/// The rules evaluator (docs/04 §4.4), the Dart twin of
/// `src/rules/evaluate.ts`: pure, deterministic, strictly typed, null-safe,
/// bounded. `today` comes from the environment, never the wall clock.
///
/// Arithmetic is done in doubles, as JavaScript does, so both engines reach
/// the same numbers.
library;

import 'dart:math' as math;

import 'package:fess_pos_engine/src/errors.dart';
import 'package:fess_pos_engine/src/json.dart';
import 'package:fess_pos_engine/src/rules/check.dart';
import 'package:fess_pos_engine/src/rules/dates.dart';
import 'package:fess_pos_engine/src/rules/regex.dart';
import 'package:fess_pos_engine/src/rules/spec.dart';
import 'package:meta/meta.dart';

/// What an evaluation may read besides its data.
@immutable
class RuleEnv {
  const RuleEnv({this.today, this.optionMeta});

  /// Frozen "today" (`YYYY-MM-DD`), normally the inspection start date.
  final String? today;

  /// Option metadata by field key → option value → meta object, for
  /// `option_meta`.
  final Map<String, Object?>? optionMeta;
}

/// Checks (cached) and evaluates [expr] against [data]. Throws [RuleError].
Object? evaluateRule(
  Object? expr,
  Object? data, {
  RuleEnv env = const RuleEnv(),
}) {
  checkRuleExpression(expr);
  return _Evaluator(env).ev(expr, data);
}

/// Evaluates an expression whose result must be boolean (null is false).
bool evaluateRuleBoolean(
  Object? expr,
  Object? data, {
  RuleEnv env = const RuleEnv(),
}) => _asBool(evaluateRule(expr, data, env: env), 'rule');

/// Mean Earth radius (IUGG), metres.
const double earthRadiusM = 6371008.8;

/// Round half away from zero to [decimals] places; -0 becomes 0.
double roundHalfAway(num x, int decimals) {
  final f = math.pow(10, decimals).toDouble();
  final r = (x.abs() * f + 0.5).floorToDouble() / f;
  final out = x < 0 ? -r : r;
  return out == 0 ? 0 : out;
}

/// Haversine great-circle distance in metres, rounded to 3 decimals.
double haversineM(({double lat, double lng}) a, ({double lat, double lng}) b) {
  const rad = math.pi / 180;
  final dLat = (b.lat - a.lat) * rad;
  final dLng = (b.lng - a.lng) * rad;
  final s1 = math.sin(dLat / 2);
  final s2 = math.sin(dLng / 2);
  final h = s1 * s1 + math.cos(a.lat * rad) * math.cos(b.lat * rad) * s2 * s2;
  final c = 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h));
  return roundHalfAway(earthRadiusM * c, 3);
}

Never _typeError(String op, String want, Object? got) => throw RuleError(
  'RULE_TYPE_ERROR',
  '"$op" expected $want, got ${jsonTypeOf(got)}',
  details: {'operator': op},
);

bool _asBool(Object? v, String op) {
  if (v == null) return false;
  if (v is bool) return v;
  _typeError(op, 'boolean', v);
}

double? _asNum(Object? v, String op) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  _typeError(op, 'number', v);
}

String? _asStr(Object? v, String op) {
  if (v == null) return null;
  if (v is String) return v;
  _typeError(op, 'string', v);
}

List<Object?> _asList(Object? v, String op) {
  if (v == null) return const [];
  if (v is List<Object?>) return v;
  _typeError(op, 'array', v);
}

num _finite(num n, String op) {
  if (!n.isFinite) {
    throw RuleError('RULE_NUMERIC_OVERFLOW', '$op: result is not finite');
  }
  return n == 0 ? 0 : n;
}

/// Ordering: both numbers or both strings (UTF-16 code units). Null → null.
int? _compare(Object? a, Object? b, String op) {
  if (a == null || b == null) return null;
  if (a is num && b is num) return a.compareTo(b).sign;
  if (a is String && b is String) return a.compareTo(b).sign;
  if ((a is num || a is String) && (b is num || b is String)) {
    throw RuleError(
      'RULE_TYPE_ERROR',
      '"$op" cannot compare ${jsonTypeOf(a)} with ${jsonTypeOf(b)}',
      details: {'operator': op},
    );
  }
  _typeError(op, 'number or string', a is num || a is String ? b : a);
}

bool _isEmpty(Object? v) =>
    v == null || v == '' || (v is List<Object?> && v.isEmpty);

/// A point from `{lat, lng}` (other keys ignored): null stays null,
/// anything else is `RULE_INVALID_POINT` (`toPoint` in
/// `src/rules/math.ts`).
({double lat, double lng})? toGeoPoint(Object? v, String op) {
  if (v == null) return null;
  if (v is! Map<Object?, Object?>) {
    throw RuleError('RULE_INVALID_POINT', '$op: expected {lat, lng}');
  }
  final lat = v['lat'];
  final lng = v['lng'];
  if (lat is! num ||
      lng is! num ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180) {
    throw RuleError(
      'RULE_INVALID_POINT',
      '$op: lat must be −90…90 and lng −180…180',
    );
  }
  return (lat: lat.toDouble(), lng: lng.toDouble());
}

bool _membership(Object? haystack, Object? needle, String op) {
  if (haystack == null) return false;
  if (haystack is List<Object?>) {
    return haystack.any((x) => deepEqual(x, needle));
  }
  if (haystack is String) {
    if (needle == null) return false;
    if (needle is! String) _typeError(op, 'a string to search for', needle);
    return haystack.contains(needle);
  }
  _typeError(op, 'array or string collection', haystack);
}

class _Evaluator {
  const _Evaluator(this.env);

  final RuleEnv env;

  Object? ev(Object? node, Object? data) {
    if (node is List<Object?>) return [for (final n in node) ev(n, data)];
    if (node is! Map<Object?, Object?>) return node;
    final op = node.keys.first! as String;
    final args = argsOf(node[op]);
    Object? arg(int i) => ev(args[i], data);

    switch (op) {
      case 'var':
        final v = readPath(data, args[0]! as String);
        if (v == null) return args.length > 1 ? arg(1) : null;
        return v;
      case 'and':
        for (var i = 0; i < args.length; i++) {
          if (!_asBool(arg(i), op)) return false;
        }
        return true;
      case 'or':
        for (var i = 0; i < args.length; i++) {
          if (_asBool(arg(i), op)) return true;
        }
        return false;
      case '!':
        return !_asBool(arg(0), op);
      case 'if':
        var i = 0;
        for (; i + 1 < args.length; i += 2) {
          if (_asBool(arg(i), op)) return arg(i + 1);
        }
        return i < args.length ? arg(i) : null;
      case '==':
        return deepEqual(arg(0), arg(1));
      case '!=':
        return !deepEqual(arg(0), arg(1));
      case '<' || '<=' || '>' || '>=':
        final c = _compare(arg(0), arg(1), op);
        if (c == null) return false;
        return switch (op) {
          '<' => c < 0,
          '<=' => c <= 0,
          '>' => c > 0,
          _ => c >= 0,
        };
      case 'between':
        final x = arg(0);
        final lo = _compare(arg(1), x, op);
        final hi = _compare(x, arg(2), op);
        return lo != null && hi != null && lo <= 0 && hi <= 0;
      case 'in':
        return _membership(arg(1), arg(0), op);
      case 'contains':
        return _membership(arg(0), arg(1), op);
      case 'some' || 'all' || 'none' || 'count':
        final items = _asList(arg(0), op);
        if (op == 'count' && args.length == 1) return items.length;
        final pred = args[1];
        final base = data is Map<String, Object?>
            ? data
            : const <String, Object?>{};
        var hits = 0;
        for (var i = 0; i < items.length; i++) {
          final scope = {...base, 'current': items[i], 'current_index': i};
          if (_asBool(ev(pred, scope), op)) {
            hits += 1;
            if (op == 'some') return true;
            if (op == 'none') return false;
          } else if (op == 'all') {
            return false;
          }
        }
        return switch (op) {
          'some' => false,
          'none' => true,
          'all' => items.isNotEmpty,
          _ => hits,
        };
      case 'empty':
        return _isEmpty(arg(0));
      case 'not_empty':
        return !_isEmpty(arg(0));
      case 'length':
        final v = arg(0);
        if (v == null) return 0;
        if (v is String) return v.runes.length;
        if (v is List<Object?>) return v.length;
        _typeError(op, 'string or array', v);
      case 'starts_with':
        final s = _asStr(arg(0), op);
        final p = _asStr(arg(1), op);
        return s != null && p != null && s.startsWith(p);
      case 'matches':
        final s = _asStr(arg(0), op);
        if (s == null) return false;
        if (s.length > RuleLimits.matchInputMaxLength) {
          throw const RuleError(
            'RULE_LIMIT_EXCEEDED',
            '"matches" input longer than ${RuleLimits.matchInputMaxLength}',
          );
        }
        return compileSafeRegex(args[1]! as String).hasMatch(s);
      case 'lower':
        return _asStr(arg(0), op)?.toLowerCase();
      case 'concat':
        final out = StringBuffer();
        for (var i = 0; i < args.length; i++) {
          out.write(_asStr(arg(i), op) ?? '');
        }
        return out.toString();
      case '+':
        double? sum;
        for (var i = 0; i < args.length; i++) {
          final n = _asNum(arg(i), op);
          if (n != null) sum = (sum ?? 0) + n;
        }
        return sum == null ? null : _finite(sum, op);
      case '-':
        final a = _asNum(arg(0), op);
        if (args.length == 1) return a == null ? null : _finite(-a, op);
        final b = _asNum(arg(1), op);
        return a == null || b == null ? null : _finite(a - b, op);
      case '*':
        var product = 1.0;
        var anyNull = false;
        for (var i = 0; i < args.length; i++) {
          final n = _asNum(arg(i), op);
          if (n == null) {
            anyNull = true;
          } else {
            product *= n;
          }
        }
        return anyNull ? null : _finite(product, op);
      case '/':
        final a = _asNum(arg(0), op);
        final b = _asNum(arg(1), op);
        if (a == null || b == null || b == 0) return null;
        return _finite(a / b, op);
      case 'min' || 'max':
        num? best;
        for (var i = 0; i < args.length; i++) {
          final v = arg(i);
          if (v != null && v is! num) _typeError(op, 'number', v);
          final n = v as num?;
          if (n != null &&
              (best == null || (op == 'min' ? n < best : n > best))) {
            best = n;
          }
        }
        return best;
      case 'round':
        final x = _asNum(arg(0), op);
        if (x == null) return null;
        final decimals = args.length > 1 ? (args[1]! as num).toInt() : 0;
        return _finite(roundHalfAway(x, decimals), op);
      case 'abs':
        final x = _asNum(arg(0), op);
        return x == null ? null : _finite(x.abs(), op);
      case 'today':
        final t = env.today;
        if (t == null || !isIsoDate(t)) {
          throw const RuleError(
            'RULE_NO_TODAY',
            'no valid frozen `today` (YYYY-MM-DD) in the evaluation context',
          );
        }
        return t;
      case 'date_diff':
        final a = _asStr(arg(0), op);
        final b = _asStr(arg(1), op);
        if (a == null || b == null) return null;
        return dateDiff(
          parseDate(a, op),
          parseDate(b, op),
          args[2]! as String,
        );
      case 'date_add':
        final d = _asStr(arg(0), op);
        final n = _asNum(arg(1), op);
        if (d == null || n == null) return null;
        if (!isIntegral(n) || n.abs() > RuleLimits.maxDateAddAmount) {
          throw const RuleError(
            'RULE_TYPE_ERROR',
            '"date_add" amount must be an integer within '
                '±${RuleLimits.maxDateAddAmount}',
          );
        }
        return formatDate(
          dateAdd(parseDate(d, op), n.toInt(), args[2]! as String),
        );
      case 'distance_m':
        final a = toGeoPoint(arg(0), op);
        final b = toGeoPoint(arg(1), op);
        return a == null || b == null ? null : haversineM(a, b);
      case 'within_m':
        final a = toGeoPoint(arg(0), op);
        final b = toGeoPoint(arg(1), op);
        final m = _asNum(arg(2), op);
        return a != null && b != null && m != null && haversineM(a, b) <= m;
      case 'option_meta':
        final path = args[0]! as String;
        final metaKey = args[1]! as String;
        final fieldKey = path.split('.').last;
        final table = env.optionMeta?[fieldKey];
        Object? lookup(String value) {
          final meta = table is Map<Object?, Object?> ? table[value] : null;
          if (meta is! Map<Object?, Object?>) return null;
          return meta[metaKey];
        }

        final v = readPath(data, path);
        if (v == null) return null;
        if (v is String) return lookup(v);
        if (v is List<Object?>) {
          return [
            for (final x in v)
              x is String ? lookup(x) : _typeError(op, 'string values', x),
          ];
        }
        _typeError(op, 'a selected option value', v);
      default:
        throw RuleError('RULE_UNKNOWN_OPERATOR', 'unknown operator "$op"');
    }
  }
}
