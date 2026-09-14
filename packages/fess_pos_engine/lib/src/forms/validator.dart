/// Answer validation (docs/04 §5–6), the Dart twin of `src/validator.ts`.
/// The module runs it before anything is sent; the server runs the
/// TypeScript one again on arrival, with the same codes:
///
/// - unknown keys are rejected; display components and groups carry no
///   answers;
/// - hidden-by-rule fields must be absent;
/// - required-when-visible answers must be present (null, "", [] and {} are
///   missing);
/// - every value must match its component's shape and resolved limits;
/// - choices must be among the (filtered) options, or the declared "other"
///   value with `other_text`;
/// - `validate[]` rules run on visible, non-empty answers;
/// - computed values must match their rule; prefilled values their source;
/// - a repeatable group's items are checked the same way, each with its
///   own `item.*`, and their count against `min_items` / `max_items`.
library;

import 'package:fess_pos_engine/src/errors.dart';
import 'package:fess_pos_engine/src/forms/catalogue.dart';
import 'package:fess_pos_engine/src/forms/model.dart';
import 'package:fess_pos_engine/src/forms/resolver.dart';
import 'package:fess_pos_engine/src/forms/templates.dart';
import 'package:fess_pos_engine/src/forms/values.dart';
import 'package:fess_pos_engine/src/hash.dart';
import 'package:fess_pos_engine/src/json.dart';
import 'package:fess_pos_engine/src/rules/evaluate.dart';

const Set<String> _entryKeys = {
  'v',
  'prefilled',
  'flagged_differs',
  'computed',
  'rendered_as',
  'other_text',
  'unknown',
};

const List<String> _boolEntryKeys = [
  'prefilled',
  'flagged_differs',
  'computed',
  'unknown',
];

const Set<String> _displayTypes = {'info', 'callout', 'divider', 'image'};

List<Map<String, Object?>> _maps(Object? v) => v is List<Object?>
    ? v.whereType<Map<String, Object?>>().toList()
    : const [];

bool _isJsonValue(Object? v, [int depth = 0]) {
  if (depth > 256) return false;
  return switch (v) {
    null || bool() || String() => true,
    final num n => n.isFinite,
    final List<Object?> l => l.every((x) => _isJsonValue(x, depth + 1)),
    final Map<Object?, Object?> m =>
      m.keys.every((k) => k is String) &&
          m.values.every((x) => _isJsonValue(x, depth + 1)),
    _ => false,
  };
}

String? _entryProblem(Object? entry) {
  if (entry is! Map<String, Object?>) {
    return 'an answer entry must be an object {v, …}';
  }
  if (!entry.containsKey('v')) return 'an answer entry needs `v`';
  for (final k in entry.keys) {
    if (!_entryKeys.contains(k)) return 'unknown answer entry property "$k"';
  }
  // Present means set: `"other_text": null` is refused, as in TypeScript.
  for (final k in _boolEntryKeys) {
    if (entry.containsKey(k) && entry[k] is! bool) return '$k must be boolean';
  }
  if (entry.containsKey('rendered_as') && entry['rendered_as'] is! String) {
    return 'rendered_as must be a string';
  }
  if (entry.containsKey('other_text') && entry['other_text'] is! String) {
    return 'other_text must be a string';
  }
  if (!_isJsonValue(entry['v'])) return 'v must be a JSON value';
  return null;
}

/// A repeatable group's child fields by key, groups opened.
Map<String, Map<String, Object?>> _childMap(Map<String, Object?> def) {
  final out = <String, Map<String, Object?>>{};
  void visit(List<Map<String, Object?>> fields) {
    for (final f in fields) {
      final key = f['key'];
      if (key is String) out[key] = f;
      if (f['type'] == 'group') visit(_maps(f['fields']));
    }
  }

  visit(_maps(def['fields']));
  return out;
}

class _Ctx {
  _Ctx(this.errors, this.env, this.context);

  final List<ValidationError> errors;
  final RuleEnv env;
  final ResolveContext context;

  void push(String path, String code, String message) =>
      errors.add(ValidationError(path, code, message));
}

/// The problems with one field's answer entry (null when unanswered): what
/// [validateAnswers] finds for that field, given the field as resolved and
/// the data its `validate` rules read. The entry must be well formed.
List<ValidationError> checkAnswerEntry(
  Map<String, Object?> def,
  ComponentSpec spec,
  ResolvedField rf,
  Map<String, Object?>? entry, {
  required Map<String, Object?> data,
  required RuleEnv env,
  ResolveContext context = const ResolveContext(),
}) {
  final errors = <ValidationError>[];
  _checkField(_Ctx(errors, env, context), def, spec, rf, entry, data);
  return errors;
}

/// The rules that failed while resolving, as problems (`RULE_ERROR`),
/// except those of hidden fields.
List<ValidationError> ruleErrorsOf(ResolvedForm resolved) => [
  for (final issue in resolved.errors)
    if (resolved.fields[issue.path.split('[').first]?.visible ?? true)
      ValidationError(
        issue.path,
        'RULE_ERROR',
        '${issue.property}: ${issue.message}',
      ),
];

/// Validates an answers map (`{key: {v, …}}`) of [form].
ValidationResult validateAnswers(
  Map<String, Object?> form,
  Object? answers, {
  ResolveContext context = const ResolveContext(),
  FormLists lists = const FormLists(),
}) {
  final errors = <ValidationError>[];
  if (answers is! Map<String, Object?>) {
    return const ValidationResult([
      ValidationError(
        '',
        'INVALID_ANSWERS',
        'answers must be an object keyed by field key',
      ),
    ]);
  }
  final compiled = compileForm(form);
  final raw = <String, Object?>{};
  final entries = <String, Map<String, Object?>>{};
  for (final e in answers.entries) {
    final cf = compiled.byKey[e.key];
    if (cf == null || !cf.spec.hasValue) {
      errors.add(
        ValidationError(
          e.key,
          'UNKNOWN_FIELD',
          '"${e.key}" is not an input field of this form',
        ),
      );
      continue;
    }
    final problem = _entryProblem(e.value);
    if (problem != null) {
      errors.add(ValidationError(e.key, 'INVALID_ENTRY', problem));
      continue;
    }
    final entry = e.value! as Map<String, Object?>;
    entries[e.key] = entry;
    raw[e.key] = cf.spec.type == 'repeatable_group'
        ? _itemsToRaw(entry['v'], cf.def, e.key, errors)
        : entry['v'];
  }

  final resolved = resolveForm(
    form,
    context: context,
    answers: raw,
    lists: lists,
  );
  final ctx = _Ctx(errors, resolved.env, context);
  for (final cf in compiled.fields) {
    if (!cf.spec.hasValue) continue;
    final rf = resolved.fields[cf.key]!;
    _checkField(ctx, cf.def, cf.spec, rf, entries[cf.key], resolved.data);
  }
  errors.addAll(ruleErrorsOf(resolved));
  return ValidationResult(errors, resolved: resolved);
}

/// A repeatable group's items as raw values, their entries checked.
Object? _itemsToRaw(
  Object? v,
  Map<String, Object?> def,
  String key,
  List<ValidationError> errors,
) {
  if (v is! List<Object?>) return v;
  final kids = _childMap(def);
  final items = <Object?>[];
  for (var i = 0; i < v.length; i++) {
    final item = v[i];
    if (item is! Map<String, Object?>) {
      errors.add(
        ValidationError(
          '$key[$i]',
          'INVALID_ENTRY',
          'each item must be an object of answer entries',
        ),
      );
      items.add(<String, Object?>{});
      continue;
    }
    final out = <String, Object?>{};
    for (final e in item.entries) {
      final kid = kids[e.key];
      final path = '$key[$i].${e.key}';
      if (kid == null ||
          kid['type'] == 'group' ||
          _displayTypes.contains(kid['type'])) {
        errors.add(
          ValidationError(
            path,
            'UNKNOWN_FIELD',
            '"${e.key}" is not an input field of this group',
          ),
        );
        continue;
      }
      final problem = _entryProblem(e.value);
      if (problem != null) {
        errors.add(ValidationError(path, 'INVALID_ENTRY', problem));
        continue;
      }
      out[e.key] = (e.value! as Map<String, Object?>)['v'];
    }
    items.add(out);
  }
  return items;
}

void _checkField(
  _Ctx ctx,
  Map<String, Object?> def,
  ComponentSpec spec,
  ResolvedField rf,
  Map<String, Object?>? entry,
  Map<String, Object?> data,
) {
  final path = rf.path;
  void push(String code, String message) => ctx.push(path, code, message);
  final present = entry != null;
  if (!rf.visible) {
    if (present) {
      push(
        'HIDDEN_FIELD_PRESENT',
        'this field is hidden by a rule and must be omitted',
      );
    }
    return;
  }
  final v = present ? entry['v'] : null;

  if (def.containsKey('value')) {
    final expected = rf.value;
    final ok = expected == null
        ? !present || entry['v'] == null
        : present &&
              entry['computed'] == true &&
              deepEqual(entry['v'], expected);
    if (!ok) {
      push(
        'COMPUTED_MISMATCH',
        "computed value does not match the server's recomputation",
      );
    }
    return;
  }
  if (spec.type == 'prefilled') {
    if ((present || rf.value != null) && !deepEqual(v, rf.value)) {
      push(
        'PREFILL_MISMATCH',
        'prefilled value differs from the job/agent snapshot',
      );
    }
    return;
  }

  final unknown = present && entry['unknown'] == true;
  final unknownOk =
      unknown && spec.type == 'date' && rf.props['allow_unknown'] == true;
  if (unknown && !unknownOk) {
    push(
      'INVALID_ENTRY',
      '`unknown` is only allowed on date fields with allow_unknown',
    );
    return;
  }
  if (unknownOk) {
    if (entry['v'] != null) {
      push('INVALID_ENTRY', 'an unknown date must have v = null');
    }
    return;
  }
  if (isEmptyAnswer(v)) {
    if (rf.required) push('REQUIRED', 'this answer is required');
    if (present && entry['other_text'] != null) {
      push('INVALID_ENTRY', 'other_text given without the other option');
    }
    return;
  }

  var type = spec.type;
  var props = rf.props;
  final renderedAs = present ? entry['rendered_as'] : null;
  if (renderedAs is String) {
    final fallback = def['fallback'];
    if (fallback is! Map<String, Object?> || fallback['type'] != renderedAs) {
      push(
        'INVALID_RENDERED_AS',
        'rendered_as "$renderedAs" is not this field\'s declared fallback',
      );
      return;
    }
    type = renderedAs;
    final fallbackProps = fallback['props'];
    props = fallbackProps is Map<String, Object?> ? fallbackProps : const {};
  }
  final issues = validateValue(
    type,
    v,
    props,
    job: ctx.context.job,
    today: ctx.context.today,
  );
  for (final i in issues) {
    push(i.code, i.message);
  }

  final otherText = present ? entry['other_text'] : null;
  if (type == spec.type &&
      (type == 'single_select' || type == 'multi_select' || type == 'lookup')) {
    final allowed = {for (final o in rf.options ?? <OptionDef>[]) o.value};
    final otherValue = props['other_value'] is String
        ? props['other_value']! as String
        : 'other';
    final allowOther = props['allow_other'] == true;
    final chosen = v is List<Object?> ? v : [v];
    var otherChosen = false;
    for (final c in chosen) {
      if (c is! String) continue;
      if (allowOther && c == otherValue) {
        otherChosen = true;
        if (!allowed.contains(c)) continue;
      }
      if (!allowed.contains(c)) {
        push('INVALID_OPTION', '"$c" is not an available option');
      }
    }
    if (otherChosen && (otherText is! String || otherText.trim().isEmpty)) {
      push('OTHER_TEXT_REQUIRED', 'describe the other option');
    }
    if (!otherChosen && otherText != null) {
      push('INVALID_ENTRY', 'other_text given without the other option');
    }
  } else if (otherText != null) {
    push('INVALID_ENTRY', 'other_text is only allowed on choice fields');
  }

  if (spec.type == 'repeatable_group' && v is List<Object?>) {
    final min = rf.props['min_items'];
    final max = rf.props['max_items'];
    if (min is num && v.length < min) {
      push('TOO_FEW_ITEMS', 'add at least $min');
    }
    if (max is num && v.length > max) {
      push('TOO_MANY_ITEMS', 'at most $max allowed');
    }
    final kids = _childMap(def);
    for (final item in rf.items ?? const <ResolvedItem>[]) {
      final rawItem = item.index < v.length ? v[item.index] : null;
      final itemEntries = rawItem is Map<String, Object?>
          ? rawItem
          : const <String, Object?>{};
      for (final e in item.fields.entries) {
        final kidDef = kids[e.key];
        final kidType = kidDef?['type'];
        final kidSpec = kidType is String ? formComponentSpec(kidType) : null;
        if (kidDef == null || kidSpec == null || !kidSpec.hasValue) continue;
        final kidEntry = itemEntries[e.key];
        _checkField(
          ctx,
          kidDef,
          kidSpec,
          e.value,
          kidEntry != null && _entryProblem(kidEntry) == null
              ? kidEntry as Map<String, Object?>
              : null,
          item.data,
        );
      }
    }
  }

  if (issues.isEmpty) _runValidateRules(ctx, def, path, data);
}

void _runValidateRules(
  _Ctx ctx,
  Map<String, Object?> def,
  String path,
  Map<String, Object?> data,
) {
  final rules = def['validate'];
  if (rules is! List<Object?>) return;
  for (final rule in rules.whereType<Map<String, Object?>>()) {
    Object? r;
    try {
      final expr = rule['rule'];
      r = expr is bool ? expr : evaluateRule(expr, data, env: ctx.env);
    } on RuleError catch (e) {
      ctx.push(path, 'RULE_ERROR', 'validate: ${e.message}');
      continue;
    }
    if (r != null && r is! bool) {
      ctx.push(path, 'RULE_ERROR', 'validate rule must evaluate to a boolean');
      continue;
    }
    if (r != true) {
      final code = rule['code'];
      final message = rule['message'];
      ctx.push(
        path,
        code is String ? code : 'VALIDATION_RULE_FAILED',
        message is String ? renderTemplate(message, data) : '',
      );
    }
  }
}

/// The context recorded in an answers document (docs/04 §5).
ResolveContext contextFromSnapshot(Object? snapshot) {
  if (snapshot is! Map<String, Object?>) return const ResolveContext();
  final today = snapshot['today'];
  return ResolveContext(
    today: today is String ? today : null,
    job: snapshot['job'],
    agent: snapshot['agent'],
    inspection: snapshot['inspection'],
    stats: snapshot['stats'],
    config: snapshot['config'],
    previous: snapshot['previous'],
  );
}

/// An answers document against [form], and its `answers_hash` when it has
/// one — what the server checks on arrival.
ValidationResult validateSubmission(
  Map<String, Object?> form,
  Map<String, Object?> document, {
  FormLists lists = const FormLists(),
  ResolveContext? context,
}) {
  final res = validateAnswers(
    form,
    document['answers'],
    context: context ?? contextFromSnapshot(document['context_snapshot']),
    lists: lists,
  );
  final errors = [...res.errors];
  if (document.containsKey('answers_hash')) {
    final expected = document['answers_hash'];
    String? hash;
    try {
      hash = answersHash(document['answers']);
    } on EngineError {
      hash = null;
    }
    if (hash != expected) {
      errors.add(
        const ValidationError(
          '',
          'ANSWERS_HASH_MISMATCH',
          'answers_hash does not match sha256(JCS(answers))',
        ),
      );
    }
  }
  return ValidationResult(errors, resolved: res.resolved);
}
