import 'package:drift/drift.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart' show OutboxState;

const PosLogger _log = PosLogger('housekeeping');

/// What one clean-up cleared.
typedef Cleared = ({int evidence, int inspections});

/// Clears what the phone no longer needs, and only on the server's word
/// (docs/08 §4, T5-08, D-91). After the retention period
/// (`sync.retain_committed_payload_days`, the one committed envelopes keep):
/// - a verified item's record and hash (its bytes left when it was
///   verified);
/// - an inspection the server approved or rejected, with its evidence
///   records.
///
/// A returned attempt goes once the attempt after it is committed. Nothing
/// goes while an envelope about it isn't committed, or while any of its
/// evidence still holds bytes.
class LocalHousekeeping {
  LocalHousekeeping(this._db, {DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final PosDatabase _db;
  final DateTime Function() _clock;

  Future<Cleared> run(Duration retain) => _db.transaction(() async {
    final cutoff = _clock().subtract(retain);
    bool older(String iso) {
      final at = DateTime.tryParse(iso);
      return at != null && at.isBefore(cutoff);
    }

    final pending = await (_db.select(
      _db.outbox,
    )..where((o) => o.state.equals(OutboxState.committed).not())).get();
    final openIds = {for (final o in pending) o.id};
    final openRefs = {for (final o in pending) ?o.entityRef};

    final reviews = {
      for (final r in await _db.select(_db.reviews).get()) r.inspectionId: r,
    };
    final submitted = await (_db.select(
      _db.inspections,
    )..where((i) => i.status.equals('submitted'))).get();
    bool nextCommitted(InspectionRow row) => submitted.any(
      (later) =>
          later.jobId == row.jobId &&
          later.attempt > row.attempt &&
          later.submissionEnvelopeId != null &&
          !openIds.contains(later.submissionEnvelopeId),
    );

    var inspections = 0;
    for (final row in submitted) {
      final review = reviews[row.id];
      final due = switch (review?.decision) {
        'approved' || 'rejected' => older(review!.decidedAt),
        'returned' => nextCommitted(row),
        _ => false,
      };
      if (!due) continue;
      final evidence = await (_db.select(
        _db.evidence,
      )..where((e) => e.inspectionId.equals(row.id))).get();
      final settled =
          !openIds.contains(row.startedEnvelopeId) &&
          !openIds.contains(row.submissionEnvelopeId) &&
          !openRefs.contains('inspection:${row.id}') &&
          !openRefs.contains('job:${row.jobId}') &&
          evidence.every(
            (e) => e.bytes == null && !openRefs.contains('evidence:${e.id}'),
          );
      if (!settled) continue;
      await (_db.delete(
        _db.evidence,
      )..where((e) => e.inspectionId.equals(row.id))).go();
      await (_db.delete(
        _db.inspections,
      )..where((i) => i.id.equals(row.id))).go();
      inspections++;
    }

    var evidence = 0;
    final verified = await (_db.select(
      _db.evidence,
    )..where((e) => e.state.equals('verified') & e.bytes.isNull())).get();
    for (final item in verified) {
      if (!older(item.updatedAt)) continue;
      if (openRefs.contains('evidence:${item.id}')) continue;
      await (_db.delete(
        _db.evidence,
      )..where((e) => e.id.equals(item.id))).go();
      evidence++;
    }
    if (evidence + inspections > 0) {
      _log.info(
        'cleared $evidence evidence records and $inspections inspections '
        'the server holds',
      );
    }
    return (evidence: evidence, inspections: inspections);
  });
}
