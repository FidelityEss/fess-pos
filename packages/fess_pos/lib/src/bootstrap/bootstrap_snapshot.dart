import 'dart:convert';

import 'package:fess_pos/src/bootstrap/semver.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:meta/meta.dart';

/// Which client the agent should use (`client_mode`, docs/13 §8).
enum PosClientMode { native, web }

/// The cached remote-config values the module needs before any feature code
/// loads (docs/13 §6): kill switches, client mode, minimum versions, the
/// Sentry DSN and the theme overrides.
///
/// Reading is defensive. A missing value takes its bundled default. An
/// invalid one takes its default too and is listed in [anomalies] for
/// reporting. Nothing here throws, so a broken cache can't stop the module
/// from starting — or from uploading what is already captured.
@immutable
class BootstrapSnapshot {
  const BootstrapSnapshot({
    this.posEnabled = true,
    this.inspectionsStartEnabled = true,
    this.clientMode = PosClientMode.native,
    this.minModuleVersionNag = '0.0.0',
    this.minModuleVersionNewWork = '0.0.0',
    this.minModuleVersionBlockInProgress = '0.0.0',
    this.sentryDsn,
    this.sentrySampleRate = 0.2,
    this.themePrimaryColor,
    this.themeFontFamily,
    this.configVersionId,
    this.anomalies = const [],
  });

  /// Reads the bootstrap keys from a resolved remote-config document (the
  /// shape of `schema/config/defaults.json`), applying the bounds in
  /// `schema/config/remote-config.schema.json`.
  factory BootstrapSnapshot.fromResolvedConfig(
    Object? config, {
    String? configVersionId,
  }) {
    final anomalies = <String>[];
    final Map<String, Object?>? root;
    if (config is Map<String, Object?>) {
      root = config;
    } else {
      root = null;
      if (config != null) anomalies.add('(root): not an object');
    }

    Object? lookup(String path) {
      Object? node = root;
      for (final key in path.split('.')) {
        if (node is! Map<String, Object?> || !node.containsKey(key)) {
          return _missing;
        }
        node = node[key];
      }
      return node;
    }

    T read<T>(String path, T fallback, T? Function(Object? v) accept) {
      final v = lookup(path);
      if (identical(v, _missing)) return fallback;
      final accepted = accept(v);
      if (accepted == null && v != null) {
        anomalies.add(path);
        return fallback;
      }
      return accepted ?? fallback;
    }

    bool? asBool(Object? v) => v is bool ? v : null;
    String? asMinVersion(Object? v) =>
        v is String && _minVersion.hasMatch(v) ? v : null;
    String? asText(Object? v) =>
        v is String && v.isNotEmpty && v.length <= 2000 ? v : null;

    const d = BootstrapSnapshot.defaults;
    return BootstrapSnapshot(
      posEnabled: read('pos.enabled', d.posEnabled, asBool),
      inspectionsStartEnabled: read(
        'inspections.start_enabled',
        d.inspectionsStartEnabled,
        asBool,
      ),
      clientMode: read(
        'client_mode',
        d.clientMode,
        (v) => switch (v) {
          'native' => PosClientMode.native,
          'web' => PosClientMode.web,
          _ => null,
        },
      ),
      minModuleVersionNag: read(
        'min_module_version.nag',
        d.minModuleVersionNag,
        asMinVersion,
      ),
      minModuleVersionNewWork: read(
        'min_module_version.new_work',
        d.minModuleVersionNewWork,
        asMinVersion,
      ),
      minModuleVersionBlockInProgress: read(
        'min_module_version.block_in_progress',
        d.minModuleVersionBlockInProgress,
        asMinVersion,
      ),
      sentryDsn: read<String?>('observability.sentry_dsn', null, asText),
      sentrySampleRate: read(
        'observability.sample_rate',
        d.sentrySampleRate,
        (v) => v is num && v >= 0 && v <= 1 ? v.toDouble() : null,
      ),
      themePrimaryColor: read<String?>(
        'theme.primary_color',
        null,
        (v) => v is String && _hexColor.hasMatch(v) ? v : null,
      ),
      themeFontFamily: read<String?>('theme.font_family', null, asText),
      configVersionId: configVersionId,
      anomalies: List.unmodifiable(anomalies),
    );
  }

  /// Reads what [toCacheJson] wrote. `null` (nothing cached yet, e.g. the
  /// first run) gives the defaults.
  factory BootstrapSnapshot.fromCacheJson(String? text) {
    if (text == null) return BootstrapSnapshot.defaults;
    final Object? decoded;
    try {
      decoded = jsonDecode(text);
    } on FormatException {
      return const BootstrapSnapshot(anomalies: ['(cache): not JSON']);
    }
    final version = decoded is Map<String, Object?>
        ? decoded['config_version_id']
        : null;
    return BootstrapSnapshot.fromResolvedConfig(
      decoded,
      configVersionId: version is String ? version : null,
    );
  }

  /// The bundled safe defaults. A test keeps them equal to
  /// `schema/config/defaults.json`.
  static const BootstrapSnapshot defaults = BootstrapSnapshot();

  static final RegExp _minVersion = RegExp(r'^\d+\.\d+\.\d+$');
  static final RegExp _hexColor = RegExp(r'^#[0-9A-Fa-f]{6}$');
  static const Object _missing = Object();

  /// `pos.enabled`: false hides the host entry point. Uploads carry on.
  final bool posEnabled;

  /// `inspections.start_enabled`: false blocks new inspections only.
  final bool inspectionsStartEnabled;

  final PosClientMode clientMode;
  final String minModuleVersionNag;
  final String minModuleVersionNewWork;
  final String minModuleVersionBlockInProgress;
  final String? sentryDsn;
  final double sentrySampleRate;

  /// `theme.primary_color`, `#RRGGBB`; null = the design tokens.
  final String? themePrimaryColor;

  /// `theme.font_family`; null = the design tokens.
  final String? themeFontFamily;

  /// The resolved remote-config version these values came from.
  final String? configVersionId;

  /// Paths whose cached value was invalid and fell back to the default.
  final List<String> anomalies;

  /// Starting inspections and accepting jobs is allowed (docs/13 §4).
  bool get newWorkAllowed =>
      compareSemver(PosVersions.module, minModuleVersionNewWork) >= 0;

  /// Show the soft "please update" banner (docs/13 §4).
  bool get updateSuggested =>
      compareSemver(PosVersions.module, minModuleVersionNag) < 0;

  /// The emergency block on finishing in-progress work (docs/13 §4).
  /// Uploading is never blocked.
  bool get inProgressBlocked =>
      compareSemver(PosVersions.module, minModuleVersionBlockInProgress) < 0;

  /// The snapshot in the resolved-config shape, plus `config_version_id`.
  String toCacheJson() => jsonEncode({
    'config_version_id': configVersionId,
    'pos': {'enabled': posEnabled},
    'inspections': {'start_enabled': inspectionsStartEnabled},
    'client_mode': clientMode.name,
    'min_module_version': {
      'nag': minModuleVersionNag,
      'new_work': minModuleVersionNewWork,
      'block_in_progress': minModuleVersionBlockInProgress,
    },
    'observability': {
      'sentry_dsn': sentryDsn,
      'sample_rate': sentrySampleRate,
    },
    'theme': {
      'primary_color': themePrimaryColor,
      'font_family': themeFontFamily,
    },
  });
}
