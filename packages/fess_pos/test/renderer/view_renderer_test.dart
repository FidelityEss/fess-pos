import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/renderer/render_context.dart';
import 'package:fess_pos/src/renderer/template.dart';
import 'package:fess_pos/src/renderer/view_renderer.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> _job(
  String id,
  String merchant, {
  String status = 'assigned',
  String? start,
  String? notes,
}) => {
  'id': id,
  'reference': 'POS-$id',
  'status': status,
  'merchant_name': merchant,
  'notes': notes,
  'address': {
    'line1': '12 Vilakazi St',
    'suburb': 'Orlando West',
    'city': 'Soweto',
    'postal_code': '1804',
  },
  'scheduled_start': start,
  'scheduled': {'start': start, 'end': null},
};

Future<void> _render(
  WidgetTester tester,
  List<Object?> items,
  RenderContext ctx,
) => tester.pumpWidget(
  MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView(
        child: ViewRenderer(items: items, context: ctx),
      ),
    ),
  ),
);

const List<Object?> _jobCard = [
  {'type': 'title', 'bind': 'job.merchant_name'},
  {'type': 'status_chip', 'bind': 'job.status'},
  {'type': 'field_value', 'label': 'Ref', 'bind': 'job.reference'},
  {'type': 'address_block', 'bind': 'job.address'},
];

void main() {
  testWidgets('the sync status opens what needs attention, when something '
      'does (T4-13)', (tester) async {
    final opened = <Map<String, Object?>>[];
    RenderContext ctx(int attention) => RenderContext(
      data: {
        'sync': {'pending': 0, 'needs_attention': attention},
      },
      onNavigate: (target, data) => opened.add(target),
    );
    await _render(tester, const [
      {'type': 'sync_status'},
    ], ctx(0));
    expect(find.text(BundledCopy.text('sync.synced')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('sync-status')));
    expect(opened, isEmpty);

    await _render(tester, const [
      {'type': 'sync_status'},
    ], ctx(2));
    expect(find.text(BundledCopy.text('sync.needs_attention')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('sync-status')));
    expect(opened, [
      {'page': 'needs_attention'},
    ]);
  });

  testWidgets('a job card shows what its view binds', (tester) async {
    await _render(
      tester,
      _jobCard,
      RenderContext(data: {'job': _job('j1', 'Joe Spaza')}),
    );
    expect(find.text('Joe Spaza'), findsOneWidget);
    expect(find.text('Assigned'), findsOneWidget, reason: 'status as copy');
    expect(find.text('Ref'), findsOneWidget);
    expect(find.text('POS-j1'), findsOneWidget);
    expect(
      find.text('12 Vilakazi St\nOrlando West, Soweto\n1804'),
      findsOneWidget,
    );
  });

  testWidgets('an item shows only while its rule holds', (tester) async {
    const items = [
      {
        'type': 'markdown',
        'text': 'Notes: {{job.notes}}',
        'visible': {
          '!=': [
            {'var': 'job.notes'},
            null,
          ],
        },
      },
    ];
    await _render(
      tester,
      items,
      RenderContext(data: {'job': _job('j1', 'A')}),
    );
    expect(find.textContaining('Notes'), findsNothing);
    await _render(
      tester,
      items,
      RenderContext(data: {'job': _job('j1', 'A', notes: 'Ring the bell')}),
    );
    expect(find.text('Notes: Ring the bell'), findsOneWidget);
  });

  testWidgets('a rule that fails hides its item, not the view', (tester) async {
    await _render(tester, [
      {
        'type': 'section_title',
        'text': 'Hidden',
        'visible': {
          'var': 'job.merchant_name', // a string, not a boolean
        },
      },
      {'type': 'section_title', 'text': 'Shown'},
    ], RenderContext(data: {'job': _job('j1', 'A')}));
    expect(find.text('Hidden'), findsNothing);
    expect(find.text('Shown'), findsOneWidget);
  });

  testWidgets('a component this build lacks is left out', (tester) async {
    await _render(
      tester,
      [
        {'type': 'map_preview', 'bind': 'job.location'},
        {'type': 'from_the_future'},
        {'type': 'greeting', 'text': 'Hi {{agent.first_name}}'},
      ],
      const RenderContext(
        data: {
          'agent': {'first_name': 'Sipho'},
        },
      ),
    );
    expect(find.text('Hi Sipho'), findsOneWidget);
  });

  testWidgets('job_list filters, sorts, limits and opens', (tester) async {
    final opened = <Object?>[];
    await _render(
      tester,
      const [
        {
          'type': 'job_list',
          'item_view': 'job_card',
          'filter': {
            'in': [
              {'var': 'job.status'},
              ['assigned', 'accepted'],
            ],
          },
          'sort': 'job.scheduled_start',
          'limit': 2,
          'on_tap': {'page': 'job_detail'},
          'empty_content': 'jobs.empty_active',
        },
      ],
      RenderContext(
        data: const {},
        jobs: [
          _job('j1', 'Later', start: '2026-09-16T08:00:00+00:00'),
          _job('j2', 'Done', status: 'approved'),
          _job('j3', 'Sooner', start: '2026-09-15T08:00:00+00:00'),
          _job('j4', 'Unscheduled', status: 'accepted'),
        ],
        itemViews: const {'job_card': _jobCard},
        onNavigate: (target, data) => opened.add((data['job']! as Map)['id']),
      ),
    );
    expect(find.text('Done'), findsNothing);
    expect(find.text('Unscheduled'), findsNothing, reason: 'limit 2');
    final sooner = tester.getTopLeft(find.text('Sooner'));
    final later = tester.getTopLeft(find.text('Later'));
    expect(sooner.dy, lessThan(later.dy));
    await tester.tap(find.text('Sooner'));
    expect(opened, ['j3']);
  });

  testWidgets('an empty job_list shows its empty content', (tester) async {
    await _render(
      tester,
      const [
        {
          'type': 'job_list',
          'item_view': 'job_card',
          'empty_content': 'jobs.empty_active',
        },
      ],
      const RenderContext(data: {}),
    );
    expect(find.text(BundledCopy.text('jobs.empty_active')), findsOneWidget);
  });

  testWidgets('stat tiles: a server total and a local count', (tester) async {
    await _render(
      tester,
      const [
        {
          'type': 'stat_row',
          'tiles': [
            {
              'type': 'stat_tile',
              'label': 'Due today',
              'source': 'server',
              'stat': 'stats.due_today',
            },
            {
              'type': 'stat_tile',
              'label': 'Returned',
              'source': 'local',
              'collection': 'jobs',
              'filter': {
                '==': [
                  {'var': 'job.status'},
                  'returned',
                ],
              },
            },
          ],
        },
      ],
      RenderContext(
        data: const {
          'stats': {'due_today': 3},
        },
        jobs: [
          _job('j1', 'A', status: 'returned'),
          _job('j2', 'B'),
        ],
      ),
    );
    expect(find.text('3'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
  });

  testWidgets('an action button opens its page; one with no target is left '
      'out (T3-05)', (tester) async {
    final opened = <Map<String, Object?>>[];
    await _render(
      tester,
      const [
        {
          'type': 'action_button',
          'label': 'Site safety check',
          'icon': 'form',
          'on_tap': {'page': 'safety_check'},
        },
        {'type': 'action_button', 'label': 'Nowhere'},
        {
          'type': 'action_button',
          'key': 'card',
          'label': 'My card',
          'style': 'secondary',
          'on_tap': {'page': 'agent_card'},
        },
      ],
      RenderContext(
        data: const {},
        onNavigate: (target, data) => opened.add(target),
      ),
    );
    expect(find.text('Nowhere'), findsNothing);
    expect(
      tester.widget(
        find.byKey(const ValueKey('action-button-Site safety check')),
      ),
      isA<FilledButton>(),
    );
    expect(
      tester.widget(find.byKey(const ValueKey('action-button-card'))),
      isA<OutlinedButton>(),
    );
    await tester.tap(find.text('Site safety check'));
    await tester.tap(find.text('My card'));
    expect(opened, [
      {'page': 'safety_check'},
      {'page': 'agent_card'},
    ]);
  });

  testWidgets('a contact offers the calls, texts and emails its actions '
      'name, where the screen can open them (T3-05)', (tester) async {
    const items = [
      {
        'type': 'contact',
        'label': 'Contact',
        'bind': 'job.contact',
        'actions': ['call', 'email'],
      },
    ];
    const data = <String, Object?>{
      'job': {
        'contact': {
          'name': 'Thandi',
          'phone': '+27 82 000 1111',
          'email': 't@example.com',
        },
      },
    };
    await _render(tester, items, const RenderContext(data: data));
    expect(find.text('Thandi\n+27 82 000 1111\nt@example.com'), findsOneWidget);
    expect(find.byKey(const ValueKey('contact-call')), findsNothing);

    final opened = <(String, String)>[];
    await _render(
      tester,
      items,
      RenderContext(data: data, openContact: (c, a) => opened.add((c, a))),
    );
    expect(find.byKey(const ValueKey('contact-sms')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('contact-call')));
    await tester.tap(find.byKey(const ValueKey('contact-email')));
    expect(opened, [('call', '+27 82 000 1111'), ('email', 't@example.com')]);
  });

  testWidgets('an announcement shows its title and Markdown text', (
    tester,
  ) async {
    await _render(tester, const [
      {
        'type': 'announcement',
        'tone': 'warning',
        'title': 'Heads up',
        'text': 'Visits **pause** on 24 September.',
      },
      {'type': 'announcement', 'text': ' '},
    ], const RenderContext(data: {}));
    expect(find.text('Heads up'), findsOneWidget);
    expect(find.text('Visits pause on 24 September.'), findsOneWidget);
  });

  testWidgets('evidence status: all sent, some waiting, some held '
      '(T3-05)', (tester) async {
    Future<String?> shown(Map<String, Object?> counts) async {
      await _render(
        tester,
        const [
          {'type': 'evidence_status', 'bind': 'inspection.evidence'},
        ],
        RenderContext(
          data: {
            'inspection': {'evidence': counts},
          },
        ),
      );
      final chip = find.byKey(const ValueKey('evidence-status'));
      if (chip.evaluate().isEmpty) return null;
      return tester
          .widget<Text>(find.descendant(of: chip, matching: find.byType(Text)))
          .data;
    }

    expect(
      await shown({'total': 3, 'sent': 3, 'waiting': 0, 'held': 0}),
      'All 3 uploaded',
    );
    expect(
      await shown({'total': 3, 'sent': 1, 'waiting': 2, 'held': 0}),
      '1 of 3 uploaded; the rest will send automatically',
    );
    expect(
      await shown({'total': 3, 'sent': 1, 'waiting': 1, 'held': 1}),
      '1 of 3 need attention',
    );
    expect(await shown({'total': 0}), isNull);
  });

  test('templates and schedule text', () {
    expect(
      fillTemplate('Hi {{ agent.first_name }}{{missing}}', {
        'agent': {'first_name': 'Sipho'},
      }),
      'Hi Sipho',
    );
    final start = DateTime(2026, 9, 14, 9).toUtc().toIso8601String();
    final end = DateTime(2026, 9, 14, 13).toUtc().toIso8601String();
    expect(
      scheduleText(start, end, month: (m) => BundledCopy.text('date.month.$m')),
      '14 Sep 2026, 09:00–13:00',
    );
    expect(scheduleText(null, null, month: (_) => ''), isNull);
  });
}
