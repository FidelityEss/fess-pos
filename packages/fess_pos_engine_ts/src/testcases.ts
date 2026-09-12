/**
 * Definition test cases (docs/04 §9, B4.12): recorded scenarios of context + answer steps with
 * expected visibility, required flags, computed values, options, props, labels and validation errors.
 * Publishing runs every test case of the family; any failure blocks the publish.
 *
 * Answers are built the way the module builds a submission: visible fields only (hidden ⇒ absent),
 * computed fields from the resolver (`computed: true`), prefilled fields from the context.
 */
import type { JsonObject, JsonValue } from "./json.ts";
import { deepEqual, isPlainObject } from "./json.ts";
import { compileForm, resolveForm } from "./resolver.ts";
import type { ResolveContext, ResolveLists, ResolvedField, ResolvedForm } from "./resolver.ts";
import { validateAnswers } from "./validator.ts";
import type { AnswerEntry } from "./validator.ts";
import { hasValue } from "./definitions/catalogue.ts";
import type { FormDefinition } from "./definitions/types.ts";
import type { ValidationError } from "./validator.ts";

export interface TestExpectation {
  visible?: Record<string, boolean>;
  required?: Record<string, boolean>;
  read_only?: Record<string, boolean>;
  /** Effective values (computed or answered) by field path. */
  values?: Record<string, JsonValue>;
  options?: Record<string, string[]>;
  /** Subset match on resolved props. */
  props?: Record<string, JsonObject>;
  labels?: Record<string, string>;
  /** Exact set of validation errors (field_key + code). */
  errors?: { field_key: string; code: string }[];
  valid?: boolean;
}

export interface TestStep {
  set?: Record<string, JsonValue>;
  unset?: string[];
  expect?: TestExpectation;
}

export interface TestCase {
  name: string;
  context?: ResolveContext;
  lists?: ResolveLists;
  steps?: TestStep[];
  expect?: TestExpectation;
}

export interface TestFailure {
  readonly step: number | "final";
  readonly check: string;
  readonly path: string;
  readonly expected: JsonValue;
  readonly actual: JsonValue;
}

export interface TestCaseResult {
  readonly name: string;
  readonly passed: boolean;
  readonly failures: TestFailure[];
}

function lookup(resolved: ResolvedForm, path: string): ResolvedField | undefined {
  const m = /^([a-z][a-z0-9_]*)\[(\d+)\]\.([a-z][a-z0-9_]*)$/.exec(path);
  if (!m) return resolved.fields[path];
  const group = resolved.fields[m[1] as string];
  return group?.items?.[Number(m[2])]?.fields[m[3] as string];
}

/** Build a submission-style answers map from raw state, as the module would. */
export function buildAnswers(form: FormDefinition, resolved: ResolvedForm, state: Record<string, JsonValue>): Record<string, AnswerEntry> {
  const compiled = compileForm(form);
  const out: Record<string, AnswerEntry> = {};
  for (const cf of compiled.fields) {
    const key = cf.def.key;
    const rf = resolved.fields[key];
    if (!rf || !rf.visible || !hasValue(cf.spec)) continue;
    if (rf.computed) {
      if (rf.value !== null) out[key] = { v: rf.value, computed: true };
      continue;
    }
    if (cf.spec.type === "prefilled") {
      if (rf.value !== null) out[key] = { v: rf.value, prefilled: true };
      continue;
    }
    if (cf.spec.type === "repeatable_group" && Array.isArray(state[key])) {
      const items = (rf.items ?? []).map((item) => {
        const entry: Record<string, JsonValue> = {};
        for (const [ck, kf] of Object.entries(item.fields)) {
          if (!kf.visible || kf.type === "group" || kf.type === "info" || kf.type === "callout" || kf.type === "divider" || kf.type === "image") continue;
          if (kf.computed) {
            if (kf.value !== null) entry[ck] = { v: kf.value, computed: true };
          } else if (kf.type === "prefilled") {
            if (kf.value !== null) entry[ck] = { v: kf.value, prefilled: true };
          } else if (kf.value !== null) {
            entry[ck] = { v: kf.value };
          }
        }
        return entry as JsonValue;
      });
      out[key] = { v: items };
      continue;
    }
    const v = state[key];
    if (v !== undefined) out[key] = { v };
  }
  return out;
}

function check(exp: TestExpectation, resolved: ResolvedForm, errors: readonly ValidationError[], step: number | "final", failures: TestFailure[]): void {
  const fail = (check: string, path: string, expected: JsonValue, actual: JsonValue): void => {
    failures.push({ step, check, path, expected, actual });
  };
  const each = <T extends JsonValue>(m: Record<string, T> | undefined, name: string, get: (rf: ResolvedField) => JsonValue, eq: (a: T, b: JsonValue) => boolean = (a, b) => deepEqual(a, b)): void => {
    for (const [path, expected] of Object.entries(m ?? {})) {
      const rf = lookup(resolved, path);
      const actual = rf ? get(rf) : null;
      if (!rf || !eq(expected, actual)) fail(name, path, expected, rf ? actual : "<no such field>");
    }
  };
  each(exp.visible, "visible", (rf) => rf.visible);
  each(exp.required, "required", (rf) => rf.required);
  each(exp.read_only, "read_only", (rf) => rf.read_only);
  each(exp.values, "value", (rf) => rf.value);
  each(exp.labels, "label", (rf) => rf.label ?? null);
  each(exp.options, "options", (rf) => (rf.options ?? []).map((o) => o.value));
  each(exp.props, "props", (rf) => rf.props, (expected, actual) => {
    if (!isPlainObject(actual)) return false;
    return Object.entries(expected).every(([k, v]) => deepEqual(v, (actual as JsonObject)[k] ?? null));
  });
  if (exp.errors) {
    const want = exp.errors.map((e) => `${e.field_key}|${e.code}`).sort();
    const got = errors.map((e) => `${e.field_key}|${e.code}`).sort();
    if (!deepEqual(want, got)) fail("errors", "", want, got);
  }
  if (exp.valid !== undefined && exp.valid !== (errors.length === 0)) fail("valid", "", exp.valid, errors.length === 0);
}

export function runTestCase(form: FormDefinition, tc: TestCase): TestCaseResult {
  const state: Record<string, JsonValue> = {};
  const failures: TestFailure[] = [];
  const context = tc.context ?? {};
  const lists = tc.lists ?? {};
  const evaluateState = (): { resolved: ResolvedForm; errors: ValidationError[] } => {
    const resolved = resolveForm(form, context, state, lists);
    const answers = buildAnswers(form, resolved, state);
    const res = validateAnswers(form, answers, context, lists);
    return { resolved: res.resolved ?? resolved, errors: res.errors };
  };
  try {
    (tc.steps ?? []).forEach((step, i) => {
      for (const [k, v] of Object.entries(step.set ?? {})) state[k] = v;
      for (const k of step.unset ?? []) delete state[k];
      if (step.expect) {
        const { resolved, errors } = evaluateState();
        check(step.expect, resolved, errors, i, failures);
      }
    });
    if (tc.expect) {
      const { resolved, errors } = evaluateState();
      check(tc.expect, resolved, errors, "final", failures);
    }
  } catch (e) {
    failures.push({ step: "final", check: "exception", path: "", expected: null, actual: e instanceof Error ? e.message : String(e) });
  }
  return { name: tc.name, passed: failures.length === 0, failures };
}

export function runTestCases(form: FormDefinition, cases: readonly TestCase[]): { passed: boolean; results: TestCaseResult[] } {
  const results = cases.map((c) => runTestCase(form, c));
  return { passed: results.every((r) => r.passed), results };
}
