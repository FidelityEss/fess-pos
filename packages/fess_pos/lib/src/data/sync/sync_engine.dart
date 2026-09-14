import 'dart:async';

import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/config/remote_config.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/data/outbox/outbox_sender.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:meta/meta.dart';

const PosLogger _log = PosLogger('sync');

/// What one [SyncEngine.syncNow] did.
@immutable
class SyncRunReport {
  const SyncRunReport({
    required this.at,
    this.drained,
    this.pulled,
    this.error,
  });

  final DateTime at;
  final DrainReport? drained;
  final PullReport? pulled;

  /// Why the run stopped short, if it did. The next run carries on.
  final String? error;

  bool get ok => error == null;
}

/// Runs the sync (docs/08): re-verify the host identity when due, send the
/// outbox, pull, send again if the pull queued anything (a restore), then
/// clear out committed items past their retention.
///
/// It runs on a timer — `sync.foreground_interval_s` while the outbox holds
/// work, `sync.idle_interval_s` otherwise — and whenever it is nudged: an
/// action, a push hint, the network coming back. One run at a time. It
/// never throws: every failure waits for the next run, and nothing is
/// dropped. Pulling needs UI access; uploads carry on without it.
class SyncEngine {
  SyncEngine({
    required this.sender,
    required this.puller,
    required this.outbox,
    required Future<EnvelopeOrigin?> Function() deviceOrigin,
    required bool Function() canPull,
    Future<void> Function(RemoteConfig config)? reverify,
    void Function(PullReport report)? onPulled,
    Future<int> Function()? uploadEvidence,
    DateTime Function()? clock,
    this.nudgeDelay = const Duration(seconds: 2),
  }) : _deviceOrigin = deviceOrigin,
       _canPull = canPull,
       _reverify = reverify,
       _onPulled = onPulled,
       _uploadEvidence = uploadEvidence,
       _clock = clock ?? DateTime.now;

  final OutboxSender sender;
  final PullEngine puller;
  final OutboxStore outbox;
  final Duration nudgeDelay;
  final Future<EnvelopeOrigin?> Function() _deviceOrigin;
  final bool Function() _canPull;
  final Future<void> Function(RemoteConfig config)? _reverify;
  final void Function(PullReport report)? _onPulled;

  /// The evidence upload lane (docs/12 §6); returns how many uploads it
  /// recorded, which then go out as `evidence_uploaded`.
  final Future<int> Function()? _uploadEvidence;
  final DateTime Function() _clock;

  RemoteConfig _config = RemoteConfig.bundled;
  SyncRunReport? _last;
  Future<SyncRunReport>? _running;
  Timer? _timer;
  bool _started = false;

  /// The resolved config as of the last run.
  RemoteConfig get config => _config;

  SyncRunReport? get lastRun => _last;

  bool get started => _started;

  /// When the next run is due: sooner while work is waiting to go up.
  static Duration nextDelay({
    required RemoteConfig config,
    required bool pendingWork,
  }) => pendingWork ? config.foregroundSyncInterval : config.idleSyncInterval;

  /// Runs now, or joins the run in progress.
  Future<SyncRunReport> syncNow() => _running ??= _run().whenComplete(() {
    _running = null;
    unawaited(_schedule());
  });

  /// Starts the timer.
  void start() {
    if (_started) return;
    _started = true;
    unawaited(_schedule());
  }

  void stop() {
    _started = false;
    _timer?.cancel();
    _timer = null;
  }

  /// Something changed — an action, a push hint, the network came back:
  /// run soon.
  void nudge() {
    if (!_started) return;
    _timer?.cancel();
    _timer = Timer(nudgeDelay, () => unawaited(syncNow()));
  }

  Future<SyncRunReport> _run() async {
    final at = _clock();
    DrainReport? drained;
    PullReport? pulled;
    String? error;
    try {
      _config = await readRemoteConfig(outbox.database);
      final reverify = _reverify;
      if (reverify != null) {
        try {
          await reverify(_config);
        } on Object catch (e) {
          _log.info('re-verifying the host identity failed (${e.runtimeType})');
        }
      }
      final origin = await _deviceOrigin();
      if (origin != null) await outbox.reportQuarantinedStores(origin);

      drained = await sender.drain();
      final upload = _uploadEvidence;
      if (upload != null) {
        try {
          if (await upload() > 0) drained = await sender.drain();
        } on Object catch (e, st) {
          _log.warning('evidence uploads stopped', error: e, stackTrace: st);
        }
      }
      if (_canPull()) {
        try {
          pulled = await puller.pull();
          _config = await readRemoteConfig(outbox.database);
          _onPulled?.call(pulled);
          if (pulled.resent > 0) drained = await sender.drain();
        } on PosException catch (e) {
          error = e.code;
          _log.info('pull not done (${e.code}); next run carries on');
        }
      }
      await outbox.purgeCommitted(_config.retainCommittedPayload);
      error ??= drained?.stoppedBy;
    } on Object catch (e, st) {
      error = e is PosException ? e.code : 'SYNC_FAILED';
      _log.warning(
        'sync run failed; next run carries on',
        error: e,
        stackTrace: st,
      );
    }
    return _last = SyncRunReport(
      at: at,
      drained: drained,
      pulled: pulled,
      error: error,
    );
  }

  Future<void> _schedule() async {
    if (!_started || _running != null) return;
    var pending = false;
    try {
      pending = (await outbox.status()).pending > 0;
    } on Object {
      pending = true; // can't tell: check back sooner
    }
    if (!_started || _running != null) return;
    _timer?.cancel();
    _timer = Timer(
      nextDelay(config: _config, pendingWork: pending),
      () => unawaited(syncNow()),
    );
  }
}
