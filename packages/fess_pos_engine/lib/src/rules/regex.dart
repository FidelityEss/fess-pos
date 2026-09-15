/// The RE2-safe regex subset (docs/04 §4.4 item 6), as the TypeScript
/// engine checks it (`src/rules/regex.ts`). Patterns run on budget devices
/// and on the server, so only constructs without catastrophic backtracking
/// are accepted:
///
/// - no backreferences, lookarounds, named or atomic groups or inline flags;
///   the only `(?` form is the non-capturing group `(?:`;
/// - a repeated group must not itself contain a repeating quantifier or an
///   alternation (rules out `(a+)+`, `(a|a)*`);
/// - at most 3 unbounded quantifiers per pattern; repeat counts ≤ 1000;
/// - pattern length ≤ 256; compiled in unicode mode, unanchored,
///   case-sensitive.
library;

import 'package:fess_pos_engine/src/errors.dart';
import 'package:fess_pos_engine/src/rules/spec.dart';

class _Group {
  bool repeating = false;
  bool alternation = false;
}

typedef _Quantifier = ({int end, bool repeating, bool unbounded});

final RegExp _repeatCount = RegExp(r'^\{(\d+)(,(\d*))?\}');
final RegExp _backrefDigit = RegExp('[1-9]');

_Quantifier? _readQuantifier(String p, int i) {
  if (i >= p.length) return null;
  final c = p[i];
  int end;
  bool repeating;
  bool unbounded;
  if (c == '*' || c == '+') {
    end = i + 1;
    repeating = true;
    unbounded = true;
  } else if (c == '?') {
    end = i + 1;
    repeating = false;
    unbounded = false;
  } else if (c == '{') {
    final m = _repeatCount.firstMatch(p.substring(i));
    if (m == null) return null;
    final lo = double.parse(m[1]!);
    final hasComma = m[2] != null;
    final hiRaw = m[3];
    final hi = hasComma
        ? (hiRaw == null || hiRaw.isEmpty
              ? double.infinity
              : double.parse(hiRaw))
        : lo;
    if (lo > RuleLimits.regexMaxRepeat ||
        (hi != double.infinity && hi > RuleLimits.regexMaxRepeat)) {
      throw const RuleError(
        'RULE_UNSAFE_REGEX',
        'repeat count above ${RuleLimits.regexMaxRepeat}',
      );
    }
    end = i + m[0]!.length;
    unbounded = hi == double.infinity;
    repeating = hi > 1;
  } else {
    return null;
  }
  if (end < p.length && p[end] == '?') end += 1; // lazy modifier
  return (end: end, repeating: repeating, unbounded: unbounded);
}

/// Throws [RuleError] unless [pattern] is in the safe subset and compiles.
void checkSafeRegex(String pattern) {
  if (pattern.length > RuleLimits.regexMaxLength) {
    throw const RuleError(
      'RULE_REGEX_TOO_LONG',
      'pattern longer than ${RuleLimits.regexMaxLength} characters',
    );
  }
  final stack = [_Group()];
  var unboundedCount = 0;
  var inClass = false;
  var i = 0;

  void afterAtom(_Group? group) {
    final top = stack.last;
    final q = _readQuantifier(pattern, i);
    if (q == null) {
      if (group != null) {
        top
          ..repeating = top.repeating || group.repeating
          ..alternation = top.alternation || group.alternation;
      }
      return;
    }
    if (q.unbounded) unboundedCount += 1;
    if (group != null) {
      if (q.repeating && (group.repeating || group.alternation)) {
        throw const RuleError(
          'RULE_UNSAFE_REGEX',
          'repeated group contains a quantifier or alternation',
        );
      }
      top
        ..repeating = top.repeating || group.repeating || q.repeating
        ..alternation = top.alternation || group.alternation;
    } else if (q.repeating) {
      top.repeating = true;
    }
    i = q.end;
  }

  while (i < pattern.length) {
    final c = pattern[i];
    if (c == r'\') {
      if (i + 1 >= pattern.length) {
        throw const RuleError(
          'RULE_INVALID_REGEX',
          'pattern ends with a backslash',
        );
      }
      final n = pattern[i + 1];
      if (!inClass && _backrefDigit.hasMatch(n)) {
        throw const RuleError(
          'RULE_UNSAFE_REGEX',
          'backreferences are not allowed',
        );
      }
      if (n == 'k') {
        throw const RuleError(
          'RULE_UNSAFE_REGEX',
          'named backreferences are not allowed',
        );
      }
      i += 2;
      if ((n == 'p' || n == 'P' || n == 'u') &&
          i < pattern.length &&
          pattern[i] == '{') {
        final close = pattern.indexOf('}', i);
        if (close < 0) {
          throw const RuleError('RULE_INVALID_REGEX', 'unterminated escape');
        }
        i = close + 1;
      }
      if (!inClass) afterAtom(null);
      continue;
    }
    if (inClass) {
      i += 1;
      if (c == ']') {
        inClass = false;
        afterAtom(null);
      }
      continue;
    }
    if (c == '[') {
      inClass = true;
      i += 1;
      continue;
    }
    if (c == '(') {
      if (i + 1 < pattern.length && pattern[i + 1] == '?') {
        if (i + 2 >= pattern.length || pattern[i + 2] != ':') {
          throw const RuleError(
            'RULE_UNSAFE_REGEX',
            'only non-capturing (?: groups are allowed — no lookarounds, '
                'named or atomic groups',
          );
        }
        i += 3;
      } else {
        i += 1;
      }
      stack.add(_Group());
      continue;
    }
    if (c == ')') {
      if (stack.length < 2) {
        throw const RuleError('RULE_INVALID_REGEX', 'unbalanced parenthesis');
      }
      final group = stack.removeLast();
      i += 1;
      afterAtom(group);
      continue;
    }
    if (c == '|') {
      stack.last.alternation = true;
      i += 1;
      continue;
    }
    i += 1;
    afterAtom(null);
  }
  if (unboundedCount > RuleLimits.regexMaxUnboundedQuantifiers) {
    throw const RuleError(
      'RULE_UNSAFE_REGEX',
      'more than ${RuleLimits.regexMaxUnboundedQuantifiers} '
          'unbounded quantifiers',
    );
  }
  try {
    RegExp(pattern, unicode: true);
  } on FormatException {
    throw const RuleError('RULE_INVALID_REGEX', 'pattern does not compile');
  }
}

final Map<String, RegExp> _compiled = {};

/// Checks and compiles [pattern] (cached). Throws [RuleError] for unsafe or
/// invalid patterns.
RegExp compileSafeRegex(String pattern) {
  final hit = _compiled[pattern];
  if (hit != null) return hit;
  checkSafeRegex(pattern);
  final re = RegExp(pattern, unicode: true);
  if (_compiled.length > 500) _compiled.clear();
  return _compiled[pattern] = re;
}
