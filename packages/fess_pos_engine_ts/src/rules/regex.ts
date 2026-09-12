/**
 * RE2-safe regex subset (docs/04 §4.4 item 6). Patterns run on budget devices and on the server,
 * so only constructs with no catastrophic backtracking are accepted:
 *
 * - no backreferences (`\1`, `\k<name>`), lookarounds, named groups, atomic groups or inline flags —
 *   the only `(?` form allowed is the non-capturing group `(?:`;
 * - a group repeated by `*`, `+`, `{n,}`, `{n,m}` (m > 1) or `{n}` (n > 1) must not itself contain a
 *   repeating quantifier or an alternation (rules out `(a+)+`, `(a|a)*`);
 * - at most 3 unbounded quantifiers (`*`, `+`, `{n,}`) per pattern; repeat counts ≤ 1000;
 * - pattern length ≤ 256; patterns are compiled with the `u` flag (Dart: `unicode: true`),
 *   unanchored search (use `^…$` to match the whole string), case-sensitive, `.` excludes newlines.
 */
import { RuleError } from "../errors.ts";
import { LIMITS } from "./spec.ts";

interface GroupState {
  repeating: boolean;
  alternation: boolean;
}

interface Quantifier {
  end: number;
  repeating: boolean;
  unbounded: boolean;
}

function readQuantifier(p: string, i: number): Quantifier | null {
  const c = p[i];
  let end: number;
  let repeating: boolean;
  let unbounded: boolean;
  if (c === "*" || c === "+") {
    end = i + 1;
    repeating = true;
    unbounded = true;
  } else if (c === "?") {
    end = i + 1;
    repeating = false;
    unbounded = false;
  } else if (c === "{") {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(p.slice(i));
    if (!m) return null;
    const lo = Number(m[1]);
    const hasComma = m[2] !== undefined;
    const hiRaw = m[3];
    const hi = hasComma ? (hiRaw === undefined || hiRaw === "" ? Infinity : Number(hiRaw)) : lo;
    if (lo > LIMITS.regexMaxRepeat || (hi !== Infinity && hi > LIMITS.regexMaxRepeat)) {
      throw new RuleError("RULE_UNSAFE_REGEX", `repeat count above ${LIMITS.regexMaxRepeat}`);
    }
    end = i + m[0].length;
    unbounded = hi === Infinity;
    repeating = hi > 1;
  } else {
    return null;
  }
  if (p[end] === "?") end += 1; // lazy modifier
  return { end, repeating, unbounded };
}

export function checkSafeRegex(pattern: string): void {
  if (pattern.length > LIMITS.regexMaxLength) {
    throw new RuleError("RULE_REGEX_TOO_LONG", `pattern longer than ${LIMITS.regexMaxLength} characters`);
  }
  const stack: GroupState[] = [{ repeating: false, alternation: false }];
  let unboundedCount = 0;
  let inClass = false;
  let i = 0;
  const top = (): GroupState => stack[stack.length - 1] as GroupState;
  const afterAtom = (group: GroupState | null): void => {
    const q = readQuantifier(pattern, i);
    if (q === null) {
      if (group !== null) {
        top().repeating ||= group.repeating;
        top().alternation ||= group.alternation;
      }
      return;
    }
    if (q.unbounded) unboundedCount += 1;
    if (group !== null) {
      if (q.repeating && (group.repeating || group.alternation)) {
        throw new RuleError("RULE_UNSAFE_REGEX", "repeated group contains a quantifier or alternation");
      }
      top().repeating ||= group.repeating || q.repeating;
      top().alternation ||= group.alternation;
    } else if (q.repeating) {
      top().repeating = true;
    }
    i = q.end;
  };

  while (i < pattern.length) {
    const c = pattern[i] as string;
    if (c === "\\") {
      const n = pattern[i + 1];
      if (n === undefined) throw new RuleError("RULE_INVALID_REGEX", "pattern ends with a backslash");
      if (!inClass && /[1-9]/.test(n)) throw new RuleError("RULE_UNSAFE_REGEX", "backreferences are not allowed");
      if (n === "k") throw new RuleError("RULE_UNSAFE_REGEX", "named backreferences are not allowed");
      i += 2;
      if ((n === "p" || n === "P" || n === "u") && pattern[i] === "{") {
        const close = pattern.indexOf("}", i);
        if (close < 0) throw new RuleError("RULE_INVALID_REGEX", "unterminated escape");
        i = close + 1;
      }
      if (!inClass) afterAtom(null);
      continue;
    }
    if (inClass) {
      if (c === "]") {
        inClass = false;
        i += 1;
        afterAtom(null);
      } else {
        i += 1;
      }
      continue;
    }
    if (c === "[") {
      inClass = true;
      i += 1;
      continue;
    }
    if (c === "(") {
      if (pattern[i + 1] === "?") {
        if (pattern[i + 2] !== ":") {
          throw new RuleError("RULE_UNSAFE_REGEX", "only non-capturing (?: groups are allowed — no lookarounds, named or atomic groups");
        }
        i += 3;
      } else {
        i += 1;
      }
      stack.push({ repeating: false, alternation: false });
      continue;
    }
    if (c === ")") {
      if (stack.length < 2) throw new RuleError("RULE_INVALID_REGEX", "unbalanced parenthesis");
      const g = stack.pop() as GroupState;
      i += 1;
      afterAtom(g);
      continue;
    }
    if (c === "|") {
      top().alternation = true;
      i += 1;
      continue;
    }
    i += 1;
    afterAtom(null);
  }
  if (unboundedCount > LIMITS.regexMaxUnboundedQuantifiers) {
    throw new RuleError("RULE_UNSAFE_REGEX", `more than ${LIMITS.regexMaxUnboundedQuantifiers} unbounded quantifiers`);
  }
  try {
    new RegExp(pattern, "u");
  } catch {
    throw new RuleError("RULE_INVALID_REGEX", "pattern does not compile");
  }
}

const compiled = new Map<string, RegExp>();

/** Check and compile (cached). Throws RuleError for unsafe or invalid patterns. */
export function compileSafeRegex(pattern: string): RegExp {
  const hit = compiled.get(pattern);
  if (hit) return hit;
  checkSafeRegex(pattern);
  const re = new RegExp(pattern, "u");
  if (compiled.size > 500) compiled.clear();
  compiled.set(pattern, re);
  return re;
}
