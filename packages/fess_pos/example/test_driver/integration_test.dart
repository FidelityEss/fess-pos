// Driver for running the integration tests with `flutter drive`, e.g. in
// profile mode (CI, T1-02):
//
//   flutter drive --profile -d <device> \
//     --driver=test_driver/integration_test.dart \
//     --target=integration_test/local_store_test.dart
//
// Android release builds can't be driven; lib/self_check.dart covers them.
import 'package:integration_test/integration_test_driver.dart';

Future<void> main() => integrationDriver();
