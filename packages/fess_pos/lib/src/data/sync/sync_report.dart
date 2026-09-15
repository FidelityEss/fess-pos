import 'package:drift/drift.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/domain/sync/power_status.dart';
import 'package:meta/meta.dart';

const PosLogger _log = PosLogger('sync_report');

/// `sync_state` keys the sync report keeps.
abstract final class ReportKeys {
  static const String lastSuccessAt = 'last_success_at';
  static const String lastReportAt = 'last_report_at';
  static const String lastReportPower = 'last_report_power';
}

/// A sync run finished without an error: the report's `last_success_at`.
Future<void> recordSyncSuccess(PosDatabase db, DateTime at) =>
    _setState(db, ReportKeys.lastSuccessAt, isoWithOffset(at), at);

Future<void> _setState(PosDatabase db, String key, String value, DateTime at) =>
    db
        .into(db.syncState)
        .insertOnConflictUpdate(
          SyncStateCompanion.insert(
            key: key,
            value: value,
            updatedAt: isoWithOffset(at),
          ),
        );

/// The device's report on its own sync (`sync_report` v1, docs/12 §3 and
/// §9, T5-02): what it holds for the server, how its storage and battery
/// stand, and which module and config it runs. Sent every
/// `sync.report_interval_s`, and sooner when what can hold background sync
/// back changes.
class SyncReporter {
  SyncReporter({
    required this.outbox,
    required Future<PowerStatus> Function() power,
    required Future<int?> Function() freeDiskBytes,
    required String? Function() configVersionId,
    required this.capabilities,
    DateTime Function()? clock,
  }) : _power = power,
       _freeDiskBytes = freeDiskBytes,
       _configVersionId = configVersionId,
       _clock = clock ?? DateTime.now;

  final OutboxStore outbox;

  /// The capability report (docs/04 §8), as the pull sends it.
  final Map<String, Object?> capabilities;
  final Future<PowerStatus> Function() _power;
  final Future<int?> Function() _freeDiskBytes;
  final String? Function() _configVersionId;
  final DateTime Function() _clock;

  PosDatabase get _db => outbox.database;

  /// The server's names for the module's evidence states.
  static const Map<String, String> _evidenceStates = {
    'local_only': 'local_only',
    'uploading': 'uploading',
    'uploaded': 'uploaded',
    'verified': 'verified_retained',
  };

  /// Queues a report as [origin] when one is due: none sent yet, the last
  /// one older than [every], or the battery status changed since. Says
  /// whether it queued one. A report whose free storage can't be read waits
  /// for the next run rather than guess.
  Future<bool> reportIfDue(
    EnvelopeOrigin origin, {
    required Duration every,
  }) async {
    final now = _clock();
    final power = await _power();
    final state = await _state();
    final lastAt = DateTime.tryParse(state[ReportKeys.lastReportAt] ?? '');
    final powerKey = '${power.batteryOptimised}/${power.backgroundRestricted}';
    final due =
        lastAt == null ||
        now.difference(lastAt) >= every ||
        state[ReportKeys.lastReportPower] != powerKey;
    if (!due) return false;
    final free = await _freeDiskBytes();
    if (free == null) {
      _log.info('free storage unknown: sync report waits');
      return false;
    }
    final report = await payload(
      power: power,
      freeBytes: free,
      state: state,
      now: now,
    );
    await _db.transaction(() async {
      await outbox.add(
        origin,
        type: 'sync_report',
        typeVersion: 1,
        payload: report,
      );
      await _setState(_db, ReportKeys.lastReportAt, isoWithOffset(now), now);
      await _setState(_db, ReportKeys.lastReportPower, powerKey, now);
    });
    return true;
  }

  /// The `sync_report` v1 payload (`schema/api/payloads/`).
  @visibleForTesting
  Future<Map<String, Object?>> payload({
    required PowerStatus power,
    required int freeBytes,
    required Map<String, String> state,
    required DateTime now,
  }) async {
    final status = await outbox.status();
    final oldest = status.oldestPendingAt;
    final offset = int.tryParse(state[SyncKeys.clockOffsetMs] ?? '');
    final background = power.backgroundRestricted;
    return {
      'reported_at_device': isoWithOffset(now),
      'pending': await _pendingByType(),
      'needs_attention': status.needsAttention,
      'oldest_pending_at': oldest == null ? null : isoWithOffset(oldest),
      'last_success_at': state[ReportKeys.lastSuccessAt],
      'evidence': await _evidenceByState(),
      'free_storage_mb': freeBytes ~/ (1024 * 1024),
      'battery_restricted': power.batteryOptimised ?? false,
      'background_restricted': ?background,
      'module_version': PosVersions.module,
      'config_version_id': _configVersionId(),
      'server_epoch_seen': state[SyncKeys.serverEpoch],
      'clock_offset_ms': ?offset,
      'capabilities': capabilities,
    };
  }

  Future<Map<String, String>> _state() async => {
    for (final r in await _db.select(_db.syncState).get()) r.key: r.value,
  };

  Future<Map<String, int>> _pendingByType() async {
    final o = _db.outbox;
    final count = o.id.count();
    final rows =
        await (_db.selectOnly(o)
              ..addColumns([o.type, count])
              ..where(o.state.isIn(OutboxState.pending))
              ..groupBy([o.type]))
            .get();
    return {for (final r in rows) r.read(o.type)!: r.read(count)!};
  }

  /// Every state the server knows, zero when none are in it.
  Future<Map<String, int>> _evidenceByState() async {
    final e = _db.evidence;
    final count = e.id.count();
    final rows =
        await (_db.selectOnly(e)
              ..addColumns([e.state, count])
              ..groupBy([e.state]))
            .get();
    final out = {for (final name in _evidenceStates.values) name: 0};
    for (final r in rows) {
      final name = _evidenceStates[r.read(e.state)];
      if (name != null) out[name] = out[name]! + r.read(count)!;
    }
    return out;
  }
}
