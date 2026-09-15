import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/sync/attention.dart';
import 'package:fess_pos/src/domain/sync/power_status.dart';
import 'package:fess_pos/src/features/shell/needs_attention_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';

void main() {
  Future<void> lifecycle(WidgetTester tester, AppLifecycleState state) =>
      tester.binding.defaultBinaryMessenger.handlePlatformMessage(
        SystemChannels.lifecycle.name,
        SystemChannels.lifecycle.codec.encodeMessage(state.toString()),
        (_) {},
      );

  testWidgets('battery settings that can hold sending back are explained, '
      'with the way to change them (T5-02)', (tester) async {
    final power = FakePowerRestrictions(
      const PowerStatus(batteryOptimised: true),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          activeDefinitionProvider.overrideWith(
            (ref, key) => Stream.value(null),
          ),
          needsAttentionProvider.overrideWith(
            (ref) => Stream.value(const <AttentionItem>[]),
          ),
          platformServicesProvider.overrideWithValue(
            fakePlatform(power: power),
          ),
        ],
        child: const MaterialApp(home: NeedsAttentionPage()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('attention-battery')), findsOneWidget);
    expect(find.text(BundledCopy.text('attention.none')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('attention-battery-open')));
    expect(power.settingsOpened, 1);

    // The agent exempts the app and comes back.
    power.current = const PowerStatus(
      batteryOptimised: false,
      backgroundRestricted: false,
    );
    await lifecycle(tester, AppLifecycleState.inactive);
    await lifecycle(tester, AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('attention-battery')), findsNothing);
    expect(find.text(BundledCopy.text('attention.none')), findsOneWidget);
  });
}
