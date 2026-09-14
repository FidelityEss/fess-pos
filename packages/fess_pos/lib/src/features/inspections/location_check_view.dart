import 'dart:async';

import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/geofence/geofence.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/platform/location.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show renderTemplate;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

enum _Stage { loading, access, off, checking, done }

/// A platform fix, as the geofence judges it.
GeoFix geoFixOf(LocationFix fix) => GeoFix(
  lat: fix.latitude,
  lng: fix.longitude,
  accuracyM: fix.accuracyM,
  at: fix.fixTime,
  isMocked: fix.isMocked,
);

/// The `location_check` step (docs/07 §7, T4-07). It samples the location
/// for up to the sampling window, showing how accurate it is, until a fix
/// that counts puts the agent inside the fence. Outside, without a GPS lock
/// or with a mocked location, it says so and offers to try again; the
/// outside fix (T4-23) and the override (T4-10) come later. Each outcome
/// goes into the inspection's `geofence_result`.
class LocationCheckView extends ConsumerStatefulWidget {
  const LocationCheckView({
    required this.inspections,
    required this.inspectionId,
    required this.onPassed,
    super.key,
  });

  final Inspections inspections;
  final String inspectionId;
  final VoidCallback onPassed;

  @override
  ConsumerState<LocationCheckView> createState() => _LocationCheckViewState();
}

class _LocationCheckViewState extends ConsumerState<LocationCheckView> {
  /// How often a fix is asked for while checking.
  static const Duration _interval = Duration(seconds: 2);

  _Stage _stage = _Stage.loading;
  GeofencePlan? _plan;
  LocationCheck? _check;
  CheckState _state = CheckState.sampling;
  StreamSubscription<LocationFix>? _fixes;
  Timer? _clock;
  bool _deniedForever = false;

  /// Seconds since the check began, counted by the clock's ticks.
  int _elapsed = 0;

  LocationProvider get _location => ref.read(platformServicesProvider).location;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
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

  Future<void> _load() async {
    final plan = await widget.inspections.geofencePlan(widget.inspectionId);
    if (!mounted) return;
    // No fence (a job without a location): there's nothing to check here.
    if (plan == null) {
      widget.onPassed();
      return;
    }
    _plan = plan;
    await _start();
  }

  Future<void> _start() async {
    final plan = _plan;
    if (plan == null) return;
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
      plan.fence,
      window: plan.sampleWindow,
      startedAt: DateTime.now(),
    );
    _elapsed = 0;
    setState(() {
      _stage = _Stage.checking;
      _state = CheckState.sampling;
    });
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
    if (check == null || !mounted || _stage != _Stage.checking) return;
    final state = check.state(_now);
    setState(() => _state = state);
    if (state != CheckState.sampling) unawaited(_finish(check, state));
  }

  Future<void> _finish(LocationCheck check, CheckState state) async {
    _stop();
    setState(() => _stage = _Stage.done);
    await widget.inspections.recordLocationCheck(
      widget.inspectionId,
      passed: state == CheckState.passed,
      verdict: check.recorded,
      sampledSeconds: check.sampledSeconds(_now),
    );
    if (mounted && state == CheckState.passed) widget.onPassed();
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
    Widget say(String text) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(text, key: ValueKey('location-${_state.name}-$_stage')),
    );
    final latest = _check?.latest;
    final window = _plan?.sampleWindow.inSeconds ?? 60;
    final children = switch (_stage) {
      _Stage.loading => <Widget>[
        const Center(child: CircularProgressIndicator()),
      ],
      _Stage.off => [say(copy('location.off')), retry],
      _Stage.access => [
        say(copy('location.needs_access')),
        FilledButton(
          key: const ValueKey('location-allow'),
          onPressed: _allow,
          child: Text(copy('location.allow')),
        ),
        const SizedBox(height: 8),
        retry,
      ],
      _Stage.checking || _Stage.done => switch (_state) {
        CheckState.sampling => [
          LinearProgressIndicator(value: _elapsed / window),
          const SizedBox(height: 12),
          say(copy('location.checking')),
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
        CheckState.passed => [say(copy('location.passed'))],
        CheckState.outside => [
          say(
            renderTemplate(copy('location.outside'), {
              'm': _check?.closestOutside?.distanceM.round(),
            }),
          ),
          retry,
        ],
        CheckState.noLock => [say(copy('location.no_lock')), retry],
        CheckState.mocked => [say(copy('location.mocked')), retry],
      },
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
