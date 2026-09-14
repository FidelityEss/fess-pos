/// The operator table for rules spec 1.0 (docs/04 §4.1): the Dart twin of
/// `packages/fess_pos_engine_ts/src/rules/spec.ts`. A test keeps it equal
/// to `schema/rules/operators.json`.
library;

import 'package:meta/meta.dart';

/// Arguments that must be literals, not expressions.
enum LiteralKind { string, unit, decimals, regex }

@immutable
class OperatorSpec {
  const OperatorSpec(
    this.name,
    this.group,
    this.minArgs,
    this.maxArgs, {
    required this.returns,
    this.literals = const {},
    this.predicateArg,
  });

  final String name;
  final String group;
  final int minArgs;

  /// Null means unbounded.
  final int? maxArgs;

  /// Argument positions that must be literals, and of what kind.
  final Map<int, LiteralKind> literals;

  /// The argument evaluated per element with `current` / `current_index`.
  final int? predicateArg;
  final String returns;
}

const Map<String, OperatorSpec> ruleOperators = {
  'var': OperatorSpec(
    'var',
    'data',
    1,
    2,
    returns: 'any',
    literals: {0: LiteralKind.string},
  ),
  'and': OperatorSpec('and', 'logic', 1, null, returns: 'boolean'),
  'or': OperatorSpec('or', 'logic', 1, null, returns: 'boolean'),
  '!': OperatorSpec('!', 'logic', 1, 1, returns: 'boolean'),
  'if': OperatorSpec('if', 'logic', 2, null, returns: 'any'),
  '==': OperatorSpec('==', 'comparison', 2, 2, returns: 'boolean'),
  '!=': OperatorSpec('!=', 'comparison', 2, 2, returns: 'boolean'),
  '<': OperatorSpec('<', 'comparison', 2, 2, returns: 'boolean'),
  '<=': OperatorSpec('<=', 'comparison', 2, 2, returns: 'boolean'),
  '>': OperatorSpec('>', 'comparison', 2, 2, returns: 'boolean'),
  '>=': OperatorSpec('>=', 'comparison', 2, 2, returns: 'boolean'),
  'between': OperatorSpec('between', 'comparison', 3, 3, returns: 'boolean'),
  'in': OperatorSpec('in', 'collections', 2, 2, returns: 'boolean'),
  'contains': OperatorSpec('contains', 'collections', 2, 2, returns: 'boolean'),
  'some': OperatorSpec(
    'some',
    'collections',
    2,
    2,
    returns: 'boolean',
    predicateArg: 1,
  ),
  'all': OperatorSpec(
    'all',
    'collections',
    2,
    2,
    returns: 'boolean',
    predicateArg: 1,
  ),
  'none': OperatorSpec(
    'none',
    'collections',
    2,
    2,
    returns: 'boolean',
    predicateArg: 1,
  ),
  'count': OperatorSpec(
    'count',
    'collections',
    1,
    2,
    returns: 'number',
    predicateArg: 1,
  ),
  'empty': OperatorSpec('empty', 'emptiness', 1, 1, returns: 'boolean'),
  'not_empty': OperatorSpec('not_empty', 'emptiness', 1, 1, returns: 'boolean'),
  'length': OperatorSpec('length', 'text', 1, 1, returns: 'number'),
  'starts_with': OperatorSpec('starts_with', 'text', 2, 2, returns: 'boolean'),
  'matches': OperatorSpec(
    'matches',
    'text',
    2,
    2,
    returns: 'boolean',
    literals: {1: LiteralKind.regex},
  ),
  'lower': OperatorSpec('lower', 'text', 1, 1, returns: 'string'),
  'concat': OperatorSpec('concat', 'text', 1, null, returns: 'string'),
  '+': OperatorSpec('+', 'numbers', 1, null, returns: 'number'),
  '-': OperatorSpec('-', 'numbers', 1, 2, returns: 'number'),
  '*': OperatorSpec('*', 'numbers', 2, null, returns: 'number'),
  '/': OperatorSpec('/', 'numbers', 2, 2, returns: 'number'),
  'min': OperatorSpec('min', 'numbers', 1, null, returns: 'number'),
  'max': OperatorSpec('max', 'numbers', 1, null, returns: 'number'),
  'round': OperatorSpec(
    'round',
    'numbers',
    1,
    2,
    returns: 'number',
    literals: {1: LiteralKind.decimals},
  ),
  'abs': OperatorSpec('abs', 'numbers', 1, 1, returns: 'number'),
  'today': OperatorSpec('today', 'dates', 0, 0, returns: 'string'),
  'date_diff': OperatorSpec(
    'date_diff',
    'dates',
    3,
    3,
    returns: 'number',
    literals: {2: LiteralKind.unit},
  ),
  'date_add': OperatorSpec(
    'date_add',
    'dates',
    3,
    3,
    returns: 'string',
    literals: {2: LiteralKind.unit},
  ),
  'distance_m': OperatorSpec('distance_m', 'geo', 2, 2, returns: 'number'),
  'within_m': OperatorSpec('within_m', 'geo', 3, 3, returns: 'boolean'),
  'option_meta': OperatorSpec(
    'option_meta',
    'options',
    2,
    2,
    returns: 'any',
    literals: {0: LiteralKind.string, 1: LiteralKind.string},
  ),
};

const List<String> dateUnits = ['days', 'months', 'years'];

/// Hard bounds (docs/04 §4.4 item 6). Changing these is a spec change.
abstract final class RuleLimits {
  static const int maxDepth = 32;
  static const int maxNodes = 500;
  static const int regexMaxLength = 256;
  static const int regexMaxUnboundedQuantifiers = 3;
  static const int regexMaxRepeat = 1000;
  static const int matchInputMaxLength = 1024;
  static const int maxRoundDecimals = 10;
  static const int maxDateAddAmount = 100000;
}

/// Error codes a rule check or evaluation raises (the fixture contract).
const List<String> ruleErrorCodes = [
  'RULE_MALFORMED',
  'RULE_UNKNOWN_OPERATOR',
  'RULE_ARITY',
  'RULE_INVALID_ARGUMENT',
  'RULE_DEPTH_EXCEEDED',
  'RULE_TOO_MANY_NODES',
  'RULE_TYPE_ERROR',
  'RULE_INVALID_REGEX',
  'RULE_UNSAFE_REGEX',
  'RULE_REGEX_TOO_LONG',
  'RULE_LIMIT_EXCEEDED',
  'RULE_NUMERIC_OVERFLOW',
  'RULE_INVALID_DATE',
  'RULE_INVALID_POINT',
  'RULE_NO_TODAY',
];
