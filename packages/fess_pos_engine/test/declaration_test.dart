// The `declaration` component (docs/11 §3.6), checked the way
// `src/values.ts` checks it: `{accepted, declaration_version_id,
// accepted_at}`, accepted must be true.
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:test/test.dart';

const Map<String, Object?> _form = {
  'spec_version': '1.0',
  'kind': 'form',
  'family': 'declared',
  'version': 1,
  'scope': null,
  'title': 'Declared',
  'declaration_key': 'agent_declaration',
  'sections': [
    {
      'key': 'agent',
      'title': 'Agent',
      'fields': [
        {
          'key': 'agent_declaration',
          'type': 'declaration',
          'label': 'Agent declaration',
          'required': true,
          'props': {'declaration_key': 'agent_declaration'},
        },
      ],
    },
  ],
};

const String _version = '0192d4e0-7c1a-7b2e-9f00-000000000001';

List<String> _codes(Object? value) => [
  for (final e in validateAnswers(_form, {
    if (value != null) 'agent_declaration': {'v': value},
  }).errors)
    e.code,
];

void main() {
  test('an accepted declaration is valid', () {
    expect(
      _codes({
        'accepted': true,
        'declaration_version_id': _version,
        'accepted_at': '2026-09-14T10:00:00.000+02:00',
      }),
      isEmpty,
    );
  });

  test('it must be accepted', () {
    expect(
      _codes({
        'accepted': false,
        'declaration_version_id': _version,
        'accepted_at': '2026-09-14T10:00:00.000+02:00',
      }),
      ['NOT_ACCEPTED'],
    );
  });

  test('it is required', () {
    expect(_codes(null), ['REQUIRED']);
  });

  test('shape: version id, time with offset, no other keys', () {
    expect(
      _codes({
        'accepted': true,
        'declaration_version_id': 'v1',
        'accepted_at': '2026-09-14T10:00:00Z',
      }),
      ['INVALID_TYPE'],
    );
    expect(
      _codes({
        'accepted': true,
        'declaration_version_id': _version,
        'accepted_at': '2026-09-14',
      }),
      ['INVALID_TYPE'],
    );
    expect(
      _codes({
        'accepted': true,
        'declaration_version_id': _version,
        'accepted_at': '2026-09-14T10:00:00Z',
        'extra': 1,
      }),
      ['INVALID_TYPE'],
    );
  });
}
