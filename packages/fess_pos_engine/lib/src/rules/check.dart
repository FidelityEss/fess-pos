/// Static checking of rule expressions (`src/rules/check.ts`): structure,
/// operator names, arity, literal arguments, safe regexes and the size
/// bounds (depth ≤ 32, nodes ≤ 500). Also extracts dependencies.
///
/// Syntax (JsonLogic-compatible): an expression is a JSON literal, an array
/// of expressions, or an object with exactly one key — the operator — whose
/// value is the argument list, or a single non-array argument (sugar for a
/// one-element list).
library;

import 'dart:math' as math;

import 'package:fess_pos_engine/src/errors.dart';
import 'package:fess_pos_engine/src/rules/regex.dart';
import 'package:fess_pos_engine/src/rules/spec.dart';
import 'package:meta/meta.dart';

@immutable
class ExpressionInfo {
  const ExpressionInfo(this.nodes, this.depth, this.deps);

  /// Total nodes (literals, arrays and operator objects).
  final int nodes;

  /// Maximum nesting depth (a bare literal has depth 1).
  final int depth;

  /// Sorted, de-duplicated var paths (`var` and `option_meta`).
  final List<String> deps;
}

final Expando<ExpressionInfo> _cache = Expando();

List<Object?> argsOf(Object? value) => value is List<Object?> ? value : [value];

/// The operator of an operator node, or null for literals and arrays.
String? operatorOf(Object? expr) {
  if (expr is! Map<Object?, Object?> || expr.length != 1) return null;
  final key = expr.keys.first;
  return key is String ? key : null;
}

/// Validates [expr]; throws [RuleError]. Results are cached per object.
ExpressionInfo checkRuleExpression(Object? expr) {
  final cacheable = expr is Map || expr is List;
  if (cacheable) {
    final hit = _cache[expr!];
    if (hit != null) return hit;
  }
  final st = _WalkState();
  final depth = _walk(expr, 1, st);
  final info = ExpressionInfo(st.nodes, depth, st.deps.toList()..sort());
  if (cacheable) _cache[expr!] = info;
  return info;
}

/// Whether [expr] passes [checkRuleExpression].
bool isValidRuleExpression(Object? expr) {
  try {
    checkRuleExpression(expr);
    return true;
  } on RuleError {
    return false;
  }
}

/// The var paths [expr] reads (docs/04 §4.4 item 2).
List<String> ruleDependencies(Object? expr) =>
    List.of(checkRuleExpression(expr).deps);

class _WalkState {
  int nodes = 0;
  final Set<String> deps = {};
}

Never _depthExceeded() => throw const RuleError(
  'RULE_DEPTH_EXCEEDED',
  'expression nests deeper than ${RuleLimits.maxDepth}',
);

Never _tooManyNodes() => throw const RuleError(
  'RULE_TOO_MANY_NODES',
  'expression has more than ${RuleLimits.maxNodes} nodes',
);

int _walk(Object? e, int depth, _WalkState st) {
  if (depth > RuleLimits.maxDepth) _depthExceeded();
  st.nodes += 1;
  if (st.nodes > RuleLimits.maxNodes) _tooManyNodes();
  if (e == null || e is bool || e is String) return depth;
  if (e is num) {
    if (!e.isFinite) {
      throw const RuleError('RULE_MALFORMED', 'numbers must be finite');
    }
    return depth;
  }
  if (e is List<Object?>) {
    var d = depth;
    for (final el in e) {
      d = math.max(d, _walk(el, depth + 1, st));
    }
    return d;
  }
  if (e is! Map<Object?, Object?>) {
    throw const RuleError('RULE_MALFORMED', 'expressions must be JSON values');
  }
  if (e.length != 1) {
    throw const RuleError(
      'RULE_MALFORMED',
      'an operator object must have exactly one key',
    );
  }
  final name = e.keys.first;
  if (name is! String) {
    throw const RuleError('RULE_MALFORMED', 'operator names are strings');
  }
  final spec = ruleOperators[name];
  if (spec == null) {
    throw RuleError(
      'RULE_UNKNOWN_OPERATOR',
      'unknown operator "$name"',
      details: {'operator': name},
    );
  }
  final args = argsOf(e[name]);
  _checkArity(spec, args.length);
  _checkLiterals(spec, args);
  if (name == 'var' || name == 'option_meta') st.deps.add(args[0]! as String);
  var d = depth;
  for (var i = 0; i < args.length; i++) {
    if (spec.literals.containsKey(i)) {
      // A literal-only argument is a node one level down, like any other.
      st.nodes += 1;
      d = math.max(d, depth + 1);
      if (depth + 1 > RuleLimits.maxDepth) _depthExceeded();
      continue;
    }
    d = math.max(d, _walk(args[i], depth + 1, st));
  }
  if (st.nodes > RuleLimits.maxNodes) _tooManyNodes();
  return d;
}

void _checkArity(OperatorSpec spec, int n) {
  final max = spec.maxArgs;
  if (n < spec.minArgs || (max != null && n > max)) {
    final want = max == null
        ? 'at least ${spec.minArgs}'
        : (spec.minArgs == max ? '${spec.minArgs}' : '${spec.minArgs}–$max');
    throw RuleError(
      'RULE_ARITY',
      '"${spec.name}" takes $want argument(s), got $n',
      details: {'operator': spec.name},
    );
  }
}

/// JavaScript's `Number.isInteger`.
bool isIntegral(Object? v) =>
    v is int || (v is double && v.isFinite && v == v.truncateToDouble());

void _checkLiterals(OperatorSpec spec, List<Object?> args) {
  final positions = spec.literals.keys.toList()..sort();
  for (final i in positions) {
    if (i >= args.length) continue;
    final a = args[i];
    Never bad(String why) => throw RuleError(
      'RULE_INVALID_ARGUMENT',
      '"${spec.name}" argument ${i + 1} $why',
      details: {'operator': spec.name},
    );
    switch (spec.literals[i]!) {
      case LiteralKind.string:
        if (a is! String) bad('must be a literal string');
        if (spec.name == 'var' && a.length > 200) bad('path is too long');
      case LiteralKind.unit:
        if (a is! String || !dateUnits.contains(a)) {
          bad('must be one of ${dateUnits.join(', ')}');
        }
      case LiteralKind.decimals:
        if (!isIntegral(a) ||
            (a! as num) < 0 ||
            (a as num) > RuleLimits.maxRoundDecimals) {
          bad('must be a literal integer 0–${RuleLimits.maxRoundDecimals}');
        }
      case LiteralKind.regex:
        if (a is! String) bad('must be a literal pattern string');
        compileSafeRegex(a);
    }
  }
}
