/// One form being filled in, kept up to date answer by answer (docs/03 §8,
/// C2). A change re-evaluates, in dependency order, only the fields that
/// read it, and re-checks only their answers. The result is what resolving
/// and validating the whole form again would give; the tests hold it to
/// that.
///
/// It keeps what the agent gave: every raw answer (a hidden field's stays
/// and comes back with the field, but is never sent), the "other"
/// descriptions, dates marked as not known and prefilled values flagged as
/// different. From those it builds the answers as they are sent (docs/04
/// §5).
library;

import 'package:fess_pos_engine/src/forms/model.dart';
import 'package:fess_pos_engine/src/forms/resolver.dart';
import 'package:fess_pos_engine/src/forms/validator.dart';
import 'package:fess_pos_engine/src/forms/values.dart' show isEmptyAnswer;

const Set<String> _noAnswer = {'group', 'info', 'callout', 'divider', 'image'};

class FormSession {
  FormSession(
    this.plan, {
    this.context = const ResolveContext(),
    FormLists lists = const FormLists(),
    Map<String, Object?> values = const {},
    Map<String, String> otherText = const {},
    Set<String> unknown = const {},
    Set<String> flaggedDiffers = const {},
    Map<String, String> renderedAs = const {},
  }) : _resolution = IncrementalResolution(
         plan,
         context: context,
         lists: lists,
       ) {
    _values.addAll(values);
    _otherText.addAll(otherText);
    _unknown.addAll(unknown);
    _flagged.addAll(flaggedDiffers);
    _renderedAs.addAll(renderedAs);
    _unknown.forEach(_values.remove);
    for (final e in _values.entries) {
      if (!isEmptyAnswer(e.value)) _raw[e.key] = e.value;
    }
    _resolution
      ..raw = _raw
      ..runAll();
    plan.fields.forEach(_check);
    _assemble(plan.byKey.keys.toSet());
  }

  /// The compiled form.
  final CompiledForm plan;

  /// What rules read besides the answers.
  final ResolveContext context;

  final IncrementalResolution _resolution;
  final Map<String, Object?> _values = {};
  final Map<String, Object?> _raw = {};
  final Map<String, String> _otherText = {};
  final Set<String> _unknown = {};
  final Set<String> _flagged = {};
  final Map<String, String> _renderedAs = {};
  final Map<String, Object?> _entries = {};
  final Map<String, List<ValidationError>> _fieldErrors = {};
  late ResolvedForm _resolved;
  late Map<String, Object?> _answers;
  List<ValidationError> _errors = const [];
  Set<String> _lastEvaluated = const {};

  /// Every raw answer given, shown or not: what a draft keeps.
  Map<String, Object?> get values => Map.unmodifiable(_values);

  Object? value(String key) => _values[key];

  /// The "other" descriptions given, by field key.
  Map<String, String> get otherTexts => Map.unmodifiable(_otherText);

  String? otherText(String key) => _otherText[key];

  /// Dates the agent said they don't know (`allow_unknown`).
  Set<String> get unknownKeys => Set.unmodifiable(_unknown);

  bool isUnknown(String key) => _unknown.contains(key);

  /// Prefilled values flagged as different on site (`allow_flag_differs`).
  Set<String> get flaggedDiffers => Set.unmodifiable(_flagged);

  bool isFlaggedDiffers(String key) => _flagged.contains(key);

  /// Fields drawn as their declared fallback (`rendered_as`, docs/04 §8):
  /// the fallback's type by field key.
  Map<String, String> get renderedAs => Map.unmodifiable(_renderedAs);

  /// Records that [key] is drawn as its fallback [type], or not (null).
  void setRenderedAs(String key, String? type) {
    if (type == null) {
      _renderedAs.remove(key);
    } else {
      _renderedAs[key] = type;
    }
    _recheck({key});
  }

  /// The answers as sent (docs/04 §5): one entry per visible, answered
  /// input field, in document order.
  Map<String, Object?> get answers => _answers;

  /// The form as the rules make it now.
  ResolvedForm get resolved => _resolved;

  /// Every problem, with the server's codes.
  List<ValidationError> get errors => _errors;

  bool get ok => _errors.isEmpty;

  /// The fields the last change evaluated again; all of them at the start.
  Set<String> get lastEvaluated => _lastEvaluated;

  /// Sets [key]'s raw answer; null clears it.
  void setValue(String key, Object? value) {
    if (value == null) {
      _values.remove(key);
    } else {
      _values[key] = value;
      _unknown.remove(key);
    }
    _answerChanged(key);
  }

  /// Sets the description of an "other" choice.
  void setOtherText(String key, String? text) {
    if (text == null) {
      _otherText.remove(key);
    } else {
      _otherText[key] = text;
    }
    _recheck({key});
  }

  /// Marks a date as not known, which answers it where the field allows
  /// that, or takes the mark away.
  void setUnknown(String key, {required bool unknown}) {
    if (unknown) {
      _unknown.add(key);
      _values.remove(key);
    } else {
      _unknown.remove(key);
    }
    _answerChanged(key);
  }

  /// Flags a prefilled value as different on site, or takes the flag away.
  void setFlaggedDiffers(String key, {required bool flagged}) {
    if (flagged) {
      _flagged.add(key);
    } else {
      _flagged.remove(key);
    }
    _recheck({key});
  }

  void _answerChanged(String key) {
    final v = _values[key];
    if (isEmptyAnswer(v)) {
      _raw.remove(key);
    } else {
      _raw[key] = v;
    }
    _recheck({
      key,
      ..._resolution.update({key}),
    });
  }

  void _recheck(Set<String> keys) {
    for (final k in keys) {
      final cf = plan.byKey[k];
      if (cf != null) _check(cf);
    }
    _assemble(keys);
  }

  void _check(CompiledField cf) {
    if (!cf.spec.hasValue) return;
    final key = cf.key;
    final rf = _resolution.fields[key]!;
    final entry = _entryFor(cf, rf);
    if (entry == null) {
      _entries.remove(key);
    } else {
      _entries[key] = entry;
    }
    _fieldErrors[key] = checkAnswerEntry(
      cf.def,
      cf.spec,
      rf,
      entry,
      data: _resolution.data,
      env: _resolution.env,
      context: context,
    );
  }

  void _assemble(Set<String> evaluated) {
    _lastEvaluated = evaluated;
    _resolved = _resolution.snapshot();
    _answers = Map.unmodifiable({
      for (final k in plan.keys)
        if (_entries.containsKey(k)) k: _entries[k],
    });
    _errors = List.unmodifiable([
      for (final k in plan.keys) ...?_fieldErrors[k],
      ...ruleErrorsOf(_resolved),
    ]);
  }

  Map<String, Object?> _entryOf(ResolvedField f, {bool flagged = false}) => {
    'v': f.value,
    if (f.computed) 'computed': true,
    if (f.type == 'prefilled') 'prefilled': true,
    if (flagged) 'flagged_differs': true,
  };

  /// The entry sent for a field, as the module builds it; null for none.
  Map<String, Object?>? _entryFor(CompiledField cf, ResolvedField rf) {
    final key = cf.key;
    if (!rf.visible) return null;
    if (rf.computed || cf.spec.type == 'prefilled') {
      if (rf.value == null) return null;
      return _entryOf(
        rf,
        flagged:
            cf.spec.type == 'prefilled' &&
            rf.props['allow_flag_differs'] == true &&
            _flagged.contains(key),
      );
    }
    if (_unknown.contains(key) &&
        cf.spec.type == 'date' &&
        rf.props['allow_unknown'] == true) {
      return {'v': null, 'unknown': true};
    }
    final v = _values[key];
    if (isEmptyAnswer(v)) return null;
    if (cf.spec.type == 'repeatable_group' && v is List<Object?>) {
      return {
        'v': [
          for (final item in rf.items ?? const <ResolvedItem>[])
            {
              for (final e in item.fields.entries)
                if (e.value.visible &&
                    !_noAnswer.contains(e.value.type) &&
                    e.value.value != null)
                  e.key: _entryOf(e.value),
            },
        ],
      };
    }
    final otherValue = rf.props['other_value'] is String
        ? rf.props['other_value']! as String
        : 'other';
    final other = _otherText[key];
    final otherChosen =
        rf.props['allow_other'] == true &&
        (v == otherValue || (v is List<Object?> && v.contains(otherValue)));
    return {
      'v': v,
      if (otherChosen && other != null && other.trim().isNotEmpty)
        'other_text': other,
      if (_renderedAs[key] case final String type) 'rendered_as': type,
    };
  }
}
