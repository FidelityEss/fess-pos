import 'dart:async';

import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/geofence/geofence.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/platform/location.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show renderTemplate;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A platform fix, as the geofence judges it.
GeoFix geoFixOf(LocationFix fix) => GeoFix(
  lat: fix.latitude,
  lng: fix.longitude,
  accuracyM: fix.accuracyM,
  at: fix.fixTime,
  isMocked: fix.isMocked,
);

enum _Stage { loading, access, off, sampling, done }

/// Samples the location against [fence] for up to [window] (docs/07 §7),
/// showing how accurate it is and the time left, then reports how it went
/// through [onDone]. It reads the location only once allowed; asking is
/// the agent's tap on Allow.
class FixSampler extends ConsumerStatefulWidget {
  const FixSampler({
    required this.fence,
    required this.window,
    required this.message,
    required this.onDone,
    super.key,
  });

  final Fence fence;
  final Duration window;

  /// What it is doing, shown while it samples.
  final String message;

  final void Function(LocationCheck check, CheckState state, int sampled)
  onDone;

  @override
  ConsumerState<FixSampler> createState() => _FixSamplerState();
}

class _FixSamplerState extends ConsumerState<FixSampler> {
  /// How often a fix is asked for while sampling.
  static const Duration _interval = Duration(seconds: 2);

  _Stage _stage = _Stage.loading;
  LocationCheck? _check;
  StreamSubscription<LocationFix>? _fixes;
  Timer? _clock;
  bool _deniedForever = false;

  /// Seconds since sampling began, counted by the clock's ticks.
  int _elapsed = 0;

  LocationProvider get _location => ref.read(platformServicesProvider).location;

  @override
  void initState() {
    super.initState();
    unawaited(_start());
  }

  @override
  void dispose() {
    _stop();
    super.dispose();
  }

  void _stop() {
    unawaited(_fixes?.cancel());
    _fixes = null;
    _clock?.cancel();
    _clock = null;
  }

  Future<void> _start() async {
    final access = await _location.access();
    if (!mounted) return;
    if (access == LocationAccess.serviceDisabled) {
      setState(() => _stage = _Stage.off);
      return;
    }
    if (!access.granted) {
      setState(() {
        _stage = _Stage.access;
        _deniedForever = access == LocationAccess.deniedForever;
      });
      return;
    }
    _stop();
    final check = _check = LocationCheck(
      widget.fence,
      window: widget.window,
      startedAt: DateTime.now(),
    );
    _elapsed = 0;
    setState(() => _stage = _Stage.sampling);
    _fixes = _location.fixes(interval: _interval).listen(
      (fix) {
        check.add(geoFixOf(fix));
        _update();
      },
      // A fix that fails is one fewer; the window still closes.
      onError: (Object _) {},
    );
    _clock = Timer.periodic(const Duration(seconds: 1), (_) {
      _elapsed++;
      _update();
    });
  }

  DateTime get _now => _check!.startedAt.add(Duration(seconds: _elapsed));

  void _update() {
    final check = _check;
    if (check == null || !mounted || _stage != _Stage.sampling) return;
    final state = check.state(_now);
    if (state == CheckState.sampling) {
      setState(() {});
      return;
    }
    _stop();
    setState(() => _stage = _Stage.done);
    widget.onDone(check, state, check.sampledSeconds(_now));
  }

  Future<void> _allow() async {
    if (_deniedForever) {
      await ref.read(platformServicesProvider).externalApps.openAppSettings();
      return;
    }
    await _location.requestAccess();
    if (mounted) await _start();
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(copyProvider);
    final theme = Theme.of(context);
    final retry = OutlinedButton(
      key: const ValueKey('location-retry'),
      onPressed: _start,
      child: Text(copy('location.try_again')),
    );
    final latest = _check?.latest;
    final window = widget.window.inSeconds;
    final children = switch (_stage) {
      _Stage.loading => <Widget>[
        const Center(child: CircularProgressIndicator()),
      ],
      _Stage.off => [
        Text(copy('location.off')),
        const SizedBox(height: 12),
        retry,
      ],
      _Stage.access => [
        Text(copy('location.needs_access')),
        const SizedBox(height: 12),
        FilledButton(
          key: const ValueKey('location-allow'),
          onPressed: _allow,
          child: Text(copy('location.allow')),
        ),
        const SizedBox(height: 8),
        retry,
      ],
      _Stage.sampling => [
        LinearProgressIndicator(value: _elapsed / window),
        const SizedBox(height: 12),
        Text(widget.message),
        const SizedBox(height: 8),
        Text(
          latest == null
              ? copy('location.waiting_fix')
              : renderTemplate(copy('location.accuracy'), {
                  'm': latest.fix.accuracyM.round(),
                }),
          key: const ValueKey('location-accuracy'),
          style: theme.textTheme.titleMedium,
        ),
        Text(
          renderTemplate(copy('location.seconds_left'), {
            's': (window - _elapsed).clamp(0, window),
          }),
          style: theme.textTheme.bodySmall,
        ),
      ],
      _Stage.done => const <Widget>[],
    };
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );
  }
}

/// The `location_check` step (docs/07 §7, T4-07, T4-23). It samples for up
/// to the window until a fix that counts puts the agent inside the fence.
/// With no fix accurate enough inside, a check-in recorded on arrival
/// proves the location if it still counts (the outside fix); otherwise the
/// agent can step outside and record one here. Outside the fence, or with
/// a mocked location, it says so and offers to try again; the override
/// (T4-10) comes later. Each outcome goes into `geofence_result`.
class LocationCheckView extends ConsumerStatefulWidget {
  const LocationCheckView({
    required this.inspections,
    required this.inspectionId,
    required this.jobId,
    required this.onPassed,
    super.key,
  });

  final Inspections inspections;
  final String inspectionId;
  final String jobId;
  final VoidCallback onPassed;

  @override
  ConsumerState<LocationCheckView> createState() => _LocationCheckViewState();
}

class _LocationCheckViewState extends ConsumerState<LocationCheckView> {
  GeofencePlan? _plan;

  /// A new sampler for each attempt.
  int _attempt = 0;

  /// Recording the outside fix rather than checking inside.
  bool _outside = false;

  /// How the last attempt ended; null while one runs.
  CheckState? _result;
  double? _distance;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final plan = await widget.inspections.geofencePlan(widget.inspectionId);
    if (!mounted) return;
    // No fence (a job without a location): there's nothing to check here.
    if (plan == null) {
      widget.onPassed();
      return;
    }
    setState(() => _plan = plan);
  }

  void _again({bool outside = false}) => setState(() {
    _attempt++;
    _outside = outside;
    _result = null;
  });

  Future<void> _record(
    bool passed,
    FixVerdict? verdict,
    int sampled, {
    GeoFix? checkin,
  }) => widget.inspections.recordLocationCheck(
    widget.inspectionId,
    passed: passed,
    verdict: verdict,
    sampledSeconds: sampled,
    method: _outside || checkin != null ? 'outside_fix' : 'inside_fix',
    checkin: checkin,
  );

  Future<void> _done(LocationCheck check, CheckState state, int sampled) async {
    final plan = _plan!;
    final rule = plan.outsideFix;
    final checkin = plan.checkin;
    var passed = state == CheckState.passed;
    if (_outside && passed) {
      // Recorded outside: it is the check-in, and it proves the location.
      final fix = check.passedBy!.fix;
      await widget.inspections.recordCheckin(widget.jobId, fix);
      await _record(true, check.passedBy, sampled, checkin: fix);
    } else if (!_outside &&
        state == CheckState.noLock &&
        rule != null &&
        checkin != null &&
        rule.counts(checkin, plan.fence, DateTime.now())) {
      // No lock inside, but the check-in on arrival still counts.
      passed = true;
      await _record(
        true,
        rule.fenceFor(plan.fence).judge(checkin),
        sampled,
        checkin: checkin,
      );
    } else {
      await _record(passed, check.recorded, sampled);
    }
    if (!mounted) return;
    if (passed) {
      widget.onPassed();
      return;
    }
    setState(() {
      _result = state;
      _distance = check.closestOutside?.distanceM;
    });
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(copyProvider);
    final theme = Theme.of(context);
    final plan = _plan;
    final rule = plan?.outsideFix;
    Widget say(String text, String key) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(text, key: ValueKey('location-$key')),
    );
    final retry = OutlinedButton(
      key: const ValueKey('location-retry'),
      onPressed: _again,
      child: Text(copy('location.try_again')),
    );
    final children = plan == null
        ? <Widget>[const Center(child: CircularProgressIndicator())]
        : switch (_result) {
            null => [
              FixSampler(
                key: ValueKey(_attempt),
                fence: _outside && rule != null
                    ? rule.fenceFor(plan.fence)
                    : plan.fence,
                window: plan.sampleWindow,
                message: copy(
                  _outside ? 'location.recording_outside' : 'location.checking',
                ),
                onDone: _done,
              ),
            ],
            CheckState.outside => [
              say(
                renderTemplate(copy('location.outside'), {
                  'm': _distance?.round(),
                }),
                'outside',
              ),
              retry,
            ],
            CheckState.noLock when rule != null => [
              say(copy('location.no_lock_outside'), 'no-lock'),
              FilledButton(
                key: const ValueKey('location-record-outside'),
                onPressed: () => _again(outside: true),
                child: Text(copy('location.record_outside')),
              ),
              const SizedBox(height: 8),
              retry,
            ],
            CheckState.noLock => [
              say(copy('location.no_lock'), 'no-lock'),
              retry,
            ],
            CheckState.mocked => [
              say(copy('location.mocked'), 'mocked'),
              retry,
            ],
            CheckState.sampling || CheckState.passed => [
              say(copy('location.passed'), 'passed'),
            ],
          };
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(copy('location.title'), style: theme.textTheme.titleMedium),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }
}
