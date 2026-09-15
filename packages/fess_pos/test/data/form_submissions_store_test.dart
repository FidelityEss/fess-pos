@TestOn('vm')
library;

import 'dart:convert';

import 'package:drift/drift.dart' hide isNotNull, isNull;
import 'package:drift/native.dart';
import 'package:fess_pos/src/data/local/form_submissions_store.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/action_recorder.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/domain/forms/form_submissions.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show answersHash;
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_pos_api.dart';

const String _configVersion = '0191d3c2-7a4e-7c1b-9f10-4b2e1c0a9e10';
const String _formVersion = '0191d3c2-7a4e-7c1b-9f10-4b2e1c0a9d61';
const String _submissionId = '0191d3c2-7a4e-7c1b-9f10-4b2e1c0a9d60';
const String _userId = '0191d3c2-7a4e-7c1b-9f10-4b2e1c0a9d70';
const String _jobId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
final String _hash = '7' * 64;

const Map<String, Object?> _answers = {
  'spoke_to': {'v': 'Owner'},
};

void main() {
  late PosDatabase db;
  late DriftFormSubmissions submissions;
  var signedIn = true;
  var sends = 0;

  FormSubmission submission(SubmissionSubject subject, {String? jobId}) =>
      FormSubmission(
        formVersionId: _formVersion,
        definitionHash: _hash,
        subject: subject,
        jobId: jobId,
        answers: _answers,
        contextSnapshot: const {'today': '2026-09-15'},
      );

  Future<List<OutboxRow>> envelopes() => db.select(db.outbox).get();

  Map<String, Object?> payloadOf(OutboxRow r) =>
      (jsonDecode(r.envelope) as Map<String, Object?>)['payload']!
          as Map<String, Object?>;

  setUp(() async {
    db = PosDatabase(NativeDatabase.memory());
    signedIn = true;
    sends = 0;
    submissions = DriftFormSubmissions(
      db: db,
      recorder: ActionRecorder(OutboxStore(db)),
      origin: () async => signedIn
          ? const EnvelopeOrigin(
              deviceId: testDeviceId,
              clientType: 'native',
              userId: _userId,
              sessionId: 's-1',
            )
          : null,
      send: () async => sends++,
      clock: () => DateTime.utc(2026, 9, 15, 10),
      newId: () => _submissionId,
    );
    await db
        .into(db.cachedDocuments)
        .insert(
          CachedDocumentsCompanion.insert(
            key: DocKeys.configDefault,
            body: '{}',
            hash: const Value(_configVersion),
            updatedAt: '2026-09-15T08:00:00+02:00',
          ),
        );
  });

  tearDown(() => db.close());

  test('a submission for a job is one form_submission envelope, as the '
      'payload schema has it (T3-19)', () async {
    final result = await submissions.submit(
      submission(SubmissionSubject.job, jobId: _jobId),
    );
    expect(result.status, JobActionStatus.recorded);
    final row = (await envelopes()).single;
    expect(row.id, result.envelopeId);
    expect(row.type, 'form_submission');
    expect(row.userId, _userId);
    expect(row.entityRef, 'job:$_jobId');
    final payload = payloadOf(row);
    expect(payload, {
      'form_submission_id': _submissionId,
      'form_version_id': _formVersion,
      'definition_hash': _hash,
      'subject_type': 'job',
      'subject_id': _jobId,
      'config_version_id': _configVersion,
      'context_snapshot': {'today': '2026-09-15'},
      'answers': _answers,
      'answers_hash': answersHash(_answers),
      'submitted_at_device': payload['submitted_at_device'],
    });
    expect(payload['submitted_at_device'], startsWith('2026-09-15'));
  });

  test('the agent is the signed-in user; nothing has no subject', () async {
    await submissions.submit(submission(SubmissionSubject.agent));
    await submissions.submit(submission(SubmissionSubject.none));
    final payloads = [for (final r in await envelopes()) payloadOf(r)];
    expect(payloads[0]['subject_type'], 'agent');
    expect(payloads[0]['subject_id'], _userId);
    expect(payloads[1]['subject_type'], 'none');
    expect(payloads[1]['subject_id'], isNull);
    expect(payloads[1].containsKey('subject_id'), isTrue, reason: 'required');
  });

  test('signed out, nothing is written', () async {
    signedIn = false;
    final result = await submissions.submit(
      submission(SubmissionSubject.none),
    );
    expect(result.status, JobActionStatus.unavailable);
    expect(await envelopes(), isEmpty);
  });

  test('a job submission needs its job', () {
    expect(
      () => submissions.submit(submission(SubmissionSubject.job)),
      throwsArgumentError,
    );
  });

  test('delivery follows the envelope; sending now never throws', () async {
    final result = await submissions.submit(
      submission(SubmissionSubject.none),
    );
    expect(
      await submissions.watchDelivery(result.envelopeId!).first,
      DeliveryState.waiting,
    );
    await submissions.sendNow();
    expect(sends, 1);
  });
}
