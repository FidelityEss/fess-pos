/// The version axes the module reports (docs/13 §2).
abstract final class PosVersions {
  /// Semver of this package. A test keeps it equal to `pubspec.yaml`.
  static const String module = '0.1.0';

  /// The POS API major the module speaks: the `/v1` path and every
  /// envelope's `api_version`.
  static const String api = '1';

  /// The highest definition `spec_version` the renderer understands.
  static const String spec = '1.0';
}
