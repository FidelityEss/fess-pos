import 'package:fess_pos_example/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('the harness opens the module entry point', (tester) async {
    await tester.pumpWidget(const HarnessApp());
    await tester.pumpAndSettle();
    expect(find.textContaining('fess_pos '), findsOneWidget);
    expect(find.text('access: notInitialized'), findsOneWidget);

    await tester.tap(find.text('Open POS'));
    await tester.pumpAndSettle();
    // Not initialised in this test: the module says so instead of failing.
    expect(
      find.text('POS verification is not set up in this app.'),
      findsOneWidget,
    );
  });
}
