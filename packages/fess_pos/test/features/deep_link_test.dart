import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/features/cards/agent_card_page.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/test_host.dart';

const String _job = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

String _copy(String key) => BundledCopy.text(key);

/// Starts the module signed in, with the local store open outside the fake
/// clock.
Future<void> _start(WidgetTester tester) => tester.runAsync(() async {
  final runtime = await startTestRuntime();
  await PosModule.signIn(testIdentity());
  await runtime.localStore();
});

Future<void> _openPos(WidgetTester tester) async {
  await tester.pumpWidget(
    MaterialApp(home: Builder(builder: (_) => PosModule.entryPoint())),
  );
  await tester.pumpAndSettle();
}

void main() {
  tearDown(ModuleRuntime.reset);

  testWidgets('a link while POS is open opens its page', (tester) async {
    await _start(tester);
    await _openPos(tester);
    expect(find.byType(JobsHomePage), findsOneWidget);

    await PosModule.handleDeepLink(Uri.parse('fess://pos/card'));
    await tester.pumpAndSettle();
    expect(find.byType(AgentCardPage), findsOneWidget);

    await PosModule.handleDeepLink(Uri.parse('fess://pos/job/$_job'));
    await tester.pumpAndSettle();
    expect(find.byType(JobDetailPage), findsOneWidget);
    expect(
      find.text(_copy('jobs.not_found')),
      findsOneWidget,
      reason: 'not on the phone yet; the page fills when a sync brings it',
    );

    await PosModule.handleDeepLink(Uri.parse('fess://pos'));
    await tester.pumpAndSettle();
    expect(find.byType(JobDetailPage), findsNothing);
    expect(find.byType(JobsHomePage), findsOneWidget);
    await tester.runAsync(ModuleRuntime.reset);
  });

  testWidgets('a link forwarded before POS opens is opened with it', (
    tester,
  ) async {
    await _start(tester);
    await PosModule.handleDeepLink(Uri.parse('fidelity://fess.com/pos/card'));
    await _openPos(tester);
    expect(find.byType(AgentCardPage), findsOneWidget);
    await tester.runAsync(ModuleRuntime.reset);
  });

  testWidgets('signed out, a link waits and opens nothing', (tester) async {
    await tester.runAsync(() async {
      final runtime = await startTestRuntime();
      await runtime.localStore();
    });
    await PosModule.handleDeepLink(Uri.parse('fess://pos/card'));
    await _openPos(tester);
    expect(find.byType(AgentCardPage), findsNothing);
    expect(find.text(_copy('shell.not_signed_in')), findsOneWidget);
    await tester.runAsync(ModuleRuntime.reset);
  });
}
