import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';

/// Where the bootstrap snapshot is kept between runs. Small, and readable
/// before anything else starts (native: secure storage, T1-19).
abstract interface class BootstrapCache {
  Future<String?> read();

  Future<void> write(String snapshotJson);
}

/// Keeps the snapshot in memory only: tests, and hosts with no storage.
class MemoryBootstrapCache implements BootstrapCache {
  MemoryBootstrapCache([this._value]);

  String? _value;

  @override
  Future<String?> read() async => _value;

  @override
  Future<void> write(String snapshotJson) async => _value = snapshotJson;
}

const PosLogger _log = PosLogger('bootstrap');

/// Loads the cached snapshot. Never throws: if the cache can't be read, the
/// module starts on the bundled defaults and says so.
Future<BootstrapSnapshot> loadBootstrapSnapshot(BootstrapCache cache) async {
  try {
    final snapshot = BootstrapSnapshot.fromCacheJson(await cache.read());
    if (snapshot.anomalies.isNotEmpty) {
      _log.warning(
        'bootstrap cache had invalid values, defaults used for: '
        '${snapshot.anomalies.join(', ')}',
      );
    }
    return snapshot;
  } on Object catch (e, st) {
    _log.warning(
      'bootstrap cache unreadable; defaults used',
      error: e,
      stackTrace: st,
    );
    return const BootstrapSnapshot(anomalies: ['(cache): unreadable']);
  }
}

/// Caches the bootstrap keys of a freshly pulled resolved config (T1-23).
Future<void> storeBootstrapSnapshot(
  BootstrapCache cache,
  Object? resolvedConfig, {
  String? configVersionId,
}) => cache.write(
  BootstrapSnapshot.fromResolvedConfig(
    resolvedConfig,
    configVersionId: configVersionId,
  ).toCacheJson(),
);
