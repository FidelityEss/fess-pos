/**
 * Operator table for rules spec 1.0 (docs/04 §4.1). Mirrors `schema/rules/operators.json`;
 * a test keeps the two in sync. Adding an operator is a minor spec_version bump (docs/04 §12).
 */

export type RuleType = "null" | "boolean" | "number" | "string" | "array" | "object" | "any";

export type LiteralKind = "string" | "unit" | "decimals" | "regex";

export interface OperatorSpec {
  readonly name: string;
  readonly group:
    | "data"
    | "logic"
    | "comparison"
    | "collections"
    | "emptiness"
    | "text"
    | "numbers"
    | "dates"
    | "geo"
    | "options";
  readonly minArgs: number;
  /** null = unbounded. */
  readonly maxArgs: number | null;
  /** Argument positions that must be literals (not expressions), and of what kind. */
  readonly literals?: Readonly<Record<number, LiteralKind>>;
  /** Argument position evaluated once per element with `current` / `current_index` bound. */
  readonly predicateArg?: number;
  readonly returns: RuleType;
}

const op = (s: OperatorSpec): OperatorSpec => s;

export const OPERATORS: Readonly<Record<string, OperatorSpec>> = {
  var: op({ name: "var", group: "data", minArgs: 1, maxArgs: 2, literals: { 0: "string" }, returns: "any" }),
  and: op({ name: "and", group: "logic", minArgs: 1, maxArgs: null, returns: "boolean" }),
  or: op({ name: "or", group: "logic", minArgs: 1, maxArgs: null, returns: "boolean" }),
  "!": op({ name: "!", group: "logic", minArgs: 1, maxArgs: 1, returns: "boolean" }),
  if: op({ name: "if", group: "logic", minArgs: 2, maxArgs: null, returns: "any" }),
  "==": op({ name: "==", group: "comparison", minArgs: 2, maxArgs: 2, returns: "boolean" }),
  "!=": op({ name: "!=", group: "comparison", minArgs: 2, maxArgs: 2, returns: "boolean" }),
  "<": op({ name: "<", group: "comparison", minArgs: 2, maxArgs: 2, returns: "boolean" }),
  "<=": op({ name: "<=", group: "comparison", minArgs: 2, maxArgs: 2, returns: "boolean" }),
  ">": op({ name: ">", group: "comparison", minArgs: 2, maxArgs: 2, returns: "boolean" }),
  ">=": op({ name: ">=", group: "comparison", minArgs: 2, maxArgs: 2, returns: "boolean" }),
  between: op({ name: "between", group: "comparison", minArgs: 3, maxArgs: 3, returns: "boolean" }),
  in: op({ name: "in", group: "collections", minArgs: 2, maxArgs: 2, returns: "boolean" }),
  contains: op({ name: "contains", group: "collections", minArgs: 2, maxArgs: 2, returns: "boolean" }),
  some: op({ name: "some", group: "collections", minArgs: 2, maxArgs: 2, predicateArg: 1, returns: "boolean" }),
  all: op({ name: "all", group: "collections", minArgs: 2, maxArgs: 2, predicateArg: 1, returns: "boolean" }),
  none: op({ name: "none", group: "collections", minArgs: 2, maxArgs: 2, predicateArg: 1, returns: "boolean" }),
  count: op({ name: "count", group: "collections", minArgs: 1, maxArgs: 2, predicateArg: 1, returns: "number" }),
  empty: op({ name: "empty", group: "emptiness", minArgs: 1, maxArgs: 1, returns: "boolean" }),
  not_empty: op({ name: "not_empty", group: "emptiness", minArgs: 1, maxArgs: 1, returns: "boolean" }),
  length: op({ name: "length", group: "text", minArgs: 1, maxArgs: 1, returns: "number" }),
  starts_with: op({ name: "starts_with", group: "text", minArgs: 2, maxArgs: 2, returns: "boolean" }),
  matches: op({ name: "matches", group: "text", minArgs: 2, maxArgs: 2, literals: { 1: "regex" }, returns: "boolean" }),
  lower: op({ name: "lower", group: "text", minArgs: 1, maxArgs: 1, returns: "string" }),
  concat: op({ name: "concat", group: "text", minArgs: 1, maxArgs: null, returns: "string" }),
  "+": op({ name: "+", group: "numbers", minArgs: 1, maxArgs: null, returns: "number" }),
  "-": op({ name: "-", group: "numbers", minArgs: 1, maxArgs: 2, returns: "number" }),
  "*": op({ name: "*", group: "numbers", minArgs: 2, maxArgs: null, returns: "number" }),
  "/": op({ name: "/", group: "numbers", minArgs: 2, maxArgs: 2, returns: "number" }),
  min: op({ name: "min", group: "numbers", minArgs: 1, maxArgs: null, returns: "number" }),
  max: op({ name: "max", group: "numbers", minArgs: 1, maxArgs: null, returns: "number" }),
  round: op({ name: "round", group: "numbers", minArgs: 1, maxArgs: 2, literals: { 1: "decimals" }, returns: "number" }),
  abs: op({ name: "abs", group: "numbers", minArgs: 1, maxArgs: 1, returns: "number" }),
  today: op({ name: "today", group: "dates", minArgs: 0, maxArgs: 0, returns: "string" }),
  date_diff: op({ name: "date_diff", group: "dates", minArgs: 3, maxArgs: 3, literals: { 2: "unit" }, returns: "number" }),
  date_add: op({ name: "date_add", group: "dates", minArgs: 3, maxArgs: 3, literals: { 2: "unit" }, returns: "string" }),
  distance_m: op({ name: "distance_m", group: "geo", minArgs: 2, maxArgs: 2, returns: "number" }),
  within_m: op({ name: "within_m", group: "geo", minArgs: 3, maxArgs: 3, returns: "boolean" }),
  option_meta: op({
    name: "option_meta",
    group: "options",
    minArgs: 2,
    maxArgs: 2,
    literals: { 0: "string", 1: "string" },
    returns: "any",
  }),
};

export const OPERATOR_NAMES: readonly string[] = Object.keys(OPERATORS);

export const DATE_UNITS = ["days", "months", "years"] as const;
export type DateUnit = (typeof DATE_UNITS)[number];

/** Hard bounds (docs/04 §4.4 item 6). Changing these is a spec change. */
export const LIMITS = {
  maxDepth: 32,
  maxNodes: 500,
  regexMaxLength: 256,
  regexMaxUnboundedQuantifiers: 3,
  regexMaxRepeat: 1000,
  matchInputMaxLength: 1024,
  maxRoundDecimals: 10,
  maxDateAddAmount: 100000,
} as const;

/** Error codes a rule check or evaluation can raise (part of the fixture contract). */
export const RULE_ERROR_CODES = [
  "RULE_MALFORMED",
  "RULE_UNKNOWN_OPERATOR",
  "RULE_ARITY",
  "RULE_INVALID_ARGUMENT",
  "RULE_DEPTH_EXCEEDED",
  "RULE_TOO_MANY_NODES",
  "RULE_TYPE_ERROR",
  "RULE_INVALID_REGEX",
  "RULE_UNSAFE_REGEX",
  "RULE_REGEX_TOO_LONG",
  "RULE_LIMIT_EXCEEDED",
  "RULE_NUMERIC_OVERFLOW",
  "RULE_INVALID_DATE",
  "RULE_INVALID_POINT",
  "RULE_NO_TODAY",
] as const;
export type RuleErrorCode = (typeof RULE_ERROR_CODES)[number];
