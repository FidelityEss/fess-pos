// Signs in to QA from a real device, through the public API only, as a host
// would: secure storage, device details and the POS API are all real.
// Skipped without the harness defines:
//
//   flutter test integration_test/qa_sign_in_test.dart -d <device> \
//     --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json
//
// QA only. It registers the device and a session for the QA agent.
import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos_example/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final identity = harnessIdentity();

  testWidgets('sign in to QA, again, then sign out', (tester) async {
    expect(
      const String.fromEnvironment('POS_ENVIRONMENT'),
      'qa',
      reason: 'QA only, never production',
    );
    await PosModule.initialize(PosHostConfig(bootstrap: harnessBootstrap()));

    expect((await PosModule.signIn(identity!)).visible, isTrue);
    // Every sign-in re-runs the exchange, with the same device id.
    expect((await PosModule.signIn(identity)).visible, isTrue);

    await PosModule.signOut();
    expect((await PosModule.access()).reason, PosAccessReason.notSignedIn);
  }, skip: identity == null);
}
