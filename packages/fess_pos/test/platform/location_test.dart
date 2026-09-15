import 'package:fess_pos/src/platform/location.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';

Position _position({bool isMocked = false, bool hasAltitude = true}) =>
    Position(
      longitude: 28.0473,
      latitude: -26.2041,
      timestamp: DateTime.utc(2026, 9, 13, 10),
      accuracy: 12.5,
      altitude: 1753,
      altitudeAccuracy: 3,
      heading: 90,
      headingAccuracy: 5,
      speed: 0.4,
      speedAccuracy: 0.1,
      isMocked: isMocked,
      hasAccuracy: true,
      hasAltitude: hasAltitude,
      hasAltitudeAccuracy: hasAltitude,
      hasHeading: true,
      hasSpeed: true,
    );

void main() {
  group('LocationFix.fromPosition', () {
    test('copies what the platform reported', () {
      final fix = LocationFix.fromPosition(_position(), web: false);
      expect(fix.latitude, -26.2041);
      expect(fix.longitude, 28.0473);
      expect(fix.accuracyM, 12.5);
      expect(fix.fixTime, DateTime.utc(2026, 9, 13, 10));
      expect(fix.altitudeM, 1753);
      expect(fix.headingDeg, 90);
      expect(fix.speedMps, 0.4);
      expect(fix.isMocked, isFalse);
    });

    test('keeps a native mock flag', () {
      expect(
        LocationFix.fromPosition(
          _position(isMocked: true),
          web: false,
        ).isMocked,
        isTrue,
      );
    });

    test('on the web, mocking is unknown rather than "clean"', () {
      expect(LocationFix.fromPosition(_position(), web: true).isMocked, isNull);
    });

    test('values the platform flags as absent become null', () {
      final fix = LocationFix.fromPosition(
        _position(hasAltitude: false),
        web: false,
      );
      expect(fix.altitudeM, isNull);
      expect(fix.altitudeAccuracyM, isNull);
    });

    test('toString never shows coordinates', () {
      final text = LocationFix.fromPosition(_position(), web: false).toString();
      expect(text, isNot(contains('26.2')));
      expect(text, isNot(contains('28.0')));
    });
  });

  test('LocationAccess.fromPermission', () {
    expect(
      LocationAccess.fromPermission(LocationPermission.always),
      LocationAccess.always,
    );
    expect(
      LocationAccess.fromPermission(LocationPermission.whileInUse).granted,
      isTrue,
    );
    expect(
      LocationAccess.fromPermission(LocationPermission.denied).granted,
      isFalse,
    );
    expect(
      LocationAccess.fromPermission(LocationPermission.deniedForever),
      LocationAccess.deniedForever,
    );
    expect(
      LocationAccess.fromPermission(LocationPermission.unableToDetermine),
      LocationAccess.unknown,
    );
    expect(LocationAccess.serviceDisabled.granted, isFalse);
  });
}
