import 'package:meta/meta.dart';

/// What the phone does to hold the module's background work back (T5-02,
/// docs/12 §9): Android's battery optimisation and its background
/// restriction. Null where the phone can't say: iOS, the web, older
/// Android.
@immutable
class PowerStatus {
  const PowerStatus({this.batteryOptimised, this.backgroundRestricted});

  static const PowerStatus unknown = PowerStatus();

  /// Battery optimisation applies to the app: it isn't exempt.
  final bool? batteryOptimised;

  /// The user or the phone restricted the app's background activity.
  final bool? backgroundRestricted;

  /// Something can hold background sync back.
  bool get restricted =>
      (batteryOptimised ?? false) || (backgroundRestricted ?? false);

  @override
  bool operator ==(Object other) =>
      other is PowerStatus &&
      other.batteryOptimised == batteryOptimised &&
      other.backgroundRestricted == backgroundRestricted;

  @override
  int get hashCode => Object.hash(batteryOptimised, backgroundRestricted);
}
