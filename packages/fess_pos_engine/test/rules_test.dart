import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:test/test.dart';

import 'support/fixtures.dart';

/// The rules fixture contract (schema/fixtures/rules), shared with the
/// TypeScript engine: every case must give the same value or error code.
void main() {
  final files = fixtures('rules');

  test('every operator in the spec has a fixture file with cases', () {
    final covered = {
      for (final f in files)
        if (f.data['operator'] is String) f.data['operator'],
    };
    for (final op in ruleOperators.keys) {
      expect(covered, contains(op), reason: 'missing fixtures for $op');
    }
  });

  for (final f in files.where((f) => f.data['topic'] != 'dependencies')) {
    group(f.name, () {
      for (final c in f.cases) {
        test(c['name']! as String, () {
          final env = c['env'] as Map<String, Object?>?;
          Object? run() => evaluateRule(
            c['expression'],
            c['data'],
            env: RuleEnv(
              today: env?['today'] as String?,
              optionMeta: env?['option_meta'] as Map<String, Object?>?,
            ),
          );
          final error = c['error'];
          if (error != null) {
            expect(
              run,
              throwsA(isA<RuleError>().having((e) => e.code, 'code', error)),
            );
            expect(ruleErrorCodes, contains(error));
          } else {
            expect(run(), equals(c['expected']));
          }
        });
      }
    });
  }

  group('dependencies', () {
    final file = files.singleWhere((f) => f.data['topic'] == 'dependencies');
    for (final c in file.cases) {
      test(c['name']! as String, () {
        expect(ruleDependencies(c['expression']), c['dependencies']);
      });
    }
  });

  test('the operator table matches schema/rules/operators.json', () {
    final spec = schemaJson('rules/operators.json');
    final listed = (spec['operators']! as List<Object?>)
        .cast<Map<String, Object?>>();
    expect(listed.map((o) => o['name']), ruleOperators.keys);
    for (final o in listed) {
      final mine = ruleOperators[o['name']]!;
      expect(mine.minArgs, o['min_args'], reason: '${o['name']} min_args');
      expect(mine.maxArgs, o['max_args'], reason: '${o['name']} max_args');
      expect(mine.returns, o['returns'], reason: '${o['name']} returns');
      expect(mine.group, o['group'], reason: '${o['name']} group');
    }
  });

  test('evaluateRuleBoolean treats null as false', () {
    expect(evaluateRuleBoolean({'var': 'missing'}, <String, Object?>{}), false);
    expect(
      () => evaluateRuleBoolean({'var': 'n'}, {'n': 1}),
      throwsA(isA<RuleError>()),
    );
  });
}
