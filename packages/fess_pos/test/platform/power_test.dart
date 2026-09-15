import 'package:fess_pos/src/domain/sync/power_status.dart';
import 'package:fess_pos/src/platform/power.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final messenger =
      TestWidgetsFlutterBinding.ensureInitialized().defaultBinaryMessenger;
  tearDown(
    () => messenger.setMockMethodCallHandler(
      ChannelPowerRestrictions.channel,
      null,
    ),
  );

  test("Android's answers become the power status (T5-02)", () async {
    messenger.setMockMethodCallHandler(
      ChannelPowerRestrictions.channel,
      (call) async => switch (call.method) {
        'status' => {'battery_optimised': true, 'background_restricted': null},
        'openSettings' => true,
        _ => null,
      },
    );
    const power = ChannelPowerRestrictions();
    final status = await power.status();
    expect(status, const PowerStatus(batteryOptimised: true));
    expect(status.restricted, isTrue);
    expect(await power.openSettings(), isTrue);
  });

  test('with no Android code to ask: unknown, never restricted', () async {
    const power = ChannelPowerRestrictions();
    expect(await power.status(), PowerStatus.unknown);
    expect(await power.openSettings(), isFalse);
    expect(PowerStatus.unknown.restricted, isFalse);
  });
}
