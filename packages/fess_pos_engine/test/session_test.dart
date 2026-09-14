import 'dart:math';

import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:test/test.dart';

import 'support/fixtures.dart';
import 'support/synthetic_form.dart';

/// A [FormSession] re-evaluates only what an answer change reaches; these
/// tests hold it to resolving and validating the whole form again.
List<String> _errors(Iterable<ValidationError> es) => [
  for (final e in es) '${e.fieldKey}|${e.code}|${e.message}',
]..sort();

Object? _view(ResolvedField f) => {
  'visible': f.visible,
  'required': f.required,
  'read_only': f.readOnly,
  'value': f.value,
  'computed': f.computed,
  'props': f.props,
  'label': f.label,
  'text': f.text,
  'has_default': f.hasDefault,
  'default': f.defaultValue,
  'options': f.options?.map((o) => o.value).toList(),
  'items': f.items
      ?.map((i) => {for (final e in i.fields.entries) e.key: _view(e.value)})
      .toList(),
};

void _expectAsWhole(
  FormSession s,
  Map<String, Object?> form, {
  ResolveContext context = const ResolveContext(),
  FormLists lists = const FormLists(),
  String reason = '',
}) {
  final whole = validateAnswers(
    form,
    s.answers,
    context: context,
    lists: lists,
  );
  expect(_errors(s.errors), _errors(whole.errors), reason: reason);
  final a = s.resolved;
  final b = whole.resolved!;
  expect(a.order, b.order);
  for (final k in b.order) {
    expect(_view(a.fields[k]!), _view(b.fields[k]!), reason: '$reason $k');
  }
  expect(a.values, b.values, reason: reason);
  for (final k in b.sections.keys) {
    expect(
      (a.sections[k]!.visible, a.sections[k]!.title),
      (b.sections[k]!.visible, b.sections[k]!.title),
      reason: '$reason §$k',
    );
  }
  List<String> issues(ResolvedForm r) => [
    for (final i in r.errors) '${i.path} ${i.property} ${i.code}',
  ]..sort();
  expect(issues(a), issues(b), reason: reason);
}

/// A second value for each synthetic answer, chosen to change what the
/// rules decide: a hidden field, a filtered option, a bad date, …
Object? _other(String key, Object? value) => switch (key.split('_').last) {
  'f7' => 'c',
  'f8' => 'e',
  'f9' => ['a', 'a'],
  'f10' => '2026-02-30',
  'f11' => 'no',
  'f14' => '0821234567',
  _ => switch (value) {
    final bool b => !b,
    final num n => n * 100 + 1,
    final String _ => '',
    _ => null,
  },
};

FormSession _fromDocument(
  CompiledForm plan,
  Map<String, Object?> document, {
  required ResolveContext context,
  required FormLists lists,
}) {
  final values = <String, Object?>{};
  final other = <String, String>{};
  final unknown = <String>{};
  final flagged = <String>{};
  final renderedAs = <String, String>{};
  for (final e in (document['answers']! as Map<String, Object?>).entries) {
    final cf = plan.byKey[e.key];
    final entry = e.value;
    if (cf == null || entry is! Map<String, Object?>) continue;
    var v = entry['v'];
    if (cf.spec.type == 'repeatable_group' && v is List<Object?>) {
      v = [
        for (final item in v.whereType<Map<String, Object?>>())
          {
            for (final c in item.entries)
              if (c.value case final Map<String, Object?> kid) c.key: kid['v'],
          },
      ];
    }
    if (v != null) values[e.key] = v;
    if (entry['other_text'] case final String t) other[e.key] = t;
    if (entry['unknown'] == true) unknown.add(e.key);
    if (entry['flagged_differs'] == true) flagged.add(e.key);
    if (entry['rendered_as'] case final String type) renderedAs[e.key] = type;
  }
  return FormSession(
    plan,
    context: context,
    lists: lists,
    values: values,
    otherText: other,
    unknown: unknown,
    flaggedDiffers: flagged,
    renderedAs: renderedAs,
  );
}

void main() {
  test('random edits to the synthetic form give what evaluating it whole '
      'gives', () {
    final form = syntheticForm(sections: 3);
    final answers = syntheticAnswers(sections: 3);
    final keys = answers.keys.toList();
    final s = FormSession(compileForm(form));
    _expectAsWhole(s, form, reason: 'empty');
    final random = Random(7);
    for (var i = 0; i < 400; i++) {
      final k = keys[random.nextInt(keys.length)];
      final v = [answers[k], _other(k, answers[k]), null][random.nextInt(3)];
      s.setValue(k, v);
      _expectAsWhole(s, form, reason: 'edit $i: $k = $v');
    }
  });

  test('an answer change re-evaluates only what reads it', () {
    final s = FormSession(
      compileForm(syntheticForm()),
      values: syntheticAnswers(),
    );
    expect(s.ok, isTrue, reason: '${s.errors}');
    expect(s.lastEvaluated, hasLength(200));

    s.setValue('s0_f4', 20);
    expect(s.lastEvaluated, {'s0_f4', 's0_f5', 's0_f6'});
    expect(s.answers['s0_f6'], {'v': 25, 'computed': true});

    s.setValue('s0_f0', false);
    expect(s.lastEvaluated, {'s0_f0', 's0_f1', 's0_f2', 's0_f3', 's0_f19'});
    expect(s.answers.containsKey('s0_f1'), isFalse, reason: 'hidden');
    expect(s.value('s0_f1'), 'Name 0', reason: 'kept for when it returns');

    s.setOtherText('s1_f7', 'Kiosk');
    expect(s.lastEvaluated, {'s1_f7'});
  });

  group('valid submissions, answer by answer', () {
    for (final f in fixtures('submissions/valid')) {
      test(f.name, () {
        final form = fixtureJson('definitions/valid/${f.data['form']}.json');
        final document = f.data['document']! as Map<String, Object?>;
        final context = contextFromSnapshot(document['context_snapshot']);
        final lists = FormLists.fromJson(f.data['lists']);
        final plan = compileForm(form);
        final s = _fromDocument(
          plan,
          document,
          context: context,
          lists: lists,
        );
        _expectAsWhole(s, form, context: context, lists: lists);
        expect(s.errors, isEmpty, reason: 'the answers it builds are valid');
        final given = Map.of(s.values);
        for (final key in given.keys) {
          s.setValue(key, null);
          _expectAsWhole(
            s,
            form,
            context: context,
            lists: lists,
            reason: 'without $key',
          );
          s.setValue(key, given[key]);
          _expectAsWhole(
            s,
            form,
            context: context,
            lists: lists,
            reason: 'with $key again',
          );
        }
      });
    }
  });

  group('definition test cases, step by step', () {
    for (final f in fixtures('testcases')) {
      final form = fixtureJson('definitions/valid/${f.data['form']}.json');
      for (final c in f.cases) {
        test('${f.name}: ${c['name']}', () {
          final context = contextFromSnapshot(c['context']);
          final lists = FormLists.fromJson(f.data['lists'] ?? c['lists']);
          final s = FormSession(
            compileForm(form),
            context: context,
            lists: lists,
          );
          final steps = c['steps'];
          for (final step in steps is List<Object?> ? steps : const []) {
            if (step is! Map<String, Object?>) continue;
            final set = step['set'];
            if (set is Map<String, Object?>) {
              set.forEach(s.setValue);
            }
            final unset = step['unset'];
            if (unset is List<Object?>) {
              for (final k in unset.whereType<String>()) {
                s.setValue(k, null);
              }
            }
            _expectAsWhole(s, form, context: context, lists: lists);
          }
        });
      }
    }
  });

  test('"I don\'t know", "other" and "differs" reach the answers', () {
    final form = {
      'sections': [
        {
          'key': 's',
          'fields': [
            {
              'key': 'opened',
              'type': 'date',
              'required': true,
              'props': {'allow_unknown': true},
            },
            {
              'key': 'kind',
              'type': 'single_select',
              'options': [
                {'value': 'shop', 'label': 'Shop'},
              ],
              'props': {'allow_other': true},
            },
            {
              'key': 'ref',
              'type': 'prefilled',
              'props': {'source': 'job.reference', 'allow_flag_differs': true},
            },
          ],
        },
      ],
    };
    const context = ResolveContext(job: {'reference': 'POS-7'});
    final s = FormSession(compileForm(form), context: context)
      ..setValue('opened', '2026-01-01')
      ..setUnknown('opened', unknown: true)
      ..setValue('kind', 'other')
      ..setOtherText('kind', 'Kiosk')
      ..setFlaggedDiffers('ref', flagged: true);
    expect(s.answers, {
      'opened': {'v': null, 'unknown': true},
      'kind': {'v': 'other', 'other_text': 'Kiosk'},
      'ref': {'v': 'POS-7', 'prefilled': true, 'flagged_differs': true},
    });
    expect(s.value('opened'), isNull);
    expect(s.ok, isTrue);
    _expectAsWhole(s, form, context: context);
  });
}
