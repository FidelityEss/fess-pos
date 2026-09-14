import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter/foundation.dart';

/// The form components this renderer draws (`11` §3–5), with their
/// versions for the capability report (T3-07). The rest arrive with their
/// tasks: address and location pin (M3), the Wave-2 components (T6-01).
const Map<String, int> supportedFormComponents = {
  'text': 1,
  'textarea': 1,
  'number': 1,
  'percentage': 1,
  'phone': 1,
  'boolean': 1,
  'tri_state': 1,
  'single_select': 1,
  'multi_select': 1,
  'date': 1,
  'time': 1,
  'duration': 1,
  'business_hours': 1,
  'info': 1,
  'callout': 1,
  'divider': 1,
  'prefilled': 1,
  'group': 1,
  'photo': 1,
  'signature': 1,
  'declaration': 1,
  'acknowledgement': 1,
};

/// Components drawn only inside an inspection, which brings the camera,
/// the signature pad and the declarations (T4-27). Elsewhere, e.g. an
/// unable reason that needs a photo, they hold the form as unsupported.
const Set<String> inspectionOnlyComponents = {
  'photo',
  'signature',
  'declaration',
};

/// One form being filled in (docs/04 §4–6): the answers so far and what
/// the rules make of them, kept by the engine's [FormSession]. A change
/// re-evaluates only what depends on it (docs/03 §8), so what is shown,
/// required and offered follows the answers as the agent goes; the
/// problems come from the same validator the server runs on arrival.
///
/// Hidden ⇒ absent: an answer to a field a rule has hidden stays here (it
/// comes back if the field does) but is never part of [answers].
class FormController extends ChangeNotifier {
  FormController({
    required this.definition,
    this.lists = const FormLists(),
    this.context = const ResolveContext(),
    this.extraChecks,
    this.inspection = false,
    CompiledForm? plan,
    Map<String, Object?> initialValues = const {},
    Map<String, String> initialOtherText = const {},
    Set<String> initialUnknown = const {},
    Set<String> initialFlaggedDiffers = const {},
  }) {
    try {
      _session = FormSession(
        plan ?? compileForm(definition),
        context: context,
        lists: lists,
        values: initialValues,
        otherText: initialOtherText,
        unknown: initialUnknown,
        flaggedDiffers: initialFlaggedDiffers,
      );
    } on EngineError catch (e) {
      _definitionError = e;
      return;
    }
    _applyDefaults();
    _check();
  }

  /// The `form` definition.
  final Map<String, Object?> definition;

  /// Where `options_source` options come from.
  final FormLists lists;

  /// What rules read besides the answers: `job`, `agent`, `today`, …
  final ResolveContext context;

  /// Checks beyond the form's own, on the answers as they would be sent:
  /// what the action the form submits to requires (e.g. a reason that
  /// needs a note).
  final List<ValidationError> Function(Map<String, Object?> answers)?
  extraChecks;

  /// Filled in inside an inspection, where [inspectionOnlyComponents] can
  /// be answered.
  final bool inspection;

  FormSession? _session;
  final Set<String> _touched = {};
  bool _showAll = false;
  EngineError? _definitionError;
  List<ValidationError> _errors = const [];

  /// Why this build can't work with the form at all (a component the
  /// engine doesn't know, a rule cycle); nothing is shown or sent.
  EngineError? get definitionError => _definitionError;

  /// The form as the rules make it now; null when [definitionError].
  ResolvedForm? get resolved => _session?.resolved;

  /// The raw value of [key], shown or not.
  Object? value(String key) => _session?.value(key);

  /// Every raw answer given, shown or not: what a draft keeps.
  Map<String, Object?> get values => _session?.values ?? const {};

  /// The "other" descriptions given, by field key.
  Map<String, String> get otherTexts => _session?.otherTexts ?? const {};

  /// The "other" description given for [key].
  String? otherText(String key) => _session?.otherText(key);

  /// Dates the agent said they don't know (`allow_unknown`).
  Set<String> get unknownKeys => _session?.unknownKeys ?? const {};

  bool isUnknown(String key) => _session?.isUnknown(key) ?? false;

  /// Prefilled values the agent flagged as different on site.
  Set<String> get flaggedDiffers => _session?.flaggedDiffers ?? const {};

  bool isFlaggedDiffers(String key) => _session?.isFlaggedDiffers(key) ?? false;

  /// The answers as the envelope carries them (docs/04 §5): one entry per
  /// visible, answered input field.
  Map<String, Object?> get answers => _session?.answers ?? const {};

  /// Every current problem, shown or not.
  List<ValidationError> get errors => _errors;

  /// Shows the problems of [keys] from now on, e.g. a flow step's fields
  /// when the agent tries to go on.
  void touchAll(Iterable<String> keys) {
    var changed = false;
    for (final k in keys) {
      changed = _touched.add(k) || changed;
    }
    if (changed) notifyListeners();
  }

  /// Visible fields this build can't draw; the form can't be finished
  /// here while there are any.
  List<String> get unsupportedVisible {
    final r = resolved;
    if (r == null) return const [];
    return [
      for (final key in r.order)
        if (r.fields[key]!.visible && !_drawable(r.fields[key]!.type)) key,
    ];
  }

  bool _drawable(String type) =>
      supportedFormComponents.containsKey(type) &&
      (inspection || !inspectionOnlyComponents.contains(type));

  /// The problems to show under [key]: once the agent has finished with
  /// it, or everywhere after [validate].
  List<ValidationError> errorsFor(String key) =>
      _showAll || _touched.contains(key)
      ? [
          for (final e in errors)
            if (e.fieldKey == key) e,
        ]
      : const [];

  /// Sets [key]'s answer; [touch] shows its problems from now on (text
  /// fields touch on leaving the field, not on every key).
  void setValue(String key, Object? value, {bool touch = true}) =>
      _change(key, (s) => s.setValue(key, value), touch: touch);

  /// Marks a date as not known, which answers it where the field allows
  /// that (`allow_unknown`), or takes the mark away.
  void setUnknown(String key, {required bool unknown}) =>
      _change(key, (s) => s.setUnknown(key, unknown: unknown));

  /// Flags a prefilled value as different on site (`allow_flag_differs`).
  void setFlaggedDiffers(String key, {required bool flagged}) =>
      _change(key, (s) => s.setFlaggedDiffers(key, flagged: flagged));

  /// Sets the description of an "other" choice.
  void setOtherText(String key, String? text, {bool touch = true}) =>
      _change(key, (s) => s.setOtherText(key, text), touch: touch);

  /// Shows [key]'s problems from now on.
  void touch(String key) {
    if (_touched.add(key)) notifyListeners();
  }

  /// Shows every problem; true when there are none and every visible field
  /// could be answered here.
  bool validate() {
    _showAll = true;
    notifyListeners();
    return _session != null && _errors.isEmpty && unsupportedVisible.isEmpty;
  }

  void _change(
    String key,
    void Function(FormSession session) apply, {
    bool touch = true,
  }) {
    final s = _session;
    if (s == null) return;
    apply(s);
    if (touch) _touched.add(key);
    _check();
  }

  /// The session's problems, and those of [extraChecks] it didn't find.
  void _check() {
    final s = _session!;
    final reported = {for (final e in s.errors) '${e.fieldKey}|${e.code}'};
    final extra = [
      for (final e in extraChecks?.call(s.answers) ?? const <ValidationError>[])
        if (reported.add('${e.fieldKey}|${e.code}')) e,
    ];
    _errors = extra.isEmpty ? s.errors : [...s.errors, ...extra];
    notifyListeners();
  }

  /// Defaults fill in before the agent starts, from the form as it first
  /// resolves.
  void _applyDefaults() {
    final s = _session!;
    for (final f in s.resolved.fields.values) {
      if (f.visible &&
          f.hasDefault &&
          f.defaultValue != null &&
          !f.computed &&
          !s.values.containsKey(f.key)) {
        s.setValue(f.key, f.defaultValue);
      }
    }
  }
}
