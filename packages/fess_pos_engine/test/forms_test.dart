import 'dart:convert';

import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:test/test.dart';

import 'support/fixtures.dart';

List<String> _keys(Iterable<ValidationError> errors) =>
    [for (final e in errors) '${e.fieldKey}|${e.code}']..sort();

/// A reason form shaped like the seeded `assignment_reject`.
final Map<String, Object?> _reject = {
  'kind': 'form',
  'family': 'assignment_reject',
  'version': 1,
  'sections': [
    {
      'key': 'reason',
      'title': "Why can't you take {{job.reference}}?",
      'fields': [
        {
          'key': 'reason_code',
          'type': 'single_select',
          'display': 'radio',
          'label': 'Reason',
          'required': true,
          'options_source': {
            'type': 'reason_codes',
            'category': 'assignment_reject',
          },
        },
        {
          'key': 'note',
          'type': 'textarea',
          'label': 'Note',
          'props': {'rows': 3, 'max_length': 10},
          'required': {
            'in': [
              {'var': 'answers.reason_code'},
              ['conflict', 'safety', 'other'],
            ],
          },
        },
        {
          'key': 'hint',
          'type': 'callout',
          'tone': 'warning',
          'text': 'Tell us what the conflict is.',
          'visible': {
            '==': [
              {'var': 'answers.reason_code'},
              'conflict',
            ],
          },
        },
      ],
    },
  ],
};

const FormLists _reasons = FormLists(
  reasonCodes: {
    'assignment_reject': [
      OptionDef(value: 'unavailable', label: 'Unavailable'),
      OptionDef(value: 'conflict', label: 'Conflict of interest'),
      OptionDef(value: 'other', label: 'Other'),
    ],
  },
);

void main() {
  group('submission fixtures (schema/fixtures/submissions)', () {
    for (final dir in ['valid', 'invalid']) {
      for (final f in fixtures('submissions/$dir')) {
        final form = fixtureJson('definitions/valid/${f.data['form']}.json');
        test('$dir/${f.name}', () {
          final expected = f.data['expected']! as Map<String, Object?>;
          final res = validateSubmission(
            form,
            f.data['document']! as Map<String, Object?>,
            lists: FormLists.fromJson(f.data['lists']),
          );
          expect(
            _keys(res.errors),
            [
              for (final e
                  in (expected['errors']! as List<Object?>)
                      .cast<Map<String, Object?>>())
                '${e['field_key']}|${e['code']}',
            ]..sort(),
          );
          expect(res.ok, expected['ok']);
        });
      }
    }
  });

  group('definition test cases (schema/fixtures/testcases)', () {
    for (final f in fixtures('testcases')) {
      group(f.name, () {
        final form = fixtureJson('definitions/valid/${f.data['form']}.json');
        final lists = f.data['lists'] == null
            ? null
            : FormLists.fromJson(f.data['lists']);
        for (final c in f.cases) {
          test('${c['name']}', () {
            final res = runTestCase(form, c, lists: lists);
            final expectPass = c['expect_pass'] ?? true;
            expect(
              res.passed,
              expectPass,
              reason: jsonEncode([for (final x in res.failures) x.toJson()]),
            );
            if (expectPass == false) expect(res.failures, isNotEmpty);
          });
        }
        test('runTestCases aggregates', () {
          final all = runTestCases(form, [
            for (final c in f.cases)
              if (c['expect_pass'] != false) c,
          ], lists: lists ?? const FormLists());
          expect(all.passed, isTrue);
        });
      });
    }
  });

  test('the catalogue is every component the schema allows', () {
    final field =
        (schemaJson('definitions/components.schema.json')[r'$defs']!
                as Map<String, Object?>)['field']!
            as Map<String, Object?>;
    final type =
        (field['properties']! as Map<String, Object?>)['type']!
            as Map<String, Object?>;
    expect(
      formComponents.keys.toSet(),
      (type['enum']! as List<Object?>).toSet(),
    );
  });

  group('resolving a reason form', () {
    test('options come from the reason codes; the title fills in', () {
      final r = resolveForm(
        _reject,
        context: const ResolveContext(job: {'reference': 'POS-1'}),
        lists: _reasons,
      );
      expect(r.sections['reason']!.title, "Why can't you take POS-1?");
      expect(r.fields['reason_code']!.options!.map((o) => o.value), [
        'unavailable',
        'conflict',
        'other',
      ]);
      expect(r.fields['reason_code']!.required, isTrue);
      expect(r.fields['note']!.required, isFalse);
      expect(r.fields['hint']!.visible, isFalse);
    });

    test('an answer changes what is required and shown', () {
      final r = resolveForm(
        _reject,
        answers: {'reason_code': 'conflict'},
        lists: _reasons,
      );
      expect(r.fields['note']!.required, isTrue);
      expect(r.fields['hint']!.visible, isTrue);
      expect(r.fields['hint']!.text, 'Tell us what the conflict is.');
    });

    test('options_filter narrows the options', () {
      final form = {
        'sections': [
          {
            'key': 's',
            'fields': [
              {
                'key': 'pick',
                'type': 'single_select',
                'options': [
                  {
                    'value': 'a',
                    'label': 'A',
                    'meta': {'tier': 1},
                  },
                  {
                    'value': 'b',
                    'label': 'B',
                    'meta': {'tier': 2},
                  },
                ],
                'options_filter': {
                  '==': [
                    {'var': 'option.meta.tier'},
                    1,
                  ],
                },
              },
            ],
          },
        ],
      };
      expect(
        resolveForm(form).fields['pick']!.options!.map((o) => o.value),
        ['a'],
      );
    });

    test('a hidden section hides its fields', () {
      final form = {
        'sections': [
          {
            'key': 's',
            'visible': false,
            'fields': [
              {'key': 'x', 'type': 'text', 'required': true},
            ],
          },
        ],
      };
      final r = resolveForm(form, answers: {'x': 'kept aside'});
      expect(r.fields['x']!.visible, isFalse);
      expect(r.values.containsKey('x'), isFalse, reason: 'hidden ⇒ absent');
    });

    test('a component this engine lacks is refused, not half-validated', () {
      expect(
        () => compileForm({
          'sections': [
            {
              'key': 's',
              'fields': [
                {'key': 'd', 'type': 'hologram'},
              ],
            },
          ],
        }),
        throwsA(
          isA<EngineError>().having(
            (e) => e.code,
            'code',
            'UNSUPPORTED_COMPONENT',
          ),
        ),
      );
    });

    test('a dependency cycle is refused', () {
      Map<String, Object?> field(String key, String other) => {
        'key': key,
        'type': 'text',
        'visible': {
          '!=': [
            {'var': 'answers.$other'},
            'x',
          ],
        },
      };
      expect(
        () => compileForm({
          'sections': [
            {
              'key': 's',
              'fields': [field('a', 'b'), field('b', 'a')],
            },
          ],
        }),
        throwsA(
          isA<EngineError>().having((e) => e.code, 'code', 'RESOLVER_CYCLE'),
        ),
      );
    });
  });

  group('validating reason-form answers', () {
    Map<String, Object?> v(Object? value) => {'v': value};

    List<String> check(Map<String, Object?> answers) =>
        _keys(validateAnswers(_reject, answers, lists: _reasons).errors);

    test('a reason from the list, and a note where the rule wants one', () {
      expect(check({'reason_code': v('unavailable')}), isEmpty);
      expect(check({'reason_code': v('conflict')}), ['note|REQUIRED']);
      expect(
        check({'reason_code': v('conflict'), 'note': v('Relative')}),
        isEmpty,
      );
    });

    test('the server’s codes for every other problem', () {
      expect(check({}), ['reason_code|REQUIRED']);
      expect(check({'reason_code': v('bribe')}), [
        'reason_code|INVALID_OPTION',
      ]);
      expect(
        check({'reason_code': v('other'), 'note': v('far too long a note')}),
        ['note|TOO_LONG'],
      );
      expect(check({'reason_code': v(3)}), ['reason_code|INVALID_TYPE']);
      expect(
        check({'reason_code': v('unavailable'), 'hint': v('x')}),
        ['hint|UNKNOWN_FIELD'],
      );
      expect(
        check({
          'reason_code': {'v': 'unavailable', 'extra': 1},
        }),
        ['reason_code|INVALID_ENTRY', 'reason_code|REQUIRED'],
      );
    });

    test('multi_select counts, duplicates and exclusive options', () {
      final form = {
        'sections': [
          {
            'key': 's',
            'fields': [
              {
                'key': 'm',
                'type': 'multi_select',
                'options': [
                  {'value': 'a', 'label': 'A'},
                  {'value': 'b', 'label': 'B'},
                  {'value': 'none', 'label': 'None'},
                ],
                'props': {
                  'min_select': 1,
                  'max_select': 2,
                  'exclusive_options': ['none'],
                },
              },
            ],
          },
        ],
      };
      List<String> m(Object? value) =>
          _keys(validateAnswers(form, {'m': v(value)}).errors);
      expect(m(['a']), isEmpty);
      expect(m(['a', 'a']), ['m|DUPLICATE_VALUE']);
      expect(m(['a', 'b', 'none']), [
        'm|EXCLUSIVE_OPTION_COMBINED',
        'm|TOO_MANY',
      ]);
      expect(m(['a', 'x']), ['m|INVALID_OPTION']);
    });

    test('"other" needs its description', () {
      final form = {
        'sections': [
          {
            'key': 's',
            'fields': [
              {
                'key': 'p',
                'type': 'single_select',
                'options': [
                  {'value': 'a', 'label': 'A'},
                ],
                'props': {'allow_other': true},
              },
            ],
          },
        ],
      };
      expect(
        _keys(validateAnswers(form, {'p': v('other')}).errors),
        ['p|OTHER_TEXT_REQUIRED'],
      );
      expect(
        validateAnswers(form, {
          'p': {'v': 'other', 'other_text': 'A kiosk'},
        }).ok,
        isTrue,
      );
    });

    test('validate rules run on answered fields, with their message', () {
      final form = {
        'sections': [
          {
            'key': 's',
            'fields': [
              {
                'key': 'name',
                'type': 'text',
                'validate': [
                  {
                    'rule': {
                      'starts_with': [
                        {'var': 'answers.name'},
                        'Shop',
                      ],
                    },
                    'message': '{{answers.name}} must start with Shop',
                  },
                ],
              },
            ],
          },
        ],
      };
      final res = validateAnswers(form, {'name': v('Kiosk')});
      expect(_keys(res.errors), ['name|VALIDATION_RULE_FAILED']);
      expect(res.errors.single.message, 'Kiosk must start with Shop');
    });

    test('the answers hash is checked like the server does', () {
      final answers = {'reason_code': v('unavailable')};
      final ok = validateSubmission(_reject, {
        'answers': answers,
        'answers_hash': answersHash(answers),
      }, lists: _reasons);
      expect(ok.ok, isTrue);
      final bad = validateSubmission(_reject, {
        'answers': answers,
        'answers_hash': '0' * 64,
      }, lists: _reasons);
      expect(_keys(bad.errors), ['|ANSWERS_HASH_MISMATCH']);
    });
  });

  test('templates render like the TypeScript engine', () {
    expect(
      renderTemplate('{{a}} · {{ b.c }} · {{n}} · {{t}} · {{x}}', {
        'a': 'A',
        'b': {'c': 'C'},
        'n': 1.0,
        't': true,
      }),
      'A · C · 1 · true · ',
    );
  });
}
