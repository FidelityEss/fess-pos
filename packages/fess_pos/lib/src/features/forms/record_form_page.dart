import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/app/app_spec.dart';
import 'package:fess_pos/src/domain/forms/form_submissions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/jobs/job_action_pages.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/renderer/form/form_controller.dart';
import 'package:fess_pos/src/renderer/form/form_view.dart';
import 'package:fess_pos/src/renderer/template.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show ResolveContext;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

T? _data<T>(AsyncValue<T> value) => switch (value) {
  AsyncData(:final value) => value,
  _ => null,
};

/// The generic form page (`form_page` bound to `record.submit`, `11` §7.1
/// and §7.3, B4.23): any form definition in force, with its rules,
/// checked on the phone and again on the server, then recorded as a
/// `form_submission` against the page's subject. It ends on the page's
/// outcome set (docs/04 §3.7). A new ad-hoc form needs no code.
class RecordFormPage extends ConsumerStatefulWidget {
  const RecordFormPage({
    required this.page,
    this.jobId,
    this.onBack,
    super.key,
  });

  /// The `form_page`: its `form`, `sections`, `subject`, `title` and
  /// `outcomes`.
  final AppPage page;

  /// The job it was opened for.
  final String? jobId;
  final VoidCallback? onBack;

  @override
  ConsumerState<RecordFormPage> createState() => _RecordFormPageState();
}

class _RecordFormPageState extends ConsumerState<RecordFormPage> {
  FormController? _form;
  String? _formVersion;
  bool _busy = false;

  @override
  void dispose() {
    _form?.dispose();
    super.dispose();
  }

  /// What the answers are stored against: the page's `subject`, else the
  /// job it was opened for, else nothing.
  SubmissionSubject get _subject => switch (widget.page.string('subject')) {
    'job' => SubmissionSubject.job,
    'agent' => SubmissionSubject.agent,
    'none' => SubmissionSubject.none,
    _ => widget.jobId == null ? SubmissionSubject.none : SubmissionSubject.job,
  };

  FormController _controllerFor(
    ActiveDefinition definition,
    Map<String, Object?> context,
  ) {
    final existing = _form;
    if (existing != null && _formVersion == definition.versionId) {
      return existing;
    }
    // A newer version arrived: start it afresh; the old one goes after
    // this frame, once nothing listens to it.
    if (existing != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => existing.dispose());
    }
    _formVersion = definition.versionId;
    final job = context['job'];
    final agent = context['agent'];
    return _form = FormController(
      definition: definition.body,
      context: ResolveContext(
        today: context['today'] as String?,
        job: job is Map<String, Object?> ? job : null,
        agent: agent is Map<String, Object?> ? agent : null,
      ),
    );
  }

  Future<void> _submit(
    ActiveDefinition definition,
    FormController form,
    FormSubmissions submissions,
    JobRecord? job,
    Map<String, Object?> ruleContext,
  ) async {
    if (!form.validate()) return;
    setState(() => _busy = true);
    final result = await submissions.submit(
      FormSubmission(
        formVersionId: definition.versionId,
        definitionHash: definition.hash,
        subject: _subject,
        jobId: job?.id,
        bankId: job?.bankId,
        answers: form.answers,
        contextSnapshot: ruleContext,
      ),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    await showOutcome(
      context,
      ActionOutcomePage(
        result: result,
        actions: submissions,
        bankId: job?.bankId,
        outcomes: widget.page.string('outcomes') ?? 'default',
        jobId: job?.id,
        data: {if (job != null) 'job': jobViewData(job)},
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final id = widget.jobId;
    final jobState = id == null ? null : ref.watch(jobProvider(id));
    final job = jobState == null ? null : _data(jobState);
    final copy = ref.watch(bankCopyProvider(job?.bankId));
    final definition = ref.watch(
      activeDefinitionVersionProvider((
        kind: 'form',
        key: widget.page.string('form') ?? '',
        bankId: job?.bankId,
      )),
    );
    final agent = _data(ref.watch(agentProvider));
    final submissions = _data(ref.watch(formSubmissionsProvider));
    final jobData = job == null ? null : jobViewData(job);
    // What the rules see, sent with the answers so the server checks them
    // against the same (docs/04 §4.4).
    final ruleContext = <String, Object?>{
      'today': todayIso(),
      'job': ?jobData,
      'agent': ?agent,
    };
    final sections = widget.page.definition['sections'];
    final title = widget.page.title;

    Widget body;
    Widget? submit;
    if (_subject == SubmissionSubject.job && id == null) {
      body = _Message(copy('page.unavailable'));
    } else if (jobState case AsyncData(value: null)) {
      body = _Message(copy('jobs.not_found'));
    } else {
      switch (definition) {
        case AsyncData(value: final ActiveDefinition found)
            when submissions != null && (id == null || job != null):
          final form = _controllerFor(found, ruleContext);
          body = ListView(
            children: [
              FormView(
                controller: form,
                copy: copy,
                sections: sections is List<Object?>
                    ? sections.whereType<String>().toList()
                    : null,
              ),
            ],
          );
          submit = SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: FilledButton(
                key: const ValueKey('record-form-submit'),
                onPressed: _busy
                    ? null
                    : () => _submit(found, form, submissions, job, ruleContext),
                child: Text(copy('form.submit')),
              ),
            ),
          );
        case AsyncData(value: null):
          body = _Message(copy('job.action.form_missing'));
        case AsyncError():
          body = _Message(copy('shell.unavailable'));
        default:
          body = const Center(child: CircularProgressIndicator());
      }
    }
    return Scaffold(
      appBar: PosHeader(
        title: title == null
            ? copy('shell.title')
            : fillTemplate(title, {'job': ?jobData, 'agent': ?agent}),
        onBack: widget.onBack ?? () => Navigator.of(context).maybePop(),
      ),
      body: body,
      bottomNavigationBar: submit,
    );
  }
}

class _Message extends StatelessWidget {
  const _Message(this.message);

  final String message;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Text(message, textAlign: TextAlign.center),
    ),
  );
}
