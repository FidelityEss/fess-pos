import 'dart:async';
import 'dart:typed_data';

import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/inspections/capture_page.dart';
import 'package:fess_pos/src/features/inspections/signature_pad_page.dart';
import 'package:fess_pos/src/features/jobs/job_action_pages.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/renderer/form/form_controller.dart';
import 'package:fess_pos/src/renderer/form/form_services.dart';
import 'package:fess_pos/src/renderer/form/form_view.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart'
    show ResolvedField, contextFromSnapshot, renderTemplate;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

T? _data<T>(AsyncValue<T> value) => switch (value) {
  AsyncData(:final value) => value,
  _ => null,
};

String? _string(Object? v) => v is String ? v : null;

List<String> _strings(Object? v) => [
  if (v is List<Object?>)
    for (final x in v)
      if (x is String) x,
];

List<Map<String, Object?>> _maps(Object? v) => v is List<Object?>
    ? v.whereType<Map<String, Object?>>().toList()
    : const [];

final RegExp _keyPattern = RegExp(r'^[a-z][a-z0-9_]{0,63}$');

/// The flow steps this build runs (T4-27): `form`, `declaration` and
/// `submit`. `location_check` ran when the inspection began; the briefing,
/// the summary and the rest of the step catalogue come with the full flow
/// runner (T3-04).
const Set<String> runnableStepTypes = {'form', 'declaration', 'submit'};

List<Map<String, Object?>> runnableSteps(Map<String, Object?> flow) => [
  for (final s in _maps(flow['steps']))
    if (runnableStepTypes.contains(s['type'])) s,
];

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

/// An inspection in progress (T4-27): the pinned flow's steps over the
/// pinned form, the answers kept on the phone as they're given (a closed
/// app resumes where it was), then the seal and the submission. The rules,
/// what's required and the wording all come from the definitions.
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

class _InspectionPageState extends ConsumerState<InspectionPage> {
  FormController? _form;
  Inspections? _inspections;
  Map<String, List<_FieldDef>> _sections = const {};
  List<Map<String, Object?>> _steps = const [];
  int _step = 0;
  Timer? _saveTimer;
  bool _unsaved = false;
  bool _busy = false;
  String? _message;

  @override
  void dispose() {
    _saveTimer?.cancel();
    // Reads the answers before the controller goes; the write finishes on
    // its own.
    if (_unsaved) unawaited(_save());
    _form?.dispose();
    super.dispose();
  }

  void _start(
    InspectionRecord record,
    Map<String, Object?> form,
    Map<String, Object?> flow,
    Inspections inspections,
  ) {
    if (_form != null) return;
    _inspections = inspections;
    _sections = _fieldsBySection(form);
    _steps = runnableSteps(flow);
    _step = _steps.isEmpty ? 0 : record.currentStep.clamp(0, _steps.length - 1);
    _form = FormController(
      definition: form,
      inspection: true,
      context: contextFromSnapshot(record.contextSnapshot),
      initialValues: record.values,
      initialOtherText: record.otherText,
    )..addListener(_scheduleSave);
  }

  void _scheduleSave() {
    _unsaved = true;
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 400), () {
      unawaited(_save());
    });
  }

  Future<void> _save() async {
    final form = _form;
    final inspections = _inspections;
    if (form == null || inspections == null) return;
    _unsaved = false;
    final values = form.values;
    final other = form.otherTexts;
    final step = _step;
    try {
      await inspections.saveDraft(
        widget.inspectionId,
        values: values,
        otherText: other,
        currentStep: step,
      );
    } on Object {
      // The answers are still on screen; the next change saves again.
      _unsaved = true;
    }
  }

  bool get _hasDeclarationStep => _steps.any((s) => s['type'] == 'declaration');

  /// The declaration fields [step] asks for.
  Set<String> _declarationKeys(Map<String, Object?> step) {
    final key = _string(step['declaration_key']);
    return {
      for (final fields in _sections.values)
        for (final f in fields)
          if (f.type == 'declaration' &&
              (key == null || (_string(f.props['declaration_key']) == key)))
            f.key,
    };
  }

  /// The fields step [step] shows.
  Set<String> _keysOf(Map<String, Object?> step) => switch (step['type']) {
    'form' => {
      for (final section in _strings(step['sections']))
        for (final f in _sections[section] ?? const <_FieldDef>[])
          if (!(_hasDeclarationStep && f.type == 'declaration')) f.key,
    },
    'declaration' => _declarationKeys(step),
    _ => const {},
  };

  bool _stepHasProblems(Set<String> keys) {
    final form = _form!;
    return form.errors.any((e) => keys.contains(e.fieldKey)) ||
        form.unsupportedVisible.any(keys.contains);
  }

  void _next() {
    final keys = _keysOf(_steps[_step]);
    _form!.touchAll(keys);
    if (_stepHasProblems(keys)) {
      final copy = ref.read(copyProvider);
      setState(() => _message = copy('inspection.fix_answers'));
      return;
    }
    setState(() {
      _step++;
      _message = null;
    });
    unawaited(_save());
  }

  void _back() {
    if (_step == 0) {
      Navigator.of(context).pop();
      return;
    }
    setState(() {
      _step--;
      _message = null;
    });
    unawaited(_save());
  }

  Future<void> _submit(Map<String, Object?> step) async {
    final form = _form!;
    final copy = ref.read(copyProvider);
    if (!form.validate()) {
      final bad = {
        for (final e in form.errors) e.fieldKey,
        ...form.unsupportedVisible,
      };
      final at = _steps.indexWhere((s) => _keysOf(s).any(bad.contains));
      setState(() {
        if (at >= 0) _step = at;
        _message = copy('inspection.fix_answers');
      });
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(
          _string(step['confirm_text']) ?? copy('inspection.submit_confirm'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(copy('inspection.cancel')),
          ),
          FilledButton(
            key: const ValueKey('inspection-submit-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(_string(step['label']) ?? copy('inspection.submit')),
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

  FormFieldServices _services(
    Inspections inspections,
    Map<String, Declaration?> declarations,
    String Function(String key) copy,
  ) => FormFieldServices(
    takePhoto: (context, field) async {
      final photo = await Navigator.of(context).push<CapturedPhoto>(
        MaterialPageRoute(
          builder: (_) =>
              CapturePage(title: field.label ?? copy('inspection.take_photo')),
        ),
      );
      if (photo == null || !context.mounted) return null;
      return _stored(
        context,
        () => inspections.recordPhoto(
          widget.inspectionId,
          fieldKey: field.key,
          category: _category(field),
          photo: photo,
        ),
      );
    },
    drawSignature: (context, field) async {
      final nameField = _string(field.props['signer_name_field']);
      final signature = await Navigator.of(context).push<SignatureCapture>(
        MaterialPageRoute(
          builder: (_) => SignaturePadPage(
            title: field.label ?? copy('inspection.signature_title'),
            signerName: nameField == null
                ? null
                : _string(_form?.value(nameField)),
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

  Widget _stepView(
    Map<String, Object?> step,
    FormController form,
    FormFieldServices services,
    String Function(String key) copy,
  ) {
    switch (step['type']) {
      case 'form':
        return FormView(
          controller: form,
          copy: copy,
          services: services,
          sections: _strings(step['sections']),
          fieldFilter: _hasDeclarationStep
              ? (f) => f.type != 'declaration'
              : null,
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
    final title =
        _string(widget.job.data['merchant_name']) ?? widget.job.reference;

    Widget body;
    Widget? bar;
    if (inspections == null || record == null || form == null || flow == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (record.submitted && _form == null) {
      body = _Message(copy('inspection.submitted'));
    } else {
      _start(record, form, flow, inspections);
      final controller = _form!;
      if (controller.definitionError != null || _steps.isEmpty) {
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
        final step = _steps[_step];
        final last = step['type'] == 'submit';
        body = ListView(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Text(
                renderTemplate(copy('inspection.step'), {
                  'n': _step + 1,
                  'total': _steps.length,
                }),
                key: ValueKey('inspection-step-$_step'),
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
            _stepView(
              step,
              controller,
              _services(inspections, declarations, copy),
              copy,
            ),
            if (_message != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  _message!,
                  key: const ValueKey('inspection-message'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          ],
        );
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
                    onPressed: _busy
                        ? null
                        : last
                        ? () => _submit(step)
                        : _next,
                    child: Text(
                      last
                          ? _string(step['label']) ?? copy('inspection.submit')
                          : copy('inspection.next'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
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
