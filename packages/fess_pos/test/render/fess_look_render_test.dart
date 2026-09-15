// Renders the main module screens to PNG with the bundled Montserrat, to
// compare side by side with the FESS designs (T3-34, docs/17 §3). Skipped
// unless an output folder is given:
//
//   flutter test test/render --dart-define=POS_RENDER_DIR=/some/folder
//
// Nothing is compared or kept in the repo: the pictures are for people.
@TestOn('vm')
library;

import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart' show OutboxStatus;
import 'package:fess_pos/src/domain/app/app_spec.dart';
import 'package:fess_pos/src/domain/cards/cards.dart';
import 'package:fess_pos/src/domain/forms/form_submissions.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/domain/sync/attention.dart';
import 'package:fess_pos/src/domain/sync/lost_store.dart';
import 'package:fess_pos/src/domain/sync/power_status.dart';
import 'package:fess_pos/src/features/app/pos_router.dart';
import 'package:fess_pos/src/features/forms/record_form_page.dart';
import 'package:fess_pos/src/features/shell/needs_attention_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';

const String _outDir = String.fromEnvironment('POS_RENDER_DIR');
const bool _skip = _outDir == '';

final GlobalKey _shot = GlobalKey();

// ---------------------------------------------------------------- set-up

String _flutterRoot() {
  final env = Platform.environment['FLUTTER_ROOT'];
  if (env != null && env.isNotEmpty) return env;
  var dir = File(Platform.resolvedExecutable).parent;
  while (dir.parent.path != dir.path) {
    if (Directory(
      '${dir.path}/bin/cache/artifacts/material_fonts',
    ).existsSync()) {
      return dir.path;
    }
    dir = dir.parent;
  }
  throw StateError('FLUTTER_ROOT not found');
}

Future<ByteData> _bytes(String path) async =>
    ByteData.sublistView(await File(path).readAsBytes());

Future<void> _loadFonts() async {
  final montserrat = FontLoader('packages/fess_pos/Montserrat');
  for (final w in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    montserrat.addFont(_bytes('assets/fonts/montserrat/Montserrat-$w.ttf'));
  }
  await montserrat.load();
  final icons = FontLoader('MaterialIcons')
    ..addFont(
      _bytes(
        '${_flutterRoot()}/bin/cache/artifacts/material_fonts/'
        'MaterialIcons-Regular.otf',
      ),
    );
  await icons.load();
}

/// A 430 × 932 phone (the FESS screenshots' size) at 2×, with a status
/// bar and a home indicator.
void _phone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(860, 1864)
    ..devicePixelRatio = 2
    ..padding = const FakeViewPadding(top: 94, bottom: 68)
    ..viewPadding = const FakeViewPadding(top: 94, bottom: 68);
  addTearDown(tester.view.reset);
}

Widget _app(List<Override> overrides, Widget home) => ProviderScope(
  overrides: overrides,
  child: MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: buildPosThemeData(PosBrand.resolve()),
    builder: (context, child) => RepaintBoundary(key: _shot, child: child),
    home: home,
  ),
);

Future<void> _save(WidgetTester tester, String name) async {
  await tester.pumpAndSettle();
  final boundary =
      _shot.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 2);
    final png = await image.toByteData(format: ui.ImageByteFormat.png);
    File('$_outDir/$name.png')
      ..createSync(recursive: true)
      ..writeAsBytesSync(png!.buffer.asUint8List());
  });
}

/// Drags the page on top up by [dy].
Future<void> _scroll(WidgetTester tester, double dy) async {
  await tester.dragFrom(const Offset(215, 700), Offset(0, -dy));
  await tester.pumpAndSettle();
}

// ------------------------------------------------------------------ data

String _at(int day, int hour, int minute) =>
    '2026-09-${day.toString().padLeft(2, '0')}T'
    '${hour.toString().padLeft(2, '0')}:${minute.toString().padLeft(2, '0')}'
    ':00+02:00';

JobRecord _job(
  String id,
  String merchant,
  String status,
  String reference, {
  required int day,
  required Map<String, Object?> address,
}) => JobRecord(
  id: id,
  reference: reference,
  status: status,
  assignedToMe: true,
  bankId: 'b1',
  data: {
    'id': id,
    'reference': reference,
    'status': status,
    'merchant_name': merchant,
    'scheduled_start': _at(day, 9, 0),
    'scheduled_end': _at(day, 13, 0),
    'address': address,
    'bank': const {'name': 'Test Bank (QA)'},
    'location': const {'lat': -26.2041, 'lng': 28.0473},
    'onsite_contact': const {
      'name': 'Thandi Mokoena',
      'role': 'Owner',
      'phone': '+27821230000',
    },
    'mcc': const {'description': 'Grocery stores and supermarkets'},
  },
);

final List<JobRecord> _jobs = [
  _job(
    'j1',
    'Braam Coffee Co.',
    'in_progress',
    'POS-2026-000031',
    day: 15,
    address: const {
      'line1': '41 De Korte St',
      'suburb': 'Braamfontein',
      'city': 'Johannesburg',
      'province': 'Gauteng',
      'postal_code': '2001',
    },
  ),
  _job(
    'j2',
    "Mama Joy's Spaza",
    'assigned',
    'POS-2026-000114',
    day: 16,
    address: const {
      'line1': '1 Commissioner St',
      'suburb': 'Marshalltown',
      'city': 'Johannesburg',
      'province': 'Gauteng',
      'postal_code': '2001',
    },
  ),
  _job(
    'j3',
    'Orlando Car Wash',
    'accepted',
    'POS-2026-000120',
    day: 17,
    address: const {
      'line1': '12 Vilakazi St',
      'suburb': 'Orlando West',
      'city': 'Soweto',
      'postal_code': '1804',
    },
  ),
  _job(
    'j4',
    'Vilakazi Pharmacy',
    'returned',
    'POS-2026-000126',
    day: 18,
    address: const {
      'line1': '8 Vilakazi St',
      'suburb': 'Orlando West',
      'city': 'Soweto',
      'postal_code': '1804',
    },
  ),
];

const List<Object?> _activeStatuses = [
  'assigned',
  'accepted',
  'in_progress',
  'paused',
  'returned',
];

/// The views as the seed publishes them (supabase/seed/20_definitions.sql).
const Map<String, Map<String, Object?>> _views = {
  'home': {
    'items': [
      {'type': 'greeting', 'text': 'Hi {{agent.first_name}}'},
      {
        'type': 'agent_card_summary',
        'on_tap': {'page': 'agent_card'},
      },
      {
        'type': 'stat_row',
        'tiles': [
          {
            'type': 'stat_tile',
            'label': 'Active',
            'source': 'server',
            'stat': 'stats.active',
            'on_tap': {'page': 'active_jobs'},
          },
          {
            'type': 'stat_tile',
            'label': 'Due today',
            'source': 'server',
            'stat': 'stats.due_today',
          },
          {
            'type': 'stat_tile',
            'label': 'Awaiting review',
            'source': 'server',
            'stat': 'stats.awaiting_review',
          },
          {
            'type': 'stat_tile',
            'label': 'Completed this month',
            'source': 'server',
            'stat': 'stats.completed_this_month',
          },
        ],
      },
      {'type': 'section_title', 'text': 'Your leads'},
      {
        'type': 'job_list',
        'filter': {
          'in': [
            {'var': 'job.status'},
            _activeStatuses,
          ],
        },
        'sort': 'job.scheduled_start',
        'item_view': 'job_card',
        'on_tap': {'page': 'job_detail'},
        'empty_content': 'jobs.empty_active',
      },
      {'type': 'sync_status'},
    ],
  },
  'job_card': {
    'items': [
      {'type': 'title', 'bind': 'job.merchant_name'},
      {'type': 'status_chip', 'bind': 'job.status'},
      {
        'type': 'badge',
        'text': 'Ready offline',
        'tone': 'success',
        'visible': {
          '==': [
            {'var': 'job.offline_ready'},
            true,
          ],
        },
      },
      {'type': 'field_value', 'label': 'Ref', 'bind': 'job.reference'},
      {'type': 'schedule_window', 'bind': 'job.scheduled'},
      {'type': 'address_block', 'bind': 'job.address'},
    ],
  },
  'job_detail': {
    'items': [
      {'type': 'title', 'bind': 'job.merchant_name'},
      {'type': 'status_chip', 'bind': 'job.status'},
      {'type': 'field_value', 'label': 'Reference', 'bind': 'job.reference'},
      {'type': 'field_value', 'label': 'Bank', 'bind': 'job.bank.name'},
      {
        'type': 'schedule_window',
        'label': 'Visit window',
        'bind': 'job.scheduled',
      },
      {'type': 'address_block', 'label': 'Address', 'bind': 'job.address'},
      {'type': 'map_preview', 'bind': 'job.location', 'height': 180},
      {
        'type': 'contact',
        'label': 'On-site contact',
        'bind': 'job.onsite_contact',
        'actions': ['call'],
      },
      {
        'type': 'field_value',
        'label': 'Category',
        'bind': 'job.mcc.description',
      },
      {'type': 'divider'},
      {
        'type': 'job_card',
        'show_photo': true,
        'show_qr': true,
        'show_status': true,
      },
    ],
  },
  'agent_card': {
    'items': [
      {
        'type': 'agent_card',
        'show_photo': true,
        'show_qr': true,
        'show_status': true,
      },
      {
        'type': 'markdown',
        'text':
            'Show this card to the merchant. Scanning the code confirms '
            'you are an authorised Fidelity POS agent.',
      },
    ],
  },
};

const Map<String, Object?> _tabsApp = {
  'home': 'home',
  'navigation': {
    'style': 'bottom_tabs',
    'items': [
      {'label': 'Home', 'icon': 'home', 'page': 'home'},
      {'label': 'Leads', 'icon': 'list', 'page': 'active_jobs'},
      {'label': 'Card', 'icon': 'badge', 'page': 'agent_card'},
    ],
  },
  'pages': {
    'home': {'type': 'view_page', 'view': 'home', 'title': 'POS verification'},
    'active_jobs': {
      'type': 'list_page',
      'title': 'Active leads',
      'source': 'jobs',
      'filter': {
        'in': [
          {'var': 'job.status'},
          _activeStatuses,
        ],
      },
      'sort': 'job.scheduled_start',
      'item_view': 'job_card',
      'on_tap': {'page': 'job_detail'},
    },
    'job_detail': {'type': 'view_page', 'view': 'job_detail'},
    'agent_card': {
      'type': 'view_page',
      'view': 'agent_card',
      'title': 'My authorisation card',
    },
  },
};

const Map<String, Object?> _agent = {
  'first_name': 'Gugu',
  'last_name': 'Dlamini',
  'employee_number': 'SEED-AG01',
  'role': 'pos_agent',
};

CardToken _card() => CardToken(
  token: 'f' * 32,
  validTo: DateTime.now().add(const Duration(hours: 20)),
);

class _FakeActions implements JobActions {
  @override
  Future<JobActionResult> record(
    JobRecord job,
    JobAction action, {
    ReasonSubmission? reason,
  }) async => const JobActionResult.recorded('env-1');

  @override
  Future<void> sendNow() async {}

  @override
  Stream<DeliveryState> watchDelivery(String envelopeId) =>
      Stream.value(DeliveryState.waiting);
}

List<Override> _common({Map<String, Object?>? app}) => [
  myJobsProvider.overrideWith((ref) => Stream.value(_jobs)),
  jobProvider.overrideWith(
    (ref, id) => Stream.value(_jobs.where((j) => j.id == id).firstOrNull),
  ),
  agentProvider.overrideWith((ref) => Stream.value(_agent)),
  agentTotalsProvider.overrideWith(
    (ref) => Stream.value(const {
      'active': 4,
      'due_today': 1,
      'awaiting_review': 5,
      'completed_this_month': 2,
    }),
  ),
  agentCardProvider.overrideWith((ref) => Stream.value(_card())),
  jobCardProvider.overrideWith((ref, id) => Stream.value(_card())),
  verifyUrlProvider.overrideWithValue(
    (token) => Uri.parse('https://pos.test/v1/public/verify/$token'),
  ),
  syncStatusProvider.overrideWith(
    (ref) => Stream.value(
      const OutboxStatus(
        queued: 0,
        inFlight: 0,
        durable: 0,
        needsAttention: 0,
        committed: 12,
      ),
    ),
  ),
  syncingProvider.overrideWith((ref) => Stream.value(false)),
  offlineReadyJobsProvider.overrideWith((ref) => Stream.value({'j1', 'j3'})),
  powerStatusProvider.overrideWith(
    (ref) async =>
        const PowerStatus(batteryOptimised: false, backgroundRestricted: false),
  ),
  lostStoresProvider.overrideWith((ref) => Stream.value(const <LostStore>[])),
  jobActionsProvider.overrideWith((ref) async => _FakeActions()),
  inspectionsProvider.overrideWith((ref) async => null),
  platformServicesProvider.overrideWithValue(fakePlatform()),
  activeDefinitionProvider.overrideWith(
    (ref, key) => Stream.value(switch (key.kind) {
      'app' => app ?? _tabsApp,
      'view' => _views[key.key],
      _ => null,
    }),
  ),
];

// ------------------------------------------------------------ the form

class _FakeSubmissions implements FormSubmissions {
  final StreamController<DeliveryState> delivery = StreamController.broadcast();

  @override
  Future<JobActionResult> submit(FormSubmission submission) async =>
      const JobActionResult.recorded('env-1');

  @override
  Future<void> sendNow() async {}

  @override
  Stream<DeliveryState> watchDelivery(String envelopeId) => delivery.stream;
}

const Map<String, Object?> _visitForm = {
  'sections': [
    {
      'key': 'visit',
      'title': 'Who you met',
      'description': 'Tell us who showed you around the business.',
      'fields': [
        {
          'key': 'spoke_to',
          'type': 'text',
          'label': 'Name of the person you spoke to',
          'required': true,
          'props': {'placeholder': 'Full name'},
        },
        {'key': 'phone', 'type': 'phone', 'label': 'Their phone number'},
        {
          'key': 'role',
          'type': 'single_select',
          'display': 'dropdown',
          'label': 'Their role',
          'options': [
            {'value': 'owner', 'label': 'Owner'},
            {'value': 'manager', 'label': 'Manager'},
            {'value': 'staff', 'label': 'Staff member'},
          ],
        },
      ],
    },
    {
      'key': 'premises',
      'title': 'The premises',
      'fields': [
        {
          'key': 'tip',
          'type': 'callout',
          'tone': 'info',
          'text': 'Check the card machine before you answer.',
        },
        {
          'key': 'trading',
          'type': 'boolean',
          'label': 'Is the business trading today?',
          'required': true,
        },
        {
          'key': 'remarks',
          'type': 'textarea',
          'label': 'Anything else the office should know?',
          'props': {'rows': 3},
        },
      ],
    },
  ],
};

const Map<String, Object?> _formApp = {
  'home': 'home',
  'pages': {
    'home': {'type': 'view_page', 'view': 'home'},
    'done_success': {
      'type': 'outcome_page',
      'outcome': 'success',
      'title': 'Sent to the office',
      'message': '{{job.reference}} is with the office. Nothing more to do.',
      'buttons': [
        {'label': 'Back to home', 'action': 'home'},
      ],
    },
    'done_saved': {
      'type': 'outcome_page',
      'outcome': 'saved',
      'title': 'Saved on your phone',
      'message': 'It sends by itself as soon as you have signal.',
      'buttons': [
        {'label': 'Back to home', 'action': 'home'},
        {'label': 'Try sending again', 'action': 'back'},
      ],
    },
    'done_failure': {'type': 'outcome_page', 'outcome': 'failure'},
  },
  'outcome_sets': {
    'default': {
      'success': 'done_success',
      'saved': 'done_saved',
      'failure': 'done_failure',
    },
  },
};

// ----------------------------------------------------------------- tests

void main() {
  setUpAll(() async {
    if (_skip) return;
    TestWidgetsFlutterBinding.ensureInitialized();
    await _loadFonts();
  });

  testWidgets('home, the lead list, a job, the card', skip: _skip, (
    tester,
  ) async {
    _phone(tester);
    await tester.pumpWidget(_app(_common(), const PosRouter()));
    await _save(tester, 'u1-01-home');
    await _scroll(tester, 520);
    await _save(tester, 'u1-02-home-scrolled');

    await tester.tap(find.text('Leads'));
    await _save(tester, 'u1-03-leads');

    await tester.tap(find.text("Mama Joy's Spaza").last);
    await _save(tester, 'u1-04-job');
    await _scroll(tester, 640);
    await _save(tester, 'u1-05-job-scrolled');
    await _scroll(tester, 900);
    await _save(tester, 'u1-06-job-card');

    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Card'));
    await _save(tester, 'u1-07-card');
  });

  testWidgets('needs attention, with the battery card', skip: _skip, (
    tester,
  ) async {
    _phone(tester);
    await tester.pumpWidget(
      _app([
        activeDefinitionProvider.overrideWith((ref, key) => Stream.value(null)),
        needsAttentionProvider.overrideWith(
          (ref) => Stream.value(const [
            AttentionItem(
              id: 'env-1',
              type: 'submission',
              createdAt: '2026-09-14T10:00:00.000+02:00',
              reason: 'VALIDATION_FAILED',
            ),
            AttentionItem(
              id: 'env-2',
              type: 'evidence_uploaded',
              createdAt: '2026-09-14T10:05:00.000+02:00',
            ),
          ]),
        ),
        lostStoresProvider.overrideWith(
          (ref) => Stream.value(const <LostStore>[]),
        ),
        platformServicesProvider.overrideWithValue(
          fakePlatform(
            power: FakePowerRestrictions(
              const PowerStatus(batteryOptimised: true),
            ),
          ),
        ),
      ], const NeedsAttentionPage()),
    );
    await _save(tester, 'u1-08-attention');
  });

  testWidgets('a form page, its checks, and its outcomes', skip: _skip, (
    tester,
  ) async {
    _phone(tester);
    final submissions = _FakeSubmissions();
    await tester.pumpWidget(
      _app(
        [
          ..._common(app: _formApp),
          activeDefinitionVersionProvider.overrideWith(
            (ref, key) => Stream.value(
              key.kind == 'form'
                  ? ActiveDefinition(
                      versionId: 'v-1',
                      hash: 'h' * 64,
                      body: _visitForm,
                    )
                  : null,
            ),
          ),
          formSubmissionsProvider.overrideWith((ref) async => submissions),
        ],
        const RecordFormPage(
          page: AppPage('visit_notes', {
            'type': 'form_page',
            'title': 'Visit notes',
            'form': 'visit_notes',
            'action': 'record.submit',
            'subject': 'job',
            'outcomes': 'default',
          }),
          jobId: 'j1',
        ),
      ),
    );
    await _save(tester, 'u1-09-form');

    await tester.tap(find.byKey(const ValueKey('record-form-submit')));
    await tester.pumpAndSettle();
    await _save(tester, 'u1-10-form-checks');

    await tester.enterText(find.byType(TextField).first, 'Thandi Mokoena');
    await tester.ensureVisible(find.text('Yes').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Yes').first);
    await tester.pumpAndSettle();
    await _save(tester, 'u1-11-form-filled');
    await tester.tap(find.byKey(const ValueKey('record-form-submit')));
    await tester.pumpAndSettle();
    await _save(tester, 'u1-12-outcome-saved');

    submissions.delivery.add(DeliveryState.delivered);
    await tester.pumpAndSettle();
    await _save(tester, 'u1-13-outcome-success');
  });
}
