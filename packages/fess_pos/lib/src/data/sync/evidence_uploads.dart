import 'package:drift/drift.dart';
import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/remote/evidence_uploader.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/remote/retry_policy.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show sha256HexBytes;

const PosLogger _log = PosLogger('evidence');

/// The evidence upload lane (docs/08 §3, docs/12 §6). Once an item's
/// `evidence_meta` is held by the server, its bytes go up through an upload
/// grant and `evidence_uploaded` is recorded. One item at a time, as budget
/// phones need.
///
/// Every failure waits for the next sync run. The bytes stay on the phone
/// until the pull reports the object verified (docs/08 §4).
class EvidenceUploads {
  EvidenceUploads({
    required this.outbox,
    required this.client,
    required this.uploader,
    required Future<EnvelopeOrigin> Function(String userId) originFor,
    DateTime Function()? clock,
  }) : _originFor = originFor,
       _clock = clock ?? DateTime.now;

  final OutboxStore outbox;
  final PosApiClient client;
  final EvidenceUploader uploader;
  final Future<EnvelopeOrigin> Function(String userId) _originFor;
  final DateTime Function() _clock;

  PosDatabase get _db => outbox.database;

  /// Uploads what is due; returns how many `evidence_uploaded` envelopes it
  /// wrote. Stops at the first failure that means the network or the
  /// server is out of reach.
  Future<int> run() async {
    final e = _db.evidence;
    // Ids first: the bytes are read one item at a time (D-74).
    final waiting =
        await (_db.selectOnly(e)
              ..addColumns([e.id])
              ..where(e.state.equals('local_only') & e.bytes.isNotNull())
              ..orderBy([OrderingTerm.asc(e.createdAtMs)]))
            .map((r) => r.read(e.id)!)
            .get();
    var written = 0;
    for (final id in waiting) {
      final row = await (_db.select(
        e,
      )..where((x) => x.id.equals(id))).getSingleOrNull();
      if (row == null || row.state != 'local_only' || row.bytes == null) {
        continue;
      }
      final envelopes = await (_db.select(
        _db.outbox,
      )..where((o) => o.entityRef.equals('evidence:${row.id}'))).get();
      if (envelopes.any((o) => o.type == 'evidence_uploaded')) {
        await _setState(row.id, 'uploaded');
        continue;
      }
      final meta = envelopes.where((o) => o.type == 'evidence_meta');
      // The record and the bytes were written together, so a record no
      // longer in the outbox was committed and later purged (docs/08 §4):
      // only one still waiting for the server holds the upload back.
      final held =
          meta.isEmpty ||
          meta.any(
            (o) =>
                o.state == OutboxState.durable ||
                o.state == OutboxState.committed,
          );
      // The grant needs the record first (EVIDENCE_NOT_LANDED otherwise).
      if (!held) continue;
      try {
        if (await _upload(row)) written++;
      } on PosException catch (e) {
        switch (classifyFailure(e)) {
          case FailureAction.retry || FailureAction.refreshSession:
            _log.info('evidence uploads wait (${e.code})');
            return written;
          case FailureAction.signInAgain ||
              FailureAction.denied ||
              FailureAction.park ||
              FailureAction.splitBatch:
            // This item or its user can't go now; the others may.
            _log.warning('evidence ${row.id} not uploaded (${e.code})');
        }
      }
    }
    return written;
  }

  /// One item. True when `evidence_uploaded` was written.
  Future<bool> _upload(EvidenceRow row) async {
    final grant = await client.uploadGrant(row.id, userId: row.userId);
    switch (grant['state']) {
      case 'upload':
        final url = grant['signed_url'];
        final bytes = row.bytes;
        if (url is! String || bytes == null) return false;
        final local = sha256HexBytes(bytes);
        final mismatch = local == row.sha256 ? null : local;
        if (mismatch != null) {
          // The stored bytes changed since capture. They go up anyway: the
          // server's own hash check quarantines them, and nothing is lost.
          _log.error('evidence ${row.id} failed its pre-upload hash check');
        }
        final type = grant['content_type'];
        try {
          await uploader.put(
            Uri.parse(url),
            bytes,
            contentType: type is String ? type : row.mime,
          );
        } on PosException catch (e) {
          if (e.code != EvidenceUploader.alreadyStored) rethrow;
        }
        await _recordUploaded(row, grant['path'], localHash: mismatch);
        return true;
      case 'already_uploaded':
        await _recordUploaded(row, grant['path']);
        return true;
      case 'already_verified':
        await (_db.update(
          _db.evidence,
        )..where((e) => e.id.equals(row.id))).write(
          EvidenceCompanion(
            state: const Value('verified'),
            bytes: const Value(null),
            updatedAt: Value(isoWithOffset(_clock())),
          ),
        );
        return false;
      case 'quarantined':
        await _setState(row.id, 'quarantined');
        return false;
      default:
        _log.warning('upload grant for ${row.id} in an unknown state');
        return false;
    }
  }

  /// `evidence_uploaded` and the item's new state, in one transaction; with
  /// [localHash], the hash the stored bytes had instead of the recorded one,
  /// reported alongside (docs/12 §3: uploaded anyway, never dropped).
  Future<void> _recordUploaded(
    EvidenceRow row,
    Object? path, {
    String? localHash,
  }) async {
    final origin = await _originFor(row.userId);
    final now = _clock();
    await _db.transaction(() async {
      if (localHash != null) {
        await outbox.add(
          origin,
          type: 'client_error',
          typeVersion: 1,
          payload: {
            'errors': [
              {
                'code': 'EVIDENCE_LOCAL_HASH_MISMATCH',
                'kind': 'local_hash_mismatch',
                'about_envelope_id': null,
                'message':
                    'the stored bytes no longer match the hash taken at '
                    'capture; uploaded anyway for the server to check',
                'detail': {
                  'evidence_id': row.id,
                  'recorded_sha256': row.sha256,
                  'local_sha256': localHash,
                },
                'at': isoWithOffset(now),
              },
            ],
          },
        );
      }
      await outbox.add(
        origin,
        type: 'evidence_uploaded',
        typeVersion: 1,
        entityRef: 'evidence:${row.id}',
        payload: {
          'evidence_id': row.id,
          'object_key': ?(path is String && path.isNotEmpty ? path : null),
          'sha256': row.sha256,
          'bytes': row.size,
          'uploaded_at_device': isoWithOffset(now),
        },
      );
      await _setState(row.id, 'uploaded');
    });
  }

  Future<void> _setState(String id, String state) =>
      (_db.update(_db.evidence)..where((e) => e.id.equals(id))).write(
        EvidenceCompanion(
          state: Value(state),
          updatedAt: Value(isoWithOffset(_clock())),
        ),
      );
}
