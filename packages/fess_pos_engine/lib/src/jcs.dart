/// RFC 8785 JSON Canonicalization Scheme (JCS).
///
/// The twin of `packages/fess_pos_engine_ts/src/jcs.ts`; both run the fixtures
/// in `schema/fixtures/jcs`.
///
/// - Object members are sorted by the UTF-16 code units of their names
///   (RFC 8785 §3.2.3). Dart's `String.compareTo` compares code units.
/// - Numbers use the ECMAScript Number-to-String algorithm (§3.2.2.3). It is
///   implemented here from the shortest round-trip digits rather than taken
///   from `double.toString()`, which differs between the VM (`100.0`) and
///   the web (`100`). `-0` → `0`.
/// - Strings are serialised as ECMAScript `JSON.stringify` does (§3.2.2.2).
///   Lone surrogates are rejected: they are not valid I-JSON.
/// - Non-finite numbers and non-JSON values are rejected. An `int` that an
///   IEEE 754 double cannot hold exactly is rejected too, because hashing it
///   would silently hash a different number (the TS twin rejects `bigint`
///   with the same code).
library;

import 'package:fess_pos_engine/src/errors.dart';

const int _maxDepth = 1000;

/// 2^53: every integer with a magnitude up to this is an exact double.
const int _maxExactInt = 9007199254740992;

/// Canonical JSON text of [value]: `null`, `bool`, `num`, `String`, `List`
/// and `Map` with `String` keys, nested up to 1000 levels.
String canonicalize(Object? value) {
  final out = StringBuffer();
  _write(value, out, 0);
  return out.toString();
}

void _write(Object? v, StringBuffer out, int depth) {
  if (depth > _maxDepth) {
    throw const JcsError('JCS_TOO_DEEP', 'value nests deeper than 1000 levels');
  }
  switch (v) {
    case null:
      out.write('null');
    case final bool b:
      out.write(b ? 'true' : 'false');
    case final num n:
      out.write(serializeNumber(n));
    case final String s:
      out.write(serializeString(s));
    case final List<Object?> list:
      out.write('[');
      for (var i = 0; i < list.length; i++) {
        if (i > 0) out.write(',');
        _write(list[i], out, depth + 1);
      }
      out.write(']');
    case final Map<Object?, Object?> map:
      final keys = <String>[];
      for (final k in map.keys) {
        if (k is! String) {
          throw JcsError(
            'JCS_UNSUPPORTED_TYPE',
            'object keys must be strings, got ${k.runtimeType}',
          );
        }
        keys.add(k);
      }
      keys.sort();
      out.write('{');
      for (var i = 0; i < keys.length; i++) {
        if (i > 0) out.write(',');
        out
          ..write(serializeString(keys[i]))
          ..write(':');
        _write(map[keys[i]], out, depth + 1);
      }
      out.write('}');
    default:
      throw JcsError(
        'JCS_UNSUPPORTED_TYPE',
        'cannot canonicalise a value of type ${v.runtimeType}',
      );
  }
}

/// RFC 8785 §3.2.2.3: the ECMAScript Number-to-String of [n].
String serializeNumber(num n) {
  final d = n.toDouble();
  // Checked first: compiled to JavaScript, `-Infinity is int` is true.
  if (d.isNaN || d.isInfinite) {
    throw JcsError('JCS_NON_FINITE_NUMBER', 'number $d is not finite');
  }
  // Only a VM int can differ from its double; on the web they're the same.
  if (n is int &&
      (n > _maxExactInt || n < -_maxExactInt) &&
      BigInt.from(d) != BigInt.from(n)) {
    throw JcsError(
      'JCS_UNSUPPORTED_TYPE',
      'integer $n cannot be represented exactly as an IEEE 754 double',
    );
  }
  if (d == 0) return '0'; // also -0
  return _ecmaScriptNumberToString(d);
}

/// ECMA-262 Number::toString(x) for a finite, non-zero [x].
///
/// Let k be the number of shortest round-trip decimal digits of x and n the
/// position of the decimal point, so that x = digits × 10^(n − k).
String _ecmaScriptNumberToString(double x) {
  final negative = x < 0;
  // With no argument, toStringAsExponential gives the shortest digits that
  // round-trip, on the VM and on the web alike: "3.333333333333333e+8".
  final exponential = x.abs().toStringAsExponential();
  final e = exponential.indexOf('e');
  var digits = exponential.substring(0, e).replaceFirst('.', '');
  while (digits.length > 1 && digits.endsWith('0')) {
    digits = digits.substring(0, digits.length - 1);
  }
  final k = digits.length;
  final n = int.parse(exponential.substring(e + 1)) + 1;

  final String s;
  if (k <= n && n <= 21) {
    s = digits + '0' * (n - k);
  } else if (0 < n && n <= 21) {
    s = '${digits.substring(0, n)}.${digits.substring(n)}';
  } else if (-6 < n && n <= 0) {
    s = '0.${'0' * -n}$digits';
  } else {
    final exp = n - 1;
    final sign = exp < 0 ? '-' : '+';
    final mantissa = k == 1 ? digits : '${digits[0]}.${digits.substring(1)}';
    s = '${mantissa}e$sign${exp.abs()}';
  }
  return negative ? '-$s' : s;
}

/// RFC 8785 §3.2.2.2: [s] as ECMAScript `JSON.stringify` writes it.
String serializeString(String s) {
  final out = StringBuffer('"');
  for (var i = 0; i < s.length; i++) {
    final c = s.codeUnitAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      if (i + 1 < s.length) {
        final next = s.codeUnitAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          out
            ..writeCharCode(c)
            ..writeCharCode(next);
          i++;
          continue;
        }
      }
      throw const JcsError(
        'JCS_LONE_SURROGATE',
        'string contains a lone surrogate',
      );
    }
    if (c >= 0xDC00 && c <= 0xDFFF) {
      throw const JcsError(
        'JCS_LONE_SURROGATE',
        'string contains a lone surrogate',
      );
    }
    switch (c) {
      case 0x22:
        out.write(r'\"');
      case 0x5C:
        out.write(r'\\');
      case 0x08:
        out.write(r'\b');
      case 0x09:
        out.write(r'\t');
      case 0x0A:
        out.write(r'\n');
      case 0x0C:
        out.write(r'\f');
      case 0x0D:
        out.write(r'\r');
      default:
        if (c < 0x20) {
          out.write('\\u00${c.toRadixString(16).padLeft(2, '0')}');
        } else {
          out.writeCharCode(c);
        }
    }
  }
  out.write('"');
  return out.toString();
}
