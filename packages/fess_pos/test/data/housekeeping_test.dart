@TestOn('vm')
library;

import 'package:drift/drift.dart' hide isNotNull, isNull;
import 'package:drift/native.dart';
import 'package:fess_pos/src/data/local/housekeeping.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:flutter_test/flutter_test.dart';

final DateTime _now = DateTime.utc(2026, 10, 30, 12);
const Duration _retain = Duration(days: 30);

String _daysAgo(int days) =>
    _now.subtract(Duration(days: days)).toIso8601String();

void main() {
  late PosDatabase db;
  late LocalHousekeeping housekeeping;
  var seq = 0;

  Future<void> inspection(
    String id, {
    required String job,
    int attempt = 1,
    String status = 'submitted',
    String? submission,
  }) => db
      .into(db.inspections)
      .insert(
        InspectionsCompanion.insert(
          id: id,
          jobId: job,
          userId: 'u-1',
          attempt: attempt,
          status: status,
          formVersionId: 'f',
          formHash: 'h',
          flowVersionId: 'fl',
          flowHash: 'h',
          contextSnapshot: '{}',
          geofence: '{}',
          integrity: '{}',
          startedAtDevice: _daysAgo(60),
          updatedAt: _daysAgo(60),
          submissionEnvelopeId: Value(submission),
        ),
      );

  Future<void> evidence(
    String id,
    String inspectionId, {
    String state = 'verified',
    bool bytes = false,
    int daysAgo = 40,
  }) => db
      .into(db.evidence)
      .insert(
        EvidenceCompanion.insert(
          id: id,
          inspectionId: inspectionId,
          jobId: 'j',
          userId: 'u-1',
          fieldKey: 'p',
          category: 'photo',
          type: 'photo',
          mime: 'image/jpeg',
          sha256: 'a' * 64,
          size: 3,
          capturedAtDevice: _daysAgo(60),
          capturedMonotonicMs: 1,
          state: state,
          createdAtMs: 1,
          updatedAt: _daysAgo(daysAgo),
          bytes: Value(bytes ? Uint8List.fromList([1, 2, 3]) : null),
        ),
      );

  Future<void> review(String inspectionId, String decision, {int days = 40}) =>
      db
          .into(db.reviews)
          .insert(
            ReviewsCompanion.insert(
              id: 'r-$inspectionId',
              jobId: 'j',
              inspectionId: inspectionId,
              attempt: 1,
              decision: decision,
              decidedAt: _daysAgo(days),
              body: '{}',
            ),
          );

  Future<void> envelope(String id, String state, {String? ref}) => db
      .into(db.outbox)
      .insert(
        OutboxCompanion.insert(
          id: id,
          deviceSeq: ++seq,
          type: 'submission',
          typeVersion: 1,
          lane: 0,
          envelope: '{}',
          payloadHash: 'h',
          bytes: 2,
          state: state,
          createdAt: _daysAgo(60),
          createdAtMs: 1,
          updatedAt: _daysAgo(60),
          entityRef: Value(ref),
        ),
      );

  Future<Set<String>> inspections() async => {
    for (final r in await db.select(db.inspections).get()) r.id,
  };

  Future<Set<String>> evidenceIds() async => {
    for (final r in await db.select(db.evidence).get()) r.id,
  };

  setUp(() {
    db = PosDatabase(NativeDatabase.memory());
    housekeeping = LocalHousekeeping(db, clock: () => _now);
    seq = 0;
  });

  tearDown(() => db.close());

  test('an approved inspection goes after the retention period, with its '
      'evidence records (T5-08)', () async {
    await inspection('i1', job: 'j1', submission: 'env-1');
    await evidence('e1', 'i1');
    await review('i1', 'approved');
    final cleared = await housekeeping.run(_retain);
    expect(cleared.inspections, 1);
    expect(await inspections(), isEmpty);
    expect(await evidenceIds(), isEmpty);
  });

  test('never before the retention period, while anything about it waits '
      'for the server, or while its evidence still has bytes', () async {
    await inspection('i2', job: 'j2');
    await review('i2', 'approved', days: 10);
    await inspection('i3', job: 'j3', submission: 'env-3');
    await review('i3', 'approved');
    await envelope('env-3', OutboxState.queued, ref: 'job:j3');
    await inspection('i4', job: 'j4');
    await review('i4', 'rejected');
    await evidence('e4', 'i4', state: 'quarantined', bytes: true);
    await inspection('i5', job: 'j5');
    await review('i5', 'rejected');
    await envelope('env-5', OutboxState.needsAttention, ref: 'job:j5');

    final cleared = await housekeeping.run(_retain);
    expect(cleared.inspections, 0);
    expect(await inspections(), {'i2', 'i3', 'i4', 'i5'});
    expect(await evidenceIds(), {'e4'});
  });

  test('a returned attempt goes once the next attempt is committed', () async {
    await inspection('i6', job: 'j6');
    await review('i6', 'returned', days: 1);
    await inspection('i7', job: 'j6', attempt: 2, submission: 'env-7');
    await envelope('env-7', OutboxState.inFlight, ref: 'job:j6');
    await housekeeping.run(_retain);
    expect(await inspections(), {'i6', 'i7'}, reason: 'not yet committed');

    await (db.update(db.outbox)..where((o) => o.id.equals('env-7'))).write(
      const OutboxCompanion(state: Value(OutboxState.committed)),
    );
    await housekeeping.run(_retain);
    expect(await inspections(), {'i7'});
  });

  test("a verified item's record goes after the retention period", () async {
    await inspection('i8', job: 'j8', status: 'in_progress');
    await evidence('e8', 'i8');
    await evidence('e9', 'i8', daysAgo: 10);
    await evidence('e10', 'i8', state: 'uploaded');
    await evidence('e11', 'i8');
    await envelope('env-11', OutboxState.queued, ref: 'evidence:e11');
    final cleared = await housekeeping.run(_retain);
    expect(cleared.evidence, 1);
    expect(await evidenceIds(), {'e9', 'e10', 'e11'});
    expect(await inspections(), {'i8'});
  });
}
