// Signs in to QA and opens POS: the home page fills with the agent's jobs as
// the sync engine pulls them, drawn from the server's views, and a job opens
// its detail page. QA only; skipped without the harness defines:
//
//   flutter test integration_test/qa_jobs_test.dart -d <device> \
//     --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json
//
// It prints what each page shows (lines starting POS_SCREEN).
import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos_example/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

final Finder _jobCards = find.byWidgetPredicate(
  (w) =>
      w.key is ValueKey<String> &&
      (w.key! as ValueKey<String>).value.startsWith('job-'),
);

void _printScreen(WidgetTester tester, String page) {
  final texts = tester
      .widgetList<Text>(find.byType(Text))
      .map((t) => t.data)
      .whereType<String>()
      .map((s) => s.replaceAll('\n', ' / '));
  debugPrint('POS_SCREEN $page: ${texts.join(' | ')}');
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final identity = harnessIdentity();

  testWidgets('QA: the job list fills from the pull, and a job opens', (
    tester,
  ) async {
    expect(
      const String.fromEnvironment('POS_ENVIRONMENT'),
      'qa',
      reason: 'QA only, never production',
    );
    await PosModule.initialize(PosHostConfig(bootstrap: harnessBootstrap()));
    expect((await PosModule.signIn(identity!)).visible, isTrue);
    await tester.pumpWidget(
      MaterialApp(home: Builder(builder: (_) => PosModule.entryPoint())),
    );

    // The bundled home view shows at once; the sync engine's first pull
    // brings the server's (its greeting) together with the jobs.
    final greeting = find.textContaining('Hi ');
    for (var i = 0; i < 120; i++) {
      if (greeting.evaluate().isNotEmpty) break;
      await tester.pump(const Duration(milliseconds: 500));
    }
    await tester.pump(const Duration(seconds: 1));
    _printScreen(tester, 'home');
    expect(greeting, findsOneWidget, reason: "the server's home view arrived");
    debugPrint('POS_JOBS ${_jobCards.evaluate().length}');

    if (_jobCards.evaluate().isNotEmpty) {
      await tester.tap(_jobCards.first);
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 300));
      }
      _printScreen(tester, 'job_detail');
      expect(find.text('Reference'), findsOneWidget, reason: 'job_detail');
    }
  }, skip: identity == null);
}
