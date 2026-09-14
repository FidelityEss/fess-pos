import 'dart:async';
import 'dart:typed_data';

import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/flows/flow_runner.dart';
import 'package:fess_pos/src/domain/geofence/geofence.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/inspections/capture_page.dart';
import 'package:fess_pos/src/features/inspections/location_check_view.dart';
import 'package:fess_pos/src/features/inspections/signature_pad_page.dart';
import 'package:fess_pos/src/features/jobs/job_action_pages.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/platform/location.dart';
import 'package:fess_pos/src/renderer/form/form_controller.dart';
import 'package:fess_pos/src/renderer/form/form_services.dart';
import 'package:fess_pos/src/renderer/form/form_view.dart';
import 'package:fess_pos/src/renderer/form/render_plans.dart';
import 'package:fess_pos/src/renderer/render_context.dart';
import 'package:fess_pos/src/renderer/view_renderer.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart'
    show
        CompiledForm,
        ResolvedField,
        contextFromSnapshot,
        evaluateRule,
        renderTemplate;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Compiles a form into its render plan; tests compile in place.
final formCompilerProvider =
    Provider<Future<CompiledForm> Function(Map<String, Object?> form)>(
      (ref) => compileRenderPlan,
      name: 'formCompiler',
    );

/// The render plan of a pinned form version: compiled once, off the UI
/// thread, and kept while the module runs (docs/03 §8).
// ignore: specify_nonobvious_property_types
final renderPlanProvider = FutureProvider.family<CompiledForm, String>((
  ref,
  formVersionId,
) async {
  final form = await ref.watch(
    definitionVersionProvider(formVersionId).future,
  );
  if (form == null) {
    throw StateError('form version $formVersionId is not on this phone');
  }
  return ref.watch(formCompilerProvider)(form);
}, name: 'renderPlan');

/// An inspection's evidence as the phone holds it, live, without the
/// bytes: the evidence fields show captions and who signed from it.
// ignore: specify_nonobvious_property_types
final inspectionEvidenceProvider = StreamProvider.autoDispose
    .family<List<EvidenceItem>, String>((ref, inspectionId) async* {
      final inspections = await ref.watch(inspectionsProvider.future);
      if (inspections != null) yield* inspections.watchEvidence(inspectionId);
    }, name: 'inspectionEvidence');

/// Asks for a photo's caption (`caption: optional | required`): the text,
/// '' when an optional one is skipped, null when the photo is discarded.
class _CaptionDialog extends StatefulWidget {
  const _CaptionDialog({required this.required, required this.copy});

  final bool required;
  final String Function(String key) copy;

  @override
  State<_CaptionDialog> createState() => _CaptionDialogState();
}

class _CaptionDialogState extends State<_CaptionDialog> {
  final TextEditingController _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final copy = widget.copy;
    final text = _text.text.trim();
    return AlertDialog(
      title: Text(copy('photo.caption.title')),
      content: TextField(
        key: const ValueKey('photo-caption'),
        controller: _text,
        autofocus: true,
        maxLength: 500,
        minLines: 1,
        maxLines: 3,
        textCapitalization: TextCapitalization.sentences,
        decoration: InputDecoration(hintText: copy('photo.caption.hint')),
        onChanged: (_) => setState(() {}),
      ),
      actions: [
        TextButton(
          key: const ValueKey('photo-caption-skip'),
          onPressed: () =>
              Navigator.of(context).pop(widget.required ? null : ''),
          child: Text(
            copy(
              widget.required ? 'photo.caption.discard' : 'photo.caption.skip',
            ),
          ),
        ),
        FilledButton(
          key: const ValueKey('photo-caption-save'),
          onPressed: text.isEmpty
              ? null
              : () => Navigator.of(context).pop(text),
          child: Text(copy('photo.caption.save')),
        ),
      ],
    );
  }
}

T? _data<T>(AsyncValue<T> value) => switch (value) {
  AsyncData(:final value) => value,
  _ => null,
};

String? _string(Object? v) => v is String ? v : null;

List<Map<String, Object?>> _maps(Object? v) => v is List<Object?>
    ? v.whereType<Map<String, Object?>>().toList()
    : const [];

final RegExp _keyPattern = RegExp(r'^[a-z][a-z0-9_]{0,63}$');

/// An input field of the form: its key, type and props.
typedef _FieldDef = ({String key, String type, Map<String, Object?> props});

/// The input fields of [form] by section, groups flattened.
Map<String, List<_FieldDef>> _fieldsBySection(Map<String, Object?> form) {
  final out = <String, List<_FieldDef>>{};
  void walk(List<Map<String, Object?>> defs, List<_FieldDef> into) {
    for (final d in defs) {
      final key = _string(d['key']);
      final type = _string(d['type']);
      if (key == null || type == null) continue;
      if (type == 'group') {
        walk(_maps(d['fields']), into);
      } else {
        final props = d['props'];
        into.add((
          key: key,
          type: type,
          props: props is Map<String, Object?> ? props : const {},
        ));
      }
    }
  }

  for (final s in _maps(form['sections'])) {
    final key = _string(s['key']);
    if (key != null) walk(_maps(s['fields']), out[key] = []);
  }
  return out;
}

/// What the flow reads: the form as the rules make it now.
class _FlowData implements FlowData {
  _FlowData(
    this.form, {
    required this.declarationStep,
    required this.checked,
  });

  final FormController form;

  /// Whether the location check has passed, as the page knows it now.
  final bool Function() checked;

  @override
  bool get locationChecked => checked();

  /// Declaration fields have a step of their own, so they don't count on
  /// form pages.
  final bool declarationStep;

  @override
  bool sectionShown(String key) {
    final r = form.resolved;
    if (r == null || !(r.sections[key]?.visible ?? false)) return false;
    return r.fields.values.any(
      (f) =>
          f.section == key &&
          f.visible &&
          f.type != 'group' &&
          !(declarationStep && f.type == 'declaration'),
    );
  }

  @override
  Object? evaluate(Object? expr) {
    final r = form.resolved;
    return r == null ? null : evaluateRule(expr, r.data, env: r.env);
  }
}

/// An inspection in progress (T4-27, T3-04): the pinned flow over the
/// pinned form, page by page as the flow runner leads (briefing, form
/// pages, review, declaration, submit), the answers and the way through
/// kept on the phone as they're given, so a closed app resumes where it
/// was. Then the seal and the submission. The rules, what's required and
/// the wording all come from the definitions.
class InspectionPage extends ConsumerStatefulWidget {
  const InspectionPage({
    required this.job,
    required this.inspectionId,
    super.key,
  });

  final JobRecord job;
  final String inspectionId;

  @override
  ConsumerState<InspectionPage> createState() => _InspectionPageState();
}

class _InspectionPageState extends ConsumerState<InspectionPage>
    with WidgetsBindingObserver {
  FormController? _form;
  Inspections? _inspections;
  FlowRunner? _runner;
  late _FlowData _flowData;
  Map<String, List<_FieldDef>> _sections = const {};

  /// The pages the agent went through to here; the last is on screen.
  List<FlowPosition> _path = const [];

  /// Briefing steps whose acknowledgement is ticked.
  final Set<int> _acknowledged = {};
  Timer? _saveTimer;
  bool _unsaved = false;
  bool _busy = false;
  String? _message;

  /// Whether the location check has passed (T4-07).
  bool _locationPassed = true;

  /// Whether the agent left the fence and hasn't come back (B3.5).
  bool _paused = false;
  StreamSubscription<LocationFix>? _fixes;

  FlowPosition get _at => _path.last;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _saveTimer?.cancel();
    unawaited(_fixes?.cancel());
    // Reads the answers before the controller goes; the write finishes on
    // its own.
    if (_unsaved) unawaited(_save());
    _form?.dispose();
    super.dispose();
  }

  /// Leaving the app may be the last chance to write the draft: the system
  /// can end a phone app in the background without warning (docs/08 §4).
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed && _unsaved) {
      _saveTimer?.cancel();
      unawaited(_save());
    }
  }

  void _start(
    InspectionRecord record,
    Map<String, Object?> form,
    Map<String, Object?> flow,
    Inspections inspections,
    CompiledForm plan,
  ) {
    if (_form != null) return;
    _inspections = inspections;
    _sections = _fieldsBySection(form);
    final runner = _runner = FlowRunner(flow);
    final controller = _form = FormController(
      definition: form,
      plan: plan,
      inspection: true,
      context: contextFromSnapshot(record.contextSnapshot),
      initialValues: record.values,
      initialOtherText: record.otherText,
      initialUnknown: record.unknownDates,
      initialFlaggedDiffers: record.flaggedDiffers,
    )..addListener(_scheduleSave);
    _locationPassed = record.locationPassed;
    final data = _flowData = _FlowData(
      controller,
      declarationStep: runner.steps.any((s) => s['type'] == 'declaration'),
      checked: () => _locationPassed,
    );
    _path = _resume(record, runner, data);
    unawaited(_watchFence(inspections));
  }

  /// Where a reopened inspection continues: the pages it went through, or
  /// for a draft from before the full flow runner, its place among the
  /// pages shown.
  static List<FlowPosition> _resume(
    InspectionRecord record,
    FlowRunner runner,
    FlowData data,
  ) {
    final path = [
      for (final p in record.flowPath)
        if (FlowPosition.tryParse(p) case final FlowPosition at
            when runner.shows(at, data))
          at,
    ];
    if (path.isNotEmpty) return path;
    final shown = runner.shown(data);
    return shown.isEmpty
        ? const []
        : [shown[record.currentStep.clamp(0, shown.length - 1)]];
  }

  /// The page on screen among the pages shown now: (index, count).
  (int, int) _progress() {
    final shown = _runner!.shown(_flowData);
    final at = _at;
    final n = shown.indexWhere(
      (p) => p.step > at.step || (p.step == at.step && p.page >= at.page),
    );
    return (n < 0 ? (shown.length - 1).clamp(0, 1 << 30) : n, shown.length);
  }

  /// How long typing may run on before the draft is written. Moving
  /// between pages, and leaving the page or the app, write it at once.
  static const Duration _draftDelay = Duration(milliseconds: 300);

  void _scheduleSave([Duration delay = _draftDelay]) {
    _unsaved = true;
    _saveTimer?.cancel();
    _saveTimer = Timer(delay, () => unawaited(_save()));
  }

  Future<void> _save() async {
    final form = _form;
    final inspections = _inspections;
    if (form == null || inspections == null || _path.isEmpty) return;
    _unsaved = false;
    final values = form.values;
    final other = form.otherTexts;
    final step = _progress().$1;
    final path = [for (final p in _path) p.toJson()];
    try {
      await inspections.saveDraft(
        widget.inspectionId,
        values: values,
        otherText: other,
        currentStep: step,
        unknownDates: form.unknownKeys,
        flaggedDiffers: form.flaggedDiffers,
        flowPath: path,
      );
    } on Object {
      // The answers are still on screen: try again shortly, whether or not
      // anything else changes.
      if (mounted) {
        _scheduleSave(const Duration(seconds: 2));
      } else {
        _unsaved = true;
      }
    }
  }

  bool get _hasDeclarationStep =>
      _runner?.steps.any((s) => s['type'] == 'declaration') ?? false;

  /// The declaration fields [step] asks for. When its `declaration_key`
  /// names none of them, all of them: the analyser makes a form carry
  /// exactly one declaration field but doesn't match it to the step, and a
  /// declaration step must never be an empty page.
  Set<String> _declarationKeys(Map<String, Object?> step) {
    final key = _string(step['declaration_key']);
    final all = [
      for (final fields in _sections.values)
        for (final f in fields)
          if (f.type == 'declaration') f,
    ];
    final named = {
      for (final f in all)
        if (key == null || _string(f.props['declaration_key']) == key) f.key,
    };
    return named.isNotEmpty ? named : {for (final f in all) f.key};
  }

  /// Whether any of the declaration fields [keys] holds an acceptance of a
  /// version other than the one on the phone now: a newer version has to
  /// be accepted again (docs/07 §4, D-77).
  bool _declarationOutdated(Iterable<String> keys) {
    final form = _form!;
    final wanted = keys.toSet();
    for (final fields in _sections.values) {
      for (final f in fields) {
        if (f.type != 'declaration' || !wanted.contains(f.key)) continue;
        final value = form.value(f.key);
        if (value is! Map<String, Object?> || value['accepted'] != true) {
          continue;
        }
        final key = _string(f.props['declaration_key']) ?? f.key;
        final current = _data(ref.read(declarationProvider(key)));
        if (current != null && value['declaration_version_id'] != current.id) {
          return true;
        }
      }
    }
    return false;
  }

  /// The location check passed: on to the page after it, without the check
  /// on the way back.
  void _locationDone() {
    if (!mounted) return;
    _locationPassed = true;
    final to = _runner!.firstFrom(FlowPosition(_at.step + 1), _flowData);
    _go(to == null ? _path : [to]);
  }

  /// Watches the fence while the inspection is open (docs/07 §7 item 8):
  /// leaving it pauses the inspection and coming back resumes it. The
  /// answers stay as they are either way.
  Future<void> _watchFence(Inspections inspections) async {
    final plan = await inspections.geofencePlan(widget.inspectionId);
    if (plan == null || !mounted) return;
    if (plan.paused) setState(() => _paused = true);
    final location = ref.read(platformServicesProvider).location;
    if (!(await location.access()).granted || !mounted) return;
    final monitor = ExitMonitor(plan.fence, paused: plan.paused);
    _fixes = location.fixes(interval: plan.fixInterval).listen((fix) async {
      // Until the check passes, the check itself reads the location.
      if (!_locationPassed) return;
      final change = monitor.add(geoFixOf(fix));
      if (change == null) return;
      await inspections.recordGeofenceChange(widget.inspectionId, change);
      if (mounted) setState(() => _paused = change.paused);
    });
  }

  /// The fields page [at] shows.
  Set<String> _keysAt(FlowPosition at) {
    final runner = _runner!;
    return switch (runner.typeOf(at.step)) {
      'form' => {
        for (final section in runner.sectionsAt(at))
          for (final f in _sections[section] ?? const <_FieldDef>[])
            if (!(_hasDeclarationStep && f.type == 'declaration')) f.key,
      },
      'declaration' => _declarationKeys(runner.steps[at.step]),
      _ => const {},
    };
  }

  /// The form sections of the flow's form steps, in flow order.
  List<String> get _flowSections {
    final runner = _runner!;
    return {
      for (var i = 0; i < runner.steps.length; i++)
        if (runner.typeOf(i) == 'form') ...runner.sections(i),
    }.toList();
  }

  bool _stepHasProblems(Set<String> keys) {
    final form = _form!;
    return form.errors.any((e) => keys.contains(e.fieldKey)) ||
        form.unsupportedVisible.any(keys.contains);
  }

  void _go(List<FlowPosition> path) {
    setState(() {
      _path = path;
      _message = null;
    });
    unawaited(_save());
  }

  void _next() {
    final runner = _runner!;
    final at = _at;
    final step = runner.steps[at.step];
    final copy = ref.read(copyProvider);
    if (step['type'] == 'location_check' && !_locationPassed) {
      setState(() => _message = copy('inspection.location_first'));
      return;
    }
    final keys = _keysAt(at);
    _form!.touchAll(keys);
    if (_stepHasProblems(keys)) {
      setState(() => _message = copy('inspection.fix_answers'));
      return;
    }
    if (_declarationOutdated(keys)) {
      setState(() => _message = copy('inspection.declaration_changed'));
      return;
    }
    if (step['type'] == 'job_briefing' &&
        _string(step['acknowledgement_text']) != null &&
        !_acknowledged.contains(at.step)) {
      setState(() => _message = copy('inspection.acknowledge_first'));
      return;
    }
    switch (runner.next(at, _flowData)) {
      case MoveTo(:final position):
        _go([..._path, position]);
      case MoveToFlow(:final family):
        unawaited(_openFlow(family));
      case MoveToPage():
        // App pages open once the app definition drives navigation (T3-17).
        setState(() => _message = copy('inspection.branch_unavailable'));
      case MoveEnd():
        break;
    }
  }

  /// Back along the way the agent came; from the first page, off the
  /// inspection (its answers stay on the phone).
  void _back() {
    final runner = _runner!;
    final data = _flowData;
    final path = [..._path]..removeLast();
    while (path.isNotEmpty && !runner.shows(path.last, data)) {
      path.removeLast();
    }
    if (path.isNotEmpty) {
      _go(path);
      return;
    }
    final at = _at;
    final before = runner
        .shown(data)
        .where(
          (p) => p.step < at.step || (p.step == at.step && p.page < at.page),
        )
        .lastOrNull;
    if (before != null) {
      _go([before]);
      return;
    }
    Navigator.of(context).pop();
  }

  /// From the review, back to the page that shows [section].
  void _jumpTo(String section) {
    final runner = _runner!;
    for (final at in runner.shown(_flowData)) {
      if (runner.typeOf(at.step) == 'form' &&
          runner.sectionsAt(at).contains(section)) {
        _go([..._path, at]);
        return;
      }
    }
  }

  /// A branch to another flow (`flow:<family>`): the unable-to-complete
  /// flow opens the job's unable reason form; the inspection stays open on
  /// the phone with its answers.
  Future<void> _openFlow(String family) async {
    final copy = ref.read(copyProvider);
    Map<String, Object?>? target;
    // Listened while it loads: a provider nobody listens to is paused.
    final sub = ref.listenManual(
      activeDefinitionProvider((
        kind: 'flow',
        key: family,
        bankId: widget.job.bankId,
      )).future,
      (_, _) {},
    );
    try {
      target = await sub.read();
    } on Object {
      target = null;
    } finally {
      sub.close();
    }
    if (!mounted) return;
    if (target?['action'] != JobAction.unable.actionName) {
      setState(() => _message = copy('inspection.branch_unavailable'));
      return;
    }
    _saveTimer?.cancel();
    await _save();
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            ReasonFormPage(job: widget.job, action: JobAction.unable),
      ),
    );
  }

  Future<void> _submit(Map<String, Object?> step) async {
    final form = _form!;
    final copy = ref.read(copyProvider);
    if (!form.validate()) {
      final bad = {
        for (final e in form.errors) e.fieldKey,
        ...form.unsupportedVisible,
      };
      final at = _runner!
          .shown(_flowData)
          .where((p) => _keysAt(p).any(bad.contains))
          .firstOrNull;
      setState(() {
        if (at != null) _path = [..._path, at];
        _message = copy('inspection.fix_answers');
      });
      return;
    }
    // An acceptance of an earlier declaration version is never sent.
    final declarationKeys = [
      for (final fields in _sections.values)
        for (final f in fields)
          if (f.type == 'declaration') f.key,
    ];
    if (_declarationOutdated(declarationKeys)) {
      final at = _runner!
          .shown(_flowData)
          .where((p) => _keysAt(p).any(declarationKeys.contains))
          .firstOrNull;
      setState(() {
        if (at != null) _path = [..._path, at];
        _message = copy('inspection.declaration_changed');
      });
      return;
    }
    final data = form.resolved?.data ?? const <String, Object?>{};
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(
          renderTemplate(
            _string(step['confirm_text']) ?? copy('inspection.submit_confirm'),
            data,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(copy('inspection.cancel')),
          ),
          FilledButton(
            key: const ValueKey('inspection-submit-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(
              renderTemplate(
                _string(step['label']) ?? copy('inspection.submit'),
                data,
              ),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final inspections = _inspections!;
    setState(() => _busy = true);
    _saveTimer?.cancel();
    await _save();
    final result = await inspections.submit(
      widget.inspectionId,
      answers: form.answers,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    // The flow's receipt: the outcome page (docs/04 §3.7).
    await Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => ActionOutcomePage(
          result: result,
          actions: inspections,
          bankId: widget.job.bankId,
        ),
      ),
    );
  }

  /// A photo field's guidance, filled in from what the rules see.
  String? _guidance(ResolvedField field) {
    final guidance = field.props['guidance'];
    final text = guidance is Map<String, Object?> ? guidance['text'] : null;
    return text is String
        ? renderTemplate(text, _form?.resolved?.data ?? const {})
        : null;
  }

  FormFieldServices _services(
    Inspections inspections,
    Map<String, Declaration?> declarations,
    String Function(String key) copy,
    Map<String, EvidenceItem> evidence,
  ) => FormFieldServices(
    takePhoto: (context, field, shot) async {
      final of = shot.of;
      final photo = await Navigator.of(context).push<CapturedPhoto>(
        MaterialPageRoute(
          builder: (_) => CapturePage(
            title: field.label ?? copy('inspection.take_photo'),
            guidance: _guidance(field),
            progress: of == null
                ? null
                : renderTemplate(copy('photo.progress'), {
                    'n': shot.number,
                    'total': of,
                  }),
            requireLocation: field.props['require_gps'] == true,
          ),
        ),
      );
      if (photo == null || !context.mounted) return null;
      // The caption goes with the photo's record, so it's asked for now.
      final policy = _string(field.props['caption']) ?? 'none';
      String? caption;
      if (policy == 'optional' || policy == 'required') {
        caption = await showDialog<String>(
          context: context,
          barrierDismissible: false,
          builder: (_) =>
              _CaptionDialog(required: policy == 'required', copy: copy),
        );
        if (caption == null) {
          // Discarded before it was stored: not evidence yet.
          await photo.releaseSource();
          return null;
        }
        if (!context.mounted) return null;
      }
      return _stored(
        context,
        () => inspections.recordPhoto(
          widget.inspectionId,
          fieldKey: field.key,
          category: _category(field),
          photo: photo,
          caption: caption,
        ),
      );
    },
    evidence: (id) => evidence[id],
    drawSignature: (context, field) async {
      // Who signs, as the answers say just before (docs/07 §4).
      String? bound(String prop) {
        final key = _string(field.props[prop]);
        final value = key == null ? null : _form?.value(key);
        return value == null ? null : '$value';
      }

      final name = bound('signer_name_field');
      final designation = bound('signer_designation_field');
      final minLength = field.props['min_stroke_length'];
      final signature = await Navigator.of(context).push<SignatureCapture>(
        MaterialPageRoute(
          builder: (_) => SignaturePadPage(
            title: field.label ?? copy('inspection.signature_title'),
            signerName: name,
            signerDesignation: designation,
            minStrokeLength: minLength is num ? minLength.toDouble() : 0,
          ),
        ),
      );
      if (signature == null || signature.isEmpty || !context.mounted) {
        return null;
      }
      return _stored(
        context,
        () => inspections.recordSignature(
          widget.inspectionId,
          fieldKey: field.key,
          signature: signature,
          signerName: name,
          signerDesignation: designation,
        ),
      );
    },
    evidenceImage: (id, size) =>
        _EvidenceImage(inspections: inspections, evidenceId: id, size: size),
    declaration: (key) => declarations[key],
  );

  /// Stores a capture; says so when it couldn't, and nothing is answered.
  Future<String?> _stored(
    BuildContext context,
    Future<String> Function() store,
  ) async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    final failed = ref.read(copyProvider)('inspection.capture_failed');
    try {
      final id = await store();
      // Its record, then its bytes, go up now if there's a network.
      unawaited(_inspections?.sendNow());
      return id;
    } on Object {
      messenger?.showSnackBar(SnackBar(content: Text(failed)));
      return null;
    }
  }

  static String _category(ResolvedField field) {
    final c = field.props['category'];
    return c is String && _keyPattern.hasMatch(c) ? c : 'photo';
  }

  /// A `job_briefing` step: the job as its view shows it, and the
  /// acknowledgement the flow asks for.
  Widget _briefing(
    Map<String, Object?> step,
    int index,
    FormController form,
    String Function(String key) copy,
  ) {
    final ack = _string(step['acknowledgement_text']);
    final agent = _data(ref.watch(agentProvider));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ViewRenderer(
          items: viewItems(
            ref,
            _string(step['view']) ?? 'job_detail',
            bankId: widget.job.bankId,
          ),
          context: RenderContext(
            data: {
              'job': jobViewData(widget.job),
              'agent': agent ?? const <String, Object?>{},
            },
            copy: copy,
            today: todayIso(),
          ),
        ),
        if (ack != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: CheckboxListTile(
              key: ValueKey('briefing-ack-$index'),
              value: _acknowledged.contains(index),
              onChanged: (on) => setState(() {
                if (on ?? false) {
                  _acknowledged.add(index);
                } else {
                  _acknowledged.remove(index);
                }
                _message = null;
              }),
              title: Text(
                renderTemplate(ack, form.resolved?.data ?? const {}),
              ),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
            ),
          ),
      ],
    );
  }

  Widget _stepView(
    FlowPosition at,
    FormController form,
    FormFieldServices services,
    String Function(String key) copy,
  ) {
    final runner = _runner!;
    final step = runner.steps[at.step];
    switch (step['type']) {
      case 'job_briefing':
        return _briefing(step, at.step, form, copy);
      case 'location_check':
        return LocationCheckView(
          inspections: _inspections!,
          inspectionId: widget.inspectionId,
          onPassed: _locationDone,
        );
      case 'form':
        return FormView(
          controller: form,
          copy: copy,
          services: services,
          sections: runner.sectionsAt(at),
          fieldFilter: _hasDeclarationStep
              ? (f) => f.type != 'declaration'
              : null,
        );
      case 'summary_review':
        return FormSummary(
          controller: form,
          copy: copy,
          sections: _flowSections,
          showRiskIndicators: step['show_risk_indicators'] == true,
          onEdit: step['allow_jump_back'] == true ? _jumpTo : null,
        );
      case 'declaration':
        final keys = _declarationKeys(step);
        return FormView(
          controller: form,
          copy: copy,
          services: services,
          sections: [
            for (final e in _sections.entries)
              if (e.value.any((f) => keys.contains(f.key))) e.key,
          ],
          fieldFilter: (f) => keys.contains(f.key),
        );
      default:
        return Padding(
          padding: const EdgeInsets.all(16),
          child: Text(copy('inspection.ready')),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(copyProvider);
    final inspections = _data(ref.watch(inspectionsProvider));
    final record = _data(ref.watch(inspectionProvider(widget.inspectionId)));
    final form = record == null
        ? null
        : _data(ref.watch(definitionVersionProvider(record.formVersionId)));
    final flow = record == null
        ? null
        : _data(ref.watch(definitionVersionProvider(record.flowVersionId)));
    final planState = record == null
        ? null
        : ref.watch(renderPlanProvider(record.formVersionId));
    final plan = planState == null ? null : _data(planState);
    final title =
        _string(widget.job.data['merchant_name']) ?? widget.job.reference;

    Widget body;
    Widget? bar;
    if (inspections == null || record == null || form == null || flow == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (record.submitted && _form == null) {
      body = _Message(copy('inspection.submitted'));
    } else if (_form == null && (planState?.hasError ?? false)) {
      // A form this build can't use (docs/04 §8): nothing half-shown.
      body = _Message(copy('form.unavailable'));
    } else if (_form == null && plan == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      _start(record, form, flow, inspections, plan!);
      final controller = _form!;
      if (controller.definitionError != null || _path.isEmpty) {
        body = _Message(copy('form.unavailable'));
      } else {
        final declarations = <String, Declaration?>{
          for (final fields in _sections.values)
            for (final f in fields)
              if (f.type == 'declaration')
                if (_string(f.props['declaration_key']) ?? f.key
                    case final String key)
                  key: _data<Declaration?>(
                    ref.watch(declarationProvider(key)),
                  ),
        };
        final at = _at;
        final step = _runner!.steps[at.step];
        final last = step['type'] == 'submit';
        final (n, total) = _progress();
        final data = controller.resolved?.data ?? const <String, Object?>{};
        final label = _string(step['label']);
        body = ListView(
          // Each page opens at its top.
          key: ValueKey('inspection-page-$at'),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Text(
                renderTemplate(copy('inspection.step'), {
                  'n': n + 1,
                  'total': total,
                }),
                key: ValueKey('inspection-step-$n'),
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
            if (label != null && !last)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: Text(
                  renderTemplate(label, data),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
            _stepView(
              at,
              controller,
              _services(inspections, declarations, copy, {
                for (final e
                    in _data(
                          ref.watch(
                            inspectionEvidenceProvider(widget.inspectionId),
                          ),
                        ) ??
                        const <EvidenceItem>[])
                  e.id: e,
              }),
              copy,
            ),
          ],
        );
        if (_paused) {
          // Nothing changes until the agent is back (B3.5); what was entered
          // stays.
          body = Column(
            children: [
              _PausedBanner(copy('inspection.paused')),
              Expanded(
                child: IgnorePointer(
                  child: Opacity(opacity: 0.4, child: body),
                ),
              ),
            ],
          );
        }
        bar = SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Row(
              children: [
                OutlinedButton(
                  key: const ValueKey('inspection-back'),
                  onPressed: _busy ? null : _back,
                  child: Text(copy('inspection.back')),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    key: ValueKey(
                      last ? 'inspection-submit' : 'inspection-next',
                    ),
                    onPressed: _busy || _paused
                        ? null
                        : last
                        ? () => _submit(step)
                        : _next,
                    child: Text(
                      last
                          ? renderTemplate(
                              label ?? copy('inspection.submit'),
                              data,
                            )
                          : copy('inspection.next'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
        // Above the buttons, so it shows however long the page is.
        final message = _message;
        if (message != null) {
          bar = Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: Text(
                  message,
                  key: const ValueKey('inspection-message'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
              bar,
            ],
          );
        }
      }
    }
    return Scaffold(
      appBar: PosHeader(
        title: title,
        onBack: () => Navigator.of(context).pop(),
      ),
      body: body,
      bottomNavigationBar: bar,
    );
  }
}

/// Shown while the inspection is paused because the agent left the fence.
class _PausedBanner extends StatelessWidget {
  const _PausedBanner(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ColoredBox(
      key: const ValueKey('inspection-paused'),
      color: scheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(Icons.location_off, color: scheme.onErrorContainer),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                text,
                style: TextStyle(color: scheme.onErrorContainer),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Evidence as the phone holds it; a cloud once the server has verified it
/// and the phone let its copy go.
class _EvidenceImage extends StatefulWidget {
  const _EvidenceImage({
    required this.inspections,
    required this.evidenceId,
    required this.size,
  });

  final Inspections inspections;
  final String evidenceId;
  final double size;

  @override
  State<_EvidenceImage> createState() => _EvidenceImageState();
}

class _EvidenceImageState extends State<_EvidenceImage> {
  late final Future<Uint8List?> _bytes = widget.inspections.evidenceBytes(
    widget.evidenceId,
  );

  @override
  Widget build(BuildContext context) => FutureBuilder<Uint8List?>(
    future: _bytes,
    builder: (context, snapshot) {
      final bytes = snapshot.data;
      if (bytes == null) {
        return ColoredBox(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          child: Icon(
            snapshot.connectionState == ConnectionState.done
                ? Icons.cloud_done
                : Icons.image,
          ),
        );
      }
      return Image.memory(
        bytes,
        key: ValueKey('evidence-${widget.evidenceId}'),
        fit: BoxFit.cover,
        cacheWidth: (widget.size * MediaQuery.devicePixelRatioOf(context))
            .round(),
        gaplessPlayback: true,
      );
    },
  );
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
