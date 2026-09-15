import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/data/local/job_actions_store.dart'
    show pulledConfigVersion, watchEnvelopeDelivery;
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/action_recorder.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/domain/forms/form_submissions.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show answersHash;
import 'package:uuid/uuid.dart';

const PosLogger _log = PosLogger('forms');

/// Generic form submissions on the local store (`record.submit`, `11`
/// §7.3): each one `form_submission` envelope through the
/// [ActionRecorder], so a double tap records one. Nothing else changes on
/// the phone; the server stores the answers against the job, the agent or
/// nothing.
class DriftFormSubmissions implements FormSubmissions {
  DriftFormSubmissions({
    required PosDatabase db,
    required ActionRecorder recorder,
    required Future<EnvelopeOrigin?> Function() origin,
    required Future<void> Function() send,
    DateTime Function()? clock,
    String Function()? newId,
  }) : _db = db,
       _recorder = recorder,
       _origin = origin,
       _send = send,
       _clock = clock ?? DateTime.now,
       _newId = newId ?? const Uuid().v7;

  final PosDatabase _db;
  final ActionRecorder _recorder;
  final Future<EnvelopeOrigin?> Function() _origin;
  final Future<void> Function() _send;
  final DateTime Function() _clock;
  final String Function() _newId;

  @override
  Future<JobActionResult> submit(FormSubmission submission) async {
    final s = submission;
    if (s.subject == SubmissionSubject.job && s.jobId == null) {
      throw ArgumentError.value(s.subject, 'subject', 'needs the job');
    }
    final origin = await _origin();
    final userId = origin?.userId;
    if (origin == null || userId == null) {
      return const JobActionResult.unavailable();
    }
    final id = _newId();
    final outcome = await _recorder.record(
      key: 'record.submit:${s.formVersionId}:${s.jobId ?? s.subject.name}',
      origin: origin,
      allowed: () async => true,
      apply: () async => PendingEnvelope(
        type: 'form_submission',
        typeVersion: 1,
        entityRef: s.jobId == null ? 'form_submission:$id' : 'job:${s.jobId}',
        payload: {
          'form_submission_id': id,
          'form_version_id': s.formVersionId,
          'definition_hash': s.definitionHash,
          'subject_type': s.subject.name,
          'subject_id': switch (s.subject) {
            SubmissionSubject.job => s.jobId,
            SubmissionSubject.agent => userId,
            SubmissionSubject.none => null,
          },
          'config_version_id': ?await pulledConfigVersion(_db, s.bankId),
          'context_snapshot': s.contextSnapshot,
          'answers': s.answers,
          'answers_hash': answersHash(s.answers),
          'submitted_at_device': isoWithOffset(_clock()),
        },
      ),
    );
    switch (outcome.status) {
      case ActionStatus.recorded:
        _log.info('form submission recorded (${s.subject.name})');
        return JobActionResult.recorded(outcome.envelopeId!);
      case ActionStatus.notAllowed:
        return const JobActionResult.notAllowed();
    }
  }

  @override
  Future<void> sendNow() async {
    try {
      await _send();
    } on Object catch (e, st) {
      _log.warning('could not send now', error: e, stackTrace: st);
    }
  }

  @override
  Stream<DeliveryState> watchDelivery(String envelopeId) =>
      watchEnvelopeDelivery(_db, envelopeId);
}
