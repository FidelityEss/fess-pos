// GENERATED — do not edit. Source: packages/fess_pos_engine_ts/src/rules/check.ts (run: node tools/vendor-engine.mjs)
/**
 * Static checking of rule expressions: structure, operator names, arity, literal arguments,
 * safe regexes and the size bounds (depth ≤ 32, nodes ≤ 500). Also extracts dependencies.
 *
 * Syntax (JsonLogic-compatible): an expression is a JSON literal (null, boolean, number, string),
 * an array of expressions, or an object with exactly one key — the operator — whose value is the
 * argument list, or a single non-array argument (sugar for a one-element list).
 */
import { RuleError } from "../errors.ts";
import type { JsonValue } from "../json.ts";
import { isPlainObject } from "../json.ts";
import { compileSafeRegex } from "./regex.ts";
import { DATE_UNITS, LIMITS, OPERATORS } from "./spec.ts";
import type { OperatorSpec } from "./spec.ts";

export interface ExpressionInfo {
  /** Total nodes (literals, arrays and operator objects). */
  readonly nodes: number;
  /** Maximum nesting depth (a bare literal has depth 1). */
  readonly depth: number;
  /** Sorted, de-duplicated var paths referenced (`var` and `option_meta`). */
  readonly deps: readonly string[];
}

const cache = new WeakMap<object, ExpressionInfo>();

export function argsOf(value: JsonValue): JsonValue[] {
  return Array.isArray(value) ? value : [value];
}

/** Operator name of an operator node, or null for literals/arrays. */
export function operatorOf(expr: unknown): string | null {
  if (!isPlainObject(expr)) return null;
  const keys = Object.keys(expr);
  return keys.length === 1 ? (keys[0] as string) : null;
}

interface WalkState {
  nodes: number;
  deps: Set<string>;
}

/** Validate an expression; throws RuleError. Results are cached per object identity. */
export function checkExpression(expr: unknown): ExpressionInfo {
  const cacheable = expr !== null && typeof expr === "object";
  if (cacheable) {
    const hit = cache.get(expr);
    if (hit) return hit;
  }
  const st: WalkState = { nodes: 0, deps: new Set() };
  const depth = walk(expr, 1, st);
  const info: ExpressionInfo = { nodes: st.nodes, depth, deps: [...st.deps].sort() };
  if (cacheable) cache.set(expr, info);
  return info;
}

/** Non-throwing structural check (used by the Zod definition mirrors). */
export function isValidExpression(expr: unknown): boolean {
  try {
    checkExpression(expr);
    return true;
  } catch {
    return false;
  }
}

/** Var paths referenced by an expression (docs/04 §4.4 item 2). */
export function dependencies(expr: unknown): string[] {
  return [...checkExpression(expr).deps];
}

function walk(e: unknown, depth: number, st: WalkState): number {
  if (depth > LIMITS.maxDepth) {
    throw new RuleError("RULE_DEPTH_EXCEEDED", `expression nests deeper than ${LIMITS.maxDepth}`);
  }
  st.nodes += 1;
  if (st.nodes > LIMITS.maxNodes) {
    throw new RuleError("RULE_TOO_MANY_NODES", `expression has more than ${LIMITS.maxNodes} nodes`);
  }
  if (e === null || typeof e === "boolean" || typeof e === "string") return depth;
  if (typeof e === "number") {
    if (!Number.isFinite(e)) throw new RuleError("RULE_MALFORMED", "numbers must be finite");
    return depth;
  }
  if (Array.isArray(e)) {
    let d = depth;
    for (const el of e) d = Math.max(d, walk(el, depth + 1, st));
    return d;
  }
  if (!isPlainObject(e)) throw new RuleError("RULE_MALFORMED", "expressions must be JSON values");
  const keys = Object.keys(e);
  if (keys.length !== 1) {
    throw new RuleError("RULE_MALFORMED", "an operator object must have exactly one key");
  }
  const name = keys[0] as string;
  const spec = Object.prototype.hasOwnProperty.call(OPERATORS, name) ? OPERATORS[name] : undefined;
  if (!spec) throw new RuleError("RULE_UNKNOWN_OPERATOR", `unknown operator "${name}"`, { operator: name });
  const raw = e[name];
  if (raw === undefined) throw new RuleError("RULE_MALFORMED", "operator arguments are missing");
  const args = argsOf(raw as JsonValue);
  checkArity(spec, args.length);
  checkLiterals(spec, args);
  if (name === "var" || name === "option_meta") st.deps.add(args[0] as string);
  let d = depth;
  args.forEach((arg, i) => {
    if (spec.literals?.[i] !== undefined) {
      // A literal-only argument is a node one level down, like any other argument.
      st.nodes += 1;
      d = Math.max(d, depth + 1);
      if (depth + 1 > LIMITS.maxDepth) throw new RuleError("RULE_DEPTH_EXCEEDED", `expression nests deeper than ${LIMITS.maxDepth}`);
      return;
    }
    d = Math.max(d, walk(arg, depth + 1, st));
  });
  if (st.nodes > LIMITS.maxNodes) {
    throw new RuleError("RULE_TOO_MANY_NODES", `expression has more than ${LIMITS.maxNodes} nodes`);
  }
  return d;
}

function checkArity(spec: OperatorSpec, n: number): void {
  if (n < spec.minArgs || (spec.maxArgs !== null && n > spec.maxArgs)) {
    const want =
      spec.maxArgs === null
        ? `at least ${spec.minArgs}`
        : spec.minArgs === spec.maxArgs
          ? `${spec.minArgs}`
          : `${spec.minArgs}–${spec.maxArgs}`;
    throw new RuleError("RULE_ARITY", `"${spec.name}" takes ${want} argument(s), got ${n}`, { operator: spec.name });
  }
}

function checkLiterals(spec: OperatorSpec, args: JsonValue[]): void {
  for (const [idxStr, kind] of Object.entries(spec.literals ?? {})) {
    const i = Number(idxStr);
    if (i >= args.length) continue;
    const a = args[i];
    const bad = (why: string): never => {
      throw new RuleError("RULE_INVALID_ARGUMENT", `"${spec.name}" argument ${i + 1} ${why}`, { operator: spec.name });
    };
    switch (kind) {
      case "string":
        if (typeof a !== "string") bad("must be a literal string");
        if (spec.name === "var" && (a as string).length > 200) bad("path is too long");
        break;
      case "unit":
        if (typeof a !== "string" || !(DATE_UNITS as readonly string[]).includes(a)) {
          bad(`must be one of ${DATE_UNITS.join(", ")}`);
        }
        break;
      case "decimals":
        if (typeof a !== "number" || !Number.isInteger(a) || a < 0 || a > LIMITS.maxRoundDecimals) {
          bad(`must be a literal integer 0–${LIMITS.maxRoundDecimals}`);
        }
        break;
      case "regex":
        if (typeof a !== "string") bad("must be a literal pattern string");
        compileSafeRegex(a as string);
        break;
    }
  }
}
