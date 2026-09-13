import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/observability/scrub.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:sentry/sentry.dart';

const PosLogger _log = PosLogger('observability');

/// Error reporting through the module's own Sentry [Hub] (docs/03 §7).
///
/// Never `Sentry.init` or `SentryFlutter.init`: they install global error
/// handlers and take over the app-wide hub, which belongs to the host
/// (docs/DEVELOPMENT-GUIDELINES.md §2). The DSN comes from remote config
/// (`observability.sentry_dsn`); without one, reporting is off.
class PosObservability {
  const PosObservability.disabled() : _hub = null;

  PosObservability._(Hub hub) : _hub = hub;

  /// A hub for [dsn], or [PosObservability.disabled] when there is no DSN or
  /// it's unusable. Creating it never throws: a bad DSN must not stop the
  /// module from starting.
  factory PosObservability.create({
    required String? dsn,
    required double sampleRate,
    required String environment,
    Transport? transport,
  }) {
    if (dsn == null) return const PosObservability.disabled();
    try {
      final options = SentryOptions(dsn: dsn)
        ..environment = environment
        ..release = 'fess_pos@${PosVersions.module}'
        ..sampleRate = sampleRate
        ..sendDefaultPii = false
        ..beforeSend = scrubEvent
        ..beforeBreadcrumb = scrubBreadcrumb;
      if (transport != null) options.transport = transport;
      return PosObservability._(Hub(options));
    } on Object catch (e, st) {
      _log.warning(
        'Sentry DSN unusable; reporting off',
        error: e,
        stackTrace: st,
      );
      return const PosObservability.disabled();
    }
  }

  final Hub? _hub;

  bool get enabled => _hub != null;

  /// Reports [error]. Reporting failures are swallowed: they must never
  /// break the module.
  Future<void> captureException(Object error, {StackTrace? stackTrace}) async {
    final hub = _hub;
    if (hub == null) return;
    try {
      await hub.captureException(error, stackTrace: stackTrace);
    } on Object catch (e, st) {
      _log.warning('Sentry capture failed', error: e, stackTrace: st);
    }
  }

  Future<void> close() async => _hub?.close();
}
