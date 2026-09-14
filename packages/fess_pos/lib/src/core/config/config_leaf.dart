import 'package:meta/meta.dart';

enum ConfigType { integer, number, boolean, string, array, object }

/// One remote-config key's contract, from
/// `schema/config/remote-config.schema.json`: its type and bounds.
@immutable
class ConfigLeaf {
  const ConfigLeaf(
    this.type, {
    this.nullable = false,
    this.min,
    this.max,
    this.values,
  });

  final ConfigType type;
  final bool nullable;
  final num? min;
  final num? max;

  /// The allowed values, for an enum.
  final List<String>? values;

  /// Whether [value] keeps the contract.
  bool accepts(Object? value) {
    if (value == null) return nullable;
    final typed = switch (type) {
      ConfigType.integer => value is int,
      ConfigType.number => value is num,
      ConfigType.boolean => value is bool,
      ConfigType.string =>
        value is String && (values == null || values!.contains(value)),
      ConfigType.array => value is List<Object?>,
      ConfigType.object => value is Map<String, Object?>,
    };
    if (!typed) return false;
    if (value is num) {
      if (min != null && value < min!) return false;
      if (max != null && value > max!) return false;
    }
    return true;
  }
}
