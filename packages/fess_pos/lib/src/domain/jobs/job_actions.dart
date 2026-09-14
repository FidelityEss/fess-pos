import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:meta/meta.dart';

/// What an agent does to a job from the phone (docs/06 §2, `11` §7.3). Each
/// becomes a `job_event` envelope.
enum JobAction {
  accept('accept', 'job.accept'),
  reject('reject', 'job.reject', reasonCategory: 'assignment_reject'),
  unable('unable', 'job.unable', reasonCategory: 'unable_to_complete');

  const JobAction(this.wire, this.actionName, {this.reasonCategory});

  /// The `job_event` payload's `action`.
  final String wire;

  /// The action a `form_page` binds to (`11` §7.3).
  final String actionName;

  /// The reason-code category it asks for, which is also the default
  /// reason form's key; null when it needs no reason.
  final String? reasonCategory;
}

/// Where the agent may give a job up as unable (`pos.job_transitions`).
/// The server also takes an unable on a job still `assigned`, for one that
/// lands before its accept; on the phone an accepted job is already
/// `accepted`, so an assigned one offers accept and reject only.
const Set<String> _unableFrom = {
  'accepted',
  'in_progress',
  'paused',
  'returned',
};

/// Whether [action] fits [job] as the phone knows it. The server has the
/// last word: an action that no longer fits when it lands is recorded as
/// superseded, never lost (docs/08 §6).
bool jobActionAllowed(JobAction action, JobRecord job) {
  if (!job.assignedToMe) return false;
  return switch (action) {
    JobAction.accept || JobAction.reject => job.status == 'assigned',
    JobAction.unable => _unableFrom.contains(job.status),
  };
}

/// The job's status on the phone once [action] is recorded, until the
/// server's own is pulled.
String statusAfter(JobAction action) => switch (action) {
  JobAction.accept => 'accepted',
  JobAction.reject => 'scheduled',
  JobAction.unable => 'unable_to_complete',
};

/// A reason form's answers, as a `job_event` carries them.
@immutable
class ReasonSubmission {
  const ReasonSubmission({
    required this.reasonCode,
    required this.formVersionId,
    required this.definitionHash,
    required this.answers,
    this.note,
  });

  final String reasonCode;
  final String? note;
  final String formVersionId;
  final String definitionHash;

  /// The answers document (`{key: {v, …}}`); its hash goes with it.
  final Map<String, Object?> answers;
}

enum JobActionStatus {
  /// The job's new status and its envelope were written.
  recorded,

  /// The job had already moved on the phone; nothing was written.
  notAllowed,

  /// Nobody is signed in with a session that can send it.
  unavailable,
}

@immutable
class JobActionResult {
  const JobActionResult.recorded(String this.envelopeId)
    : status = JobActionStatus.recorded;

  const JobActionResult.notAllowed()
    : status = JobActionStatus.notAllowed,
      envelopeId = null;

  const JobActionResult.unavailable()
    : status = JobActionStatus.unavailable,
      envelopeId = null;

  final JobActionStatus status;
  final String? envelopeId;
}

/// Where an action's envelope is, for the outcome page (docs/04 §3.7).
enum DeliveryState {
  /// On the phone, waiting to be sent.
  waiting,

  /// The server holds it.
  delivered,

  /// The server couldn't take it; it is kept and an administrator is told.
  needsAttention,
}

/// Follows envelopes to the server, for outcome pages.
abstract interface class DeliveryTracker {
  /// Sends now if it can: one sync pass. Never throws.
  Future<void> sendNow();

  /// The delivery of envelope [envelopeId], live.
  Stream<DeliveryState> watchDelivery(String envelopeId);
}

/// Records job actions and follows their envelopes.
abstract interface class JobActions implements DeliveryTracker {
  /// Records [action] on [job]: the job's status on the phone and its
  /// `job_event` envelope, in one transaction, once however often it's
  /// tapped. Reject and unable need [reason].
  Future<JobActionResult> record(
    JobRecord job,
    JobAction action, {
    ReasonSubmission? reason,
  });
}
