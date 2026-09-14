/// The synthetic form of the performance plan (docs/03 §8, R-27, C2): 200
/// fields in 10 sections, with 110 rules (visibility, required, computed
/// values, validate rules and option filters) and label templates, shaped
/// like a long site inspection.
library;

Map<String, Object?> _var(String path) => {'var': path};

Map<String, Object?> _field(
  String key,
  String type, [
  Map<String, Object?> extra = const {},
]) => {'key': key, 'type': type, 'label': key, ...extra};

List<Map<String, Object?>> _options(int n) => [
  for (var i = 0; i < n; i++)
    {
      'value': String.fromCharCode(97 + i),
      'label': 'Option $i',
      'meta': {'tier': i},
    },
];

/// Section `s` holds fields `s<s>_f0` … `s<s>_f19`.
Map<String, Object?> syntheticForm({int sections = 10}) => {
  'kind': 'form',
  'family': 'synthetic',
  'version': 1,
  'sections': [
    for (var s = 0; s < sections; s++) _section(s),
  ],
};

Map<String, Object?> _section(int s) {
  String k(int i) => 's${s}_f$i';
  String a(int i) => 'answers.${k(i)}';
  return {
    'key': 'section_$s',
    'title': 'Section $s',
    'fields': [
      _field(k(0), 'boolean'),
      _field(k(1), 'text', {
        'visible': {
          '==': [_var(a(0)), true],
        },
      }),
      _field(k(2), 'text', {
        'required': {
          '==': [_var(a(0)), true],
        },
      }),
      _field(k(3), 'text', {'label': 'About {{${a(1)}}}'}),
      _field(k(4), 'number', {
        'props': {'min': 0, 'max': 1000},
      }),
      _field(k(5), 'number', {
        'validate': [
          {
            'rule': {
              '<=': [_var(a(5)), _var(a(4))],
            },
            'message': 'At most {{${a(4)}}}',
          },
        ],
      }),
      _field(k(6), 'number', {
        'value': {
          '+': [_var(a(4)), _var(a(5))],
        },
      }),
      _field(k(7), 'single_select', {'options': _options(5)}),
      _field(k(8), 'single_select', {
        'options': _options(5),
        'options_filter': {
          '<=': [_var('option.meta.tier'), 2],
        },
      }),
      _field(k(9), 'multi_select', {
        'options': _options(4),
        'visible': {
          'in': [
            _var(a(7)),
            ['a', 'b'],
          ],
        },
      }),
      _field(k(10), 'date'),
      _field(k(11), 'tri_state', {
        'visible': {
          '!=': [_var(a(10)), null],
        },
      }),
      _field(k(12), 'textarea', {
        'required': {
          '==': [_var(a(11)), 'no'],
        },
      }),
      _field(k(13), 'percentage'),
      _field(k(14), 'phone'),
      _field(k(15), 'boolean'),
      _field(k(16), 'text', {'visible': _var(a(15))}),
      _field(k(17), 'number', {
        'required': {
          '!=': [_var(a(16)), null],
        },
      }),
      _field(k(18), 'text'),
      _field(k(19), 'text', {
        'visible': {
          'and': [_var(a(0)), _var(a(15))],
        },
      }),
    ],
  };
}

/// Every field answered, validly.
Map<String, Object?> syntheticAnswers({int sections = 10}) => {
  for (var s = 0; s < sections; s++) ...{
    's${s}_f0': true,
    's${s}_f1': 'Name $s',
    's${s}_f2': 'Detail',
    's${s}_f3': 'About',
    's${s}_f4': 10,
    's${s}_f5': 5,
    's${s}_f7': 'a',
    's${s}_f8': 'b',
    's${s}_f9': ['a'],
    's${s}_f10': '2026-01-01',
    's${s}_f11': 'yes',
    's${s}_f12': 'A note',
    's${s}_f13': 50,
    's${s}_f14': '+27821234567',
    's${s}_f15': true,
    's${s}_f16': 'More',
    's${s}_f17': 3,
    's${s}_f18': 'Text',
    's${s}_f19': 'Text',
  },
};
