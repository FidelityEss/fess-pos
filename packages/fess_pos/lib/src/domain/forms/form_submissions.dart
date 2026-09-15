import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:meta/meta.dart';

/// What a `record.submit` form's answers are stored against
/// (`form_page.subject`, `11` §7.3).
enum SubmissionSubject { job, agent, none }

/// A generic form page's answers, to record as a `form_submission`
/// (`schema/api/payloads/form_submission.v1`).
@immutable
class FormSubmission {
  const FormSubmission({
    required this.formVersionId,
    required this.definitionHash,
    required this.subject,
    required this.answers,
    required this.contextSnapshot,
    this.jobId,
    this.bankId,
  });

  final String formVersionId;
  final String definitionHash;
  final SubmissionSubject subject;

  /// The job, when [subject] is a job.
  final String? jobId;

  /// The bank whose config the submission names; the default when null.
  final String? bankId;

  /// The answers document (`{key: {v, …}}`).
  final Map<String, Object?> answers;

  /// What the form's rules saw (docs/04 §4.4), which the server validates
  /// the answers against.
  final Map<String, Object?> contextSnapshot;
}

/// Records generic form submissions (`record.submit`) and follows them.
abstract interface class FormSubmissions implements DeliveryTracker {
  /// Records [submission] as a `form_submission` envelope. Nothing changes
  /// on the phone; the server stores the answers against the job, the
  /// agent or nothing.
  Future<JobActionResult> submit(FormSubmission submission);
}
