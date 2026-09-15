import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/renderer/form/form_controller.dart';
import 'package:fess_pos/src/renderer/form/form_services.dart';
import 'package:fess_pos/src/renderer/form/form_view.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// A pad that records who the answers say is signing, as the inspection
/// does.
class _Pad {
  late FormController form;
  final Map<String, EvidenceItem> items = {};

  String? _answer(String key) => form.value(key) as String?;

  FormFieldServices get services => FormFieldServices(
    takePhoto: (context, field, shot) async => null,
    drawSignature: (context, field) async {
      final id = 's${items.length + 1}';
      items[id] = EvidenceItem(
        id: id,
        fieldKey: field.key,
        type: 'signature',
        state: 'local_only',
        signerName: _answer('signer_name'),
        signerDesignation: _answer('signer_role'),
      );
      return id;
    },
    evidenceImage: (id, size) => SizedBox.square(dimension: size),
    evidence: (id) => items[id],
    declaration: (key) => null,
  );
}

Future<(_Pad, FormController)> _show(WidgetTester tester) async {
  final pad = _Pad();
  final controller = FormController(
    definition: {
      'sections': [
        {
          'key': 's',
          'fields': [
            {'key': 'signer_name', 'type': 'text', 'label': 'Name'},
            {'key': 'signer_role', 'type': 'text', 'label': 'Designation'},
            {
              'key': 'interviewee_signature',
              'type': 'signature',
              'label': 'Signature',
              'props': {
                'signer_name_field': 'signer_name',
                'signer_designation_field': 'signer_role',
              },
            },
          ],
        },
      ],
    },
    context: const ResolveContext(job: {'reference': 'POS-7'}),
  );
  addTearDown(controller.dispose);
  pad.form = controller;
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: FormView(controller: controller, services: pad.services),
        ),
      ),
    ),
  );
  return (pad, controller);
}

final Finder _sign = find.byKey(
  const ValueKey('signature-sign-interviewee_signature'),
);
final Finder _changed = find.byKey(
  const ValueKey('signature-changed-interviewee_signature'),
);

Future<void> _named(
  WidgetTester tester,
  FormController c, {
  String name = 'Thandi Mokoena',
}) async {
  c
    ..setValue('signer_name', name)
    ..setValue('signer_role', 'Owner');
  await tester.pump();
}

void main() {
  testWidgets('the signer is named first, and the signature shows who '
      'signed', (tester) async {
    final (_, c) = await _show(tester);
    expect(
      find.byKey(const ValueKey('signature-waiting-interviewee_signature')),
      findsOneWidget,
    );
    expect(tester.widget<OutlinedButton>(_sign).onPressed, isNull);

    await _named(tester, c);
    await tester.ensureVisible(_sign);
    await tester.tap(_sign);
    await tester.pumpAndSettle();
    expect(c.value('interviewee_signature'), 's1');
    expect(find.text('Signed by Thandi Mokoena · Owner'), findsOneWidget);
    expect(_changed, findsNothing);
  });

  testWidgets('a signer changed after signing asks for the signature '
      'again; signing again asks first and keeps the first', (tester) async {
    final (pad, c) = await _show(tester);
    await _named(tester, c);
    await tester.ensureVisible(_sign);
    await tester.tap(_sign);
    await tester.pumpAndSettle();

    await _named(tester, c, name: 'Thandi M.');
    expect(_changed, findsOneWidget);

    await tester.ensureVisible(_sign);
    await tester.tap(_sign);
    await tester.pumpAndSettle();
    expect(pad.items, hasLength(1), reason: 'not before the agent agrees');
    await tester.tap(
      find.byKey(const ValueKey('signature-confirm-interviewee_signature')),
    );
    await tester.pumpAndSettle();
    expect(c.value('interviewee_signature'), 's2');
    expect(pad.items, hasLength(2), reason: 'the first stays on record');
    expect(_changed, findsNothing);
  });
}
