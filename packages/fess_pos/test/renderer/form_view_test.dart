import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/renderer/form/form_controller.dart';
import 'package:fess_pos/src/renderer/form/form_view.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> _in(String key, List<String> values) => {
  'in': [
    {'var': 'answers.$key'},
    values,
  ],
};

/// The seeded `assignment_reject` form, with a callout added.
final Map<String, Object?> _reject = {
  'kind': 'form',
  'family': 'assignment_reject',
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
          'props': {'rows': 3, 'max_length': 1000},
          'required': _in('reason_code', ['conflict', 'safety', 'other']),
        },
        {
          'key': 'conflict_hint',
          'type': 'callout',
          'tone': 'warning',
          'text': 'Say how you know the merchant.',
          'visible': _in('reason_code', ['conflict']),
        },
      ],
    },
  ],
};

const FormLists _rejectReasons = FormLists(
  reasonCodes: {
    'assignment_reject': [
      OptionDef(value: 'unavailable', label: 'Not available'),
      OptionDef(
        value: 'conflict',
        label: 'Conflict of interest',
        helpText: 'You know the merchant',
      ),
      OptionDef(value: 'other', label: 'Other'),
    ],
  },
);

Map<String, Object?> _optionMeta(String meta) => {
  '==': [
    {
      'option_meta': ['answers.reason_code', meta],
    },
    true,
  ],
};

/// Shaped like `form_unable_to_complete` (schema/fixtures): the reason's
/// own meta decides whether a note and a photo are asked for.
final Map<String, Object?> _unable = {
  'kind': 'form',
  'sections': [
    {
      'key': 'reason',
      'fields': [
        {
          'key': 'reason_code',
          'type': 'single_select',
          'label': 'Reason',
          'required': true,
          'options_source': {
            'type': 'reason_codes',
            'category': 'unable_to_complete',
          },
        },
        {
          'key': 'note',
          'type': 'textarea',
          'label': 'What happened?',
          'required': _optionMeta('requires_note'),
        },
        {
          'key': 'photo',
          'type': 'photo',
          'label': 'Photo of the location',
          'required': true,
          'visible': _optionMeta('requires_photo'),
          'props': {'min_count': 1, 'max_count': 3},
        },
      ],
    },
  ],
};

const FormLists _unableReasons = FormLists(
  reasonCodes: {
    'unable_to_complete': [
      OptionDef(
        value: 'business_closed',
        label: 'Business closed',
        meta: {'requires_note': false, 'requires_photo': false},
      ),
      OptionDef(
        value: 'incorrect_address',
        label: 'Incorrect address',
        meta: {'requires_note': true, 'requires_photo': true},
      ),
    ],
  },
);

Future<FormController> _show(
  WidgetTester tester,
  Map<String, Object?> form, {
  FormLists lists = const FormLists(),
}) async {
  final controller = FormController(
    definition: form,
    lists: lists,
    context: const ResolveContext(job: {'reference': 'POS-7'}),
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
  testWidgets('a reason form offers its reasons; the rules follow the answer', (
    tester,
  ) async {
    final c = await _show(tester, _reject, lists: _rejectReasons);
    expect(find.text("Why can't you take POS-7?"), findsOneWidget);
    expect(find.text('Reason *'), findsOneWidget);
    expect(find.text('Not available'), findsOneWidget);
    expect(find.text('You know the merchant'), findsOneWidget);
    expect(find.text('Note'), findsOneWidget, reason: 'not required yet');
    expect(find.text('Say how you know the merchant.'), findsNothing);

    await tester.tap(find.text('Conflict of interest'));
    await tester.pump();
    expect(c.value('reason_code'), 'conflict');
    expect(find.text('Note *'), findsOneWidget);
    expect(find.text('Say how you know the merchant.'), findsOneWidget);
    expect(c.answers, {
      'reason_code': {'v': 'conflict'},
    });

    expect(c.validate(), isFalse);
    await tester.pump();
    expect(find.text(_copy('form.error.REQUIRED')), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'My cousin');
    await tester.pump();
    expect(c.validate(), isTrue);
    await tester.pump();
    expect(find.text(_copy('form.error.REQUIRED')), findsNothing);
    expect(c.answers, {
      'reason_code': {'v': 'conflict'},
      'note': {'v': 'My cousin'},
    });
  });

  testWidgets('problems show once the agent tries to go on, not before', (
    tester,
  ) async {
    final c = await _show(tester, _reject, lists: _rejectReasons);
    expect(c.errors.map((e) => e.code), ['REQUIRED']);
    expect(find.text(_copy('form.error.REQUIRED')), findsNothing);
    c.validate();
    await tester.pump();
    expect(find.text(_copy('form.error.REQUIRED')), findsOneWidget);
  });

  testWidgets("a text limit shows in the agent's words", (tester) async {
    final form = {
      'sections': [
        {
          'key': 's',
          'fields': [
            {
              'key': 'note',
              'type': 'text',
              'label': 'Explain',
              'props': {'min_length': 10},
            },
          ],
        },
      ],
    };
    final c = await _show(tester, form);
    await tester.enterText(find.byType(TextField), 'Too short');
    await tester.pump();
    expect(c.validate(), isFalse);
    await tester.pump();
    expect(find.text('Enter at least 10 characters.'), findsOneWidget);
  });

  testWidgets(
    "the reason's meta asks for a note and a photo; a photo this build "
    "can't take holds the form",
    (tester) async {
      final c = await _show(tester, _unable, lists: _unableReasons);
      await tester.tap(find.text('Incorrect address'));
      await tester.pump();
      expect(find.text('What happened? *'), findsOneWidget);
      expect(find.text('Photo of the location *'), findsOneWidget);
      expect(find.text(_copy('form.unsupported_field')), findsOneWidget);
      expect(c.unsupportedVisible, ['photo']);
      await tester.enterText(find.byType(TextField), 'Wrong street');
      await tester.pump();
      expect(c.validate(), isFalse);

      await tester.tap(find.text('Business closed'));
      await tester.pump();
      expect(find.text('What happened?'), findsOneWidget);
      expect(find.text(_copy('form.unsupported_field')), findsNothing);
      expect(c.unsupportedVisible, isEmpty);
      expect(c.validate(), isTrue);
    },
  );

  testWidgets('booleans, an exclusive choice, and "other" with its text', (
    tester,
  ) async {
    final form = {
      'sections': [
        {
          'key': 's',
          'fields': [
            {'key': 'open', 'type': 'boolean', 'label': 'Open now?'},
            {
              'key': 'sells',
              'type': 'multi_select',
              'label': 'Sells',
              'options': [
                {'value': 'food', 'label': 'Food'},
                {'value': 'airtime', 'label': 'Airtime'},
                {'value': 'none', 'label': 'None of these'},
              ],
              'props': {
                'exclusive_options': ['none'],
              },
            },
            {
              'key': 'kind',
              'type': 'single_select',
              'display': 'chips',
              'label': 'Kind',
              'options': [
                {'value': 'shop', 'label': 'Shop'},
              ],
              'props': {'allow_other': true},
            },
          ],
        },
      ],
    };
    final c = await _show(tester, form);
    await tester.tap(find.text('Yes'));
    await tester.pump();
    expect(c.value('open'), isTrue);

    await tester.tap(find.text('Food'));
    await tester.pump();
    await tester.tap(find.text('Airtime'));
    await tester.pump();
    expect(c.value('sells'), ['food', 'airtime']);
    await tester.tap(find.text('None of these'));
    await tester.pump();
    expect(c.value('sells'), ['none']);
    await tester.tap(find.text('Food'));
    await tester.pump();
    expect(c.value('sells'), ['food']);

    await tester.tap(find.text(_copy('form.other')));
    await tester.pump();
    expect(find.byKey(const ValueKey('form-other-kind')), findsOneWidget);
    expect(c.validate(), isFalse);
    await tester.pump();
    expect(find.text(_copy('form.error.OTHER_TEXT_REQUIRED')), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('form-other-kind')),
      'Kiosk',
    );
    await tester.pump();
    expect(c.validate(), isTrue);
    expect(c.answers['kind'], {'v': 'other', 'other_text': 'Kiosk'});
  });

  test('a hidden answer stays on the phone but is not sent', () {
    final form = {
      'sections': [
        {
          'key': 's',
          'fields': [
            {
              'key': 'reason_code',
              'type': 'single_select',
              'options': [
                {'value': 'a', 'label': 'A'},
                {'value': 'other', 'label': 'Other'},
              ],
            },
            {
              'key': 'detail',
              'type': 'text',
              'visible': _in('reason_code', ['other']),
            },
          ],
        },
      ],
    };
    final c = FormController(definition: form)
      ..setValue('reason_code', 'other')
      ..setValue('detail', 'Something else');
    expect(c.answers.keys, ['reason_code', 'detail']);
    c.setValue('reason_code', 'a');
    expect(c.answers.keys, ['reason_code']);
    expect(c.value('detail'), 'Something else');
    expect(c.validate(), isTrue, reason: 'no HIDDEN_FIELD_PRESENT');
    c.setValue('reason_code', 'other');
    expect(c.answers['detail'], {'v': 'Something else'});
    c.dispose();
  });

  test('defaults fill in before the agent starts', () {
    final c = FormController(
      definition: {
        'sections': [
          {
            'key': 's',
            'fields': [
              {'key': 'open', 'type': 'boolean', 'default': true},
            ],
          },
        ],
      },
    );
    expect(c.answers, {
      'open': {'v': true},
    });
    c.dispose();
  });

  testWidgets("a form this build can't read shows a notice, not half a form", (
    tester,
  ) async {
    final c = await _show(tester, {
      'sections': [
        {
          'key': 's',
          'fields': [
            {'key': 'visit', 'type': 'date', 'label': 'Visit date'},
          ],
        },
      ],
    });
    expect(c.definitionError?.code, 'UNSUPPORTED_COMPONENT');
    expect(find.text(_copy('form.unavailable')), findsOneWidget);
    expect(find.text('Visit date'), findsNothing);
    expect(c.validate(), isFalse);
  });

  test('this build draws every component it reports', () {
    for (final type in supportedFormComponents.keys) {
      expect(formComponentSpec(type), isNotNull, reason: type);
    }
  });
}
