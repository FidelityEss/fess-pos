import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_cache.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/core/config/remote_config.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:meta/meta.dart';

const PosLogger _log = PosLogger('pull');

/// One part of the pull that a later task owns (docs/08 §2): jobs and
/// reviews (T2-14), definitions and lists (T3-07), evidence (T4-03). A
/// stream's cursor moves only when a section applied it, so nothing is
/// skipped before the module can store it.
abstract interface class PullSection {
  /// The cursor streams this section applies, e.g. `jobs`.
  Set<String> get streams;

  /// Adds what the device already holds to the request's `have`.
  Future<void> describeHave(Map<String, Object?> have);

  /// Applies [page], inside the page's local transaction.
  Future<void> apply(Map<String, Object?> page);
}

/// `cached_documents` keys.
abstract final class DocKeys {
  static const String configDefault = 'config:default';
  static const String configBankPrefix = 'config:bank:';
  static const String me = 'me';
  static const String agentTotals = 'agent_totals';
  static const String reasonCodes = 'reason_codes';
  static const String agentCard = 'agent_card';
}

/// `sync_state` keys the pull keeps.
abstract final class SyncKeys {
  static const String serverEpoch = 'server_epoch';
  static const String clockOffsetMs = 'clock_offset_ms';
  static const String lastPullAt = 'last_pull_at';

  static String cursor(String stream) => 'cursor.$stream';
}

/// What one [PullEngine.pull] did.
@immutable
class PullReport {
  const PullReport({
    required this.pages,
    required this.complete,
    this.epochChanged = false,
    this.resent = 0,
    this.bootstrap,
  });

  final int pages;

  /// Every stream was pulled to its end (not stopped by the page limit).
  final bool complete;

  /// The server was restored since the last pull (docs/12 §12).
  final bool epochChanged;

  /// Envelopes queued again because of a restore or a command.
  final int resent;

  /// The kill switches and other bootstrap keys of the new config, if one
  /// came.
  final BootstrapSnapshot? bootstrap;
}

/// The pull (docs/08 §2): `POST /v1/sync/pull` page by page until every
/// stream the module stores is complete. Each page is applied in one local
/// transaction.
///
/// It keeps the resolved remote config (and refreshes the cached kill
/// switches, docs/13 §6), the clock offset and `server_epoch`, and applies
/// envelope outcomes to the outbox. A changed `server_epoch` means the
/// server was restored: every envelope the device still keeps is sent again
/// (docs/12 §12).
class PullEngine {
  PullEngine({
    required this.db,
    required this.client,
    required this.outbox,
    required this.bootstrapCache,
    required this.capabilities,
    this.sections = const [],
    this.pageLimit = 200,
    this.maxPages = 20,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final PosDatabase db;
  final PosApiClient client;
  final OutboxStore outbox;
  final BootstrapCache bootstrapCache;

  /// The capability report sent with every pull (docs/04 §8).
  final Map<String, Object?> capabilities;
  final List<PullSection> sections;
  final int pageLimit;

  /// Pages per pull; the next pull carries on from the cursors.
  final int maxPages;
  final DateTime Function() _clock;

  /// The streams whose cursors this engine keeps.
  Set<String> get streams => {
    'envelopes',
    for (final s in sections) ...s.streams,
  };

  /// Pulls until complete or [maxPages]. Throws the client's
  /// `PosException` (e.g. `SCOPE_INSUFFICIENT` after sign-out); pages
  /// already applied stay applied.
  Future<PullReport> pull({String? userId}) async {
    var pages = 0;
    var epochChanged = false;
    var resent = 0;
    BootstrapSnapshot? bootstrap;
    while (pages < maxPages) {
      final page = await client.pull(await _request(), userId: userId);
      pages++;
      final applied = await _apply(page);
      epochChanged = epochChanged || applied.epochChanged;
      resent += applied.resent;
      bootstrap = applied.bootstrap ?? bootstrap;
      if (!_hasMore(page)) {
        return PullReport(
          pages: pages,
          complete: true,
          epochChanged: epochChanged,
          resent: resent,
          bootstrap: bootstrap,
        );
      }
    }
    return PullReport(
      pages: pages,
      complete: false,
      epochChanged: epochChanged,
      resent: resent,
      bootstrap: bootstrap,
    );
  }

  Future<Map<String, Object?>> _request() async {
    final state = {
      for (final r in await db.select(db.syncState).get()) r.key: r.value,
    };
    final reasons = await _doc(DocKeys.reasonCodes);
    final have = <String, Object?>{
      'reason_codes_hash': ?reasons?.hash,
      'agent_card_valid': _agentCardValid(await _doc(DocKeys.agentCard)),
    };
    for (final s in sections) {
      await s.describeHave(have);
    }
    return {
      'cursors': {
        for (final s in streams)
          if (state[SyncKeys.cursor(s)] != null) s: state[SyncKeys.cursor(s)],
      },
      'have': have,
      'capabilities': capabilities,
      'limit': pageLimit,
    };
  }

  Future<({bool epochChanged, int resent, BootstrapSnapshot? bootstrap})>
  _apply(Map<String, Object?> page) async {
    Map<String, Object?>? defaults;
    String? configVersion;
    final applied = await db.transaction(() async {
      final now = _clock();
      var resent = 0;
      var epochChanged = false;

      final serverTime = DateTime.tryParse(_string(page['server_time']) ?? '');
      if (serverTime != null) {
        await _setState(
          SyncKeys.clockOffsetMs,
          '${serverTime.difference(now).inMilliseconds}',
          now,
        );
      }
      final epoch = _string(page['server_epoch']);
      if (epoch != null) {
        final known = await _getState(SyncKeys.serverEpoch);
        if (known != null && known != epoch) {
          epochChanged = true;
          resent += await outbox.resendRetained();
          _log.warning('the server was restored; kept envelopes go again');
        }
        await _setState(SyncKeys.serverEpoch, epoch, now);
      }

      final config = _map(page['config']);
      final byDefault = _map(config?['default']);
      if (byDefault != null) {
        defaults = _map(byDefault['values']);
        configVersion = _string(byDefault['config_version_id']);
        await _putDoc(DocKeys.configDefault, byDefault, now, configVersion);
        final byBank = _map(config?['by_bank']) ?? const {};
        await (db.delete(db.cachedDocuments)..where(
              (d) =>
                  d.key.like('${DocKeys.configBankPrefix}%') &
                  d.key.isIn([
                    for (final id in byBank.keys)
                      '${DocKeys.configBankPrefix}$id',
                  ]).not(),
            ))
            .go();
        for (final e in byBank.entries) {
          final bank = _map(e.value);
          if (bank == null) continue;
          await _putDoc(
            '${DocKeys.configBankPrefix}${e.key}',
            bank,
            now,
            _string(bank['config_version_id']),
          );
        }
      }

      final me = _map(page['me']);
      if (me != null) await _putDoc(DocKeys.me, me, now, null);
      final totals = _map(page['agent_totals']);
      if (totals != null) {
        await _putDoc(DocKeys.agentTotals, totals, now, null);
      }
      final reasons = _map(page['reason_codes']);
      if (reasons != null && reasons['items'] != null) {
        await _putDoc(
          DocKeys.reasonCodes,
          reasons['items'],
          now,
          _string(reasons['hash']),
        );
      }
      final card = _map(page['agent_card']);
      if (card != null) await _putDoc(DocKeys.agentCard, card, now, null);

      final envelopes = _map(page['envelopes']);
      await outbox.applyServerOutcomes([
        for (final item in _list(envelopes?['items']))
          if (_string(item['id']) != null && _string(item['state']) != null)
            ServerOutcome(
              _string(item['id'])!,
              _string(item['state'])!,
              _string(item['resolution']),
            ),
      ]);

      for (final command in _list(page['commands'])) {
        if (command['type'] == 'resend_envelopes') {
          resent += await outbox.resendRetained();
        } else {
          _log.info('server command ${command['type']} is not supported yet');
        }
      }

      for (final s in sections) {
        await s.apply(page);
      }
      for (final stream in streams) {
        final cursor = _string(_map(page[stream])?['next_cursor']);
        if (cursor != null) {
          await _setState(SyncKeys.cursor(stream), cursor, now);
        }
      }
      await _setState(SyncKeys.lastPullAt, isoWithOffset(now), now);
      return (epochChanged: epochChanged, resent: resent);
    });

    BootstrapSnapshot? bootstrap;
    final values = defaults;
    if (values != null) {
      bootstrap = BootstrapSnapshot.fromResolvedConfig(
        values,
        configVersionId: configVersion,
      );
      try {
        await bootstrapCache.write(bootstrap.toCacheJson());
      } on Object catch (e, st) {
        _log.warning(
          'the kill-switch cache could not be written',
          error: e,
          stackTrace: st,
        );
      }
    }
    return (
      epochChanged: applied.epochChanged,
      resent: applied.resent,
      bootstrap: bootstrap,
    );
  }

  bool _hasMore(Map<String, Object?> page) =>
      streams.any((s) => _map(page[s])?['has_more'] == true);

  bool _agentCardValid(CachedDocumentRow? row) {
    if (row == null) return false;
    final card = _map(jsonDecode(row.body));
    final validTo = DateTime.tryParse(_string(card?['valid_to']) ?? '');
    return validTo != null &&
        validTo.isAfter(_clock().add(const Duration(hours: 1)));
  }

  Future<CachedDocumentRow?> _doc(String key) => (db.select(
    db.cachedDocuments,
  )..where((d) => d.key.equals(key))).getSingleOrNull();

  Future<void> _putDoc(String key, Object? body, DateTime now, String? hash) =>
      db
          .into(db.cachedDocuments)
          .insertOnConflictUpdate(
            CachedDocumentsCompanion.insert(
              key: key,
              body: jsonEncode(body),
              hash: Value(hash),
              updatedAt: isoWithOffset(now),
            ),
          );

  Future<String?> _getState(String key) async => (await (db.select(
    db.syncState,
  )..where((s) => s.key.equals(key))).getSingleOrNull())?.value;

  Future<void> _setState(String key, String value, DateTime now) => db
      .into(db.syncState)
      .insertOnConflictUpdate(
        SyncStateCompanion.insert(
          key: key,
          value: value,
          updatedAt: isoWithOffset(now),
        ),
      );
}

/// The stored resolved config for [bankId] (or the default context), or
/// the bundled defaults before the first pull.
Future<RemoteConfig> readRemoteConfig(PosDatabase db, {String? bankId}) async {
  Future<CachedDocumentRow?> doc(String key) => (db.select(
    db.cachedDocuments,
  )..where((d) => d.key.equals(key))).getSingleOrNull();
  final row =
      (bankId == null
          ? null
          : await doc('${DocKeys.configBankPrefix}$bankId')) ??
      await doc(DocKeys.configDefault);
  if (row == null) return RemoteConfig.bundled;
  final body = _map(jsonDecode(row.body));
  return RemoteConfig(
    _map(body?['values']),
    versionId: _string(body?['config_version_id']),
  );
}

Map<String, Object?>? _map(Object? v) => v is Map<String, Object?> ? v : null;

String? _string(Object? v) => v is String ? v : null;

List<Map<String, Object?>> _list(Object? v) => v is List<Object?>
    ? v.whereType<Map<String, Object?>>().toList()
    : const [];
