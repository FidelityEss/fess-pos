import 'dart:async';

import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/forms/reason_codes.dart';
import 'package:fess_pos/src/domain/forms/reason_form.dart';
import 'package:fess_pos/src/domain/geofence/geofence.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/app/pos_router.dart';
import 'package:fess_pos/src/features/inspections/inspection_page.dart';
import 'package:fess_pos/src/features/jobs/checkin_page.dart';
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

String? _string(Object? v) => v is String ? v : null;

Map<String, Object?>? _map(Object? v) => v is Map<String, Object?> ? v : null;

/// The app definition in force (docs/04 §3.6) for [bankId]'s jobs, as the
/// router checked it; the bundled one when none can be used (T3-17).
Map<String, Object?> _app(WidgetRef ref, String? bankId) =>
    ref.watch(appSpecProvider(bankId)).definition;

/// How the app definition configures a job action: the button's label and
/// the form page it opens (its title and form). The label comes from the
/// job page's button that opens that form page; without one, bundled copy
/// and the action's default form stand in.
@immutable
class JobActionConfig {
  const JobActionConfig({this.label, this.title, this.form});

  /// [actions] are the job page's buttons; the app's `job_detail` page's
  /// when null.
  factory JobActionConfig.of(
    Map<String, Object?>? app,
    JobAction action, {
    List<Object?>? actions,
  }) {
    final pages = _map(app?['pages']) ?? const {};
    String? pageKey;
    Map<String, Object?>? page;
    for (final e in pages.entries) {
      final p = _map(e.value);
      if (p?['type'] == 'form_page' && p?['action'] == action.actionName) {
        pageKey = e.key;
        page = p;
        break;
      }
    }
    String? label;
    final buttons = actions ?? _map(pages['job_detail'])?['actions'];
    if (pageKey != null && buttons is List<Object?>) {
      for (final a in buttons.whereType<Map<String, Object?>>()) {
        if (_map(a['target'])?['page'] == pageKey) {
          label = _string(a['label']);
          break;
        }
      }
    }
    return JobActionConfig(
      label: label,
      title: _string(page?['title']),
      form: _string(page?['form']),
    );
  }

  final String? label;
  final String? title;
  final String? form;

  /// The label of the job page's button that opens a flow, e.g. "Start
  /// inspection"; null when there's none.
  static String? flowLabel(
    Map<String, Object?>? app,
    List<Object?>? actions,
  ) {
    final pages = _map(app?['pages']) ?? const {};
    final buttons = actions ?? _map(pages['job_detail'])?['actions'];
    if (buttons is! List<Object?>) return null;
    for (final a in buttons.whereType<Map<String, Object?>>()) {
      final target = _map(a['target']);
      final page = _map(pages[target?['page']]);
      if (target?['flow'] is String || page?['type'] == 'flow') {
        return _string(a['label']);
      }
    }
    return null;
  }

  /// Whether the job's action bar shows [button] as one of its own: it
  /// opens a flow, or a form page bound to a job action.
  static bool handles(
    Map<String, Object?>? app,
    Map<String, Object?> button,
  ) {
    final pages = _map(app?['pages']) ?? const {};
    final target = _map(button['target']);
    if (target?['flow'] is String) return true;
    final page = _map(pages[target?['page']]);
    return switch (page?['type']) {
      'flow' => true,
      'form_page' => JobAction.values.any(
        (a) => a.actionName == page?['action'],
      ),
      _ => false,
    };
  }
}

/// What an outcome page shows (docs/04 §3.7): the app definition's page
/// for the outcome in its `default` set, or bundled copy.
@immutable
class OutcomeContent {
  const OutcomeContent({
    required this.title,
    required this.message,
    required this.buttons,
    this.icon,
  });

  factory OutcomeContent.of(
    Map<String, Object?>? app,
    String outcome,
    String Function(String key) copy,
  ) {
    final set = _map(_map(app?['outcome_sets'])?['default']);
    final page = _map(_map(app?['pages'])?[set?[outcome]]);
    final buttons = [
      if (page?['buttons'] case final List<Object?> list)
        for (final b in list.whereType<Map<String, Object?>>())
          if (_string(b['label']) case final String label)
            if (_string(b['action']) case final String action)
              (label: label, action: action),
    ];
    return OutcomeContent(
      title: _string(page?['title']) ?? copy('outcome.$outcome.title'),
      message: _string(page?['message']) ?? copy('outcome.$outcome.message'),
      icon: _string(page?['icon']),
      buttons: buttons.isNotEmpty
          ? buttons
          : [
              if (outcome == 'failure')
                (label: copy('outcome.retry'), action: 'retry'),
              (label: copy('outcome.home'), action: 'home'),
            ],
    );
  }

  final String title;
  final String message;
  final String? icon;
  final List<({String label, String action})> buttons;
}

/// Begins [job]'s inspection, or opens the one in progress (T4-27), and
/// says why not when it can't. [onBegun] runs once the begin has settled,
/// before the inspection opens.
Future<void> openInspection(
  BuildContext context,
  Inspections inspections,
  JobRecord job,
  String Function(String key) copy, {
  VoidCallback? onBegun,
}) async {
  final result = await inspections.begin(job);
  onBegun?.call();
  if (!context.mounted) return;
  final id = result.inspectionId;
  if (result.status == BeginStatus.begun && id != null) {
    // The start goes to the server now if it can; otherwise it waits.
    unawaited(inspections.sendNow());
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => InspectionPage(job: job, inspectionId: id),
      ),
    );
    return;
  }
  final message = switch (result.status) {
    BeginStatus.definitionsMissing => copy('inspection.definitions_missing'),
    BeginStatus.unavailable => copy('job.action.unavailable'),
    _ => copy('job.action.not_allowed'),
  };
  ScaffoldMessenger.maybeOf(
    context,
  )?.showSnackBar(SnackBar(content: Text(message)));
}

/// The actions [job] allows now (docs/06 §2): accept and "can't take it"
/// while it's assigned, "unable to complete" once it's the agent's.
class JobActionBar extends ConsumerStatefulWidget {
  const JobActionBar({
    required this.job,
    this.pageActions,
    this.onNavigate,
    super.key,
  });

  final JobRecord job;

  /// The job page's buttons; the app's `job_detail` page's when null. Those
  /// that open a flow or a job action's form label the bar's own buttons;
  /// the rest show as they are.
  final List<Map<String, Object?>>? pageActions;

  /// Opens a button's target that isn't one of the job's own actions.
  final PageNavigate? onNavigate;

  @override
  ConsumerState<JobActionBar> createState() => _JobActionBarState();
}

class _JobActionBarState extends ConsumerState<JobActionBar> {
  bool _busy = false;

  Future<void> _accept(JobActions actions) async {
    setState(() => _busy = true);
    final result = await actions.record(widget.job, JobAction.accept);
    if (!mounted) return;
    setState(() => _busy = false);
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ActionOutcomePage(
          result: result,
          actions: actions,
          bankId: widget.job.bankId,
        ),
      ),
    );
  }

  Future<void> _openForm(JobAction action, JobActionConfig config) =>
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) =>
              ReasonFormPage(job: widget.job, action: action, config: config),
        ),
      );

  /// Begins the inspection, or opens the one in progress (T4-27).
  Future<void> _inspect(
    Inspections inspections,
    String Function(String key) copy,
  ) async {
    setState(() => _busy = true);
    await openInspection(
      context,
      inspections,
      widget.job,
      copy,
      onBegun: () {
        if (mounted) setState(() => _busy = false);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(bankCopyProvider(widget.job.bankId));
    final actions = _data(ref.watch(jobActionsProvider));
    final inspections = _data(ref.watch(inspectionsProvider));
    final latest = _data(ref.watch(latestInspectionProvider(widget.job.id)));
    final app = _app(ref, widget.job.bankId);
    final pageActions =
        widget.pageActions ??
        [
          if (_map(_map(app['pages'])?['job_detail'])?['actions']
              case final List<Object?> list)
            ...list.whereType<Map<String, Object?>>(),
        ];
    final allowed = [
      for (final a in JobAction.values)
        if (jobActionAllowed(a, widget.job)) a,
    ];
    final open = latest != null && latest.status == 'in_progress';
    final canInspect =
        widget.job.assignedToMe &&
        (open || inspectionBeginStatuses.contains(widget.job.status));
    final showActions = actions != null && allowed.isNotEmpty;
    final jobData = {'job': jobViewData(widget.job)};
    final navigate = widget.onNavigate;
    final others = [
      if (navigate != null)
        for (final a in pageActions)
          if (!JobActionConfig.handles(app, a))
            if (a case {
              'label': final String label,
              'target': final Map<String, Object?> target,
            })
              OutlinedButton(
                key: ValueKey('page-action-${a['key'] ?? label}'),
                onPressed: () => navigate(target, jobData),
                child: Text(fillTemplate(label, jobData)),
              ),
    ];
    if (!showActions &&
        (inspections == null || !canInspect) &&
        others.isEmpty) {
      return const SizedBox.shrink();
    }
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (inspections != null && canInspect && !open)
              _CheckinPrompt(inspections: inspections, job: widget.job),
            if (inspections != null && canInspect)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: FilledButton(
                  key: ValueKey(
                    open ? 'job-action-continue' : 'job-action-begin',
                  ),
                  onPressed: _busy ? null : () => _inspect(inspections, copy),
                  child: Text(
                    open
                        ? copy('inspection.continue')
                        : JobActionConfig.flowLabel(app, pageActions) ??
                              copy('inspection.begin'),
                  ),
                ),
              ),
            if (actions != null)
              for (final a in allowed)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: _button(
                    a,
                    actions,
                    JobActionConfig.of(app, a, actions: pageActions),
                    copy,
                  ),
                ),
            for (final b in others)
              Padding(padding: const EdgeInsets.only(top: 8), child: b),
          ],
        ),
      ),
    );
  }

  Widget _button(
    JobAction action,
    JobActions actions,
    JobActionConfig config,
    String Function(String key) copy,
  ) {
    final label = Text(config.label ?? copy('job.action.${action.wire}'));
    final key = ValueKey('job-action-${action.wire}');
    return action == JobAction.accept
        ? FilledButton(
            key: key,
            onPressed: _busy ? null : () => _accept(actions),
            child: label,
          )
        : OutlinedButton(
            key: key,
            onPressed: _busy ? null : () => _openForm(action, config),
            child: label,
          );
  }
}

/// Asks for a check-in on arrival where the job's profile, or the flow,
/// expects no GPS lock indoors (docs/07 §7 item 2, T4-23), and says when one
/// that still counts is on the phone.
class _CheckinPrompt extends ConsumerStatefulWidget {
  const _CheckinPrompt({required this.inspections, required this.job});

  final Inspections inspections;
  final JobRecord job;

  @override
  ConsumerState<_CheckinPrompt> createState() => _CheckinPromptState();
}

class _CheckinPromptState extends ConsumerState<_CheckinPrompt> {
  CheckinPlan? _plan;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final plan = await widget.inspections.checkinPlan(widget.job);
    if (mounted) setState(() => _plan = plan);
  }

  Future<void> _checkIn(CheckinPlan plan) async {
    final done = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => CheckinPage(
          job: widget.job,
          plan: plan,
          inspections: widget.inspections,
        ),
      ),
    );
    await _load();
    if ((done ?? false) && mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        SnackBar(
          content: Text(
            ref.read(bankCopyProvider(widget.job.bankId))('checkin.done'),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(bankCopyProvider(widget.job.bankId));
    final plan = _plan;
    if (plan == null || !plan.prompt) return const SizedBox.shrink();
    if (plan.checkedIn(DateTime.now())) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Text(
          copy('checkin.done'),
          key: const ValueKey('job-checked-in'),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(copy('checkin.prompt')),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            key: const ValueKey('job-checkin'),
            onPressed: () => _checkIn(plan),
            icon: const Icon(Icons.my_location),
            label: Text(copy('checkin.button')),
          ),
        ],
      ),
    );
  }
}

/// A reason form for [action] on [job] (B2.3, B2.4, B4.17): the bank's
/// form in force, its reasons from the pulled reason codes. Submitting
/// records the action with the answers and goes to its outcome.
class ReasonFormPage extends ConsumerStatefulWidget {
  const ReasonFormPage({
    required this.job,
    required this.action,
    this.config = const JobActionConfig(),
    super.key,
  });

  final JobRecord job;
  final JobAction action;
  final JobActionConfig config;

  @override
  ConsumerState<ReasonFormPage> createState() => _ReasonFormPageState();
}

class _ReasonFormPageState extends ConsumerState<ReasonFormPage> {
  FormController? _form;
  String? _formVersion;
  bool _busy = false;

  String get _category => widget.action.reasonCategory!;

  @override
  void dispose() {
    _form?.dispose();
    super.dispose();
  }

  FormController _controllerFor(
    ActiveDefinition definition,
    ReasonFormFields fields,
    List<ReasonCode> codes,
    Map<String, Object?>? agent,
    String Function(String key) copy,
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
    return _form = FormController(
      definition: definition.body,
      lists: reasonCodeLists(codes, bankId: widget.job.bankId),
      context: ResolveContext(
        today: todayIso(),
        job: jobViewData(widget.job),
        agent: agent,
      ),
      extraChecks: (answers) =>
          fields.check(answers, codes, category: _category, message: copy),
    );
  }

  Future<void> _submit(
    ActiveDefinition definition,
    ReasonFormFields fields,
    FormController form,
    JobActions actions,
  ) async {
    if (!form.validate()) return;
    final answers = form.answers;
    final code = fields.reasonCode(answers);
    if (code == null) return;
    setState(() => _busy = true);
    final result = await actions.record(
      widget.job,
      widget.action,
      reason: ReasonSubmission(
        reasonCode: code,
        note: fields.note(answers),
        formVersionId: definition.versionId,
        definitionHash: definition.hash,
        answers: answers,
      ),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    await Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => ActionOutcomePage(
          result: result,
          actions: actions,
          bankId: widget.job.bankId,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(bankCopyProvider(widget.job.bankId));
    final formKey = widget.config.form ?? _category;
    final definition = ref.watch(
      activeDefinitionVersionProvider((
        kind: 'form',
        key: formKey,
        bankId: widget.job.bankId,
      )),
    );
    final codes = _data(ref.watch(reasonCodesProvider));
    final agent = _data(ref.watch(agentProvider));
    final actions = _data(ref.watch(jobActionsProvider));
    final title =
        widget.config.title ?? copy('job.action.${widget.action.wire}.title');

    Widget body;
    Widget? submit;
    switch (definition) {
      case AsyncData(value: final ActiveDefinition found)
          when codes != null && actions != null:
        final fields = ReasonFormFields.of(found.body, _category);
        if (fields == null) {
          body = _Message(copy('form.unavailable'));
          break;
        }
        final form = _controllerFor(found, fields, codes, agent, copy);
        body = ListView(
          children: [FormView(controller: form, copy: copy)],
        );
        submit = SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: FilledButton(
              key: const ValueKey('reason-form-submit'),
              onPressed: _busy
                  ? null
                  : () => _submit(found, fields, form, actions),
              child: Text(copy('job.action.submit')),
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
    return Scaffold(
      appBar: PosHeader(
        title: title,
        onBack: () => Navigator.of(context).pop(),
      ),
      body: body,
      bottomNavigationBar: submit,
    );
  }
}

/// How an action ended (docs/04 §3.7): received by the server, saved on
/// the phone to send later, or not done. While the first send runs it says
/// so; a receipt that arrives later still turns "saved" into "received".
class ActionOutcomePage extends ConsumerStatefulWidget {
  const ActionOutcomePage({
    required this.result,
    required this.actions,
    this.bankId,
    super.key,
  });

  final JobActionResult result;

  /// Follows the envelope: a job action's, or an inspection's submission.
  final DeliveryTracker actions;
  final String? bankId;

  @override
  ConsumerState<ActionOutcomePage> createState() => _ActionOutcomePageState();
}

class _ActionOutcomePageState extends ConsumerState<ActionOutcomePage> {
  Stream<DeliveryState>? _delivery;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    final id = widget.result.envelopeId;
    if (id == null) return;
    _delivery = widget.actions.watchDelivery(id);
    _sending = true;
    unawaited(
      widget.actions.sendNow().whenComplete(() {
        if (mounted) setState(() => _sending = false);
      }),
    );
  }

  void _run(String action) {
    final navigator = Navigator.of(context);
    switch (action) {
      case 'retry':
        navigator.pop();
      case 'home':
        PosRouter.goHome(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(bankCopyProvider(widget.bankId));
    final app = _app(ref, widget.bankId);
    return StreamBuilder<DeliveryState>(
      stream: _delivery,
      builder: (context, snapshot) {
        final delivery = snapshot.data;
        final String outcome;
        String? detail;
        switch (widget.result.status) {
          case JobActionStatus.notAllowed:
            outcome = 'failure';
            detail = copy('job.action.not_allowed');
          case JobActionStatus.unavailable:
            outcome = 'failure';
            detail = copy('job.action.unavailable');
          case JobActionStatus.recorded:
            if (delivery == DeliveryState.delivered) {
              outcome = 'success';
            } else if (delivery == DeliveryState.needsAttention) {
              outcome = 'failure';
              detail = copy('outcome.needs_attention');
            } else {
              outcome = _sending ? 'sending' : 'saved';
            }
        }
        if (outcome == 'sending') {
          return Scaffold(
            body: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CircularProgressIndicator(),
                  const SizedBox(height: 16),
                  Text(copy('outcome.sending')),
                ],
              ),
            ),
          );
        }
        final content = OutcomeContent.of(app, outcome, copy);
        final theme = Theme.of(context);
        return Scaffold(
          appBar: PosHeader(
            title: copy('shell.title'),
            onBack: () => _run('home'),
          ),
          body: ListView(
            key: ValueKey('outcome-$outcome'),
            padding: const EdgeInsets.all(24),
            children: [
              Icon(
                _icon(content.icon, outcome),
                size: 64,
                color: outcome == 'failure'
                    ? theme.colorScheme.error
                    : theme.colorScheme.primary,
              ),
              const SizedBox(height: 16),
              Text(
                content.title,
                textAlign: TextAlign.center,
                style: theme.textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text(content.message, textAlign: TextAlign.center),
              if (detail != null) ...[
                const SizedBox(height: 16),
                Text(detail, textAlign: TextAlign.center),
              ],
              const SizedBox(height: 24),
              for (final b in content.buttons)
                if (b.action == 'home' || b.action == 'retry')
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: b.action == 'home'
                        ? FilledButton(
                            onPressed: () => _run(b.action),
                            child: Text(b.label),
                          )
                        : OutlinedButton(
                            onPressed: () => _run(b.action),
                            child: Text(b.label),
                          ),
                  ),
            ],
          ),
        );
      },
    );
  }
}

IconData _icon(String? name, String outcome) => switch (name) {
  'check_circle' => Icons.check_circle,
  'cloud_upload' => Icons.cloud_upload,
  'error' => Icons.error,
  _ => switch (outcome) {
    'success' => Icons.check_circle,
    'saved' => Icons.cloud_upload,
    _ => Icons.error,
  },
};

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
