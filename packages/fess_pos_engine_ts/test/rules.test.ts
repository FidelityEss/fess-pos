import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { OPERATORS, OPERATOR_NAMES, LIMITS, RULE_ERROR_CODES, dependencies, evaluate, checkExpression, isValidExpression } from "../src/rules/index.ts";
import { RuleError } from "../src/errors.ts";
import type { JsonValue, JsonObject } from "../src/json.ts";
import { SCHEMA_DIR, expectJson, fixtures, readJson, schemaFor } from "./helpers.ts";

interface RuleCase {
  name: string;
  expression: unknown;
  data?: JsonValue;
  env?: { today?: string; option_meta?: Record<string, Record<string, JsonObject>> };
  expected?: JsonValue;
  error?: string;
  dependencies?: string[];
}
interface RuleFile {
  operator?: string;
  topic?: string;
  cases: RuleCase[];
}

const files = fixtures<RuleFile>("rules");
const STRUCTURAL = new Set(["RULE_MALFORMED", "RULE_UNKNOWN_OPERATOR", "RULE_ARITY", "RULE_INVALID_ARGUMENT", "RULE_REGEX_TOO_LONG"]);
const expressionSchema = schemaFor("rules/expression.schema.json");

function run(c: RuleCase): JsonValue {
  return evaluate(c.expression, c.data ?? null, { today: c.env?.today ?? null, optionMeta: c.env?.option_meta ?? {} });
}

describe("rules fixture contract (schema/fixtures/rules)", () => {
  it("every operator in the spec has a fixture file with cases", () => {
    const covered = new Set(files.map((f) => f.data.operator).filter((x): x is string => typeof x === "string"));
    for (const op of OPERATOR_NAMES) expect(covered, `missing fixtures for ${op}`).toContain(op);
    for (const f of files) expect(f.data.cases.length).toBeGreaterThan(0);
  });

  for (const f of files.filter((x) => x.data.topic !== "dependencies")) {
    describe(f.name, () => {
      for (const c of f.data.cases) {
        it(c.name, () => {
          if (c.error !== undefined) {
            let thrown: unknown;
            try {
              run(c);
            } catch (e) {
              thrown = e;
            }
            expect(thrown, "expected an error").toBeInstanceOf(RuleError);
            expect((thrown as RuleError).code).toBe(c.error);
            expect(RULE_ERROR_CODES).toContain(c.error);
          } else {
            expectJson(run(c), c.expected);
          }
          // expression.schema.json agrees with the engine on structure.
          const structurallyBad = c.error !== undefined && STRUCTURAL.has(c.error);
          expect(expressionSchema(c.expression), JSON.stringify(expressionSchema.errors)).toBe(!structurallyBad);
        });
      }
    });
  }

  const deps = files.find((f) => f.data.topic === "dependencies");
  describe("dependencies", () => {
    for (const c of deps?.data.cases ?? []) {
      it(c.name, () => expect(dependencies(c.expression)).toEqual(c.dependencies));
    }
  });
});

describe("operators.json ↔ engine spec", () => {
  const spec = readJson<{ operators: { name: string; fixture: string; min_args: number; max_args: number | null; returns: string; group: string }[]; limits: Record<string, unknown> }>(
    join(SCHEMA_DIR, "rules", "operators.json"),
  );
  it("lists exactly the engine's operators with the same arity, group and result type", () => {
    expect(spec.operators.map((o) => o.name).sort()).toEqual([...OPERATOR_NAMES].sort());
    for (const o of spec.operators) {
      const s = OPERATORS[o.name];
      expect(s, o.name).toBeDefined();
      expect([o.min_args, o.max_args, o.group, o.returns]).toEqual([s?.minArgs, s?.maxArgs, s?.group, s?.returns]);
      expect(files.some((f) => f.name === o.fixture && f.data.operator === o.name), `fixture file ${o.fixture}`).toBe(true);
    }
  });
  it("limits match", () => {
    expect(spec.limits["max_depth"]).toBe(LIMITS.maxDepth);
    expect(spec.limits["max_nodes"]).toBe(LIMITS.maxNodes);
    expect(spec.limits["regex_max_length"]).toBe(LIMITS.regexMaxLength);
    expect(spec.limits["match_input_max_length"]).toBe(LIMITS.matchInputMaxLength);
  });
  it("expression.schema.json allows exactly these operator names", () => {
    const schema = readJson<{ $defs: { operation: { propertyNames: { enum: string[] } } } }>(join(SCHEMA_DIR, "rules", "expression.schema.json"));
    expect([...schema.$defs.operation.propertyNames.enum].sort()).toEqual([...OPERATOR_NAMES].sort());
  });
});

describe("checkExpression", () => {
  it("reports size and caches by identity", () => {
    const e = { and: [true, { var: "answers.a" }] };
    const a = checkExpression(e);
    expect(a).toEqual({ nodes: 4, depth: 3, deps: ["answers.a"] });
    expect(checkExpression(e)).toBe(a);
    expect(checkExpression(3)).toEqual({ nodes: 1, depth: 1, deps: [] });
  });
  it("rejects non-JSON values", () => {
    expect(isValidExpression(Number.NaN)).toBe(false);
    expect(isValidExpression({ var: undefined })).toBe(false);
    expect(isValidExpression(new Date())).toBe(false);
    expect(isValidExpression(() => 1)).toBe(false);
    expect(isValidExpression({ var: "x".repeat(201) })).toBe(false);
  });
});
