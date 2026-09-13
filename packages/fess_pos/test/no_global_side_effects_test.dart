// T1-18: the module installs no global side effects (docs/03 §3,
// docs/DEVELOPMENT-GUIDELINES.md §2). This test starts the module with a
// Sentry DSN configured, signs in, and opens and leaves the entry point
// inside a host that has no ProviderScope, then checks every global a
// careless module could have changed.

import 'dart:ui';

import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sentry/sentry.dart';

import 'support/test_host.dart';

void main() {
  tearDown(ModuleRuntime.reset);

  testWidgets('initialise, sign in, open and leave: no globals touched', (
    tester,
  ) async {
    final flutterOnError = FlutterError.onError;
    final platformOnError = PlatformDispatcher.instance.onError;
    final errorWidgetBuilder = ErrorWidget.builder;
    final debugPrintBefore = debugPrint;
    expect(Sentry.isEnabled, isFalse);

    late ModuleRuntime runtime;
    await tester.runAsync(() async {
      runtime = await startTestRuntime(
        cachedSnapshot: BootstrapSnapshot.fromResolvedConfig(const {
          'observability': {
            'sentry_dsn': 'https://public@sentry.example.invalid/1',
          },
        }).toCacheJson(),
      );
      await PosModule.signIn(testIdentity());
    });
    expect(runtime.observability.enabled, isTrue, reason: 'own hub built');

    // A plain host: no ProviderScope anywhere above the module.
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: ElevatedButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => PosModule.entryPoint()),
              ),
              child: const Text('open POS'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open POS'));
    await tester.pumpAndSettle();
    expect(find.text(BundledCopy.text('shell.placeholder')), findsOneWidget);

    // The back button leaves the module by popping the host's route.
    await tester.tap(find.byTooltip(BundledCopy.text('shell.back')));
    await tester.pumpAndSettle();
    expect(find.text('open POS'), findsOneWidget);

    expect(identical(FlutterError.onError, flutterOnError), isTrue);
    expect(
      identical(PlatformDispatcher.instance.onError, platformOnError),
      isTrue,
    );
    expect(identical(ErrorWidget.builder, errorWidgetBuilder), isTrue);
    expect(identical(debugPrint, debugPrintBefore), isTrue);
    expect(
      Sentry.isEnabled,
      isFalse,
      reason: 'the app-wide Sentry hub belongs to the host',
    );
  });

  testWidgets('the entry point copes with an uninitialised module', (
    tester,
  ) async {
    await tester.pumpWidget(MaterialApp(home: PosModule.entryPoint()));
    expect(
      find.text(BundledCopy.text('shell.not_initialized')),
      findsOneWidget,
    );
  });

  testWidgets('the kill switch shows the unavailable message', (tester) async {
    await tester.runAsync(
      () => startTestRuntime(
        cachedSnapshot: BootstrapSnapshot.fromResolvedConfig(const {
          'pos': {'enabled': false},
        }).toCacheJson(),
      ),
    );
    await tester.pumpWidget(MaterialApp(home: PosModule.entryPoint()));
    expect(find.text(BundledCopy.text('shell.unavailable')), findsOneWidget);
  });
}
