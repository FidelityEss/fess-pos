import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/app/pos_router.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

JobRecord _job(String id, String merchant, String status) => JobRecord(
  id: id,
  reference: 'POS-$id',
  status: status,
  assignedToMe: true,
  data: {
    'id': id,
    'reference': 'POS-$id',
    'status': status,
    'merchant_name': merchant,
  },
);

final List<JobRecord> _jobs = [
  _job('j1', 'Joe Spaza', 'assigned'),
  _job('j2', 'Done Deal', 'approved'),
];

const Map<String, Map<String, Object?>> _views = {
  'home': {
    'items': [
      {'type': 'greeting', 'text': 'Hi {{agent.first_name}}'},
      {
        'type': 'action_button',
        'label': 'How it works',
        'on_tap': {'page': 'help'},
      },
    ],
  },
  'job_card': {
    'items': [
      {'type': 'title', 'bind': 'job.merchant_name'},
    ],
  },
  'job_detail': {
    'items': [
      {'type': 'field_value', 'label': 'Reference', 'bind': 'job.reference'},
    ],
  },
  'help': {
    'items': [
      {'type': 'markdown', 'text': 'Visit, **photograph**, submit.'},
    ],
  },
};

const Map<String, Object?> _tabs = {
  'style': 'bottom_tabs',
  'items': [
    {'label': 'Home', 'icon': 'home', 'page': 'home'},
    {'label': 'Leads', 'icon': 'list', 'page': 'active_jobs'},
  ],
};

Map<String, Object?> _app(
  Map<String, Object?> navigation, {
  String home = 'home',
}) => {
  'home': home,
  'navigation': navigation,
  'pages': {
    'home': {'type': 'view_page', 'view': 'home'},
    'active_jobs': {
      'type': 'list_page',
      'title': 'Active leads',
      'source': 'jobs',
      'filter': {
        'in': [
          {'var': 'job.status'},
          ['assigned', 'accepted'],
        ],
      },
      'item_view': 'job_card',
      'on_tap': {'page': 'job_detail'},
    },
    'job_detail': {'type': 'view_page', 'view': 'job_detail'},
    'help': {'type': 'view_page', 'view': 'help', 'title': 'How it works'},
  },
};

Widget _router(Map<String, Object?> app) => ProviderScope(
  overrides: [
    myJobsProvider.overrideWith((ref) => Stream.value(_jobs)),
    jobProvider.overrideWith(
      (ref, id) => Stream.value(_jobs.where((j) => j.id == id).firstOrNull),
    ),
    agentProvider.overrideWith((ref) => Stream.value({'first_name': 'Sipho'})),
    agentTotalsProvider.overrideWith((ref) => Stream.value(null)),
    activeDefinitionProvider.overrideWith(
      (ref, key) => Stream.value(switch (key.kind) {
        'app' => app,
        'view' => _views[key.key],
        _ => null,
      }),
    ),
  ],
  child: const MaterialApp(home: PosRouter()),
);

void main() {
  testWidgets('the tabs show the top-level pages; a job opens over them and '
      'Back returns (T3-17)', (tester) async {
    await tester.pumpWidget(_router(_app(_tabs)));
    await tester.pumpAndSettle();
    expect(find.text('Hi Sipho'), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);

    await tester.tap(find.text('Leads'));
    await tester.pumpAndSettle();
    expect(find.text('Active leads'), findsOneWidget);
    expect(find.text('Joe Spaza'), findsOneWidget);
    expect(find.text('Done Deal'), findsNothing, reason: 'filtered out');

    await tester.tap(find.text('Joe Spaza'));
    await tester.pumpAndSettle();
    expect(find.text('POS-j1'), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing, reason: 'over the tabs');

    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();
    expect(find.text('Active leads'), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
  });

  testWidgets("a page's button opens the page it names", (tester) async {
    await tester.pumpWidget(_router(_app(_tabs)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('How it works'));
    await tester.pumpAndSettle();
    expect(find.text('Visit, photograph, submit.'), findsOneWidget);
  });

  testWidgets('a drawer lists the navigation; choosing a page shows it', (
    tester,
  ) async {
    await tester.pumpWidget(
      _router(
        _app({
          'style': 'drawer',
          'items': [
            {'label': 'Home', 'icon': 'home', 'page': 'home'},
            {'label': 'Leads', 'icon': 'list', 'page': 'active_jobs'},
          ],
        }),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsNothing);
    await tester.tap(find.byKey(const ValueKey('pos-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('pos-nav-active_jobs')));
    await tester.pumpAndSettle();
    expect(find.text('Active leads'), findsOneWidget);
    expect(find.text('Joe Spaza'), findsOneWidget);
  });

  testWidgets("an app definition that can't be used gives way to the "
      'bundled one, and the module says so (T3-17)', (tester) async {
    final logged = <PosLogRecord>[];
    PosLogger.sink = logged.add;
    addTearDown(() => PosLogger.sink = null);
    await tester.pumpWidget(_router(_app(_tabs, home: 'nowhere')));
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsNothing);
    expect(
      find.text('Hi Sipho'),
      findsOneWidget,
      reason: 'the bundled home page, drawing the home view in force',
    );
    expect(
      logged.where(
        (r) =>
            r.level == PosLogLevel.warning &&
            r.message.contains("can't be used"),
      ),
      isNotEmpty,
    );
  });
}
