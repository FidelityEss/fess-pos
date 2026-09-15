import 'package:fess_pos/src/domain/sync/power_status.dart';
import 'package:flutter/services.dart';

/// Android's battery optimisation and background restriction, through the
/// module's own Android code (T5-02, D-95). The module asks for no
/// permission: the agent exempts the app in the phone's settings.
abstract interface class PowerRestrictions {
  Future<PowerStatus> status();

  /// Opens the phone's battery settings so the agent can exempt the app;
  /// false where there are none.
  Future<bool> openSettings();
}

/// `FessPosPlugin` in the module's `android/` code.
class ChannelPowerRestrictions implements PowerRestrictions {
  const ChannelPowerRestrictions();

  static const MethodChannel channel = MethodChannel('fess_pos/power');

  @override
  Future<PowerStatus> status() async {
    try {
      final map = await channel.invokeMapMethod<String, Object?>('status');
      return PowerStatus(
        batteryOptimised: map?['battery_optimised'] as bool?,
        backgroundRestricted: map?['background_restricted'] as bool?,
      );
    } on Object {
      // Can't tell: never reported as restricted, never as clear.
      return PowerStatus.unknown;
    }
  }

  @override
  Future<bool> openSettings() async {
    try {
      return await channel.invokeMethod<bool>('openSettings') ?? false;
    } on Object {
      return false;
    }
  }
}

/// Where the phone can't say: iOS, the web, and tests.
class UnavailablePowerRestrictions implements PowerRestrictions {
  const UnavailablePowerRestrictions();

  @override
  Future<PowerStatus> status() async => PowerStatus.unknown;

  @override
  Future<bool> openSettings() async => false;
}
