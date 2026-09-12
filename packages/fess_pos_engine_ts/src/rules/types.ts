/**
 * Publish-time type inference for rule expressions (docs/04 §4.4 item 7): flags mismatches that
 * are certain from the component value shapes, e.g. `answers.is_open == "yes"` on a boolean field.
 * Unknown types (`any`) never produce an issue.
 */
import type { JsonValue } from "../json.ts";
import { isPlainObject, jsonTypeOf } from "../json.ts";
import { argsOf } from "./check.ts";
import { OPERATORS } from "./spec.ts";
import type { RuleType } from "./spec.ts";

export interface TypeIssue {
  readonly operator: string;
  readonly message: string;
}

export type VarTypeLookup = (path: string) => RuleType;

const known = (t: RuleType): boolean => t !== "any" && t !== "null";

export function inferType(expr: unknown, varType: VarTypeLookup, issues: TypeIssue[]): RuleType {
  if (expr === null) return "null";
  if (Array.isArray(expr)) {
    expr.forEach((e) => inferType(e, varType, issues));
    return "array";
  }
  if (!isPlainObject(expr)) {
    return jsonTypeOf(expr as JsonValue) as RuleType;
  }
  const op = Object.keys(expr)[0] as string;
  const spec = OPERATORS[op];
  if (!spec) return "any";
  const args = argsOf(expr[op] as JsonValue);
  const issue = (message: string): void => {
    issues.push({ operator: op, message });
  };
  const t = (i: number): RuleType => (spec.literals?.[i] !== undefined ? "string" : inferType(args[i], varType, issues));
  const expect = (i: number, allowed: RuleType[]): RuleType => {
    const ty = t(i);
    if (known(ty) && !allowed.includes(ty)) issue(`argument ${i + 1} of "${op}" is ${ty}, expected ${allowed.join(" or ")}`);
    return ty;
  };

  switch (op) {
    case "var": {
      const ty = varType(args[0] as string);
      if (args.length > 1) {
        const d = t(1);
        return ty === "any" || (known(d) && d !== ty) ? "any" : ty;
      }
      return ty;
    }
    case "and":
    case "or":
    case "!":
      args.forEach((_, i) => expect(i, ["boolean"]));
      return "boolean";
    case "if": {
      const results: RuleType[] = [];
      let i = 0;
      for (; i + 1 < args.length; i += 2) {
        expect(i, ["boolean"]);
        results.push(t(i + 1));
      }
      if (i < args.length) results.push(t(i));
      const nonNull = [...new Set(results.filter((r) => r !== "null"))];
      return nonNull.length === 1 ? (nonNull[0] as RuleType) : "any";
    }
    case "==":
    case "!=": {
      const a = t(0);
      const b = t(1);
      if (known(a) && known(b) && a !== b) issue(`"${op}" compares ${a} with ${b}: never equal under strict typing`);
      return "boolean";
    }
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "between": {
      const types = args.map((_, i) => expect(i, ["number", "string"])).filter(known);
      if (new Set(types).size > 1) issue(`"${op}" mixes ${[...new Set(types)].join(" and ")}`);
      return "boolean";
    }
    case "in":
      t(0);
      expect(1, ["array", "string"]);
      return "boolean";
    case "contains":
      expect(0, ["array", "string"]);
      t(1);
      return "boolean";
    case "some":
    case "all":
    case "none":
    case "count":
      expect(0, ["array"]);
      if (args.length > 1) expect(1, ["boolean"]);
      return spec.returns;
    case "length":
      expect(0, ["string", "array"]);
      return "number";
    case "starts_with":
    case "matches":
    case "lower":
    case "concat":
      args.forEach((_, i) => expect(i, ["string"]));
      return spec.returns;
    case "+":
    case "-":
    case "*":
    case "/":
    case "min":
    case "max":
    case "round":
    case "abs":
      args.forEach((_, i) => {
        if (spec.literals?.[i] === undefined) expect(i, ["number"]);
      });
      return "number";
    case "date_diff":
    case "date_add":
      expect(0, ["string"]);
      if (op === "date_add") expect(1, ["number"]);
      else expect(1, ["string"]);
      return spec.returns;
    case "distance_m":
    case "within_m":
      expect(0, ["object"]);
      expect(1, ["object"]);
      if (op === "within_m") expect(2, ["number"]);
      return spec.returns;
    default:
      args.forEach((_, i) => t(i));
      return spec.returns;
  }
}
