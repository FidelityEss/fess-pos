import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter/foundation.dart';

/// The form components this renderer draws (`11` §3–5), with their
/// versions for the capability report (T3-07). The rest arrive with their
/// tasks: number, date and the other Wave-1 inputs (T3-03), photo and
/// signature with the evidence pipeline.
const Map<String, int> supportedFormComponents = {
  'text': 1,
  'textarea': 1,
  'boolean': 1,
  'single_select': 1,
  'multi_select': 1,
  'info': 1,
  'callout': 1,
  'divider': 1,
  'group': 1,
};

/// One form being filled in (docs/04 §4–6): the answers so far and what
/// the rules make of them. Every change re-resolves the form with the
/// engine, so what is shown, required and offered follows the answers as
/// the agent goes; the problems come from the same validator the server
/// runs on arrival.
///
/// Hidden ⇒ absent: an answer to a field a rule has hidden stays here (it
/// comes back if the field does) but is never part of [answers].
class FormController extends ChangeNotifier {
  FormController({
    required this.definition,
    this.lists = const FormLists(),
    this.context = const ResolveContext(),
    this.extraChecks,
    Map<String, Object?> initialValues = const {},
  }) {
    _values.addAll(initialValues);
    try {
      compileForm(definition);
    } on EngineError catch (e) {
      _definitionError = e;
      return;
    }
    _refresh();
    _applyDefaults();
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

  final Map<String, Object?> _values = {};
  final Map<String, String> _otherText = {};
  final Set<String> _touched = {};
  bool _showAll = false;
  EngineError? _definitionError;
  Map<String, Object?> _answers = const {};
  ValidationResult? _result;

  /// Why this build can't work with the form at all (a component the
  /// engine doesn't know, a rule cycle); nothing is shown or sent.
  EngineError? get definitionError => _definitionError;

  /// The form as the rules make it now; null when [definitionError].
  ResolvedForm? get resolved => _result?.resolved;

  /// The raw value of [key], shown or not.
  Object? value(String key) => _values[key];

  /// The "other" description given for [key].
  String? otherText(String key) => _otherText[key];

  /// The answers as the envelope carries them (docs/04 §5): one entry per
  /// visible, answered input field.
  Map<String, Object?> get answers => _answers;

  /// Every current problem, shown or not.
  List<ValidationError> get errors => _result?.errors ?? const [];

  /// Visible fields this build can't draw; the form can't be finished
  /// here while there are any.
  List<String> get unsupportedVisible {
    final r = resolved;
    if (r == null) return const [];
    return [
      for (final key in r.order)
        if (r.fields[key]!.visible &&
            !supportedFormComponents.containsKey(r.fields[key]!.type))
          key,
    ];
  }

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
  void setValue(String key, Object? value, {bool touch = true}) {
    if (value == null) {
      _values.remove(key);
    } else {
      _values[key] = value;
    }
    if (touch) _touched.add(key);
    _refresh();
  }

  /// Sets the description of an "other" choice.
  void setOtherText(String key, String? text, {bool touch = true}) {
    if (text == null) {
      _otherText.remove(key);
    } else {
      _otherText[key] = text;
    }
    if (touch) _touched.add(key);
    _refresh();
  }

  /// Shows [key]'s problems from now on.
  void touch(String key) {
    if (_touched.add(key)) notifyListeners();
  }

  /// Shows every problem; true when there are none and every visible field
  /// could be answered here.
  bool validate() {
    _showAll = true;
    if (_definitionError != null) return false;
    _refresh();
    return (_result?.ok ?? false) && unsupportedVisible.isEmpty;
  }

  void _refresh() {
    if (_definitionError != null) return;
    // What the rules see first, so hidden fields drop out of the answers;
    // then the answers exactly as they would be sent, checked.
    final raw = {
      for (final e in _values.entries)
        if (!isEmptyAnswer(e.value)) e.key: e.value,
    };
    final seen = resolveForm(
      definition,
      context: context,
      answers: raw,
      lists: lists,
    );
    _answers = _entries(seen);
    final checked = validateAnswers(
      definition,
      _answers,
      context: context,
      lists: lists,
    );
    // An extra check may find what the form's own rules already found.
    final reported = {
      for (final e in checked.errors) '${e.fieldKey}|${e.code}',
    };
    final extra = [
      for (final e in extraChecks?.call(_answers) ?? const <ValidationError>[])
        if (reported.add('${e.fieldKey}|${e.code}')) e,
    ];
    _result = extra.isEmpty
        ? checked
        : ValidationResult([
            ...checked.errors,
            ...extra,
          ], resolved: checked.resolved);
    notifyListeners();
  }

  Map<String, Object?> _entries(ResolvedForm r) {
    final out = <String, Object?>{};
    for (final key in r.order) {
      final f = r.fields[key]!;
      final spec = formComponentSpec(f.type);
      if (!f.visible || spec == null || !spec.hasValue) continue;
      if (f.computed || f.type == 'prefilled') {
        if (f.value != null) {
          out[key] = {
            'v': f.value,
            if (f.computed) 'computed': true,
            if (f.type == 'prefilled') 'prefilled': true,
          };
        }
        continue;
      }
      final v = _values[key];
      if (isEmptyAnswer(v)) continue;
      final other = _otherText[key];
      final otherValue = f.props['other_value'] is String
          ? f.props['other_value']! as String
          : 'other';
      final otherChosen =
          f.props['allow_other'] == true &&
          (v == otherValue || (v is List<Object?> && v.contains(otherValue)));
      out[key] = {
        'v': v,
        if (otherChosen && other != null && other.trim().isNotEmpty)
          'other_text': other,
      };
    }
    return out;
  }

  void _applyDefaults() {
    final r = resolved;
    if (r == null) return;
    var applied = false;
    for (final f in r.fields.values) {
      if (f.visible &&
          f.hasDefault &&
          f.defaultValue != null &&
          !f.computed &&
          !_values.containsKey(f.key)) {
        _values[f.key] = f.defaultValue;
        applied = true;
      }
    }
    if (applied) _refresh();
  }
}
