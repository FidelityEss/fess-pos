/// Definition test cases (docs/04 §9, B4.12), the Dart twin of
/// `src/testcases.ts`: recorded scenarios of context and answer steps with
/// the visibility, required flags, values, options, props, labels and
/// validation errors they must produce. Publishing runs them in the
/// TypeScript engine; the same fixtures run here, so both engines agree on
/// what a form does.
///
/// Answers are built the way the module builds a submission: visible
/// fields only (hidden ⇒ absent), computed fields from the resolver
/// (`computed: true`), prefilled fields from the context.
library;

import 'package:fess_pos_engine/src/forms/model.dart';
import 'package:fess_pos_engine/src/forms/resolver.dart';
import 'package:fess_pos_engine/src/forms/validator.dart';
import 'package:fess_pos_engine/src/json.dart';
import 'package:meta/meta.dart';

/// One expectation a test case didn't meet.
@immutable
class TestFailure {
  const TestFailure(
    this.step,
    this.check,
    this.path,
    this.expected,
    this.actual,
  );

  /// The step's index, or `'final'` for the case's own `expect`.
  final Object step;
  final String check;
  final String path;
  final Object? expected;
  final Object? actual;

  Map<String, Object?> toJson() => {
    'step': step,
    'check': check,
    'path': path,
    'expected': expected,
    'actual': actual,
  };

  @override
  String toString() =>
      'step $step: $check $path expected $expected, got $actual';
}

@immutable
class TestCaseResult {
  const TestCaseResult(this.name, this.failures);

  final String name;
  final List<TestFailure> failures;

  bool get passed => failures.isEmpty;
}

final RegExp _itemPath = RegExp(
  r'^([a-z][a-z0-9_]*)\[(\d+)\]\.([a-z][a-z0-9_]*)$',
);

/// A field by path: its key, or `group[i].key` inside a repeatable group.
ResolvedField? _lookup(ResolvedForm resolved, String path) {
  final m = _itemPath.firstMatch(path);
  if (m == null) return resolved.fields[path];
  final items = resolved.fields[m[1]]?.items;
  final index = int.parse(m[2]!);
  if (items == null || index >= items.length) return null;
  return items[index].fields[m[3]];
}

const Set<String> _noAnswer = {'group', 'info', 'callout', 'divider', 'image'};

Map<String, Object?> _entry(ResolvedField f) => f.computed
    ? {'v': f.value, 'computed': true}
    : f.type == 'prefilled'
    ? {'v': f.value, 'prefilled': true}
    : {'v': f.value};

/// A submission-style answers map (`{key: {v, …}}`) from the raw [state],
/// as the module builds it.
Map<String, Object?> buildAnswers(
  Map<String, Object?> form,
  ResolvedForm resolved,
  Map<String, Object?> state,
) {
  final compiled = compileForm(form);
  final out = <String, Object?>{};
  for (final cf in compiled.fields) {
    final key = cf.key;
    final rf = resolved.fields[key];
    if (rf == null || !rf.visible || !cf.spec.hasValue) continue;
    if (rf.computed || cf.spec.type == 'prefilled') {
      if (rf.value != null) out[key] = _entry(rf);
      continue;
    }
    if (cf.spec.type == 'repeatable_group' && state[key] is List<Object?>) {
      out[key] = {
        'v': [
          for (final item in rf.items ?? const <ResolvedItem>[])
            {
              for (final e in item.fields.entries)
                if (e.value.visible &&
                    !_noAnswer.contains(e.value.type) &&
                    e.value.value != null)
                  e.key: _entry(e.value),
            },
        ],
      };
      continue;
    }
    if (state.containsKey(key)) out[key] = {'v': state[key]};
  }
  return out;
}

void _check(
  Map<String, Object?> exp,
  ResolvedForm resolved,
  List<ValidationError> errors,
  Object step,
  List<TestFailure> failures,
) {
  void fail(String check, String path, Object? expected, Object? actual) =>
      failures.add(TestFailure(step, check, path, expected, actual));

  void each(
    String property,
    String check,
    Object? Function(ResolvedField rf) get, [
    bool Function(Object? expected, Object? actual) eq = deepEqual,
  ]) {
    final m = exp[property];
    if (m is! Map<String, Object?>) return;
    for (final e in m.entries) {
      final rf = _lookup(resolved, e.key);
      final actual = rf == null ? null : get(rf);
      if (rf == null || !eq(e.value, actual)) {
        fail(check, e.key, e.value, rf == null ? '<no such field>' : actual);
      }
    }
  }

  each('visible', 'visible', (rf) => rf.visible);
  each('required', 'required', (rf) => rf.required);
  each('read_only', 'read_only', (rf) => rf.readOnly);
  each('values', 'value', (rf) => rf.value);
  each('labels', 'label', (rf) => rf.label);
  each(
    'options',
    'options',
    (rf) => [
      for (final o in rf.options ?? const <OptionDef>[]) o.value,
    ],
  );
  each(
    'props',
    'props',
    (rf) => rf.props,
    (expected, actual) =>
        expected is Map<String, Object?> &&
        actual is Map<String, Object?> &&
        expected.entries.every((e) => deepEqual(e.value, actual[e.key])),
  );
  final wantErrors = exp['errors'];
  if (wantErrors is List<Object?>) {
    final want = [
      for (final e in wantErrors.whereType<Map<String, Object?>>())
        '${e['field_key']}|${e['code']}',
    ]..sort();
    final got = [for (final e in errors) '${e.fieldKey}|${e.code}']..sort();
    if (!deepEqual(want, got)) fail('errors', '', want, got);
  }
  final valid = exp['valid'];
  if (valid is bool && valid != errors.isEmpty) {
    fail('valid', '', valid, errors.isEmpty);
  }
}

/// Runs one test case (`{name, context?, lists?, steps?, expect?}`) against
/// [form]. [lists] replaces the case's own `lists`.
TestCaseResult runTestCase(
  Map<String, Object?> form,
  Map<String, Object?> testCase, {
  FormLists? lists,
}) {
  final name = testCase['name'];
  final context = contextFromSnapshot(testCase['context']);
  final optionLists = lists ?? FormLists.fromJson(testCase['lists']);
  final state = <String, Object?>{};
  final failures = <TestFailure>[];

  void evaluateAndCheck(Map<String, Object?> expect, Object step) {
    final resolved = resolveForm(
      form,
      context: context,
      answers: state,
      lists: optionLists,
    );
    final res = validateAnswers(
      form,
      buildAnswers(form, resolved, state),
      context: context,
      lists: optionLists,
    );
    _check(expect, res.resolved ?? resolved, res.errors, step, failures);
  }

  try {
    final steps = testCase['steps'];
    if (steps is List<Object?>) {
      for (var i = 0; i < steps.length; i++) {
        final step = steps[i];
        if (step is! Map<String, Object?>) continue;
        final set = step['set'];
        if (set is Map<String, Object?>) state.addAll(set);
        final unset = step['unset'];
        if (unset is List<Object?>) unset.forEach(state.remove);
        final expect = step['expect'];
        if (expect is Map<String, Object?>) evaluateAndCheck(expect, i);
      }
    }
    final expect = testCase['expect'];
    if (expect is Map<String, Object?>) evaluateAndCheck(expect, 'final');
  } on Exception catch (e) {
    failures.add(TestFailure('final', 'exception', '', null, '$e'));
  }
  return TestCaseResult(name is String ? name : '', failures);
}

/// Runs every case; passes when all of them do.
({bool passed, List<TestCaseResult> results}) runTestCases(
  Map<String, Object?> form,
  List<Map<String, Object?>> cases, {
  FormLists? lists,
}) {
  final results = [
    for (final c in cases) runTestCase(form, c, lists: lists),
  ];
  return (passed: results.every((r) => r.passed), results: results);
}
