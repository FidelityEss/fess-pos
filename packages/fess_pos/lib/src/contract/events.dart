import 'package:meta/meta.dart';

/// A content-free telemetry event for the host's analytics.
///
/// Events never carry personal data, coordinates, tokens or evidence hashes:
/// only a [name] and small non-identifying [properties].
@immutable
class PosEvent {
  PosEvent(this.name, {Map<String, Object?> properties = const {}})
    : properties = Map.unmodifiable(properties),
      at = DateTime.now();

  static const String moduleInitialized = 'pos_module_initialized';
  static const String signedIn = 'pos_signed_in';
  static const String signedOut = 'pos_signed_out';
  static const String entryOpened = 'pos_entry_opened';

  final String name;
  final Map<String, Object?> properties;
  final DateTime at;

  @override
  String toString() => 'PosEvent($name)';
}
