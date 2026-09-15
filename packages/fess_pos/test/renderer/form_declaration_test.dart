import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/renderer/form/form_controller.dart';
import 'package:fess_pos/src/renderer/form/form_services.dart';
import 'package:fess_pos/src/renderer/form/form_view.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const Declaration _v2 = Declaration(
  id: 'decl-v2',
  key: 'agent_declaration',
  version: 2,
  title: 'Agent declaration',
  text: 'I visited these premises myself.',
);

Future<FormController> _show(WidgetTester tester) async {
  final controller = FormController(
    definition: {
      'sections': [
        {
          'key': 's',
          'fields': [
            {
              'key': 'agent_declaration',
              'type': 'declaration',
              'label': 'Declaration',
              'required': true,
              'props': {'declaration_key': 'agent_declaration'},
            },
          ],
        },
      ],
    },
    context: const ResolveContext(job: {'reference': 'POS-7'}),
  );
  addTearDown(controller.dispose);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: FormView(
            controller: controller,
            services: FormFieldServices(
              takePhoto: (context, field, shot) async => null,
              drawSignature: (context, field) async => null,
              evidenceImage: (id, size) => const SizedBox(),
              declaration: (key) => key == 'agent_declaration' ? _v2 : null,
              now: () => DateTime.utc(2026, 9, 14, 10),
            ),
          ),
        ),
      ),
    ),
  );
  return controller;
}

final Finder _accept = find.byKey(
  const ValueKey('declaration-accept-agent_declaration'),
);
final Finder _newer = find.byKey(
  const ValueKey('declaration-newer-agent_declaration'),
);

void main() {
  testWidgets('the declaration shows its title, wording and version; '
      'ticking accepts this version, with the time (B5.5)', (tester) async {
    final c = await _show(tester);
    expect(find.text('Agent declaration'), findsOneWidget);
    expect(find.text('I visited these premises myself.'), findsOneWidget);
    expect(find.text('Version 2'), findsOneWidget);

    await tester.tap(_accept);
    await tester.pump();
    final value = c.value('agent_declaration')! as Map<String, Object?>;
    expect(value['accepted'], isTrue);
    expect(value['declaration_version_id'], 'decl-v2');
    expect(value['accepted_at'], isA<String>());
  });

  testWidgets('an earlier version accepted has to be accepted again', (
    tester,
  ) async {
    final c = await _show(tester);
    c.setValue('agent_declaration', {
      'accepted': true,
      'declaration_version_id': 'decl-v1',
      'accepted_at': '2026-09-13T10:00:00+02:00',
    });
    await tester.pump();
    expect(_newer, findsOneWidget);
    expect(tester.widget<CheckboxListTile>(_accept).value, isFalse);

    await tester.tap(_accept);
    await tester.pump();
    expect(
      (c.value('agent_declaration')! as Map)['declaration_version_id'],
      'decl-v2',
    );
    expect(_newer, findsNothing);
  });
}
