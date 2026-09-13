import 'package:fess_pos/src/contract/bootstrap.dart';
import 'package:fess_pos/src/contract/events.dart';
import 'package:fess_pos/src/contract/theme.dart';
import 'package:meta/meta.dart';

/// The host's device push token, passed to the module as data. Push is an
/// optional hint: sync never depends on it (docs/03 §7).
@immutable
class PosPushConfig {
  const PosPushConfig({required this.provider, required this.getToken});

  /// The push provider, e.g. `fcm`.
  final String provider;

  final Future<String?> Function() getToken;
}

/// Everything the host passes to `PosModule.initialize`.
@immutable
class PosHostConfig {
  const PosHostConfig({
    required this.bootstrap,
    this.theme,
    this.push,
    this.onEvent,
    this.onUserActivity,
  });

  final PosBootstrap bootstrap;

  /// Optional brand overrides (host-overridable keys only).
  final PosTheme? theme;

  final PosPushConfig? push;

  /// Content-free analytics and telemetry, out to the host.
  final void Function(PosEvent event)? onEvent;

  /// Called (throttled) while the agent uses the module, so the host can
  /// reset its own idle or PIN timer (FESS: a 2-minute lock, D-42).
  final void Function()? onUserActivity;
}
