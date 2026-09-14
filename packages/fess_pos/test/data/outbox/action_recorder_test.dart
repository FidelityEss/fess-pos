@TestOn('vm')
library;

import 'package:drift/native.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/action_recorder.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_pos_api.dart';

const EnvelopeOrigin _origin = EnvelopeOrigin(
  deviceId: testDeviceId,
  clientType: 'native',
  userId: 'u-1',
);

void main() {
  late PosDatabase db;
  late ActionRecorder actions;

  // A stand-in for a job's local state: a sync_state row per job.
  Future<String?> jobState(String job) async => (await (db.select(
    db.syncState,
  )..where((s) => s.key.equals('job:$job'))).getSingleOrNull())?.value;

  Future<void> setJobState(String job, String state) => db
      .into(db.syncState)
      .insertOnConflictUpdate(
        SyncStateCompanion.insert(
          key: 'job:$job',
          value: state,
          updatedAt: 'test',
        ),
      );

  Future<ActionOutcome> accept(
    String job, {
    Duration slow = Duration.zero,
    bool fail = false,
  }) => actions.record(
    key: 'accept:job:$job',
    origin: _origin,
    allowed: () async => await jobState(job) == 'assigned',
    apply: () async {
      await Future<void>.delayed(slow);
      await setJobState(job, 'accepted');
      if (fail) throw StateError('the screen crashed mid-action');
      return PendingEnvelope(
        type: 'job_event',
        typeVersion: 1,
        payload: {'job_id': job, 'event': 'accept'},
        entityRef: 'job:$job',
      );
    },
  );

  setUp(() async {
    db = PosDatabase(NativeDatabase.memory());
    actions = ActionRecorder(OutboxStore(db));
    await setJobState('j1', 'assigned');
    await setJobState('j2', 'assigned');
  });

  tearDown(() => db.close());

  test('a double tap on a slow phone makes one envelope', () async {
    final first = accept('j1', slow: const Duration(milliseconds: 30));
    expect(actions.isRunning('accept:job:j1'), isTrue);
    final second = accept('j1');
    final outcomes = await Future.wait([first, second]);
    expect(outcomes.map((o) => o.status), everyElement(ActionStatus.recorded));
    expect(outcomes[0].envelopeId, outcomes[1].envelopeId);
    expect(await db.select(db.outbox).get(), hasLength(1));
    expect(actions.isRunning('accept:job:j1'), isFalse);
  });

  test('a tap after it finished finds the state moved on', () async {
    await accept('j1');
    final again = await accept('j1');
    expect(again.status, ActionStatus.notAllowed);
    expect(again.envelopeId, isNull);
    expect(await db.select(db.outbox).get(), hasLength(1));
  });

  test('a change that fails leaves no envelope and no change', () async {
    await expectLater(accept('j1', fail: true), throwsStateError);
    expect(await db.select(db.outbox).get(), isEmpty);
    expect(await jobState('j1'), 'assigned');
    // And the action can be tried again.
    expect((await accept('j1')).status, ActionStatus.recorded);
  });

  test('different subjects are separate actions', () async {
    final outcomes = await Future.wait([accept('j1'), accept('j2')]);
    expect(outcomes.map((o) => o.status), everyElement(ActionStatus.recorded));
    final rows = await db.select(db.outbox).get();
    expect(rows.map((r) => r.entityRef).toSet(), {'job:j1', 'job:j2'});
    expect(
      rows.map((r) => r.deviceSeq).toSet(),
      hasLength(2),
      reason: 'every envelope has its own device_seq',
    );
  });
}
