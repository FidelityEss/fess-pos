import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

/// Whether the module may read the device location.
enum LocationAccess {
  always,
  whileInUse,
  denied,
  deniedForever,

  /// Location services are switched off on the device.
  serviceDisabled,
  unknown;

  bool get granted => this == always || this == whileInUse;

  static LocationAccess fromPermission(LocationPermission p) => switch (p) {
    LocationPermission.always => always,
    LocationPermission.whileInUse => whileInUse,
    LocationPermission.denied => denied,
    LocationPermission.deniedForever => deniedForever,
    LocationPermission.unableToDetermine => unknown,
  };
}

/// One location fix, as the device reported it. The geofence engine (T4-07)
/// judges it; this layer only reports.
///
/// Coordinates are personal data: they never appear in [toString] or logs.
@immutable
class LocationFix {
  const LocationFix({
    required this.latitude,
    required this.longitude,
    required this.accuracyM,
    required this.fixTime,
    this.altitudeM,
    this.altitudeAccuracyM,
    this.headingDeg,
    this.speedMps,
    this.isMocked,
  });

  factory LocationFix.fromPosition(Position p, {required bool web}) =>
      LocationFix(
        latitude: p.latitude,
        longitude: p.longitude,
        accuracyM: p.accuracy,
        fixTime: p.timestamp,
        altitudeM: p.hasAltitude ? p.altitude : null,
        altitudeAccuracyM: p.hasAltitudeAccuracy ? p.altitudeAccuracy : null,
        headingDeg: p.hasHeading ? p.heading : null,
        speedMps: p.hasSpeed ? p.speed : null,
        // Browsers can't detect a mocked location (docs/13 §8): unknown, not
        // "clean".
        isMocked: web ? null : p.isMocked,
      );

  final double latitude;
  final double longitude;

  /// Horizontal accuracy radius in metres.
  final double accuracyM;

  /// When the fix was taken, by the location provider's clock (GNSS time
  /// where the platform supplies it; docs/07 §6, "three clocks").
  final DateTime fixTime;

  final double? altitudeM;
  final double? altitudeAccuracyM;
  final double? headingDeg;
  final double? speedMps;

  /// Whether the platform flagged the fix as mocked; null when it can't tell.
  final bool? isMocked;

  @override
  String toString() => 'LocationFix(±${accuracyM.round()} m)';
}

abstract interface class LocationProvider {
  Future<LocationAccess> access();

  Future<LocationAccess> requestAccess();

  Future<LocationFix> currentFix({Duration? timeLimit});

  /// A stream of fixes, roughly every [interval].
  Stream<LocationFix> fixes({required Duration interval});
}

/// geolocator, on Android, iOS and the web. Foreground only: background
/// location isn't needed and isn't requested.
class GeolocatorLocationProvider implements LocationProvider {
  const GeolocatorLocationProvider();

  @override
  Future<LocationAccess> access() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return LocationAccess.serviceDisabled;
    }
    return LocationAccess.fromPermission(await Geolocator.checkPermission());
  }

  @override
  Future<LocationAccess> requestAccess() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return LocationAccess.serviceDisabled;
    }
    return LocationAccess.fromPermission(await Geolocator.requestPermission());
  }

  @override
  Future<LocationFix> currentFix({Duration? timeLimit}) async =>
      LocationFix.fromPosition(
        await Geolocator.getCurrentPosition(
          locationSettings: _settings(timeLimit: timeLimit),
        ),
        web: kIsWeb,
      );

  @override
  Stream<LocationFix> fixes({required Duration interval}) =>
      Geolocator.getPositionStream(
        locationSettings: _settings(interval: interval),
      ).map((p) => LocationFix.fromPosition(p, web: kIsWeb));

  static LocationSettings _settings({Duration? interval, Duration? timeLimit}) {
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      return AndroidSettings(
        intervalDuration: interval,
        timeLimit: timeLimit,
      );
    }
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
      return AppleSettings(
        timeLimit: timeLimit,
        // The host declares no background location mode (findings/03 §7).
        allowBackgroundLocationUpdates: false,
      );
    }
    return LocationSettings(timeLimit: timeLimit);
  }
}
