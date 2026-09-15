@TestOn('vm')
library;

import 'dart:convert';

import 'package:drift/drift.dart' hide isNotNull, isNull;
import 'package:drift/native.dart';
import 'package:fess_pos/src/data/local/job_actions_store.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/action_recorder.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/data/sync/sections.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show answersHash;
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_pos_api.dart';

const String _configVersion = '0191d3c2-7a4e-7c1b-9f10-4b2e1c0a9e10';
const String _formVersion = '0191d3c2-7a4e-7c1b-9f10-4b2e1c0a9d40';
final String _hash = 'a' * 64;

Map<String, Object?> _pulledJob(
  String id, {
  String status = 'assigned',
  bool mine = true,
}) => {
  'id': id,
  'reference': 'POS-$id',
  'status': status,
  'assigned_to_me': mine,
  'updated_at': '2026-09-14T08:00:00Z',
  'merchant_name': 'Joe Spaza',
};

void main() {
  late PosDatabase db;
  late DriftJobActions actions;
  var signedIn = true;
  var sends = 0;

  JobRecord job(String id, {String status = 'assigned'}) => JobRecord(
    id: id,
    reference: 'POS-$id',
    status: status,
    assignedToMe: true,
    data: const {},
  );

  Future<void> putJob(String id, {String status = 'assigned'}) =>
      JobsSection(db).apply({
        'jobs': {
          'items': [_pulledJob(id, status: status)],
        },
      });

  Future<JobRow> row(String id) =>
      (db.select(db.jobs)..where((j) => j.id.equals(id))).getSingle();

  Future<List<OutboxRow>> envelopes() => db.select(db.outbox).get();

  Map<String, Object?> payloadOf(OutboxRow r) =>
      (jsonDecode(r.envelope) as Map<String, Object?>)['payload']!
          as Map<String, Object?>;

  Future<void> setState(String id, String state) =>
      (db.update(db.outbox)..where((o) => o.id.equals(id))).write(
        OutboxCompanion(state: Value(state)),
      );

  ReasonSubmission reason(String code, {String? note}) => ReasonSubmission(
    reasonCode: code,
    note: note,
    formVersionId: _formVersion,
    definitionHash: _hash,
    answers: {
      'reason_code': {'v': code},
      if (note != null) 'note': {'v': note},
    },
  );

  setUp(() async {
    db = PosDatabase(NativeDatabase.memory());
    signedIn = true;
    sends = 0;
    actions = DriftJobActions(
      db: db,
      recorder: ActionRecorder(OutboxStore(db)),
      origin: () async => signedIn
          ? const EnvelopeOrigin(
              deviceId: testDeviceId,
              clientType: 'native',
              userId: 'u-1',
              sessionId: 's-1',
            )
          : null,
      send: () async => sends++,
    );
    await putJob('j1');
    await db
        .into(db.cachedDocuments)
        .insert(
          CachedDocumentsCompanion.insert(
            key: DocKeys.configDefault,
            body: '{}',
            hash: const Value(_configVersion),
            updatedAt: '2026-09-14T08:00:00+02:00',
          ),
        );
  });

  tearDown(() => db.close());

  test('accepting moves the job and writes one envelope', () async {
    final first = await actions.record(job('j1'), JobAction.accept);
    final second = await actions.record(job('j1'), JobAction.accept);
    expect(first.status, JobActionStatus.recorded);
    expect(second.status, JobActionStatus.notAllowed, reason: 'already moved');
    expect((await row('j1')).status, 'accepted');
    final rows = await envelopes();
    expect(rows, hasLength(1));
    expect(rows.single.id, first.envelopeId);
    expect(rows.single.type, 'job_event');
    expect(rows.single.userId, 'u-1');
    expect(rows.single.entityRef, 'job:j1');
    expect(payloadOf(rows.single), {
      'job_id': 'j1',
      'action': 'accept',
      'trigger': 'agent',
      'evidence_ids': <Object?>[],
      'config_version_id': _configVersion,
    });
  });

  test('rejecting hands the job back and carries the reason form', () async {
    final result = await actions.record(
      job('j1'),
      JobAction.reject,
      reason: reason('conflict', note: 'My cousin'),
    );
    expect(result.status, JobActionStatus.recorded);
    final r = await row('j1');
    expect(r.status, 'scheduled');
    expect(r.assignedToMe, isFalse);
    expect(
      (jsonDecode(r.body) as Map<String, Object?>)['status'],
      'scheduled',
      reason: 'views read the body',
    );
    final payload = payloadOf((await envelopes()).single);
    final answers = {
      'reason_code': {'v': 'conflict'},
      'note': {'v': 'My cousin'},
    };
    expect(payload, {
      'job_id': 'j1',
      'action': 'reject',
      'trigger': 'agent',
      'reason_code': 'conflict',
      'note': 'My cousin',
      'form_version_id': _formVersion,
      'definition_hash': _hash,
      'form_answers': answers,
      'answers_hash': answersHash(answers),
      'evidence_ids': <Object?>[],
      'config_version_id': _configVersion,
    });
  });

  test('unable once accepted; not before the job allows it', () async {
    await putJob('j2', status: 'scheduled');
    expect(
      (await actions.record(
        job('j2', status: 'scheduled'),
        JobAction.unable,
        reason: reason('business_closed'),
      )).status,
      JobActionStatus.notAllowed,
    );
    await actions.record(job('j1'), JobAction.accept);
    final unable = await actions.record(
      job('j1', status: 'accepted'),
      JobAction.unable,
      reason: reason('business_closed'),
    );
    expect(unable.status, JobActionStatus.recorded);
    expect((await row('j1')).status, 'unable_to_complete');
    expect(await envelopes(), hasLength(2));
  });

  test('nothing is written without a signed-in session', () async {
    signedIn = false;
    final result = await actions.record(job('j1'), JobAction.accept);
    expect(result.status, JobActionStatus.unavailable);
    expect(await envelopes(), isEmpty);
    expect((await row('j1')).status, 'assigned');
  });

  test('reject and unable need their reason', () {
    expect(
      () => actions.record(job('j1'), JobAction.reject),
      throwsArgumentError,
    );
  });

  test('delivery follows the envelope', () async {
    final id = (await actions.record(job('j1'), JobAction.accept)).envelopeId!;
    final seen = <DeliveryState>[];
    final sub = actions.watchDelivery(id).listen(seen.add);
    await pumpEventQueue();
    await setState(id, OutboxState.durable);
    await pumpEventQueue();
    await setState(id, OutboxState.needsAttention);
    await pumpEventQueue();
    await sub.cancel();
    expect(seen, [
      DeliveryState.waiting,
      DeliveryState.delivered,
      DeliveryState.needsAttention,
    ]);
    await actions.sendNow();
    expect(sends, 1);
  });

  test("a pull doesn't undo an action still on the phone", () async {
    final id = (await actions.record(job('j1'), JobAction.accept)).envelopeId!;
    // The server hasn't seen the accept yet: its job still says assigned.
    await putJob('j1');
    final kept = await row('j1');
    expect(kept.status, 'accepted');
    expect(
      (jsonDecode(kept.body) as Map<String, Object?>)['status'],
      'accepted',
    );
    expect(
      (jsonDecode(kept.body) as Map<String, Object?>)['merchant_name'],
      'Joe Spaza',
      reason: 'the rest of the pulled job still lands',
    );

    // Once the server holds it, the server's word wins, e.g. an admin who
    // revoked the job meanwhile.
    await setState(id, OutboxState.committed);
    await putJob('j1', status: 'scheduled');
    expect((await row('j1')).status, 'scheduled');
  });
}
