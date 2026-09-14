import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/renderer/form/form_controller.dart';
import 'package:fess_pos/src/renderer/form/form_view.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The Wave-1 inputs of T3-03: each stores the value shape the server's
/// validator wants, and each problem shows in the agent's words.
Future<FormController> _show(
  WidgetTester tester,
  List<Map<String, Object?>> fields, {
  Map<String, Object?> initialValues = const {},
}) async {
  final controller = FormController(
    definition: {
      'sections': [
        {'key': 's', 'fields': fields},
      ],
    },
    context: const ResolveContext(job: {'reference': 'POS-7'}),
    initialValues: initialValues,
  );
  addTearDown(controller.dispose);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(child: FormView(controller: controller)),
      ),
    ),
  );
  return controller;
}

String _copy(String key) => BundledCopy.text(key);

void main() {
  testWidgets('numbers take a comma and spaces, show their unit and limits', (
    tester,
  ) async {
    final c = await _show(tester, [
      {
        'key': 'staff',
        'type': 'number',
        'label': 'Staff',
        'props': {'integer': true, 'min': 1, 'max': 50, 'unit': 'people'},
      },
      {
        'key': 'turnover',
        'type': 'number',
        'label': 'Turnover',
        'props': {'decimals': 2},
      },
    ]);
    expect(find.text('people'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('number-turnover')),
      '1 250,5',
    );
    await tester.pump();
    expect(c.value('turnover'), 1250.5);

    final staff = find.byKey(const ValueKey('number-staff'));
    await tester.enterText(staff, '2.5');
    await tester.pump();
    expect(c.validate(), isFalse);
    await tester.pump();
    expect(find.text(_copy('form.error.NOT_INTEGER')), findsOneWidget);
    await tester.enterText(staff, '80');
    await tester.pump();
    expect(find.text('Enter 50 or less.'), findsOneWidget);
    await tester.enterText(staff, '1.2.3');
    await tester.pump();
    expect(c.value('staff'), '1.2.3', reason: 'kept as typed, not dropped');
    expect(find.text(_copy('form.error.number.INVALID_TYPE')), findsOneWidget);
    await tester.enterText(staff, '12');
    await tester.pump();
    expect(c.validate(), isTrue);
    expect(c.answers['staff'], {'v': 12});
  });

  testWidgets('a stepper counts in steps and stops at the limits', (
    tester,
  ) async {
    final c = await _show(tester, [
      {
        'key': 'tills',
        'type': 'number',
        'display': 'stepper',
        'label': 'Tills',
        'props': {'min': 0, 'max': 2},
      },
    ]);
    final up = find.byKey(const ValueKey('number-up-tills'));
    for (final expected in [0, 1, 2, 2]) {
      await tester.tap(up);
      await tester.pump();
      expect(c.value('tills'), expected);
    }
    await tester.tap(find.byKey(const ValueKey('number-down-tills')));
    await tester.pump();
    expect(c.value('tills'), 1);
    expect(find.widgetWithText(TextField, '1'), findsOneWidget);
  });

  testWidgets('a percentage as a slider, and typed', (tester) async {
    final c = await _show(tester, [
      {
        'key': 'share',
        'type': 'percentage',
        'display': 'slider',
        'label': 'Card share',
      },
      {'key': 'cash', 'type': 'percentage', 'label': 'Cash share'},
    ]);
    await tester.tap(find.byKey(const ValueKey('percent-share')));
    await tester.pump();
    expect(c.value('share'), 50);
    expect(find.text('50%'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('number-cash')), '120');
    await tester.pump();
    expect(c.validate(), isFalse);
    await tester.pump();
    expect(
      find.text(_copy('form.error.percentage.OUT_OF_RANGE')),
      findsOneWidget,
    );
  });

  testWidgets('a phone number is stored in E.164', (tester) async {
    final c = await _show(tester, [
      {'key': 'cell', 'type': 'phone', 'label': 'Cell'},
    ]);
    final cell = find.byKey(const ValueKey('phone-cell'));
    await tester.enterText(cell, '082 123 4567');
    await tester.pump();
    expect(c.value('cell'), '+27821234567');
    await tester.enterText(cell, '0027 82 123 4567');
    await tester.pump();
    expect(c.value('cell'), '+27821234567');
    await tester.enterText(cell, '12345');
    await tester.pump();
    expect(c.validate(), isFalse);
    await tester.pump();
    expect(find.text(_copy('form.error.phone.INVALID_FORMAT')), findsOneWidget);
  });

  testWidgets('yes, no or not applicable, with the definition’s labels', (
    tester,
  ) async {
    final c = await _show(tester, [
      {
        'key': 'till',
        'type': 'tri_state',
        'label': 'Till slip matches?',
        'props': {
          'labels': {'na': 'No till'},
        },
      },
      {
        'key': 'signage',
        'type': 'tri_state',
        'display': 'radio',
        'label': 'Signage?',
      },
    ]);
    await tester.tap(find.text('No till'));
    await tester.pump();
    expect(c.value('till'), 'na');
    await tester.tap(find.text(_copy('form.not_applicable')));
    await tester.pump();
    expect(c.value('signage'), 'na');
    expect(c.answers, {
      'till': {'v': 'na'},
      'signage': {'v': 'na'},
    });
  });

  testWidgets('a date shows in words, picks within its limits, may be '
      'unknown', (tester) async {
    final c = await _show(tester, [
      {
        'key': 'opened',
        'type': 'date',
        'label': 'Opened',
        'required': true,
        'props': {
          'min': '2026-09-10',
          'max': '2026-09-10',
          'allow_unknown': true,
        },
      },
    ]);
    expect(find.text(_copy('form.date.choose')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('date-pick-opened')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(c.value('opened'), '2026-09-10');
    expect(find.text('10 Sep 2026'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('date-unknown-opened')));
    await tester.pump();
    expect(c.value('opened'), isNull);
    expect(c.answers['opened'], {'v': null, 'unknown': true});
    expect(c.validate(), isTrue, reason: 'unknown answers a required date');
  });

  testWidgets('a time shows as the phone does and keeps its limits', (
    tester,
  ) async {
    final c = await _show(
      tester,
      [
        {
          'key': 'opens',
          'type': 'time',
          'label': 'Opens',
          'props': {'min': '07:00'},
        },
      ],
      initialValues: {'opens': '06:30'},
    );
    expect(find.textContaining('6:30'), findsOneWidget);
    expect(c.validate(), isFalse);
    await tester.pump();
    expect(find.text('Choose 07:00 or later.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('time-pick-opens')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(c.value('opens'), '06:30');
  });

  testWidgets('a duration is a whole number and a unit', (tester) async {
    final c = await _show(tester, [
      {
        'key': 'trading',
        'type': 'duration',
        'label': 'How long in business?',
        'props': {
          'units': ['months', 'years'],
        },
      },
    ]);
    await tester.enterText(find.byKey(const ValueKey('duration-trading')), '3');
    await tester.pump();
    expect(c.value('trading'), {'value': 3, 'unit': 'months'});
    await tester.tap(find.byKey(const ValueKey('duration-unit-trading')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(_copy('form.duration.years')).last);
    await tester.pumpAndSettle();
    expect(c.value('trading'), {'value': 3, 'unit': 'years'});
    expect(c.validate(), isTrue);
  });

  testWidgets('business hours: every day group open, closed or 24 hours', (
    tester,
  ) async {
    final c = await _show(tester, [
      {
        'key': 'hours',
        'type': 'business_hours',
        'label': 'Trading hours',
        'required': true,
        'props': {
          'groups': ['weekdays', 'sunday'],
        },
      },
    ]);
    expect(find.text(_copy('form.hours.saturday')), findsNothing);
    expect(find.byKey(const ValueKey('hours-hours-sunday-24h')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('hours-hours-sunday-closed')));
    await tester.pump();
    expect(c.value('hours'), {'sunday': 'closed'});
    expect(c.validate(), isFalse);
    await tester.pump();
    expect(find.text(_copy('form.error.MISSING_GROUP')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('hours-hours-weekdays-open')));
    await tester.pump();
    expect(find.text(_copy('form.error.INVALID_HOURS')), findsOneWidget);
    c.setValue('hours', {
      'sunday': 'closed',
      'weekdays': {'open': '08:00', 'close': '17:00'},
    });
    await tester.pump();
    expect(find.textContaining('8:00'), findsOneWidget);
    expect(c.validate(), isTrue);
  });

  testWidgets('a prefilled value is shown and can be flagged as different', (
    tester,
  ) async {
    final c = await _show(tester, [
      {
        'key': 'ref',
        'type': 'prefilled',
        'label': 'Reference',
        'props': {
          'source': 'job.reference',
          'allow_flag_differs': true,
          'differs_note': 'Say what you see in the notes.',
        },
      },
    ]);
    expect(find.text('POS-7'), findsOneWidget);
    expect(c.answers['ref'], {'v': 'POS-7', 'prefilled': true});
    expect(find.text('Say what you see in the notes.'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('prefilled-differs-ref')));
    await tester.pump();
    expect(c.answers['ref'], {
      'v': 'POS-7',
      'prefilled': true,
      'flagged_differs': true,
    });
    expect(find.text('Say what you see in the notes.'), findsOneWidget);
    expect(c.validate(), isTrue);
  });

  testWidgets('an acknowledgement is ticked, and only true is sent', (
    tester,
  ) async {
    final c = await _show(tester, [
      {
        'key': 'ack',
        'type': 'acknowledgement',
        'required': true,
        'props': {'text': 'I checked the till slip for {{job.reference}}.'},
      },
    ]);
    expect(find.text('I checked the till slip for POS-7. *'), findsOneWidget);
    expect(c.validate(), isFalse);
    await tester.pump();
    expect(
      find.text(_copy('form.error.acknowledgement.REQUIRED')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('ack-ack')));
    await tester.pump();
    expect(c.answers['ack'], {'v': true});
    expect(c.validate(), isTrue);
    await tester.tap(find.byKey(const ValueKey('ack-ack')));
    await tester.pump();
    expect(c.answers.containsKey('ack'), isFalse);
  });

  testWidgets('a two-column group pairs its fields when there is room', (
    tester,
  ) async {
    Future<void> show() => _show(tester, [
      {
        'key': 'contact',
        'type': 'group',
        'label': 'Contact',
        'props': {'layout': 'two_column'},
        'fields': [
          {'key': 'first', 'type': 'text', 'label': 'First'},
          {'key': 'second', 'type': 'text', 'label': 'Second'},
        ],
      },
    ]);
    await show();
    expect(find.text('Contact'), findsOneWidget);
    var first = tester.getTopLeft(find.text('First'));
    var second = tester.getTopLeft(find.text('Second'));
    expect(first.dy, second.dy);
    expect(first.dx, lessThan(second.dx));

    tester.view
      ..physicalSize = const Size(400, 900)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await show();
    first = tester.getTopLeft(find.text('First'));
    second = tester.getTopLeft(find.text('Second'));
    expect(first.dx, second.dx);
    expect(first.dy, lessThan(second.dy));
  });

  testWidgets('a computed value is shown, not asked for', (tester) async {
    final c = await _show(tester, [
      {'key': 'n', 'type': 'number', 'label': 'Tills'},
      {
        'key': 'twice',
        'type': 'number',
        'label': 'Twice',
        'value': {
          '*': [
            {'var': 'answers.n'},
            2,
          ],
        },
      },
    ]);
    await tester.enterText(find.byKey(const ValueKey('number-n')), '4');
    await tester.pump();
    expect(find.text('8'), findsOneWidget);
    expect(find.byKey(const ValueKey('number-twice')), findsNothing);
    expect(c.answers['twice'], {'v': 8, 'computed': true});
  });
}
