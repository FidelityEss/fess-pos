import 'dart:async';

import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/preview/preview_scope.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/domain/preview/preview_request.dart';
import 'package:fess_pos/src/features/inspections/inspection_page.dart'
    show formCompilerProvider;
import 'package:fess_pos/src/features/preview/preview_entry.dart';
import 'package:fess_pos/src/features/preview/preview_link_page.dart';
import 'package:fess_pos/src/features/preview/preview_sandbox.dart';
import 'package:fess_pos/src/platform/preview/preview_bridge.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show compileForm;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';

class _FakeBridge implements PreviewBridge {
  final StreamController<Map<String, Object?>> incoming =
      StreamController.broadcast();
  final List<Map<String, Object?>> sent = [];
  bool closed = false;

  @override
  Stream<Map<String, Object?>> get messages => incoming.stream;

  @override
  void send(Map<String, Object?> message) => sent.add(message);

  @override
  void close() => closed = true;
}

class _FakeDrafts implements PreviewDrafts {
  _FakeDrafts(this.request);

  final PreviewRequest? request;
  final List<String> asked = [];

  @override
  Future<PreviewRequest?> fetch(String token) async {
    asked.add(token);
    return request;
  }
}

const Map<String, Object?> _context = {
  'today': '2026-09-15',
  'job': {
    'id': '00000000-0000-4000-8000-000000000042',
    'reference': 'POS-2026-000042',
    'status': 'assigned',
    'merchant_name': "Mama Joy's Spaza",
  },
  'agent': {'first_name': 'Gugu'},
  'stats': {'due_today': 1},
};

const Map<String, Object?> _views = {
  'home': {
    'items': [
      {'type': 'greeting', 'text': 'Hi {{agent.first_name}}'},
      {
        'type': 'job_list',
        'item_view': 'job_card',
        'on_tap': {'page': 'job_detail'},
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
};

const Map<String, Object?> _app = {
  'kind': 'app',
  'family': 'agent_app',
  'home': 'home',
  'navigation': {
    'style': 'bottom_tabs',
    'items': [
      {'label': 'Home', 'page': 'home'},
      {'label': 'Card', 'page': 'agent_card'},
    ],
  },
  'pages': {
    'home': {'type': 'view_page', 'view': 'home'},
    'agent_card': {'type': 'view_page', 'view': 'agent_card'},
    'job_detail': {'type': 'view_page', 'view': 'job_detail'},
  },
};

const Map<String, Object?> _safetyForm = {
  'kind': 'form',
  'family': 'site_safety',
  'sections': [
    {
      'key': 's',
      'fields': [
        {
          'key': 'hazards',
          'type': 'text',
          'label': 'Hazards seen',
          'required': true,
        },
      ],
    },
  ],
};

const Map<String, Object?> _flow = {
  'kind': 'flow',
  'family': 'safety_flow',
  'form_family': 'site_safety',
  'steps': [
    {'type': 'location_check'},
    {
      'type': 'form',
      'sections': ['s'],
    },
    {'type': 'submit', 'label': 'Send'},
  ],
};

PreviewRequest _preview(String kind, Map<String, Object?> definition) =>
    PreviewRequest(
      kind: kind,
      definition: definition,
      bundle: const {'views': _views},
      context: _context,
    );

Widget _sandbox(PreviewRequest request) => MaterialApp(
  home: PreviewSandbox(request: request, platform: fakePlatform()),
);

void main() {
  testWidgets('an app draft runs as the agent would see it, with the '
      'sample agent and job (T3-08)', (tester) async {
    await tester.pumpWidget(_sandbox(_preview('app', _app)));
    await tester.pumpAndSettle();
    expect(find.text('Hi Gugu'), findsOneWidget);
    expect(find.byType(BottomNavigationBar), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (w) => w is Banner && w.message == BundledCopy.text('preview.label'),
      ),
      findsOneWidget,
      reason: 'marked as a preview',
    );

    await tester.tap(find.text("Mama Joy's Spaza"));
    await tester.pumpAndSettle();
    expect(find.text('POS-2026-000042'), findsOneWidget);
  });

  testWidgets('a form draft can be filled in and sent, and nothing is '
      'recorded', (tester) async {
    await tester.pumpWidget(
      _sandbox(
        _preview('form', {
          'kind': 'form',
          'family': 'site_safety',
          'sections': [
            {
              'key': 's',
              'fields': [
                {
                  'key': 'hazards',
                  'type': 'text',
                  'label': 'Hazards seen',
                  'required': true,
                },
              ],
            },
          ],
        }),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Hazards seen *'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'None');
    await tester.tap(find.byKey(const ValueKey('record-form-submit')));
    await tester.pumpAndSettle();
    expect(
      find.text(BundledCopy.text('outcome.success.title')),
      findsOneWidget,
    );
  });

  testWidgets('a flow draft walks through its questions, kept in memory '
      'only (T3-12)', (tester) async {
    const request = PreviewRequest(
      kind: 'flow',
      definition: _flow,
      bundle: {
        'views': _views,
        'forms': {'site_safety': _safetyForm},
      },
      context: _context,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: PreviewSandbox(
          request: request,
          platform: fakePlatform(),
          testOverrides: [
            formCompilerProvider.overrideWithValue(
              (form) async => compileForm(form),
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    // It opens at once, on the first page after the location check, which
    // a preview has nothing to judge by.
    expect(find.byKey(const ValueKey('inspection-step-0')), findsOneWidget);
    expect(find.text('Hazards seen *'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'None');
    await tester.pumpAndSettle();

    // Back: the flow can be walked again from the start.
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('preview-flow-intro')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('preview-flow-start')));
    await tester.pumpAndSettle();
    expect(find.text('None'), findsOneWidget, reason: 'the draft is kept');
  });

  testWidgets("a flow draft without its questions says it can't be walked "
      'through', (tester) async {
    await tester.pumpWidget(_sandbox(_preview('flow', _flow)));
    await tester.pumpAndSettle();
    expect(
      find.text(BundledCopy.text('preview.flow_unavailable')),
      findsOneWidget,
    );
    expect(previewProblems(_preview('flow', _flow)), [
      contains("questions (site_safety) aren't in the preview"),
    ]);
    expect(
      previewProblems(
        _preview('flow', const {'kind': 'flow', 'family': 'f', 'steps': []}),
      ),
      [contains("doesn't name its questions")],
    );
  });

  test('a preview names its definitions by preview version ids, and takes '
      'the look being tried', () {
    final request = PreviewRequest.fromJson({
      'kind': 'flow',
      'definition': _flow,
      'bundle': {
        'forms': {'site_safety': _safetyForm},
        'declarations': {
          'agent_declaration': {'title': 'I declare', 'text': 'All true.'},
        },
      },
      'theme': {'primary_color': '#123456', 'font_family': 'Roboto'},
    })!;
    expect(
      request.definitionOfVersion(previewVersionId('form', 'site_safety')),
      _safetyForm,
    );
    expect(
      request.definitionOfVersion(previewVersionId('flow', 'safety_flow')),
      _flow,
    );
    expect(request.definitionOfVersion('0192d4e0-real-version'), isNull);
    final declaration = previewDeclaration(request, 'agent_declaration');
    expect(declaration?.text, 'All true.');
    expect(declaration?.title, 'I declare');
    final brand = previewBrand(request);
    expect(brand.primary, const Color(0xFF123456));
    expect(brand.fontFamily, 'Roboto');
    expect(
      previewBrand(_preview('app', _app)).primary,
      PosBrand.resolve().primary,
      reason: 'no theme: the brand',
    );
  });

  testWidgets('a new request starts the preview afresh, even with a '
      "flow's inspection open", (tester) async {
    Widget sandbox(PreviewRequest request) => MaterialApp(
      home: PreviewSandbox(
        request: request,
        platform: fakePlatform(),
        testOverrides: [
          formCompilerProvider.overrideWithValue(
            (form) async => compileForm(form),
          ),
        ],
      ),
    );
    // A new object each time, as each message from the studio is.
    PreviewRequest flow() => PreviewRequest(
      kind: 'flow',
      definition: _flow,
      bundle: const {
        'forms': {'site_safety': _safetyForm},
      },
      context: Map.of(_context),
    );
    await tester.pumpWidget(sandbox(flow()));
    await tester.pumpAndSettle();
    expect(find.text('Hazards seen *'), findsOneWidget);

    // The studio sends the draft again, e.g. after an edit.
    await tester.pumpWidget(sandbox(flow()));
    await tester.pumpAndSettle();
    expect(find.text('Hazards seen *'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('the preview app says it is ready, draws what the studio '
      'sends and answers with what it found', (tester) async {
    final bridge = _FakeBridge();
    await tester.pumpWidget(
      MaterialApp(
        home: PosPreviewEntry(bridge: bridge, platform: fakePlatform()),
      ),
    );
    expect(bridge.sent.single['type'], previewReady);
    expect(
      (bridge.sent.single['capabilities']! as Map)['page_types'],
      containsPair('list_page', 1),
    );
    expect(find.byKey(const ValueKey('preview-waiting')), findsOneWidget);

    bridge.incoming.add({
      'type': previewRender,
      'version': 1,
      'request': {
        'kind': 'app',
        'definition': _app,
        'bundle': {'views': _views},
        'context': _context,
      },
    });
    await tester.pumpAndSettle();
    expect(find.text('Hi Gugu'), findsOneWidget);
    expect(bridge.sent.last, {
      'type': previewRendered,
      'version': 1,
      'ok': true,
      'problems': <String>[],
    });

    bridge.incoming.add({
      'type': previewRender,
      'request': {
        'kind': 'app',
        'definition': {..._app, 'home': 'nowhere'},
      },
    });
    await tester.pumpAndSettle();
    expect(bridge.sent.last['ok'], isFalse);
    expect(bridge.sent.last['problems'], [contains('home nowhere')]);

    bridge.incoming.add({'type': previewRender, 'request': 'junk'});
    await tester.pump();
    expect(bridge.sent.last['ok'], isFalse);

    await tester.pumpWidget(const SizedBox());
    expect(bridge.closed, isTrue);
  });

  testWidgets('a preview link draws its draft; an unknown one says so', (
    tester,
  ) async {
    Widget link(PreviewDrafts? drafts) => ProviderScope(
      overrides: [
        previewDraftsProvider.overrideWith((ref) async => drafts),
        platformServicesProvider.overrideWithValue(fakePlatform()),
        activeDefinitionProvider.overrideWith(
          (ref, key) => Stream.value(null),
        ),
      ],
      child: const MaterialApp(home: PreviewLinkPage(token: 'tok')),
    );
    final drafts = _FakeDrafts(_preview('app', _app));
    await tester.pumpWidget(link(drafts));
    await tester.pumpAndSettle();
    expect(drafts.asked, ['tok']);
    expect(find.text('Hi Gugu'), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(link(null));
    await tester.pumpAndSettle();
    expect(
      find.text(BundledCopy.text('preview.unavailable')),
      findsOneWidget,
    );
  });
}
