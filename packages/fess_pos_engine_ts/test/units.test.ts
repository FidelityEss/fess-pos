/** Targeted unit tests for paths the fixture contract does not reach. */
import { describe, expect, it } from "vitest";
import { parseDefinitionOfKind } from "../src/definitions/index.ts";
import type { FieldDef, FormDefinition, SectionDef } from "../src/definitions/index.ts";
import { compileForm, resolveForm } from "../src/resolver.ts";
import { contextFromSnapshot, validateAnswers, validateSubmission } from "../src/validator.ts";
import { decimalPlaces, isEmptyAnswer, isValidZaId, validateValue, zaIdDerived } from "../src/values.ts";
import { analyseDefinition, computeRequires } from "../src/analyser.ts";
import { buildAnswers, runTestCase } from "../src/testcases.ts";
import { checkSafeRegex, compileSafeRegex, evaluate, evaluateBoolean, inferType } from "../src/rules/index.ts";
import { dateAdd, dateDiff, tryParseDate, civilFromDays, daysFromCivil } from "../src/rules/dates.ts";
import { EngineError, RuleError } from "../src/errors.ts";
import { cloneJson, getOwn, hasOwnKey, isJsonObject, isJsonValue, jsonTypeOf, readPath } from "../src/json.ts";
import { renderScalar, templatePaths } from "../src/definitions/templates.ts";
import { resolveRemoteConfig } from "../src/config/remote-config.ts";
import type { JsonObject, JsonValue } from "../src/json.ts";

function form(fields: FieldDef[], section: Partial<SectionDef> = {}): FormDefinition {
  const res = parseDefinitionOfKind({ spec_version: "1.0", kind: "form", family: "t", version: 1, sections: [{ key: "s", fields, ...section }] }, "form");
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.definition;
}
const codes = (xs: readonly { code: string }[]): string[] => xs.map((x) => x.code).sort();

describe("resolver", () => {
  it("falls back safely when rules fail, and records the problem", () => {
    const f = form([
      { key: "a", type: "text", visible: { "<": ["x", 1] } },
      { key: "b", type: "text", visible: { "+": [1, 2] } },
      { key: "c", type: "number", required: { "+": ["x"] }, props: { min: { concat: ["a"] }, max: { "+": ["a"] } } },
      { key: "d", type: "text", label: { concat: ["Hi ", { var: "answers.n" }] } },
      { key: "e", type: "text", label: { "+": [1, 2] } },
      { key: "f", type: "text", label: { var: "missing" } },
      { key: "n", type: "text", default: { var: "job.name" } },
      { key: "g", type: "text", label: { "+": ["x"] } },
    ]);
    const r = resolveForm(f, { job: { name: "Joe" } }, { n: "Bob" });
    expect(r.fields["a"]?.visible).toBe(true);
    expect(r.fields["b"]?.visible).toBe(true);
    expect(r.fields["c"]?.required).toBe(false);
    expect(r.fields["c"]?.props).toEqual({});
    expect(r.fields["d"]?.label).toBe("Hi Bob");
    expect(r.fields["e"]?.label).toBeUndefined();
    expect(r.fields["f"]?.label).toBe("");
    expect(r.fields["n"]?.default_value).toBe("Joe");
    expect(r.errors.map((e) => `${e.path}:${e.property}`).sort()).toEqual(["a:visible", "b:visible", "c:props.max", "c:props.min", "c:required", "e:label", "g:label"]);
  });

  it("resolves option sources, filters and display text", () => {
    const f = form([
      { key: "l", type: "lookup", props: { list: "provinces" } },
      { key: "r", type: "single_select", options_source: { type: "reason_codes", category: "unable" } },
      { key: "k", type: "single_select", options_source: { type: "lookup_list", key: "missing" } },
      { key: "q", type: "single_select", options_filter: { "+": ["x"] }, options: [{ value: "a", label: "A" }] },
      { key: "i", type: "info", text: "Ref {{job.reference}}" },
      { key: "img", type: "image", asset: { sha256: "a".repeat(64) }, caption: "Cap {{job.reference}}" },
    ]);
    const r = resolveForm(f, { job: { reference: "R1" } }, {}, { lookup_lists: { provinces: [{ value: "GP", label: "Gauteng" }] }, reason_codes: { unable: [{ value: "x", label: "X" }] } });
    expect(r.fields["l"]?.options?.map((o) => o.value)).toEqual(["GP"]);
    expect(r.fields["r"]?.options?.map((o) => o.value)).toEqual(["x"]);
    expect(r.fields["k"]?.options).toEqual([]);
    expect(r.fields["q"]?.options?.map((o) => o.value)).toEqual(["a"]);
    expect(r.fields["i"]?.text).toBe("Ref R1");
    expect(r.fields["img"]?.text).toBe("Cap R1");
    expect(r.env.optionMeta?.["r"]).toEqual({ x: {} });
  });

  it("section and group visibility hide their fields; section titles render", () => {
    const f = form(
      [
        { key: "flag", type: "boolean" },
        { key: "g", type: "group", visible: { "==": [{ var: "answers.flag" }, true] }, fields: [{ key: "inner", type: "text", required: true }, { key: "g2", type: "group", fields: [{ key: "deep", type: "text" }] }] },
      ],
      { title: "Hello {{agent.name}}" },
    );
    const hidden = resolveForm(f, { agent: { name: "Sipho" } }, { flag: false, inner: "x" });
    expect(hidden.fields["inner"]?.visible).toBe(false);
    expect(hidden.fields["deep"]?.visible).toBe(false);
    expect(hidden.values["inner"]).toBeUndefined();
    expect(hidden.sections["s"]).toEqual({ key: "s", visible: true, title: "Hello Sipho" });
    const shown = resolveForm(f, {}, { flag: true, inner: "x" });
    expect(shown.values["inner"]).toBe("x");
    const hiddenSection = form([{ key: "a", type: "text" }], { visible: false });
    expect(resolveForm(hiddenSection).sections["s"]).toEqual({ key: "s", visible: false });
  });

  it("repeatable groups tolerate malformed items and apply child rules per item", () => {
    const f = form([
      { key: "rg", type: "repeatable_group", fields: [
        { key: "kind", type: "text" },
        { key: "extra", type: "text", visible: { "==": [{ var: "item.kind" }, "shop"] } },
        { key: "tag", type: "computed", value: { concat: [{ var: "item.kind" }, "!"] } },
        { key: "ref", type: "prefilled", props: { source: "job.reference" } },
      ] },
    ]);
    expect(resolveForm(f, {}, { rg: "oops" }).values["rg"]).toBe("oops");
    const r = resolveForm(f, { job: { reference: "R9" } }, { rg: [{ kind: "shop", extra: "x" }, "bad", { kind: "home", extra: "y" }] });
    const items = r.fields["rg"]?.items ?? [];
    expect(items.map((i) => i.fields["extra"]?.visible)).toEqual([true, false, false]);
    expect(items.map((i) => i.fields["tag"]?.value)).toEqual(["shop!", "!", "home!"]);
    expect(r.values["rg"]).toEqual([
      { kind: "shop", extra: "x", tag: "shop!", ref: "R9" },
      { kind: null, tag: "!", ref: "R9" },
      { kind: "home", tag: "home!", ref: "R9" },
    ]);
    const built = buildAnswers(f, r, { rg: [{ kind: "shop", extra: "x" }] });
    expect(built["rg"]?.v).toEqual([
      { kind: { v: "shop" }, extra: { v: "x" }, tag: { v: "shop!", computed: true }, ref: { v: "R9", prefilled: true } },
      { tag: { v: "!", computed: true }, ref: { v: "R9", prefilled: true } },
      { kind: { v: "home" }, tag: { v: "home!", computed: true }, ref: { v: "R9", prefilled: true } },
    ]);
  });

  it("derived za_id facts feed rules; cycles and unknown components are refused", () => {
    const f = form([
      { key: "age", type: "computed", value: { date_diff: [{ var: "derived.id.dob" }, { today: [] }, "years"] } },
      { key: "id", type: "id_number", props: { scheme: "za_id" } },
    ]);
    const r = resolveForm(f, { today: "2026-09-10" }, { id: "8001015009087" });
    expect(r.data["derived"]).toEqual({ id: { dob: "1980-01-01", gender: "male" } });
    expect(r.values["age"]).toBe(46);
    const cyclic = form([{ key: "a", type: "computed", value: { var: "answers.b" } }, { key: "b", type: "computed", value: { var: "answers.a" } }]);
    expect(() => resolveForm(cyclic)).toThrowError(EngineError);
    const kidCycle = form([{ key: "g", type: "repeatable_group", fields: [{ key: "x", type: "text", visible: { "==": [{ var: "item.y" }, 1] } }, { key: "y", type: "text", visible: { "==": [{ var: "item.x" }, 1] } }] }]);
    expect(() => compileForm(kidCycle)).toThrow(/RESOLVER_CYCLE/);
    const bogus = { spec_version: "1.0", kind: "form", family: "t", version: 1, sections: [{ key: "s", fields: [{ key: "a", type: "nope" }] }] } as FormDefinition;
    expect(() => compileForm(bogus)).toThrow(/UNSUPPORTED_COMPONENT/);
    expect(compileForm(f)).toBe(compileForm(f));
  });
});

describe("value shapes", () => {
  const v = (type: string, value: JsonValue, props: JsonObject = {}, env = {}): string[] => codes(validateValue(type, value, props, env));
  it("identity and registration schemes", () => {
    expect(v("registration_number", "4123456789", { scheme: "vat_za" })).toEqual([]);
    expect(v("registration_number", "5123456789", { scheme: "vat_za" })).toEqual(["INVALID_FORMAT"]);
    expect(v("registration_number", "AB12", { scheme: "custom", pattern: "^[A-Z]{2}[0-9]{2}$" })).toEqual([]);
    expect(v("registration_number", 5, { scheme: "cipc" })).toEqual(["INVALID_TYPE"]);
    expect(v("id_number", "A1234567", { scheme: "passport" })).toEqual([]);
    expect(v("id_number", "a1", { scheme: "passport" })).toEqual(["INVALID_FORMAT"]);
    expect(v("id_number", "X-1", { scheme: "custom", pattern: "^[0-9]+$" })).toEqual(["PATTERN_MISMATCH"]);
    expect(v("id_number", 1, { scheme: "za_id" })).toEqual(["INVALID_TYPE"]);
    expect(v("email", `${"a".repeat(250)}@x.co`)).toEqual(["INVALID_FORMAT"]);
    expect(v("email", 1)).toEqual(["INVALID_TYPE"]);
    expect(v("phone", 1)).toEqual(["INVALID_TYPE"]);
    expect(v("textarea", "abc", { min_length: 5 })).toEqual(["TOO_SHORT"]);
  });
  it("choices, numbers and dates", () => {
    expect(v("boolean", "true")).toEqual(["INVALID_TYPE"]);
    expect(v("single_select", 1)).toEqual(["INVALID_TYPE"]);
    expect(v("lookup", "x")).toEqual([]);
    expect(v("multi_select", "x")).toEqual(["INVALID_TYPE"]);
    expect(v("multi_select", ["a"], { min_select: 2 })).toEqual(["TOO_FEW"]);
    expect(v("number", Number.POSITIVE_INFINITY)).toEqual(["INVALID_TYPE"]);
    expect(v("rating", 5)).toEqual([]);
    expect(v("rating", 6)).toEqual(["OUT_OF_RANGE"]);
    expect(v("slider", 3, { min: 0, max: 10, step: 1 })).toEqual([]);
    expect(v("currency", 5)).toEqual(["INVALID_TYPE"]);
    expect(v("currency", { minor: 5, currency: "zar" })).toEqual(["INVALID_TYPE"]);
    expect(v("currency", { minor: 500, currency: "ZAR" }, { max: 100 })).toEqual(["ABOVE_MAX"]);
    expect(v("date", "2026-01-01", { min: "2026-02-01T00:00:00Z" })).toEqual(["BELOW_MIN"]);
    expect(v("time", "05:00", { min: "06:00" })).toEqual(["BELOW_MIN"]);
    expect(v("datetime", "2026-09-10T10:00:00Z", { max: "2026-09-10T09:00:00Z" })).toEqual(["ABOVE_MAX"]);
    expect(v("datetime", "2026-09-10T10:00:00Z", { max: "not a date" })).toEqual([]);
    expect(v("duration", 3)).toEqual(["INVALID_TYPE"]);
    expect(v("duration", { value: 2, unit: "days" })).toEqual([]);
  });
  it("hours, locations and legal shapes", () => {
    expect(v("business_hours", "open")).toEqual(["INVALID_TYPE"]);
    expect(v("business_hours", { weekdays: "24h", saturday: "closed", sunday: "closed", public_holidays: "closed" })).toEqual(["INVALID_HOURS"]);
    expect(v("business_hours", { weekdays: { open: "8", close: "17:00" }, saturday: "closed", sunday: "closed", public_holidays: "closed" })).toEqual(["INVALID_HOURS"]);
    expect(v("address", "x")).toEqual(["INVALID_TYPE"]);
    expect(v("address", { line1: "a", city: "b", province: "c", line2: "x".repeat(201) })).toEqual(["INVALID_FORMAT"]);
    expect(v("address", { line1: "a", city: "b", province: "c", pin: { lat: 1, lng: 1, source: "gps" } }, { map_pin: "none" })).toEqual(["PIN_NOT_ALLOWED"]);
    expect(v("address", { line1: "a", city: "b", province: "c", pin: { lat: 91, lng: 1, source: "map_pin" } })).toEqual(["INVALID_FORMAT"]);
    expect(v("location_pin", { lat: 1, lng: 1 })).toEqual(["INVALID_TYPE"]);
    expect(v("location_pin", { lat: 1, lng: 1, source: "map_pin" }, { max_distance_from_job_m: 10 }, { job: { location: null } })).toEqual([]);
    expect(v("location_pin", { lat: 1, lng: 1, source: "map_pin" }, { max_distance_from_job_m: 10 })).toEqual([]);
    const fix = { lat: 1, lng: 1, accuracy_m: 5, ts: "2026-09-10T10:00:00Z", is_mocked: false };
    expect(v("current_location", { ...fix, accuracy_m: -1 })).toEqual(["INVALID_TYPE"]);
    expect(v("current_location", { ...fix, ts: "yesterday" })).toEqual(["INVALID_TYPE"]);
    expect(v("current_location", { ...fix, gnss_ts: "x" })).toEqual(["INVALID_TYPE"]);
    expect(v("photo", "x")).toEqual(["INVALID_TYPE"]);
    expect(v("signature", "0191d3c2-7a4e-7c1b-9f10-4b2e1c0a9d01")).toEqual([]);
    const decl = { accepted: true, declaration_version_id: "0191d3c2-7a4e-7c1b-9f10-4b2e1c0a9d01", accepted_at: "2026-09-10T10:00:00Z" };
    expect(v("declaration", { ...decl, declaration_version_id: "x" })).toEqual(["INVALID_TYPE"]);
    expect(v("declaration", { ...decl, accepted_at: "x" })).toEqual(["INVALID_TYPE"]);
    expect(v("declaration", "x")).toEqual(["INVALID_TYPE"]);
    expect(v("acknowledgement", "yes")).toEqual(["INVALID_TYPE"]);
    const consent = { given: true, text_version_id: "0191d3c2-7a4e-7c1b-9f10-4b2e1c0a9d01", at: "2026-09-10T10:00:00Z", by_name: "A" };
    expect(v("consent", consent)).toEqual([]);
    expect(v("consent", { ...consent, given: "yes" })).toEqual(["INVALID_TYPE"]);
    expect(v("consent", { ...consent, text_version_id: "x" })).toEqual(["INVALID_TYPE"]);
    expect(v("consent", { ...consent, at: "x" })).toEqual(["INVALID_TYPE"]);
    expect(v("consent", 1)).toEqual(["INVALID_TYPE"]);
  });
  it("matrix, containers and helpers", () => {
    const props = { rows: [{ key: "r1", label: "R1" }, { key: "r2", label: "R2" }], columns: [{ value: "a", label: "A" }, { value: "b", label: "B" }], required_rows: ["r1"] };
    expect(v("matrix", [], props)).toEqual(["INVALID_TYPE"]);
    expect(v("matrix", { r1: ["a", "b"], r2: ["a", "a"] }, { ...props, cell_type: "multi" })).toEqual(["INVALID_OPTION"]);
    expect(v("matrix", { r1: "note", r2: 5 }, { ...props, cell_type: "text" })).toEqual(["INVALID_TYPE"]);
    expect(v("matrix", { r2: "a" }, { ...props, cell_type: "single" })).toEqual(["MISSING_ROW"]);
    expect(v("repeatable_group", "x")).toEqual(["INVALID_TYPE"]);
    expect(v("computed", { any: "thing" })).toEqual([]);
    expect(isEmptyAnswer(undefined)).toBe(true);
    expect(isEmptyAnswer({})).toBe(true);
    expect(isEmptyAnswer(0)).toBe(false);
    expect([decimalPlaces(1e-7), decimalPlaces(1.25), decimalPlaces(100), decimalPlaces(1e21), decimalPlaces(-2.5)]).toEqual([7, 2, 0, 0, 1]);
    expect(isValidZaId("8013015009087")).toBe(false);
    expect(zaIdDerived("8001015009087", null)).toBeNull();
    expect(zaIdDerived("0501014800087", "2026-09-10")).toEqual({ dob: "2005-01-01", gender: "female" });
    expect(zaIdDerived("0002295009084", "2026-09-10")).toEqual({ dob: "2000-02-29", gender: "male" });
  });
});

describe("validator", () => {
  const f = form([
    { key: "d", type: "date", props: { allow_unknown: true } },
    { key: "s", type: "single_select", options: [{ value: "a", label: "A" }] },
    { key: "addr", type: "address", fallback: { type: "text", props: { max_length: 5 } } },
    { key: "n", type: "number", validate: [{ rule: { "+": [1, 2] }, message: "x" }, { rule: { "+": ["x"] }, message: "y" }, { rule: false, message: "Always {{answers.n}}" }, { rule: true, message: "never" }] },
  ]);
  it("rejects malformed answer maps and entries", () => {
    expect(codes(validateAnswers(f, "x").errors)).toEqual(["INVALID_ANSWERS"]);
    const bad = validateAnswers(f, { d: { v: null, prefilled: "yes" }, s: { v: "a", rendered_as: 1 }, n: { v: 1, other_text: 2 }, addr: {} });
    expect(codes(bad.errors)).toEqual(["INVALID_ENTRY", "INVALID_ENTRY", "INVALID_ENTRY", "INVALID_ENTRY"]);
  });
  it("unknown dates, other_text, fallbacks and validate rules", () => {
    expect(codes(validateAnswers(f, { d: { v: "2026-01-01", unknown: true } }).errors)).toEqual(["INVALID_ENTRY"]);
    expect(codes(validateAnswers(f, { d: { v: null, unknown: true } }).errors)).toEqual([]);
    expect(codes(validateAnswers(f, { s: { v: null, other_text: "x" } }).errors)).toEqual(["INVALID_ENTRY"]);
    expect(codes(validateAnswers(f, { s: { v: "a", other_text: "x" } }).errors)).toEqual(["INVALID_ENTRY"]);
    expect(codes(validateAnswers(f, { addr: { v: "123456", rendered_as: "text" } }).errors)).toEqual(["TOO_LONG"]);
    const res = validateAnswers(f, { n: { v: 7 } });
    expect(codes(res.errors)).toEqual(["RULE_ERROR", "RULE_ERROR", "VALIDATION_RULE_FAILED"]);
    expect(res.errors.find((e) => e.code === "VALIDATION_RULE_FAILED")?.message).toBe("Always 7");
  });
  it("context snapshots and hash failures", async () => {
    expect(contextFromSnapshot(undefined)).toEqual({});
    expect(contextFromSnapshot({ today: 5 }).today).toBeNull();
    const lone = String.fromCharCode(0xd800);
    const res = await validateSubmission(f, { answers: { s: { v: "a", other_text: lone } }, answers_hash: "a".repeat(64) }, { context: {} });
    expect(res.errors.map((e) => e.code)).toContain("ANSWERS_HASH_MISMATCH");
  });
});

describe("analyser branches", () => {
  const A = (def: unknown, bundle = {}) => analyseDefinition(def, bundle);
  const errs = (r: ReturnType<typeof A>) => [...new Set(r.errors.map((e) => e.code))].sort();
  const warns = (r: ReturnType<typeof A>) => [...new Set(r.warnings.map((e) => e.code))].sort();
  const F = (fields: unknown[], extra = {}) => ({ spec_version: "1.0", kind: "form", family: "t", version: 1, sections: [{ key: "s", fields }], ...extra });
  const FL = (steps: unknown[], extra = {}) => ({ spec_version: "1.0", kind: "flow", family: "f", version: 1, form_family: "t", steps, ...extra });
  const followup = F([{ key: "a", type: "text" }], { family: "followup" }) as unknown as FormDefinition;

  it("form references to supporting data and structure", () => {
    expect(errs(A(F([{ key: "m", type: "multi_select", options: [{ value: "a", label: "A" }], props: { exclusive_options: ["z"] } }])))).toEqual(["MISSING_REF"]);
    expect(errs(A(F([{ key: "x", type: "matrix", props: { rows: [{ key: "r", label: "R" }, { key: "r", label: "R" }], columns: [{ value: "a", label: "A" }, { value: "a", label: "A" }], cell_type: "single", required_rows: ["q"] } }])))).toEqual(["DUPLICATE_KEY", "DUPLICATE_OPTION_VALUE", "MISSING_REF"]);
    expect(warns(A(F([{ key: "a", type: "text", visible: { "==": [{ var: "previous.answers.gone" }, 1] } }])))).toEqual(["MISSING_PREVIOUS_REF"]);
    expect(errs(A(F([{ key: "d", type: "declaration", props: { declaration_key: "x" } }], { declaration_key: "y" }), { declarations: ["z"] }))).toEqual(["MISSING_REF"]);
    expect(errs(A(F([{ key: "r", type: "single_select", options_source: { type: "reason_codes", category: "q" } }]), { reason_code_categories: ["z"] }))).toEqual(["MISSING_REF"]);
    expect(errs(A(F([{ key: "s", type: "single_select", options: [{ value: "a", label: "A" }], options_filter: { "+": [1, 2] } }])))).toEqual(["TYPE_MISMATCH"]);
    expect(errs(A(F([{ key: "a", type: "text", risk_indicator: { when: { "+": [1, 1] }, level: "high" }, validate: [{ rule: { "+": [1, 1] }, message: "m {{" }] }])))).toEqual(["INVALID_TEMPLATE", "TYPE_MISMATCH"]);
    expect(errs(A(F([{ key: "d", type: "date", props: { min: "2026-02-01", max: "2026-01-01" } }])))).toEqual(["MIN_GREATER_THAN_MAX"]);
    expect(errs(A(F([{ key: "a", type: "text", label: { "+": [1, 2] } }])))).toEqual(["TYPE_MISMATCH"]);
    expect(errs(A(F([{ key: "id", type: "id_number", props: { scheme: "za_id" } }, { key: "x", type: "text", visible: { "==": [{ var: "derived.id.gender" }, "female"] } }])))).toEqual([]);
    expect(errs(A(F([{ key: "n", type: "number", props: { min: { "if": [true, "a", "b"] } } }])))).toEqual(["TYPE_MISMATCH"]);
    expect(errs(A(F([{ key: "t", type: "text", props: { placeholder: "{{answers.zz}}" } }])))).toEqual(["MISSING_REF"]);
    expect(errs(A({ kind: "nope" }))).toEqual(["DEF_UNKNOWN_KIND"]);
  });

  it("type inference across operators", () => {
    const fields = [{ key: "b", type: "boolean" }, { key: "n", type: "number" }, { key: "m", type: "multi_select", options: [{ value: "a", label: "A" }] }, { key: "t", type: "text" }];
    const vis = (e: unknown) => errs(A(F([...fields, { key: "z", type: "text", visible: e }])));
    expect(vis({ and: [{ var: "answers.n" }] })).toEqual(["TYPE_MISMATCH"]);
    expect(vis({ in: ["a", { var: "answers.n" }] })).toEqual(["TYPE_MISMATCH"]);
    expect(vis({ contains: [{ var: "answers.b" }, "a"] })).toEqual(["TYPE_MISMATCH"]);
    expect(vis({ some: [{ var: "answers.t" }, true] })).toEqual(["TYPE_MISMATCH"]);
    expect(vis({ ">": [{ length: [{ var: "answers.b" }] }, 1] })).toEqual(["TYPE_MISMATCH"]);
    expect(vis({ starts_with: [{ var: "answers.n" }, "a"] })).toEqual(["TYPE_MISMATCH"]);
    expect(vis({ ">": [{ date_diff: [{ var: "answers.n" }, "2026-01-01", "days"] }, 1] })).toEqual(["TYPE_MISMATCH"]);
    expect(vis({ "==": [{ date_add: ["2026-01-01", { var: "answers.t" }, "days"] }, "x"] })).toEqual(["TYPE_MISMATCH"]);
    expect(vis({ within_m: [{ var: "answers.n" }, { var: "job.location" }, "x"] })).toEqual(["TYPE_MISMATCH"]);
    expect(vis({ "==": [{ var: ["answers.n", "x"] }, 1] })).toEqual([]);
    expect(vis({ "==": [{ if: [true, 1, "a"] }, 1] })).toEqual([]);
    expect(vis({ "==": [{ count: [{ var: "answers.m" }, { "==": [{ var: "current" }, "a"] }] }, 1] })).toEqual([]);
    expect(vis({ "==": [{ option_meta: ["answers.m", "k"] }, 1] })).toEqual([]);
    expect(vis({ "==": [{ var: "index" }, 1] })).toEqual(["UNKNOWN_ROOT"]);
    expect(vis({ "==": [[1, 2], [1]] })).toEqual([]);
    const issues: { operator: string; message: string }[] = [];
    expect(inferType({ nope: [] }, () => "any", issues)).toBe("any");
  });

  it("flows", () => {
    const withForm = { forms: { followup } };
    const flowFor = (steps: unknown[], extra = {}) => FL(steps, { form_family: "followup", ...extra });
    const base = [{ type: "location_check" }, { type: "form", sections: ["s"] }, { type: "declaration" }, { type: "submit" }];
    expect(errs(A(flowFor(base), withForm))).toEqual(["DECLARATION_FIELD_MISSING"]);
    const r = A(flowFor([{ type: "location_check" }, { type: "form", sections: ["s"], next: { var: "answers.a" } }, { type: "summary_review", visible: false }, { type: "declaration" }, { type: "submit" }]), withForm);
    expect(warns(r)).toEqual(["DYNAMIC_NEXT", "STEP_NEVER_VISIBLE"]);
    expect(errs(A(FL([{ type: "form", sections: ["s"] }], { action: "record.submit" })))).toEqual(["NO_SUBMIT_STEP"]);
    expect(errs(A(FL([...base, { type: "submit" }, { type: "location_check" }])))).toEqual(["INTEGRITY_STEP_DUPLICATE", "INTEGRITY_STEP_ORDER"]);
    expect(errs(A(FL([{ type: "location_check" }, { type: "declaration" }, { type: "submit" }, { type: "form", sections: ["s"] }])))).toEqual(["INTEGRITY_STEP_ORDER"]);
    // A literal next that leaves the flow means the following step is never reached from there.
    expect(errs(A(FL([{ type: "form", sections: ["s"], next: "flow:ghost" }, { type: "submit" }], { action: "job.unable" }), { flows: {} }))).toEqual(["MISSING_FLOW_REF", "UNREACHABLE_STEP"]);
    expect(errs(A(FL([{ type: "form", sections: ["s"] }, { type: "submit" }], { action: "job.unable", form_family: undefined })))).toEqual(["MISSING_FORM_REF"]);
    expect(errs(A(FL([{ type: "form", sections: ["s"] }, { type: "submit" }], { action: "job.unable" }), { forms: {} }))).toEqual(["MISSING_FORM_REF"]);
    expect(warns(A(FL([{ type: "form", sections: ["s"], next: "page:home" }, { type: "submit" }], { action: "lead.create" })))).toEqual(["ACTION_PENDING_DECISION"]);
    expect(errs(A(flowFor([{ type: "location_check" }, { type: "form", sections: ["s"], next: { if: [{ "==": [{ var: "answers.a" }, "x"] }, "decl"] } }, { id: "decl", type: "declaration" }, { type: "submit" }]), withForm))).toEqual(["DECLARATION_FIELD_MISSING"]);
    expect(errs(A(flowFor([{ type: "location_check" }, { type: "form", sections: ["s"], next: { if: [{ "==": [{ var: "answers.a" }, 1] }, "decl"] } }, { id: "decl", type: "declaration" }, { type: "submit" }]), withForm))).toEqual(["DECLARATION_FIELD_MISSING", "TYPE_MISMATCH"]);
  });

  it("apps and views", () => {
    const P = (pages: unknown, extra = {}) => ({ spec_version: "1.0", kind: "app", family: "a", version: 1, home: "home", pages, ...extra });
    const out = { ok: { type: "outcome_page", outcome: "success" }, sv: { type: "outcome_page", outcome: "saved" }, fl: { type: "outcome_page", outcome: "failure", buttons: [{ label: "x", action: "page", target: { page: "ghost" } }] } };
    const sets = { outcome_sets: { default: { success: "ok", saved: "sv", failure: "fl" } } };
    const app = P({ home: { type: "form_page", form: "followup", sections: ["zz"], action: "record.submit", outcomes: "default", title: "Hi {{" }, ...out }, sets);
    expect(errs(A(app, { forms: { followup } }))).toEqual(["INVALID_TEMPLATE", "MISSING_PAGE_REF", "MISSING_SECTION_REF"]);
    expect(errs(A(P({ home: { type: "form_page", form: "ghost", action: "record.submit", outcomes: "default" }, ...out }, sets), { forms: {} }))).toContain("MISSING_FORM_REF");
    expect(errs(A(P({ home: { type: "list_page", source: "inspections", item_view: "ghost", on_tap: { flow: "f" } } }), { views: {}, flows: {} }))).toEqual(["MISSING_FLOW_REF", "MISSING_VIEW_REF", "OUTCOME_SET_MISSING"]);
    expect(errs(A(P({ home: { type: "flow", flow: "ghost", outcomes: "default" }, ...out }, { ...sets, outcome_sets: { default: { success: "ok", saved: "nowhere", failure: "fl" } }, navigation: { style: "drawer", items: [{ label: "x", page: "gone" }] } }), { flows: {} }))).toEqual(["MISSING_FLOW_REF", "MISSING_PAGE_REF", "ORPHAN_PAGE"]);
    const view = { spec_version: "1.0", kind: "view", family: "v", version: 1, items: [
      { type: "job_list", item_view: "ghost", filter: { "==": [{ var: "answers.x" }, 1] }, sort: "record.when" },
      { type: "stat_row", tiles: [{ type: "stat_tile", label: "L", source: "local" }] },
      { type: "markdown", text: "{{secrets.x}}", visible: { "==": [{ var: "job.status" }, "x"] } },
    ] };
    expect(errs(A(view, { views: {} }))).toEqual(["INVALID_STAT_TILE", "MISSING_VIEW_REF", "UNKNOWN_ROOT"]);
    const content = { spec_version: "1.0", kind: "content", family: "c", version: 1, locale: "en-ZA", strings: { "a.b": "Fine {{x}}" } };
    expect(A(content).ok).toBe(true);
    expect(computeRequires(A(content).definition as never)).toEqual({ spec: "1.0" });
    const js = { spec_version: "1.0", kind: "job_schema", family: "j", version: 1, attributes: [{ key: "a", type: "text", visible: { "==": [{ var: "answers.b" }, "x"] } }, { key: "b", type: "text" }] };
    expect(A(js).warnings.map((w) => w.path)).toEqual(["/attributes/0/visible"]);
  });
});

describe("rules internals", () => {
  it("evaluateBoolean, regex scanning and dates", () => {
    expect(evaluateBoolean({ "==": [1, 1] }, null)).toBe(true);
    expect(evaluateBoolean(null, null)).toBe(false);
    expect(() => evaluateBoolean(1, null)).toThrowError(RuleError);
    for (const ok of ["\\p{L}+", "\\u{1F600}", "[\\]a]+", "a+?b", "a{2,}", "a{2,3}", "[(]x"]) expect(() => checkSafeRegex(ok), ok).not.toThrow();
    for (const bad of ["\\p{L", "a\\", "a)", "(?i)a"]) expect(() => checkSafeRegex(bad), bad).toThrowError(RuleError);
    expect(compileSafeRegex("^a$")).toBe(compileSafeRegex("^a$"));
    for (let i = 0; i < 510; i++) compileSafeRegex(`^x${i}$`);
    expect(tryParseDate("2026-13-01")).toBeNull();
    expect(dateDiff({ y: 2026, m: 1, d: 1 }, { y: 2026, m: 1, d: 1 }, "years")).toBe(0);
    expect(dateAdd({ y: 2026, m: 3, d: 31 }, -1, "months")).toEqual({ y: 2026, m: 2, d: 28 });
    expect(civilFromDays(daysFromCivil({ y: -1, m: 12, d: 31 }))).toEqual({ y: -1, m: 12, d: 31 });
    expect(() => evaluate({ date_add: ["0000-01-01", -1, "days"] }, null, {})).toThrow(/RULE_INVALID_DATE/);
  });
});

describe("json and template helpers", () => {
  it("covers the small utilities", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 300; i++) deep = [deep];
    expect(isJsonValue(deep)).toBe(false);
    expect(isJsonValue({ a: [1, "x", null, true] })).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(cloneJson({ a: [1] })).toEqual({ a: [1] });
    expect(getOwn({ a: 1 }, "toString")).toBeUndefined();
    expect(hasOwnKey({ a: 1 }, "a")).toBe(true);
    expect([jsonTypeOf(null), jsonTypeOf([]), jsonTypeOf(true), jsonTypeOf(1), jsonTypeOf("s"), jsonTypeOf({})]).toEqual(["null", "array", "boolean", "number", "string", "object"]);
    expect(readPath({ a: [1] }, "a.x")).toBeUndefined();
    expect(readPath({ a: 1 }, "a.b")).toBeUndefined();
    expect(templatePaths("{{a}} {{ b.c }} {{a}}")).toEqual(["a", "b.c"]);
    expect([renderScalar(undefined), renderScalar(1.5), renderScalar(false), renderScalar([1])]).toEqual(["", "1.5", "false", ""]);
    expect(new EngineError("X", "m", { a: 1 }).details).toEqual({ a: 1 });
    expect(resolveRemoteConfig([5]).ok).toBe(false);
  });
  it("test-case runner reports exceptions and unknown paths", () => {
    const cyclic = { spec_version: "1.0", kind: "form", family: "t", version: 1, sections: [{ key: "s", fields: [{ key: "a", type: "computed", value: { var: "answers.b" } }, { key: "b", type: "computed", value: { var: "answers.a" } }] }] } as FormDefinition;
    const r = runTestCase(cyclic, { name: "x", expect: { valid: true } });
    expect(r.failures[0]?.check).toBe("exception");
    const f = form([{ key: "a", type: "text" }]);
    const res = runTestCase(f, { name: "y", expect: { values: { "a[0].b": 1 }, props: { a: { min: 1 } }, valid: false } });
    expect(res.failures.map((x) => x.check).sort()).toEqual(["props", "valid", "value"]);
  });
});
