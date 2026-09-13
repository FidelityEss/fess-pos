import 'package:meta/meta.dart';

/// What this build of the module is and supports (docs/13 §2). It feeds the
/// capability report.
@immutable
class PosModuleInfo {
  PosModuleInfo({
    required this.moduleVersion,
    required this.apiVersion,
    required this.specVersion,
    Map<String, int> components = const {},
  }) : components = Map.unmodifiable(components);

  /// Semver of the `fess_pos` package.
  final String moduleVersion;

  /// POS API major, e.g. `1`.
  final String apiVersion;

  /// Highest definition `spec_version` supported, e.g. `1.0`.
  final String specVersion;

  /// Supported component types and their versions. Empty until the renderer
  /// exists (T2-15 onwards).
  final Map<String, int> components;
}
