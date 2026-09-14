import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/domain/cards/cards.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show definitionHash;

const PosLogger _log = PosLogger('pull');

/// Jobs and review outcomes (T2-14): the `jobs` and `reviews` streams. Each
/// job is kept whole as pulled; a later version replaces it.
class JobsSection implements PullSection {
  JobsSection(this.db);

  final PosDatabase db;

  @override
  Set<String> get streams => const {'jobs', 'reviews'};

  @override
  Future<void> describeHave(Map<String, Object?> have) async {}

  @override
  Future<void> apply(Map<String, Object?> page) async {
    final waiting = await _jobsWithWaitingActions();
    for (final pulled in _items(_map(page['jobs'])?['items'])) {
      var job = pulled;
      final id = job['id'];
      final reference = job['reference'];
      var status = job['status'];
      final updatedAt = job['updated_at'];
      if (id is! String ||
          reference is! String ||
          status is! String ||
          updatedAt is! String) {
        _log.error('a pulled job lacks id, reference, status or updated_at');
        continue;
      }
      var mine = job['assigned_to_me'] == true;
      if (waiting.contains(id)) {
        // The agent's action on it hasn't reached the server yet: keep the
        // status it gave the job, so a pull can't undo it (docs/08 §3).
        // Once the server holds the action, its own status wins.
        final local = await (db.select(
          db.jobs,
        )..where((j) => j.id.equals(id))).getSingleOrNull();
        if (local != null) {
          status = local.status;
          mine = local.assignedToMe;
          job = {...job, 'status': status, 'assigned_to_me': mine};
        }
      }
      final bank = _map(job['bank']);
      final start = job['scheduled_start'];
      await db
          .into(db.jobs)
          .insertOnConflictUpdate(
            JobsCompanion.insert(
              id: id,
              reference: reference,
              status: status,
              updatedAt: updatedAt,
              assignedToMe: Value(mine),
              bankId: Value(
                bank?['id'] is String ? bank!['id']! as String : null,
              ),
              scheduledStartMs: Value(
                start is String
                    ? DateTime.tryParse(start)?.millisecondsSinceEpoch
                    : null,
              ),
              body: jsonEncode(job),
            ),
          );
    }
    for (final review in _items(_map(page['reviews'])?['items'])) {
      final id = review['id'];
      final jobId = review['job_id'];
      final inspectionId = review['inspection_id'];
      final attempt = review['attempt'];
      final decision = review['decision'];
      final decidedAt = review['decided_at'];
      if (id is! String ||
          jobId is! String ||
          inspectionId is! String ||
          attempt is! int ||
          decision is! String ||
          decidedAt is! String) {
        _log.error('a pulled review lacks one of its required fields');
        continue;
      }
      await db
          .into(db.reviews)
          .insertOnConflictUpdate(
            ReviewsCompanion.insert(
              id: id,
              jobId: jobId,
              inspectionId: inspectionId,
              attempt: attempt,
              decision: decision,
              decidedAt: decidedAt,
              body: jsonEncode(review),
            ),
          );
    }
  }
}

/// Job authorisation cards (T2-18, docs/07 §10): the token the server
/// issues per job, kept as `job_card:<job id>`. Every card still valid is
/// reported in `have.job_card_job_ids`, so the server issues a new one only
/// for a job without one. Its expiry is the job window's (at least an hour
/// from issue), so reporting only cards with time to spare would have the
/// server issue a fresh token on every pull. Lapsed cards are dropped, and
/// the next pull brings a new one.
class CardsSection implements PullSection {
  CardsSection(this.db, {DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final PosDatabase db;
  final DateTime Function() _clock;

  @override
  Set<String> get streams => const {};

  Future<List<CachedDocumentRow>> _cards() => (db.select(
    db.cachedDocuments,
  )..where((d) => d.key.like('${DocKeys.jobCardPrefix}%'))).get();

  @override
  Future<void> describeHave(Map<String, Object?> have) async {
    final now = _clock();
    have['job_card_job_ids'] = [
      for (final row in await _cards())
        if (CardToken.tryParse(_decode(row.body))?.validAt(now) ?? false)
          row.key.substring(DocKeys.jobCardPrefix.length),
    ];
  }

  @override
  Future<void> apply(Map<String, Object?> page) async {
    final now = _clock();
    final cards = page['job_cards'];
    for (final item in cards is List<Object?> ? cards : const <Object?>[]) {
      final card = CardToken.tryParse(item);
      final jobId = item is Map<String, Object?> ? item['job_id'] : null;
      if (card == null || jobId is! String) {
        _log.error('a pulled job card lacks its job, token or expiry');
        continue;
      }
      await db
          .into(db.cachedDocuments)
          .insertOnConflictUpdate(
            CachedDocumentsCompanion.insert(
              key: '${DocKeys.jobCardPrefix}$jobId',
              body: jsonEncode(card.toJson()),
              updatedAt: isoWithOffset(now),
            ),
          );
    }
    for (final row in await _cards()) {
      if (!(CardToken.tryParse(_decode(row.body))?.validAt(now) ?? false)) {
        await (db.delete(
          db.cachedDocuments,
        )..where((d) => d.key.equals(row.key))).go();
      }
    }
  }

  static Object? _decode(String body) {
    try {
      return jsonDecode(body);
    } on FormatException {
      return null;
    }
  }
}

extension on JobsSection {
  /// Jobs with a `job_event` still on the phone, not yet sent.
  Future<Set<String>> _jobsWithWaitingActions() async {
    final rows =
        await (db.select(db.outbox)..where(
              (o) =>
                  o.type.equals('job_event') &
                  o.state.isIn([OutboxState.queued, OutboxState.inFlight]),
            ))
            .get();
    return {
      for (final r in rows)
        if (r.entityRef case final String ref when ref.startsWith('job:'))
          ref.substring('job:'.length),
    };
  }
}

/// Definitions of every kind (docs/04 §7, docs/08 §2): the bodies the
/// device lacks, each stored only if its `definition_hash` matches its
/// content, and the manifest of what is in force per context. Pinning,
/// eviction and capability fallbacks come with T3-07.
class DefinitionsSection implements PullSection {
  DefinitionsSection(this.db);

  /// The API takes up to 2000 ids in `have.definition_version_ids`.
  static const int maxHave = 2000;

  final PosDatabase db;

  @override
  Set<String> get streams => const {};

  @override
  Future<void> describeHave(Map<String, Object?> have) async {
    final column = db.definitionVersions.versionId;
    final ids =
        await (db.selectOnly(db.definitionVersions)
              ..addColumns([column])
              ..limit(maxHave))
            .map((r) => r.read(column)!)
            .get();
    if (ids.isNotEmpty) have['definition_version_ids'] = ids;
  }

  @override
  Future<void> apply(Map<String, Object?> page) async {
    final definitions = _map(page['definitions']);
    if (definitions == null) return;
    for (final body in _items(definitions['bodies'])) {
      final id = body['id'];
      final familyId = body['family_id'];
      final kind = body['kind'];
      final key = body['key'];
      final version = body['version'];
      final spec = body['spec_version'];
      final hash = body['definition_hash'];
      final definition = body['definition'];
      if (id is! String ||
          familyId is! String ||
          kind is! String ||
          key is! String ||
          version is! int ||
          spec is! String ||
          hash is! String ||
          definition is! Map<String, Object?>) {
        _log.error('a pulled definition lacks one of its required fields');
        continue;
      }
      if (definitionHash(definition) != hash) {
        // Never render or pin a definition that isn't what was published.
        _log.error('definition $kind/$key v$version failed its hash check');
        continue;
      }
      await db
          .into(db.definitionVersions)
          .insert(
            DefinitionVersionsCompanion.insert(
              versionId: id,
              familyId: familyId,
              kind: kind,
              key: key,
              bankId: Value(
                body['bank_id'] is String ? body['bank_id']! as String : null,
              ),
              version: version,
              specVersion: spec,
              hash: hash,
              body: jsonEncode(definition),
            ),
            mode: InsertMode.insertOrIgnore,
          );
    }
    final manifest = definitions['manifest'];
    if (manifest is! List<Object?>) return;
    await db.delete(db.activeDefinitions).go();
    for (final entry in _items(manifest)) {
      final kind = entry['kind'];
      final key = entry['key'];
      final versionId = entry['version_id'];
      if (kind is! String || key is! String || versionId is! String) continue;
      final bank = entry['context_bank_id'];
      await db
          .into(db.activeDefinitions)
          .insertOnConflictUpdate(
            ActiveDefinitionsCompanion.insert(
              context: bank is String ? bank : '',
              kind: kind,
              key: key,
              versionId: versionId,
            ),
          );
    }
  }
}

Map<String, Object?>? _map(Object? v) => v is Map<String, Object?> ? v : null;

List<Map<String, Object?>> _items(Object? v) => v is List<Object?>
    ? v.whereType<Map<String, Object?>>().toList()
    : const [];
