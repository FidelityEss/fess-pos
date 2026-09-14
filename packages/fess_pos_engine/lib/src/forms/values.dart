/// Value-shape checks per component type (`src/values.ts`), for the
/// components in `formComponents`. `props` are the resolved props.
library;

import 'package:fess_pos_engine/src/errors.dart';
import 'package:fess_pos_engine/src/rules/regex.dart';
import 'package:meta/meta.dart';

@immutable
class ValueIssue {
  const ValueIssue(this.code, this.message);

  final String code;
  final String message;
}

final RegExp _uuid = RegExp(
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
  r'[0-9a-fA-F]{12}$',
);

/// Empty answers: null, "", [] and {}.
bool isEmptyAnswer(Object? v) =>
    v == null ||
    v == '' ||
    (v is List<Object?> && v.isEmpty) ||
    (v is Map<Object?, Object?> && v.isEmpty);

num? _num(Object? v) => v is num ? v : null;

/// Checks one non-empty answer [value] of a component [type].
List<ValueIssue> validateValue(
  String type,
  Object? value,
  Map<String, Object?> props,
) {
  final out = <ValueIssue>[];
  void push(String code, String message) => out.add(ValueIssue(code, message));
  List<ValueIssue> bad(String want) {
    push('INVALID_TYPE', 'expected $want');
    return out;
  }

  void count(int n, Object? min, Object? max, String few, String many) {
    final lo = _num(min);
    final hi = _num(max);
    if (lo != null && n < lo) push('TOO_FEW', few.replaceAll('{n}', '$lo'));
    if (hi != null && n > hi) push('TOO_MANY', many.replaceAll('{n}', '$hi'));
  }

  switch (type) {
    case 'text' || 'textarea':
      if (value is! String) return bad('a string');
      final n = value.runes.length;
      final min = _num(props['min_length']);
      final max = _num(props['max_length']);
      if (min != null && n < min) {
        push('TOO_SHORT', 'must be at least $min characters');
      }
      if (max != null && n > max) {
        push('TOO_LONG', 'must be at most $max characters');
      }
      final pattern = props['pattern'];
      if (pattern is String) {
        try {
          if (!compileSafeRegex(pattern).hasMatch(value)) {
            push('PATTERN_MISMATCH', 'does not match the required format');
          }
        } on RuleError catch (e) {
          push('PATTERN_MISMATCH', e.message);
        }
      }
      return out;
    case 'boolean':
      return value is bool ? out : bad('true or false');
    case 'single_select':
      return value is String ? out : bad('an option value');
    case 'multi_select':
      if (value is! List<Object?> || !value.every((x) => x is String)) {
        return bad('a list of option values');
      }
      if (value.toSet().length != value.length) {
        push('DUPLICATE_VALUE', 'an option is selected twice');
      }
      count(
        value.length,
        props['min_select'],
        props['max_select'],
        'select at least {n}',
        'select at most {n}',
      );
      final exclusive = props['exclusive_options'];
      if (value.length > 1 &&
          exclusive is List<Object?> &&
          value.any(exclusive.contains)) {
        push(
          'EXCLUSIVE_OPTION_COMBINED',
          'this option cannot be combined with others',
        );
      }
      return out;
    case 'photo':
      if (value is! List<Object?> ||
          !value.every((x) => x is String && _uuid.hasMatch(x))) {
        return bad('a list of evidence ids');
      }
      if (value.toSet().length != value.length) {
        push('DUPLICATE_VALUE', 'the same photo is listed twice');
      }
      count(
        value.length,
        props['min_count'],
        props['max_count'],
        'at least {n} photos are required',
        'at most {n} photos are allowed',
      );
      return out;
    case 'signature':
      return value is String && _uuid.hasMatch(value)
          ? out
          : bad('an evidence id');
    default:
      return out;
  }
}
