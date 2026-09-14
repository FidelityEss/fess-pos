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
