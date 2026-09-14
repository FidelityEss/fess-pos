import 'package:fess_pos/src/core/config/config_defaults.g.dart';
import 'package:meta/meta.dart';

/// The resolved remote config as the module reads it (docs/13 §5): each
/// pulled value that keeps its contract (type and bounds from
/// `schema/config/remote-config.schema.json`), the bundled safe default
/// otherwise. Reading never throws, so a bad value can't stop the module,
/// or its uploads.
@immutable
class RemoteConfig {
  const RemoteConfig(this.values, {this.versionId});

  /// Before the first pull: the bundled defaults only.
  static const RemoteConfig bundled = RemoteConfig(null);

  /// The pulled values (`config.default.values`, or a bank's); null before
  /// the first pull.
  final Map<String, Object?>? values;

  /// The resolved config version, frozen into records at use.
  final String? versionId;

  /// The value at a dotted [path], e.g. `sync.idle_interval_s`.
  Object? value(String path) {
    final pulled = _lookup(values, path);
    if (!identical(pulled, _missing) && _keeps(path, pulled)) return pulled;
    final fallback = _lookup(bundledConfigDefaults, path);
    return identical(fallback, _missing) ? null : fallback;
  }

  int integer(String path) {
    final v = value(path);
    return v is int ? v : 0;
  }

  bool flag(String path) => value(path) == true;

  String? text(String path) {
    final v = value(path);
    return v is String ? v : null;
  }

  /// Keys whose pulled value broke its contract; their defaults are used.
  List<String> get anomalies => [
    for (final path in configLeaves.keys)
      if (!identical(_lookup(values, path), _missing) &&
          !_keeps(path, _lookup(values, path)))
        path,
  ];

  /// How often to sync while the outbox holds work.
  Duration get foregroundSyncInterval =>
      Duration(seconds: integer('sync.foreground_interval_s'));

  /// How often to sync otherwise.
  Duration get idleSyncInterval =>
      Duration(seconds: integer('sync.idle_interval_s'));

  /// How long committed envelopes are kept for a restore re-send.
  Duration get retainCommittedPayload =>
      Duration(days: integer('sync.retain_committed_payload_days'));

  /// How often the host identity is re-verified (docs/07 §2).
  Duration get reverifyEvery => Duration(hours: integer('auth.reverify_hours'));

  static bool _keeps(String path, Object? v) {
    final leaf = configLeaves[path];
    return leaf == null ? v != null : leaf.accepts(v);
  }

  static const Object _missing = Object();

  static Object? _lookup(Map<String, Object?>? root, String path) {
    if (root == null) return _missing;
    Object? node = root;
    for (final key in path.split('.')) {
      if (node is! Map<String, Object?> || !node.containsKey(key)) {
        return _missing;
      }
      node = node[key];
    }
    return node;
  }
}
