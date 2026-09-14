import 'package:fess_pos/src/renderer/form/render_plans.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> _form(String type) => {
  'sections': [
    {
      'key': 's',
      'fields': [
        {'key': 'a', 'type': type},
        {
          'key': 'b',
          'type': 'text',
          'visible': {
            '==': [
              {'var': 'answers.a'},
              'x',
            ],
          },
        },
      ],
    },
  ],
};

void main() {
  test(
    'a form compiles on a background isolate into a plan that works',
    () async {
      final plan = await compileRenderPlan(_form('text'));
      expect(plan.keys, ['a', 'b']);
      expect(plan.byKey['b']!.hardDeps, {'a'});
      final session = FormSession(plan)..setValue('a', 'x');
      expect(session.resolved.fields['b']!.visible, isTrue);
    },
  );

  test("a form this build can't use fails with the engine's error", () async {
    await expectLater(
      compileRenderPlan(_form('hologram')),
      throwsA(
        isA<EngineError>().having(
          (e) => e.code,
          'code',
          'UNSUPPORTED_COMPONENT',
        ),
      ),
    );
  });
}
