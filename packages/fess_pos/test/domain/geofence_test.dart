import 'package:fess_pos/src/domain/geofence/geofence.dart';
import 'package:flutter_test/flutter_test.dart';

/// The merchant's pin.
const double _lat = -26.2041;
const double _lng = 28.0473;

/// About 111 m of latitude.
const double _degree100m = 100 / 111195;

final Fence _fence = Fence.fromResult({
  'profile': 'standalone',
  'job_location': {'lat': _lat, 'lng': _lng},
  'profile_params': {
    'radius_m': 75,
    'max_accuracy_m': 30,
    'exit_consecutive_fixes': 3,
    'prompt_checkin_on_arrival': false,
  },
})!;

/// A fix [metres] north of the pin.
GeoFix _fix(double metres, {double accuracy = 10, bool? mocked}) => GeoFix(
  lat: _lat + metres / 100 * _degree100m,
  lng: _lng,
  accuracyM: accuracy,
  at: DateTime.utc(2026, 9, 14, 10),
  isMocked: mocked,
);

final DateTime _t0 = DateTime.utc(2026, 9, 14, 10);

void main() {
  group('a fix', () {
    test('is inside when its distance less its accuracy is within the '
        'radius, and counts only when accurate enough', () {
      expect(_fence.judge(_fix(60)).passes, isTrue);
      // Accurate to 10 m: 80 − 10 is within 75; 90 − 10 isn't.
      expect(_fence.judge(_fix(80)).passes, isTrue);
      expect(_fence.judge(_fix(90)).outside, isTrue);
      final vague = _fence.judge(_fix(10, accuracy: 45));
      expect((vague.inside, vague.qualifies), (true, false));
    });

    test('mocked never counts where the config refuses it', () {
      expect(_fence.judge(_fix(10, mocked: true)).qualifies, isFalse);
      final lenient = Fence.fromResult({
        'job_location': {'lat': _lat, 'lng': _lng},
        'profile_params': {'radius_m': 75, 'max_accuracy_m': 30},
      }, blockOnMock: false)!;
      expect(lenient.judge(_fix(10, mocked: true)).passes, isTrue);
    });

    test('no fence without the job location', () {
      expect(Fence.fromResult({'profile_params': <String, Object?>{}}), isNull);
    });
  });

  group('the location check', () {
    LocationCheck check() => LocationCheck(
      _fence,
      window: const Duration(seconds: 60),
      startedAt: _t0,
    );

    test('passes on the first fix that counts and is inside', () {
      final c = check()
        ..add(_fix(10, accuracy: 50))
        ..add(_fix(20));
      expect(c.state(_t0.add(const Duration(seconds: 5))), CheckState.passed);
      expect(c.passedBy!.distanceM, closeTo(20, 1));
      c.add(_fix(500));
      expect(c.state(_t0), CheckState.passed, reason: 'it stays passed');
    });

    test('samples for the window, then is outside or has no lock', () {
      final outside = check()
        ..add(_fix(300))
        ..add(_fix(200));
      expect(
        outside.state(_t0.add(const Duration(seconds: 59))),
        CheckState.sampling,
      );
      expect(
        outside.state(_t0.add(const Duration(seconds: 60))),
        CheckState.outside,
      );
      expect(outside.closestOutside!.distanceM, closeTo(200, 1));

      final vague = check()..add(_fix(10, accuracy: 60));
      expect(
        vague.state(_t0.add(const Duration(seconds: 61))),
        CheckState.noLock,
      );
      expect(vague.sampledSeconds(_t0.add(const Duration(seconds: 90))), 60);
    });

    test('a mocked fix fails it for good', () {
      final c = check()
        ..add(_fix(10, mocked: true))
        ..add(_fix(10));
      expect(c.state(_t0), CheckState.mocked);
    });
  });

  group('the outside fix (T4-23)', () {
    const rule = OutsideFixRule(
      maxAccuracyM: 30,
      validFor: Duration(minutes: 20),
    );

    test('counts when accurate enough, within the fence and recent', () {
      final now = _t0.add(const Duration(minutes: 10));
      expect(rule.counts(_fix(50, accuracy: 20), _fence, now), isTrue);
      expect(
        rule.counts(_fix(50, accuracy: 40), _fence, now),
        isFalse,
        reason: 'not accurate enough',
      );
      expect(
        rule.counts(_fix(200, accuracy: 20), _fence, now),
        isFalse,
        reason: 'outside the fence',
      );
      expect(
        rule.counts(
          _fix(50, accuracy: 20),
          _fence,
          _t0.add(const Duration(minutes: 21)),
        ),
        isFalse,
        reason: 'too old',
      );
    });
  });

  group('during the inspection', () {
    test("the profile's fixes in a row outside pause it; one inside "
        'resumes it; vague fixes change nothing', () {
      final m = ExitMonitor(_fence);
      expect(m.add(_fix(200)), isNull);
      expect(m.add(_fix(200, accuracy: 80)), isNull, reason: 'ignored');
      expect(m.add(_fix(200)), isNull);
      final pause = m.add(_fix(200))!;
      expect((pause.paused, m.paused), (true, true));
      expect(m.add(_fix(200)), isNull, reason: 'already paused');
      final resume = m.add(_fix(20))!;
      expect((resume.paused, m.paused), (false, false));
    });

    test('a fix inside resets the count', () {
      final m = ExitMonitor(_fence)
        ..add(_fix(200))
        ..add(_fix(200))
        ..add(_fix(20));
      expect(m.add(_fix(200)), isNull);
      expect(m.paused, isFalse);
    });
  });
}
