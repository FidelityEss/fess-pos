/**
 * The admin's rule builder (apps/fess-pos-admin/src/components/definitions/studio/rule-model.ts, T3-10) against the
 * rules fixtures: every fixture rule the builder can show reads back to exactly the same JSON (same keys, same order)
 * and evaluates exactly as the original. Rules it can't show say so (null), so the admin keeps them as JSON instead of
 * rewriting them. The model lives in the admin; this test runs here because the engine's vitest is the only unit-test
 * runner in the repo (no new tooling).
 */
import { describe, expect, it } from "vitest";
import { RuleError } from "../src/errors.ts";
import type { JsonObject, JsonValue } from "../src/json.ts";
import { evaluate, isValidExpression } from "../src/rules/index.ts";
import { fixtures } from "./helpers.ts";
import { buildRule, isComplete, parseRule, type RuleNode } from "../../../apps/fess-pos-admin/src/components/definitions/studio/rule-model.ts";

interface RuleCase {
  name: string;
  expression: unknown;
  data?: JsonValue;
  env?: { today?: string; option_meta?: Record<string, Record<string, JsonObject>> };
  expected?: JsonValue;
  error?: string;
}

const cases = fixtures<{ cases: RuleCase[] }>("rules").flatMap((f) => f.data.cases.map((c) => ({ file: f.name, c })));

function outcome(expression: unknown, c: RuleCase): { value?: JsonValue; error?: string } {
  try {
    return { value: evaluate(expression, c.data ?? null, { today: c.env?.today ?? null, optionMeta: c.env?.option_meta ?? {} }) };
  } catch (e) {
    if (e instanceof RuleError) return { error: e.code };
    throw e;
  }
}

describe("admin rule builder ↔ rules fixtures (T3-10)", () => {
  const buildable = cases.filter(({ c }) => parseRule(c.expression) !== null);

  it("shows the fixture rules that compare an answer or job value", () => {
    expect(buildable.length).toBeGreaterThanOrEqual(8);
  });

  for (const { file, c } of buildable) {
    it(`${file}: ${c.name} reads back exactly and evaluates the same`, () => {
      const model = parseRule(c.expression) as RuleNode;
      const json = buildRule(model);
      expect(JSON.stringify(json)).toBe(JSON.stringify(c.expression));
      expect(parseRule(json)).toEqual(model);
      expect(outcome(json, c)).toEqual(outcome(c.expression, c));
    });
  }
});

const A: RuleNode = { t: "cond", path: "answers.trading", op: "eq", value: false };
const B: RuleNode = { t: "cond", path: "answers.premises_type", op: "ne", value: "home" };
const C: RuleNode = { t: "cond", path: "job.attributes.risk_tier", op: "in", values: ["high", "elevated"] };

const MODELS: RuleNode[] = [
  A,
  B,
  { t: "cond", path: "answers.notes", op: "answered" },
  { t: "cond", path: "answers.notes", op: "unanswered" },
  { t: "cond", path: "answers.staff", op: "lt", value: 3 },
  { t: "cond", path: "answers.staff", op: "lte", value: 3.5 },
  { t: "cond", path: "answers.staff", op: "gt", value: 0 },
  { t: "cond", path: "answers.staff", op: "gte", value: 10 },
  { t: "cond", path: "answers.ecommerce_pct", op: "between", value: 10, to: 90 },
  C,
  { t: "cond", path: "inspection.geofence.profile", op: "not_in", values: ["standalone", "residential"] },
  { t: "cond", path: "inspection.geofence.profile", op: "not_in", values: ["standalone"], notArray: true },
  { t: "cond", path: "answers.services", op: "contains", value: "delivery" },
  { t: "cond", path: "answers.notes", op: "empty" },
  { t: "cond", path: "answers.notes", op: "empty", bare: true },
  { t: "cond", path: "answers.notes", op: "not_empty" },
  { t: "cond", path: "answers.notes", op: "not_empty", bare: true },
  { t: "cond", path: "answers.owner_name", op: "starts_with", value: "Mr" },
  { t: "cond", path: "answers.branch_code", op: "matches", value: "^[0-9]{6}$" },
  { t: "cond", path: "inspection.attempt", op: "eq", value: 2 },
  { t: "group", join: "and", items: [A, B] },
  { t: "group", join: "or", items: [A, { t: "group", join: "and", items: [B, C] }] },
  { t: "group", join: "or", items: [A, B], not: "object" },
  { t: "group", join: "and", items: [A], not: "array" },
];

/** The conditions the seeded forms use (supabase/seed/definitions): all must open in the builder unchanged. */
const SEEDED = [
  { in: [{ var: "answers.reason_code" }, ["conflict", "safety", "other"]] },
  { "==": [{ var: "answers.premises_type" }, "other"] },
  {
    or: [
      { in: [{ var: "inspection.geofence.profile" }, ["shopping_centre", "office_park", "large_site"]] },
      { "==": [{ var: "inspection.geofence.method" }, "outside_fix"] },
    ],
  },
  { "==": [{ var: "answers.inventory_sufficient" }, false] },
  { "!=": [{ var: "job.notes" }, null] },
];

/** Rules the builder can't show exactly: they must read as null (kept as JSON), never be rewritten. */
const NOT_BUILDABLE: unknown[] = [
  { or: [{ "==": [{ var: "answers.delivered_at_pos_pct" }, null] }, { "<=": [{ "+": [{ var: "answers.ecommerce_pct" }, { var: "answers.delivered_at_pos_pct" }] }, 100] }] },
  { "==": ["other", { var: "answers.premises_type" }] },
  { var: "answers.trading" },
  { "==": [{ var: ["answers.trading", false] }, true] },
  { "==": [{ var: "answers.a" }, { var: "answers.b" }] },
  { if: [{ var: "x" }, true, false] },
  { some: [{ var: "items" }, { "==": [{ var: "current.kind" }, "home"] }] },
  { "!": { var: "x" } },
  { "!": { "==": [{ var: "answers.a" }, 1] } },
  { and: [] },
  { "<": [{ var: "answers.visit_date" }, "2026-01-01"] },
  { in: [{ var: "answers.a" }, []] },
  { in: ["delivery", { var: "answers.services" }] },
  { "==": [{ var: "answers.a" }, 1], extra: true },
  "answers.a",
  true,
  null,
];

describe("admin rule builder model (T3-10)", () => {
  it("round-trips every builder shape: model → JSON → the same model and the same JSON", () => {
    for (const m of MODELS) {
      const json = buildRule(m);
      expect(parseRule(json), JSON.stringify(json)).toEqual(m);
      expect(JSON.stringify(buildRule(parseRule(json) as RuleNode))).toBe(JSON.stringify(json));
      expect(isValidExpression(json), JSON.stringify(json)).toBe(true);
    }
  });

  it("opens every seeded condition unchanged", () => {
    for (const rule of SEEDED) {
      const m = parseRule(rule);
      expect(m, JSON.stringify(rule)).not.toBeNull();
      expect(JSON.stringify(buildRule(m as RuleNode))).toBe(JSON.stringify(rule));
    }
  });

  it("leaves rules it can't show exactly to the JSON view", () => {
    for (const rule of NOT_BUILDABLE) expect(parseRule(rule), JSON.stringify(rule)).toBeNull();
  });

  it("only writes complete conditions", () => {
    expect(MODELS.every(isComplete)).toBe(true);
    expect(isComplete({ t: "cond", path: "", op: "answered" })).toBe(false);
    expect(isComplete({ t: "cond", path: "answers.a", op: "eq" })).toBe(false);
    expect(isComplete({ t: "cond", path: "answers.a", op: "eq", value: "" })).toBe(false);
    expect(isComplete({ t: "cond", path: "answers.a", op: "between", value: 1 })).toBe(false);
    expect(isComplete({ t: "cond", path: "answers.a", op: "in", values: [] })).toBe(false);
    expect(isComplete({ t: "group", join: "and", items: [] })).toBe(false);
    expect(isComplete({ t: "group", join: "or", items: [A, { t: "cond", path: "answers.a", op: "eq" }] })).toBe(false);
  });

  it("gives the same answers as the rule it came from", () => {
    const data = { answers: { trading: false, premises_type: "shop", staff: 4, ecommerce_pct: 50, services: ["delivery"], notes: null }, job: { attributes: { risk_tier: "high" } }, inspection: { geofence: { profile: "standalone" }, attempt: 2 } };
    const results = MODELS.map((m) => evaluate(buildRule(m), data as unknown as JsonValue, { today: null, optionMeta: {} }));
    expect(results.slice(0, 4)).toEqual([true, true, false, true]);
  });
});
