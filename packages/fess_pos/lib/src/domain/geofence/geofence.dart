/// The geofence engine (docs/07 §7, T4-07): judges location fixes against
/// a job's fence, as the profile frozen into the inspection's
/// `geofence_result` at its start sets it.
///
/// Pure: fixes come in, verdicts go out. Where fixes come from, and what is
/// recorded, belongs to the inspection.
library;

import 'dart:math' as math;

import 'package:fess_pos_engine/fess_pos_engine.dart' show haversineM;
import 'package:meta/meta.dart';

/// One location fix, as the geofence judges it: where, how accurate, when,
/// and whether the platform flagged it as mocked (null when it can't tell).
@immutable
class GeoFix {
  const GeoFix({
    required this.lat,
    required this.lng,
    required this.accuracyM,
    required this.at,
    this.isMocked,
  });

  final double lat;
  final double lng;

  /// Horizontal accuracy radius, in metres.
  final double accuracyM;
  final DateTime at;
  final bool? isMocked;
}

/// A job's fence: where the merchant is, and how its location profile
/// judges fixes.
@immutable
class Fence {
  const Fence({
    required this.profile,
    required this.lat,
    required this.lng,
    required this.radiusM,
    required this.maxAccuracyM,
    required this.exitConsecutiveFixes,
    this.blockOnMock = true,
  });

  /// From an inspection's `geofence_result` (the values frozen at its
  /// start); null when the job has no location to fence.
  static Fence? fromResult(
    Map<String, Object?> result, {
    bool blockOnMock = true,
  }) {
    final job = result['job_location'];
    final params = result['profile_params'];
    if (job is! Map<String, Object?> || params is! Map<String, Object?>) {
      return null;
    }
    final lat = job['lat'];
    final lng = job['lng'];
    if (lat is! num || lng is! num) return null;
    num? n(Object? v) => v is num ? v : null;
    final profile = result['profile'];
    return Fence(
      profile: profile is String ? profile : 'standalone',
      lat: lat.toDouble(),
      lng: lng.toDouble(),
      radiusM: (n(params['radius_m']) ?? 75).toDouble(),
      maxAccuracyM: (n(params['max_accuracy_m']) ?? 30).toDouble(),
      exitConsecutiveFixes: math.max(
        n(params['exit_consecutive_fixes'])?.toInt() ?? 3,
        1,
      ),
      blockOnMock: blockOnMock,
    );
  }

  final String profile;
  final double lat;
  final double lng;
  final double radiusM;

  /// A fix counts only when it is accurate to this or better.
  final double maxAccuracyM;

  /// How many fixes in a row that count, outside, mean the agent left.
  final int exitConsecutiveFixes;

  /// Whether a mocked fix is refused (`integrity.block_on_mock`).
  final bool blockOnMock;

  /// How [fix] stands against the fence.
  FixVerdict judge(GeoFix fix) {
    final distance = haversineM(
      (lat: fix.lat, lng: fix.lng),
      (lat: lat, lng: lng),
    );
    final mocked = fix.isMocked ?? false;
    return FixVerdict(
      fix: fix,
      distanceM: distance,
      qualifies: fix.accuracyM <= maxAccuracyM && !(mocked && blockOnMock),
      // Inside = distance − accuracy ≤ radius (docs/07 §7).
      inside: distance - fix.accuracyM <= radiusM,
      mocked: mocked,
    );
  }
}

/// One fix, judged.
@immutable
class FixVerdict {
  const FixVerdict({
    required this.fix,
    required this.distanceM,
    required this.qualifies,
    required this.inside,
    required this.mocked,
  });

  final GeoFix fix;

  /// From the merchant's pin, in metres.
  final double distanceM;

  /// Accurate enough to count, and not a refused mocked fix.
  final bool qualifies;
  final bool inside;
  final bool mocked;

  /// Inside, by a fix that counts.
  bool get passes => qualifies && inside;

  /// Outside, by a fix that counts.
  bool get outside => qualifies && !inside;
}

/// Where a location check stands.
enum CheckState {
  /// Still within the sampling window, with no fix that passes yet.
  sampling,

  /// A fix that counts put the agent inside the fence.
  passed,

  /// The window closed with fixes that count, all outside.
  outside,

  /// The window closed with no fix accurate enough to count.
  noLock,

  /// A mocked location was reported where the config refuses them.
  mocked,
}

/// The `location_check` step (B3.1–B3.3): fixes over a sampling window.
/// The first fix that counts and is inside passes. When the window closes
/// without one, the check is [CheckState.outside] or [CheckState.noLock];
/// the outside fix (T4-23) and the override (T4-10) take it from there.
class LocationCheck {
  LocationCheck(this.fence, {required this.window, required this.startedAt});

  final Fence fence;
  final Duration window;
  final DateTime startedAt;

  FixVerdict? _latest;
  FixVerdict? _passedBy;
  FixVerdict? _closestOutside;
  bool _mocked = false;

  /// The newest fix, for the live accuracy.
  FixVerdict? get latest => _latest;

  /// The fix that passed the check.
  FixVerdict? get passedBy => _passedBy;

  /// The nearest fix that counted but was outside.
  FixVerdict? get closestOutside => _closestOutside;

  /// Takes a fix in. A passed check stays passed; a mocked fix, where the
  /// config refuses them, fails the check for good (docs/07 §7 item 7).
  void add(GeoFix fix) {
    if (_passedBy != null || _mocked) return;
    final v = fence.judge(fix);
    _latest = v;
    if (v.mocked && fence.blockOnMock) {
      _mocked = true;
    } else if (v.passes) {
      _passedBy = v;
    } else if (v.outside &&
        (_closestOutside == null || v.distanceM < _closestOutside!.distanceM)) {
      _closestOutside = v;
    }
  }

  CheckState state(DateTime now) {
    if (_passedBy != null) return CheckState.passed;
    if (_mocked) return CheckState.mocked;
    if (now.difference(startedAt) < window) return CheckState.sampling;
    return _closestOutside != null ? CheckState.outside : CheckState.noLock;
  }

  /// How long the check sampled, in whole seconds, up to the window.
  int sampledSeconds(DateTime now) {
    final s = now.difference(startedAt).inSeconds;
    return s.clamp(0, window.inSeconds);
  }

  /// The fix the result records: the one that passed, else the nearest
  /// outside, else the newest.
  FixVerdict? get recorded => _passedBy ?? _closestOutside ?? _latest;
}

/// Leaving the fence, or coming back.
@immutable
class GeofenceChange {
  const GeofenceChange({required this.paused, required this.verdict});

  /// True when the agent left and the inspection pauses; false when they
  /// came back and it resumes.
  final bool paused;
  final FixVerdict verdict;
}

/// Watches fixes during an inspection (docs/07 §7 item 8, B3.5): the
/// profile's number of fixes in a row that count and are outside pauses
/// it; one that counts and is inside resumes it. Fixes that don't count
/// neither pause nor reset the count.
class ExitMonitor {
  ExitMonitor(this.fence, {bool paused = false}) : _paused = paused;

  final Fence fence;
  bool _paused;
  int _outside = 0;

  bool get paused => _paused;

  /// Takes a fix in; what changed, if anything.
  GeofenceChange? add(GeoFix fix) {
    final v = fence.judge(fix);
    if (!v.qualifies) return null;
    if (v.inside) {
      _outside = 0;
      if (!_paused) return null;
      _paused = false;
      return GeofenceChange(paused: false, verdict: v);
    }
    if (_paused) return null;
    _outside++;
    if (_outside < fence.exitConsecutiveFixes) return null;
    _outside = 0;
    _paused = true;
    return GeofenceChange(paused: true, verdict: v);
  }
}

/// What an inspection's location is judged by: its fence, the sampling
/// window and how often fixes are taken, from the config in force; and
/// whether it is paused now.
@immutable
class GeofencePlan {
  const GeofencePlan({
    required this.fence,
    required this.sampleWindow,
    required this.fixInterval,
    required this.passed,
    this.paused = false,
  });

  final Fence fence;

  /// `geofence.sample_seconds`.
  final Duration sampleWindow;

  /// `geofence.trace_interval_s`.
  final Duration fixInterval;

  /// Whether the location check has passed.
  final bool passed;

  /// Whether the agent left the fence and hasn't come back.
  final bool paused;
}
