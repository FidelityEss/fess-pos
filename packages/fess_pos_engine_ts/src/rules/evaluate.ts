/**
 * Rules evaluator (docs/04 §4.4): pure, deterministic, strictly typed, null-safe, bounded.
 * `today` comes from the environment, never the wall clock.
 */
import { RuleError } from "../errors.ts";
import type { JsonObject, JsonValue } from "../json.ts";
import { deepEqual, getOwn, isPlainObject, jsonTypeOf, readPath } from "../json.ts";
import { argsOf, checkExpression } from "./check.ts";
import { dateAdd, dateDiff, formatDate, isIsoDate, parseDate } from "./dates.ts";
import { finite, haversineM, roundHalfAway, toPoint } from "./math.ts";
import { compileSafeRegex } from "./regex.ts";
import { LIMITS } from "./spec.ts";
import type { DateUnit } from "./spec.ts";

/** Option metadata by field key → option value → meta object (for `option_meta`). */
export type OptionMetaMap = Readonly<Record<string, Readonly<Record<string, JsonObject>>>>;

export interface RuleEnv {
  /** Frozen "today" (`YYYY-MM-DD`), normally the inspection start date (context_snapshot.today). */
  readonly today?: string | null;
  readonly optionMeta?: OptionMetaMap;
}

/** Check (cached) and evaluate an expression against `data`. Throws RuleError. */
export function evaluate(expr: unknown, data: JsonValue, env: RuleEnv = {}): JsonValue {
  checkExpression(expr);
  return ev(expr as JsonValue, data, env);
}

/** Evaluate an expression whose result must be boolean (null counts as false). */
export function evaluateBoolean(expr: unknown, data: JsonValue, env: RuleEnv = {}): boolean {
  return asBool(evaluate(expr, data, env), "rule");
}

function typeError(op: string, want: string, got: JsonValue): never {
  throw new RuleError("RULE_TYPE_ERROR", `"${op}" expected ${want}, got ${jsonTypeOf(got)}`, { operator: op });
}

function asBool(v: JsonValue, op: string): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  return typeError(op, "boolean", v);
}

function asNumOrNull(v: JsonValue, op: string): number | null {
  if (v === null) return null;
  if (typeof v === "number") return v;
  return typeError(op, "number", v);
}

function asStrOrNull(v: JsonValue, op: string): string | null {
  if (v === null) return null;
  if (typeof v === "string") return v;
  return typeError(op, "string", v);
}

function asArrOrEmpty(v: JsonValue, op: string): JsonValue[] {
  if (v === null) return [];
  if (Array.isArray(v)) return v;
  return typeError(op, "array", v);
}

/** Ordering: both numbers or both strings (UTF-16 code-unit order). null → null (caller yields false). */
function compare(a: JsonValue, b: JsonValue, op: string): number | null {
  if (a === null || b === null) return null;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if ((typeof a === "number" || typeof a === "string") && (typeof b === "number" || typeof b === "string")) {
    throw new RuleError("RULE_TYPE_ERROR", `"${op}" cannot compare ${jsonTypeOf(a)} with ${jsonTypeOf(b)}`, {
      operator: op,
    });
  }
  return typeError(op, "number or string", typeof a === "number" || typeof a === "string" ? b : a);
}

function withCurrent(data: JsonValue, el: JsonValue, i: number): JsonValue {
  const base: JsonObject = isPlainObject(data) ? (data as JsonObject) : {};
  return { ...base, current: el, current_index: i };
}

function isEmpty(v: JsonValue): boolean {
  return v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function ev(node: JsonValue, data: JsonValue, env: RuleEnv): JsonValue {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => ev(n, data, env));
  const op = Object.keys(node)[0] as string;
  const args = argsOf(node[op] as JsonValue);
  const arg = (i: number): JsonValue => ev(args[i] as JsonValue, data, env);

  switch (op) {
    case "var": {
      const v = readPath(data, args[0] as string);
      if (v === undefined || v === null) return args.length > 1 ? arg(1) : null;
      return v;
    }
    case "and":
      for (let i = 0; i < args.length; i++) if (!asBool(arg(i), op)) return false;
      return true;
    case "or":
      for (let i = 0; i < args.length; i++) if (asBool(arg(i), op)) return true;
      return false;
    case "!":
      return !asBool(arg(0), op);
    case "if": {
      let i = 0;
      for (; i + 1 < args.length; i += 2) if (asBool(arg(i), op)) return arg(i + 1);
      return i < args.length ? arg(i) : null;
    }
    case "==":
      return deepEqual(arg(0), arg(1));
    case "!=":
      return !deepEqual(arg(0), arg(1));
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const c = compare(arg(0), arg(1), op);
      if (c === null) return false;
      return op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : c >= 0;
    }
    case "between": {
      const x = arg(0);
      const lo = compare(arg(1), x, op);
      const hi = compare(x, arg(2), op);
      return lo !== null && hi !== null && lo <= 0 && hi <= 0;
    }
    case "in":
      return membership(arg(1), arg(0), op);
    case "contains":
      return membership(arg(0), arg(1), op);
    case "some":
    case "all":
    case "none":
    case "count": {
      const items = asArrOrEmpty(arg(0), op);
      if (op === "count" && args.length === 1) return items.length;
      const pred = args[1] as JsonValue;
      let hits = 0;
      for (let i = 0; i < items.length; i++) {
        const ok = asBool(ev(pred, withCurrent(data, items[i] as JsonValue, i), env), op);
        if (ok) {
          hits += 1;
          if (op === "some") return true;
          if (op === "none") return false;
        } else if (op === "all") {
          return false;
        }
      }
      if (op === "some") return false;
      if (op === "none") return true;
      if (op === "all") return items.length > 0;
      return hits;
    }
    case "empty":
      return isEmpty(arg(0));
    case "not_empty":
      return !isEmpty(arg(0));
    case "length": {
      const v = arg(0);
      if (v === null) return 0;
      if (typeof v === "string") return [...v].length;
      if (Array.isArray(v)) return v.length;
      return typeError(op, "string or array", v);
    }
    case "starts_with": {
      const s = asStrOrNull(arg(0), op);
      const p = asStrOrNull(arg(1), op);
      return s !== null && p !== null && s.startsWith(p);
    }
    case "matches": {
      const s = asStrOrNull(arg(0), op);
      if (s === null) return false;
      if (s.length > LIMITS.matchInputMaxLength) {
        throw new RuleError("RULE_LIMIT_EXCEEDED", `"matches" input longer than ${LIMITS.matchInputMaxLength}`);
      }
      return compileSafeRegex(args[1] as string).test(s);
    }
    case "lower": {
      const s = asStrOrNull(arg(0), op);
      return s === null ? null : s.toLowerCase();
    }
    case "concat": {
      let out = "";
      for (let i = 0; i < args.length; i++) out += asStrOrNull(arg(i), op) ?? "";
      return out;
    }
    case "+": {
      let sum: number | null = null;
      for (let i = 0; i < args.length; i++) {
        const n = asNumOrNull(arg(i), op);
        if (n !== null) sum = (sum ?? 0) + n;
      }
      return sum === null ? null : finite(sum, op);
    }
    case "-": {
      const a = asNumOrNull(arg(0), op);
      if (args.length === 1) return a === null ? null : finite(-a, op);
      const b = asNumOrNull(arg(1), op);
      return a === null || b === null ? null : finite(a - b, op);
    }
    case "*": {
      let prod = 1;
      let anyNull = false;
      for (let i = 0; i < args.length; i++) {
        const n = asNumOrNull(arg(i), op);
        if (n === null) anyNull = true;
        else prod *= n;
      }
      return anyNull ? null : finite(prod, op);
    }
    case "/": {
      const a = asNumOrNull(arg(0), op);
      const b = asNumOrNull(arg(1), op);
      if (a === null || b === null || b === 0) return null;
      return finite(a / b, op);
    }
    case "min":
    case "max": {
      let best: number | null = null;
      for (let i = 0; i < args.length; i++) {
        const n = asNumOrNull(arg(i), op);
        if (n !== null && (best === null || (op === "min" ? n < best : n > best))) best = n;
      }
      return best;
    }
    case "round": {
      const x = asNumOrNull(arg(0), op);
      if (x === null) return null;
      return finite(roundHalfAway(x, args.length > 1 ? (args[1] as number) : 0), op);
    }
    case "abs": {
      const x = asNumOrNull(arg(0), op);
      return x === null ? null : finite(Math.abs(x), op);
    }
    case "today": {
      const t = env.today;
      if (typeof t !== "string" || !isIsoDate(t)) {
        throw new RuleError("RULE_NO_TODAY", "no valid frozen `today` (YYYY-MM-DD) in the evaluation context");
      }
      return t;
    }
    case "date_diff": {
      const a = asStrOrNull(arg(0), op);
      const b = asStrOrNull(arg(1), op);
      if (a === null || b === null) return null;
      return dateDiff(parseDate(a, op), parseDate(b, op), args[2] as DateUnit);
    }
    case "date_add": {
      const d = asStrOrNull(arg(0), op);
      const n = asNumOrNull(arg(1), op);
      if (d === null || n === null) return null;
      if (!Number.isInteger(n) || Math.abs(n) > LIMITS.maxDateAddAmount) {
        throw new RuleError("RULE_TYPE_ERROR", `"date_add" amount must be an integer within ±${LIMITS.maxDateAddAmount}`);
      }
      return formatDate(dateAdd(parseDate(d, op), n, args[2] as DateUnit));
    }
    case "distance_m": {
      const a = toPoint(arg(0), op);
      const b = toPoint(arg(1), op);
      return a === null || b === null ? null : haversineM(a, b);
    }
    case "within_m": {
      const a = toPoint(arg(0), op);
      const b = toPoint(arg(1), op);
      const m = asNumOrNull(arg(2), op);
      return a !== null && b !== null && m !== null && haversineM(a, b) <= m;
    }
    case "option_meta": {
      const path = args[0] as string;
      const metaKey = args[1] as string;
      const fieldKey = path.split(".").pop() as string;
      const table = env.optionMeta && getOwnRecord(env.optionMeta, fieldKey);
      const lookup = (value: string): JsonValue => {
        const meta = table ? getOwnRecord(table, value) : undefined;
        if (!meta) return null;
        return getOwn(meta, metaKey) ?? null;
      };
      const v = readPath(data, path) ?? null;
      if (v === null) return null;
      if (typeof v === "string") return lookup(v);
      if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? lookup(x) : typeError(op, "string values", x)));
      return typeError(op, "a selected option value", v);
    }
    /* c8 ignore next 2 — unreachable: checkExpression rejects unknown operators */
    default:
      throw new RuleError("RULE_UNKNOWN_OPERATOR", `unknown operator "${op}"`);
  }
}

function getOwnRecord<T>(o: Readonly<Record<string, T>>, k: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}

function membership(haystack: JsonValue, needle: JsonValue, op: string): boolean {
  if (haystack === null) return false;
  if (Array.isArray(haystack)) return haystack.some((x) => deepEqual(x, needle));
  if (typeof haystack === "string") {
    if (needle === null) return false;
    if (typeof needle !== "string") return typeError(op, "a string to search for", needle);
    return haystack.includes(needle);
  }
  return typeError(op, "array or string collection", haystack);
}
