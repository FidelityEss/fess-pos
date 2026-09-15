import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/domain/sync/lost_store.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show payloadHash;
import 'package:meta/meta.dart';
import 'package:uuid/uuid.dart';

const PosLogger _log = PosLogger('outbox');

/// Milliseconds since the module started in this process: the envelope's
/// `monotonic_ms`, which the wall clock can't move (docs/12 §11).
final Stopwatch _monotonic = Stopwatch()..start();

/// Who an envelope comes from, resolved before the local transaction that
/// writes it.
@immutable
class EnvelopeOrigin {
  const EnvelopeOrigin({
    required this.deviceId,
    required this.clientType,
    this.userId,
    this.sessionId,
  });

  final String deviceId;

  /// `native` or `web`.
  final String clientType;

  /// The user whose session sends it. Null for device reports, which go
  /// with whoever is signed in.
  final String? userId;
  final String? sessionId;
}

/// What the pull reports about one envelope the server holds.
@immutable
class ServerOutcome {
  const ServerOutcome(this.id, this.state, [this.resolution]);

  final String id;

  /// `received`, `deferred`, `committed`, `duplicate`, `rejected` or
  /// `conflict`.
  final String state;

  /// `reprocessed`, `attached` or `resolved` once an admin acted on it.
  final String? resolution;
}

/// A batch to send: up to 50 envelopes and ~1 MB, all for one user.
@immutable
class OutboxBatch {
  const OutboxBatch(this.userId, this.rows);

  final String userId;
  final List<OutboxRow> rows;
}

/// What the outbox holds, for the sync chip and the sync report
/// (docs/08 §8).
@immutable
class OutboxStatus {
  const OutboxStatus({
    required this.queued,
    required this.inFlight,
    required this.durable,
    required this.needsAttention,
    required this.committed,
    this.oldestPendingAt,
    this.evidenceWaiting = 0,
    this.lostStores = 0,
  });

  final int queued;
  final int inFlight;
  final int durable;
  final int needsAttention;
  final int committed;

  /// When the oldest item the server doesn't hold yet was created.
  final DateTime? oldestPendingAt;

  int get pending => queued + inFlight;

  /// Photos and signatures whose bytes haven't gone up yet (docs/08 §8).
  final int evidenceWaiting;

  /// Everything the server doesn't hold yet: envelopes and evidence.
  int get waiting => pending + evidenceWaiting;

  /// Stores moved aside with work on them whose notice the agent hasn't
  /// acknowledged (T5-13); they count with what needs attention.
  final int lostStores;
}

/// The transactional outbox (docs/12 §3, docs/08 §3): every device write
/// becomes an envelope in the same local transaction as the change it
/// records, and leaves only by receipt.
///
/// Nothing here deletes an item the server doesn't hold. The only deletion
/// is [purgeCommitted], after the retention period (docs/08 §4).
class OutboxStore {
  OutboxStore(this._db, {DateTime Function()? clock, String Function()? newId})
    : _clock = clock ?? DateTime.now,
      _newId = newId ?? _uuid.v7;

  static const Uuid _uuid = Uuid();

  /// `sync_state` key of the last `device_seq` used.
  static const String deviceSeqKey = 'device_seq';

  /// The API takes 1–50 envelopes and 1 MB per call (docs/12 §4). The byte
  /// budget leaves room for the request's own wrapper.
  static const int maxBatchCount = 50;
  static const int maxBatchBytes = 900 * 1024;

  final PosDatabase _db;
  final DateTime Function() _clock;
  final String Function() _newId;

  PosDatabase get database => _db;

  /// Writes an envelope and returns its id. Call it inside the
  /// `db.transaction` that makes the change it records, so both are stored
  /// or neither is (docs/12 §3). Outside one it runs in its own.
  Future<String> add(
    EnvelopeOrigin origin, {
    required String type,
    required int typeVersion,
    required Map<String, Object?> payload,
    String? entityRef,
  }) => _db.transaction(() async {
    final now = _clock();
    final id = _newId();
    final seq = await _nextDeviceSeq(now);
    final hash = payloadHash(payload);
    final text = jsonEncode(
      envelopeJson(
        id: id,
        type: type,
        typeVersion: typeVersion,
        payloadHash: hash,
        deviceId: origin.deviceId,
        sessionId: origin.sessionId,
        deviceSeq: seq,
        clientType: origin.clientType,
        createdAtDevice: isoWithOffset(now),
        monotonicMs: _monotonic.elapsedMilliseconds,
        payload: payload,
      ),
    );
    final iso = isoWithOffset(now);
    await _db
        .into(_db.outbox)
        .insert(
          OutboxCompanion.insert(
            id: id,
            deviceSeq: seq,
            type: type,
            typeVersion: typeVersion,
            lane: OutboxLane.forType(type),
            userId: Value(origin.userId),
            envelope: text,
            payloadHash: hash,
            bytes: utf8.encode(text).length,
            state: OutboxState.queued,
            entityRef: Value(entityRef),
            createdAt: iso,
            createdAtMs: now.millisecondsSinceEpoch,
            updatedAt: iso,
          ),
        );
    return id;
  });

  /// The next batch that is due, in lane then sequence order, for the first
  /// user [sendAs] accepts. [sendAs] maps an item's user (null: a device
  /// report) to the user to send it as, or null when that user can't send
  /// now (not signed in, session ended).
  Future<OutboxBatch?> nextBatch({
    required String? Function(String? itemUser) sendAs,
  }) async {
    final nowMs = _clock().millisecondsSinceEpoch;
    final due =
        await (_db.select(_db.outbox)
              ..where(
                (o) =>
                    o.state.equals(OutboxState.queued) &
                    (o.nextAttemptMs.isNull() |
                        o.nextAttemptMs.isSmallerOrEqualValue(nowMs)),
              )
              ..orderBy([
                (o) => OrderingTerm.asc(o.lane),
                (o) => OrderingTerm.asc(o.deviceSeq),
              ])
              ..limit(1000))
            .get();
    String? user;
    final rows = <OutboxRow>[];
    var bytes = 0;
    for (final row in due) {
      final as = sendAs(row.userId);
      if (as == null) continue;
      user ??= as;
      if (as != user) continue;
      if (rows.isNotEmpty &&
          (rows.length >= maxBatchCount || bytes + row.bytes > maxBatchBytes)) {
        break;
      }
      rows.add(row);
      bytes += row.bytes;
    }
    return user == null ? null : OutboxBatch(user, rows);
  }

  Future<void> markInFlight(List<OutboxRow> rows) =>
      _setState(rows, OutboxState.inFlight);

  /// Back to queued, unchanged: nothing was learned (e.g. the session
  /// can't send until the host signs in again).
  Future<void> release(List<OutboxRow> rows) =>
      _setState(rows, OutboxState.queued);

  /// Back to queued, to try again after [delayFor] the new attempt count.
  Future<void> reschedule(
    List<OutboxRow> rows, {
    required Duration Function(int attempt) delayFor,
    String? error,
  }) async {
    if (rows.isEmpty) return;
    final now = _clock();
    final attempt =
        rows.map((r) => r.attempts).reduce((a, b) => a > b ? a : b) + 1;
    final next = now.add(delayFor(attempt)).millisecondsSinceEpoch;
    await (_db.update(_db.outbox)..where((o) => o.id.isIn(_ids(rows)))).write(
      OutboxCompanion(
        state: const Value(OutboxState.queued),
        attempts: Value(attempt),
        nextAttemptMs: Value(next),
        lastError: Value(error),
        updatedAt: Value(isoWithOffset(now)),
      ),
    );
  }

  /// Applies one receipt per item, in one transaction (docs/12 §4). Items
  /// refused at the door are parked and reported with a `client_error`.
  /// Returns how many of each outcome.
  Future<Map<String, int>> applyReceipts(
    List<OutboxRow> rows,
    List<IngestReceipt> receipts,
  ) => _db.transaction(() async {
    final now = _clock();
    final iso = isoWithOffset(now);
    final byId = {
      for (final r in receipts)
        if (r.id != null) r.id!: r,
    };
    final counts = <String, int>{};
    final refused = <(OutboxRow, IngestReceipt)>[];
    for (var i = 0; i < rows.length; i++) {
      final row = rows[i];
      final receipt = byId[row.id] ?? receipts[i];
      final (state, error) = _outcome(row, receipt);
      counts[state] = (counts[state] ?? 0) + 1;
      if (receipt.state == null && !receipt.durable) {
        refused.add((row, receipt));
      }
      await (_db.update(_db.outbox)..where((o) => o.id.equals(row.id))).write(
        OutboxCompanion(
          state: Value(state),
          receiptState: Value(receipt.state ?? 'refused'),
          receipt: Value(jsonEncode(receipt.raw)),
          lastError: Value(error),
          nextAttemptMs: const Value(null),
          committedAtMs: Value(
            state == OutboxState.committed ? now.millisecondsSinceEpoch : null,
          ),
          updatedAt: Value(iso),
        ),
      );
    }
    await _reportRefused(refused, now);
    return counts;
  });

  /// Parks an item the server will never take as it is (too large on its
  /// own, or refused as a request): kept as needs-attention and reported.
  Future<void> park(OutboxRow row, PosException cause) =>
      _db.transaction(() async {
        final now = _clock();
        await (_db.update(_db.outbox)..where((o) => o.id.equals(row.id))).write(
          OutboxCompanion(
            state: const Value(OutboxState.needsAttention),
            receiptState: const Value('parked'),
            lastError: Value(cause.code),
            nextAttemptMs: const Value(null),
            updatedAt: Value(isoWithOffset(now)),
          ),
        );
        _log.warning('outbox item parked (${row.type}, ${cause.code})');
        if (row.type == 'client_error') return;
        await _addClientError(row, now, [
          {
            'code': cause.code,
            'kind': 'parked_item',
            'about_envelope_id': row.id,
            'message': 'parked on the device: the server cannot take it as is',
            'detail': {
              'type': row.type,
              'type_version': row.typeVersion,
              'device_seq': row.deviceSeq,
              'bytes': row.bytes,
            },
            'at': isoWithOffset(now),
          },
        ]);
      });

  /// Applies what the pull says about envelopes the server holds (docs/08
  /// §2, §6): a deferred item later committed or rejected, a rejected one
  /// reprocessed, or one an admin resolved in the envelope inbox. A
  /// resolved or attached item is settled and leaves after the retention
  /// period like a committed one. Items the server doesn't hold yet (queued,
  /// in flight) wait for their own receipt; unknown ids are ignored.
  Future<void> applyServerOutcomes(Iterable<ServerOutcome> outcomes) =>
      _db.transaction(() async {
        final now = _clock();
        for (final o in outcomes) {
          final settled =
              o.resolution == 'resolved' || o.resolution == 'attached';
          final state = settled
              ? OutboxState.committed
              : switch (o.state) {
                  'committed' || 'duplicate' => OutboxState.committed,
                  'rejected' || 'conflict' => OutboxState.needsAttention,
                  'received' || 'deferred' => OutboxState.durable,
                  _ => null,
                };
          if (state == null) continue;
          await (_db.update(_db.outbox)..where(
                (r) =>
                    r.id.equals(o.id) &
                    r.state.isIn([
                      OutboxState.durable,
                      OutboxState.needsAttention,
                      OutboxState.committed,
                    ]) &
                    r.state.equals(state).not(),
              ))
              .write(
                OutboxCompanion(
                  state: Value(state),
                  receiptState: Value(
                    settled ? 'resolved:${o.resolution}' : o.state,
                  ),
                  committedAtMs: Value(
                    state == OutboxState.committed
                        ? now.millisecondsSinceEpoch
                        : null,
                  ),
                  updatedAt: Value(isoWithOffset(now)),
                ),
              );
        }
      });

  /// After a server restore (`server_epoch` changed, docs/12 §12): every
  /// item still kept is sent again, same id and bytes. Idempotent landing
  /// heals the gap. Needs-attention items wait for their resolution.
  Future<int> resendRetained() async {
    final now = _clock();
    return (_db.update(_db.outbox)..where(
          (o) => o.state.isIn([OutboxState.durable, OutboxState.committed]),
        ))
        .write(
          OutboxCompanion(
            state: const Value(OutboxState.queued),
            attempts: const Value(0),
            nextAttemptMs: const Value(null),
            updatedAt: Value(isoWithOffset(now)),
          ),
        );
  }

  /// Deletes committed items older than [retain] after commit
  /// (`sync.retain_committed_payload_days`, docs/08 §4). The only way an
  /// item leaves the outbox.
  Future<int> purgeCommitted(Duration retain) {
    final cutoff = _clock().subtract(retain).millisecondsSinceEpoch;
    return (_db.delete(_db.outbox)..where(
          (o) =>
              o.state.equals(OutboxState.committed) &
              o.committedAtMs.isSmallerThanValue(cutoff),
        ))
        .go();
  }

  Future<OutboxStatus> status() async {
    final counts = <String, int>{};
    final count = _db.outbox.id.count();
    final rows =
        await (_db.selectOnly(_db.outbox)
              ..addColumns([_db.outbox.state, count])
              ..groupBy([_db.outbox.state]))
            .get();
    for (final r in rows) {
      counts[r.read(_db.outbox.state)!] = r.read(count)!;
    }
    final oldest = _db.outbox.createdAtMs.min();
    final oldestMs =
        await (_db.selectOnly(_db.outbox)
              ..addColumns([oldest])
              ..where(_db.outbox.state.isIn(OutboxState.pending)))
            .map((r) => r.read(oldest))
            .getSingleOrNull();
    final photos = _db.evidence.id.count();
    final photosWaiting =
        await (_db.selectOnly(_db.evidence)
              ..addColumns([photos])
              ..where(
                _db.evidence.bytes.isNotNull() &
                    _db.evidence.state.isIn(const ['local_only', 'uploading']),
              ))
            .map((r) => r.read(photos))
            .getSingle();
    final lost = _lostStoresToShow(
      await (_db.select(
        _db.moduleMeta,
      )..where((m) => m.key.isIn(_lostKeys))).get(),
    );
    return OutboxStatus(
      evidenceWaiting: photosWaiting ?? 0,
      lostStores: lost.length,
      queued: counts[OutboxState.queued] ?? 0,
      inFlight: counts[OutboxState.inFlight] ?? 0,
      durable: counts[OutboxState.durable] ?? 0,
      needsAttention: counts[OutboxState.needsAttention] ?? 0,
      committed: counts[OutboxState.committed] ?? 0,
      oldestPendingAt: oldestMs == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(oldestMs),
    );
  }

  /// What the server couldn't take (`needs_attention`, docs/08 §8), newest
  /// first, for the needs-attention list (T4-13). Kept until the server's
  /// resolution is pulled.
  Stream<List<OutboxRow>> watchNeedsAttention() =>
      _needsAttentionQuery().watch();

  /// [status], again each time the outbox changes, for the sync status.
  Stream<OutboxStatus> watchStatus() async* {
    yield await status();
    yield* _db
        .tableUpdates(
          TableUpdateQuery.onAllTables([
            _db.outbox,
            _db.evidence,
            _db.moduleMeta,
          ]),
        )
        .asyncMap((_) => status());
  }

  /// [status] after each change to what is waiting, without the current one
  /// first: for the custody note (T5-13), which starts from [status].
  Stream<OutboxStatus> watchWaitingChanges() => _db
      .tableUpdates(TableUpdateQuery.onAllTables([_db.outbox, _db.evidence]))
      .asyncMap((_) => status());

  SimpleSelectStatement<$OutboxTable, OutboxRow> _needsAttentionQuery() =>
      _db.select(_db.outbox)
        ..where((o) => o.state.equals(OutboxState.needsAttention))
        ..orderBy([(o) => OrderingTerm.desc(o.createdAtMs)]);

  static const List<String> _lostKeys = [
    MetaKeys.quarantinedStores,
    MetaKeys.quarantinedStoresAcknowledged,
  ];

  /// Stores moved aside with work on them whose notice the agent hasn't
  /// acknowledged yet, live (T5-13, D-93).
  Stream<List<LostStore>> watchLostStores() => (_db.select(
    _db.moduleMeta,
  )..where((m) => m.key.isIn(_lostKeys))).watch().map(_lostStoresToShow);

  /// The agent has read the notice for every store moved aside so far.
  Future<void> acknowledgeLostStores() async {
    final log =
        await (_db.select(
              _db.moduleMeta,
            )..where((m) => m.key.equals(MetaKeys.quarantinedStores)))
            .getSingleOrNull();
    await _db
        .into(_db.moduleMeta)
        .insertOnConflictUpdate(
          ModuleMetaCompanion.insert(
            key: MetaKeys.quarantinedStoresAcknowledged,
            value: '${_lostLog(log?.value).length}',
            updatedAt: isoWithOffset(_clock()),
          ),
        );
  }

  static List<LostStore> _lostStoresToShow(List<ModuleMetaRow> rows) {
    final meta = {for (final r in rows) r.key: r.value};
    final acknowledged =
        int.tryParse(meta[MetaKeys.quarantinedStoresAcknowledged] ?? '') ?? 0;
    return [
      for (final store in _lostLog(
        meta[MetaKeys.quarantinedStores],
      ).skip(acknowledged))
        if (store.outcome != LostStoreOutcome.nothingUnsent) store,
    ];
  }

  static List<LostStore> _lostLog(String? json) {
    if (json == null) return const [];
    try {
      final log = jsonDecode(json);
      return log is List<Object?>
          ? [
              for (final e in log.whereType<Map<String, Object?>>())
                LostStore.fromJson(e),
            ]
          : const [];
    } on FormatException {
      return const [];
    }
  }

  /// The `client_error` for a store moved aside: what the note kept beside
  /// it says was lost, that its bytes are kept, and that nothing was
  /// recovered (C10.12).
  static Map<String, Object?> _lostStoreError(
    Map<String, Object?> store,
    DateTime now,
  ) {
    final lost = LostStore.fromJson(store);
    const moved =
        'a local store that could not be opened was moved aside '
        'intact and a new one started';
    return {
      'code': 'LOCAL_STORE_QUARANTINED',
      'kind': 'recovery_anomaly',
      'about_envelope_id': null,
      'message': switch (lost.outcome) {
        LostStoreOutcome.nothingUnsent => '$moved; the server held all of it',
        LostStoreOutcome.unsentUnrecoverable =>
          '$moved; ${lost.waiting} items the server did not hold were on it '
              'and cannot be recovered on this phone',
        LostStoreOutcome.unknown => '$moved; what was on it is unknown',
      },
      'detail': {
        ...store,
        'outcome': lost.outcome.name,
        'bytes_retained': true,
        'recovered': false,
      },
      'at': isoWithOffset(now),
    };
  }

  /// Reports stores moved into quarantine (D-52) that haven't been
  /// reported yet, as one `client_error`.
  Future<void> reportQuarantinedStores(EnvelopeOrigin origin) =>
      _db.transaction(() async {
        final meta = {
          for (final m in await _db.select(_db.moduleMeta).get()) m.key: m,
        };
        final logged = meta[MetaKeys.quarantinedStores];
        if (logged == null) return;
        final all = (jsonDecode(logged.value) as List<Object?>)
            .whereType<Map<String, Object?>>()
            .toList();
        final done =
            int.tryParse(
              meta[MetaKeys.quarantinedStoresReported]?.value ?? '',
            ) ??
            0;
        if (done >= all.length) return;
        final now = _clock();
        await add(
          origin,
          type: 'client_error',
          typeVersion: 1,
          payload: {
            'errors': [
              for (final store in all.skip(done).take(50))
                _lostStoreError(store, now),
            ],
          },
        );
        await _db
            .into(_db.moduleMeta)
            .insertOnConflictUpdate(
              ModuleMetaCompanion.insert(
                key: MetaKeys.quarantinedStoresReported,
                value: '${all.length}',
                updatedAt: isoWithOffset(now),
              ),
            );
      });

  /// The startup recovery scan for evidence (docs/12 §3, D-74): evidence
  /// still to upload whose bytes are gone is reported, each item once, as
  /// `client_error`. Nothing is deleted; the record stays for review.
  Future<void> reportEvidenceAnomalies(EnvelopeOrigin origin) =>
      _db.transaction(() async {
        final e = _db.evidence;
        final lost =
            await (_db.selectOnly(e)
                  ..addColumns([e.id, e.inspectionId, e.fieldKey])
                  ..where(e.state.equals('local_only') & e.bytes.isNull()))
                .map(
                  (r) => (
                    id: r.read(e.id)!,
                    inspectionId: r.read(e.inspectionId)!,
                    fieldKey: r.read(e.fieldKey)!,
                  ),
                )
                .get();
        if (lost.isEmpty) return;
        final logged =
            await (_db.select(
                  _db.moduleMeta,
                )..where(
                  (m) => m.key.equals(MetaKeys.evidenceAnomaliesReported),
                ))
                .getSingleOrNull();
        final reported = <String>{
          if (logged != null)
            for (final id in jsonDecode(logged.value) as List<Object?>)
              if (id is String) id,
        };
        final fresh = [
          for (final l in lost)
            if (!reported.contains(l.id)) l,
        ];
        if (fresh.isEmpty) return;
        final now = _clock();
        for (var i = 0; i < fresh.length; i += 50) {
          await add(
            origin,
            type: 'client_error',
            typeVersion: 1,
            payload: {
              'errors': [
                for (final l in fresh.skip(i).take(50))
                  {
                    'code': 'EVIDENCE_BYTES_MISSING',
                    'kind': 'recovery_anomaly',
                    'about_envelope_id': null,
                    'message':
                        'evidence recorded on this phone has lost its bytes; '
                        'its record is kept',
                    'detail': {
                      'evidence_id': l.id,
                      'inspection_id': l.inspectionId,
                      'field_key': l.fieldKey,
                    },
                    'at': isoWithOffset(now),
                  },
              ],
            },
          );
        }
        await _db
            .into(_db.moduleMeta)
            .insertOnConflictUpdate(
              ModuleMetaCompanion.insert(
                key: MetaKeys.evidenceAnomaliesReported,
                value: jsonEncode([...reported, for (final l in fresh) l.id]),
                updatedAt: isoWithOffset(now),
              ),
            );
      });

  (String, String?) _outcome(OutboxRow row, IngestReceipt receipt) {
    final hashMismatch =
        receipt.storedHash != null && receipt.storedHash != row.payloadHash;
    switch (receipt.state) {
      case 'committed' || 'duplicate':
        if (hashMismatch) {
          _log.error(
            'receipt hash differs from the payload hash (${row.type}); '
            'kept as a conflict',
          );
          return (OutboxState.needsAttention, 'STORED_HASH_MISMATCH');
        }
        return (OutboxState.committed, null);
      case 'rejected' || 'conflict':
        return (OutboxState.needsAttention, receipt.errorCode);
      case null:
        return receipt.durable
            ? (OutboxState.durable, null)
            : (OutboxState.needsAttention, receipt.errorCode ?? 'REFUSED');
      default:
        // received, deferred, or a state a newer server added: it's held.
        return receipt.durable
            ? (OutboxState.durable, null)
            : (OutboxState.queued, receipt.errorCode);
    }
  }

  Future<void> _reportRefused(
    List<(OutboxRow, IngestReceipt)> refused,
    DateTime now,
  ) async {
    final reportable = refused.where((r) => r.$1.type != 'client_error');
    if (reportable.isEmpty) return;
    _log.warning('${refused.length} envelope(s) refused at the door; parked');
    await _addClientError(reportable.first.$1, now, [
      for (final (row, receipt) in reportable.take(50))
        {
          'code': receipt.errorCode ?? 'INVALID_ENVELOPE',
          'kind': 'wrapper_rejected',
          'about_envelope_id': row.id,
          'message': 'the server refused the envelope wrapper',
          'detail': {
            'type': row.type,
            'type_version': row.typeVersion,
            'device_seq': row.deviceSeq,
            'issues': receipt.error?['details'],
          },
          'at': isoWithOffset(now),
        },
    ]);
  }

  Future<void> _addClientError(
    OutboxRow about,
    DateTime now,
    List<Map<String, Object?>> errors,
  ) async {
    final envelope = jsonDecode(about.envelope) as Map<String, Object?>;
    await add(
      EnvelopeOrigin(
        deviceId: envelope['device_id']! as String,
        clientType: envelope['client_type']! as String,
        userId: about.userId,
      ),
      type: 'client_error',
      typeVersion: 1,
      payload: {'errors': errors},
    );
  }

  Future<int> _nextDeviceSeq(DateTime now) async {
    final row = await (_db.select(
      _db.syncState,
    )..where((s) => s.key.equals(deviceSeqKey))).getSingleOrNull();
    // A new store starts above anything an earlier store on this device
    // could have used, so the server's per-device ordering holds (D-57).
    final last =
        int.tryParse(row?.value ?? '') ?? now.millisecondsSinceEpoch * 1000;
    final next = last + 1;
    await _db
        .into(_db.syncState)
        .insertOnConflictUpdate(
          SyncStateCompanion.insert(
            key: deviceSeqKey,
            value: '$next',
            updatedAt: isoWithOffset(now),
          ),
        );
    return next;
  }

  Future<void> _setState(List<OutboxRow> rows, String state) async {
    if (rows.isEmpty) return;
    await (_db.update(_db.outbox)..where((o) => o.id.isIn(_ids(rows)))).write(
      OutboxCompanion(
        state: Value(state),
        updatedAt: Value(isoWithOffset(_clock())),
      ),
    );
  }

  static List<String> _ids(List<OutboxRow> rows) => [
    for (final r in rows) r.id,
  ];
}
