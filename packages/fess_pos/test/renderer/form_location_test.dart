import 'package:fess_pos/src/renderer/form/form_controller.dart';
import 'package:fess_pos/src/renderer/form/form_services.dart';
import 'package:fess_pos/src/renderer/form/form_view.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// A map that hands out the pins it is given, one per visit.
FormFieldServices _map(List<Map<String, Object?>> pins) => FormFieldServices(
  takePhoto: (context, field, shot) async => null,
  drawSignature: (context, field) async => null,
  evidenceImage: (id, size) => const SizedBox(),
  declaration: (key) => null,
  pickPin: (context, field, current) async =>
      pins.isEmpty ? null : pins.removeAt(0),
);

const Map<String, Object?> _pin = {
  'lat': -26.2041,
  'lng': 28.0473,
  'source': 'map_pin',
};

Future<FormController> _show(
  WidgetTester tester,
  Map<String, Object?> field, {
  FormFieldServices? services,
}) async {
  final controller = FormController(
    definition: {
      'sections': [
        {
          'key': 's',
          'fields': [field],
        },
      ],
    },
    context: const ResolveContext(job: {'reference': 'POS-7'}),
    inspection: true,
  );
  addTearDown(controller.dispose);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: FormView(controller: controller, services: services),
        ),
      ),
    ),
  );
  return controller;
}

void main() {
  testWidgets('an address is typed part by part and kept structured, with '
      'its pin (T4-11)', (tester) async {
    final c = await _show(tester, {
      'key': 'premises',
      'type': 'address',
      'label': 'Premises address',
      'props': {
        'map_pin': 'optional',
        'provinces': ['Gauteng', 'Western Cape'],
      },
    }, services: _map([_pin]));
    await tester.enterText(
      find.byKey(const ValueKey('address-line1-premises')),
      '12 Main Road ',
    );
    await tester.enterText(
      find.byKey(const ValueKey('address-city-premises')),
      'Johannesburg',
    );
    await tester.tap(find.byKey(const ValueKey('address-province-premises')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Gauteng').last);
    await tester.pumpAndSettle();
    expect(c.value('premises'), {
      'line1': '12 Main Road',
      'city': 'Johannesburg',
      'province': 'Gauteng',
    });

    await tester.ensureVisible(find.byKey(const ValueKey('pin-set-premises')));
    await tester.tap(find.byKey(const ValueKey('pin-set-premises')));
    await tester.pumpAndSettle();
    expect((c.value('premises')! as Map)['pin'], _pin);
    expect((c.value('premises')! as Map)['city'], 'Johannesburg');
    expect(find.text('Pin at -26.20410, 28.04730'), findsOneWidget);
  });

  testWidgets('map_pin none: no pin to set', (tester) async {
    await _show(tester, {
      'key': 'premises',
      'type': 'address',
      'props': {'map_pin': 'none'},
    }, services: _map([_pin]));
    expect(find.byKey(const ValueKey('pin-set-premises')), findsNothing);
  });

  testWidgets('a location pin is set on the map', (tester) async {
    final c = await _show(tester, {
      'key': 'entrance',
      'type': 'location_pin',
      'label': 'Entrance',
    }, services: _map([_pin]));
    expect(find.text('No pin yet.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('pin-set-entrance')));
    await tester.pumpAndSettle();
    expect(c.value('entrance'), _pin);
    expect(find.text('Move the pin'), findsOneWidget);
  });

  testWidgets('without a map, a location pin holds the form', (tester) async {
    await _show(tester, {
      'key': 'entrance',
      'type': 'location_pin',
      'label': 'Entrance',
    });
    expect(find.byKey(const ValueKey('pin-set-entrance')), findsNothing);
  });
}
