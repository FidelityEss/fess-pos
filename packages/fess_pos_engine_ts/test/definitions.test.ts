import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parseDefinition, parseDefinitionOfKind, COMPONENTS, COMPONENT_TYPES, STEPS, VIEW_COMPONENTS, PAGE_TYPES } from "../src/definitions/index.ts";
import type { AppDefinition, Definition, FlowDefinition, FormDefinition, ViewDefinition } from "../src/definitions/index.ts";
import { analyseDefinition, computeRequires } from "../src/analyser.ts";
import type { AnalysisBundle } from "../src/analyser.ts";
import { SCHEMA_DIR, SCHEMA_FILES, ajv, fixtures, readJson, relSchemaPath, schemaFor } from "./helpers.ts";

const anyDefinition = schemaFor("definitions/definition.schema.json");
const valid = fixtures<Definition>("definitions/valid");
const support = readJson<{ lookup_lists: string[]; reason_code_categories: string[]; declarations: string[] }>(join(SCHEMA_DIR, "fixtures", "definitions", "_support.json"));

function byKind<K extends Definition["kind"]>(kind: K): Record<string, Extract<Definition, { kind: K }>> {
  const out: Record<string, Extract<Definition, { kind: K }>> = {};
  for (const f of valid) if (f.data.kind === kind) out[f.data.family] = f.data as Extract<Definition, { kind: K }>;
  return out;
}
const fullBundle: AnalysisBundle = {
  forms: byKind("form") as Record<string, FormDefinition>,
  flows: byKind("flow") as Record<string, FlowDefinition>,
  views: byKind("view") as Record<string, ViewDefinition>,
  ...support,
};
const stem = (s: string): Definition => {
  const f = valid.find((x) => x.name === s);
  if (!f) throw new Error(`no valid fixture ${s}`);
  return f.data;
};
function bundleFrom(spec: { forms?: string[]; flows?: string[]; views?: string[]; lookup_lists?: string[]; reason_code_categories?: string[]; declarations?: string[] } | undefined): AnalysisBundle {
  if (!spec) return {};
  const map = <T extends Definition>(names?: string[]): Record<string, T> | undefined =>
    names ? Object.fromEntries(names.map((n) => [stem(n).family, stem(n) as T])) : undefined;
  return {
    ...(spec.forms ? { forms: map<FormDefinition>(spec.forms) } : {}),
    ...(spec.flows ? { flows: map<FlowDefinition>(spec.flows) } : {}),
    ...(spec.views ? { views: map<ViewDefinition>(spec.views) } : {}),
    ...(spec.lookup_lists ? { lookup_lists: spec.lookup_lists } : {}),
    ...(spec.reason_code_categories ? { reason_code_categories: spec.reason_code_categories } : {}),
    ...(spec.declarations ? { declarations: spec.declarations } : {}),
  };
}

describe("JSON Schemas compile", () => {
  for (const f of SCHEMA_FILES) {
    it(relSchemaPath(f), () => expect(ajv().getSchema((readJson<{ $id: string }>(f)).$id)).toBeTypeOf("function"));
  }
});

describe("valid definitions (schema/fixtures/definitions/valid)", () => {
  for (const f of valid) {
    it(`${f.name}: JSON Schema, Zod and publish analysis accept it`, () => {
      expect(anyDefinition(f.data), JSON.stringify(anyDefinition.errors?.slice(0, 3))).toBe(true);
      const parsed = parseDefinition(f.data);
      expect(parsed.ok, JSON.stringify(parsed.ok ? null : parsed.errors)).toBe(true);
      const res = analyseDefinition(f.data, fullBundle);
      expect(res.errors, JSON.stringify(res.errors)).toEqual([]);
      expect(res.requires?.spec).toBe("1.0");
    });
  }
  it("the valid fixtures use every wave 1 and 2 component, step type, view component and page type", () => {
    const used = { components: new Set<string>(), steps: new Set<string>(), views: new Set<string>(), pages: new Set<string>() };
    for (const f of valid) {
      const r = computeRequires(f.data);
      Object.keys(r.components ?? {}).forEach((k) => used.components.add(k));
      Object.keys(r.step_types ?? {}).forEach((k) => used.steps.add(k));
      Object.keys(r.view_components ?? {}).forEach((k) => used.views.add(k));
      Object.keys(r.page_types ?? {}).forEach((k) => used.pages.add(k));
    }
    expect([...used.components].sort()).toEqual([...COMPONENT_TYPES].sort());
    expect([...used.steps].sort()).toEqual(Object.keys(STEPS).sort());
    expect([...used.views].sort()).toEqual(Object.keys(VIEW_COMPONENTS).sort());
    expect([...used.pages].sort()).toEqual(Object.keys(PAGE_TYPES).sort());
  });
});

describe("invalid definitions (schema/fixtures/definitions/invalid)", () => {
  for (const f of fixtures<{ expected_errors: string[]; definition: unknown }>("definitions/invalid")) {
    it(`${f.name}: rejected by JSON Schema and by Zod with ${f.data.expected_errors.join(", ")}`, () => {
      expect(anyDefinition(f.data.definition)).toBe(false);
      const parsed = parseDefinition(f.data.definition);
      expect(parsed.ok).toBe(false);
      const codes = parsed.ok ? [] : parsed.errors.map((e) => e.code);
      for (const c of f.data.expected_errors) expect(codes, JSON.stringify(parsed)).toContain(c);
    });
  }
});

describe("publish analysis (schema/fixtures/definitions/analysis)", () => {
  type AnaFixture = { definition: unknown; expected_errors: string[]; expected_warnings?: string[]; expected_requires?: unknown; bundle?: Parameters<typeof bundleFrom>[0] };
  for (const f of fixtures<AnaFixture>("definitions/analysis")) {
    it(f.name, () => {
      expect(anyDefinition(f.data.definition), "analysis fixtures are schema-valid").toBe(true);
      const res = analyseDefinition(f.data.definition, bundleFrom(f.data.bundle));
      expect([...new Set(res.errors.map((e) => e.code))].sort(), JSON.stringify(res.errors)).toEqual([...new Set(f.data.expected_errors)].sort());
      expect(res.ok).toBe(f.data.expected_errors.length === 0);
      if (f.data.expected_warnings) {
        expect([...new Set(res.warnings.map((w) => w.code))].sort(), JSON.stringify(res.warnings)).toEqual([...f.data.expected_warnings].sort());
      }
      if (f.data.expected_requires) expect(res.requires).toEqual(f.data.expected_requires);
    });
  }
});

describe("catalogue ↔ schema/definitions sync", () => {
  type JsonSchemaNode = { properties?: Record<string, JsonSchemaNode & { enum?: string[]; anyOf?: { $ref?: string }[] }>; required?: string[]; $defs?: Record<string, JsonSchemaNode> };
  const isRuleable = (s: { anyOf?: { $ref?: string }[] } | undefined): boolean => Boolean(s?.anyOf?.some((x) => x.$ref?.endsWith("/operation")));
  const components = readJson<JsonSchemaNode>(join(SCHEMA_DIR, "definitions", "components.schema.json")).$defs ?? {};

  it("field dispatch lists every component type", () => {
    expect([...(components["field"]?.properties?.["type"]?.enum ?? [])].sort()).toEqual([...COMPONENT_TYPES].sort());
    const attrTypes = Object.values(COMPONENTS).filter((s) => s.jobSchema).map((s) => s.type).sort();
    expect([...(components["attribute"]?.properties?.["type"]?.enum ?? [])].sort()).toEqual(attrTypes);
  });
  for (const spec of Object.values(COMPONENTS)) {
    it(`${spec.type}: props, rule-able flags, required props and display variants`, () => {
      const d = components[spec.type];
      expect(d).toBeDefined();
      const props = spec.shape === "display" ? d?.properties ?? {} : d?.properties?.["props"]?.properties ?? {};
      const names = Object.keys(props).filter((k) => spec.shape !== "display" || !["type", "key", "id", "visible", "pdf"].includes(k));
      expect(names.sort()).toEqual(Object.keys(spec.props).sort());
      for (const [name, p] of Object.entries(spec.props)) expect(isRuleable(props[name]), `${spec.type}.${name}`).toBe(Boolean(p.ruleable));
      const req = spec.shape === "display" ? (d?.required ?? []).filter((k) => !["type", "key"].includes(k)) : d?.properties?.["props"]?.required ?? [];
      expect([...req].sort()).toEqual(Object.entries(spec.props).filter(([, p]) => p.required).map(([n]) => n).sort());
      if (spec.displays.length > 0) expect(d?.properties?.["display"]?.enum).toEqual([...spec.displays]);
      else expect(d?.properties?.["display"]).toBeUndefined();
    });
  }
  const checkTopLevel = (file: string, table: Record<string, { props: Record<string, { ruleable?: boolean; required?: boolean }> }>, common: string[]) => {
    const defs = readJson<JsonSchemaNode>(join(SCHEMA_DIR, "definitions", file)).$defs ?? {};
    for (const [type, spec] of Object.entries(table)) {
      const d = defs[type];
      const names = Object.keys(d?.properties ?? {}).filter((k) => !common.includes(k));
      expect(names.sort(), `${file} ${type}`).toEqual(Object.keys(spec.props).sort());
      for (const [name, p] of Object.entries(spec.props)) expect(isRuleable(d?.properties?.[name]), `${type}.${name}`).toBe(Boolean(p.ruleable));
    }
  };
  it("flow steps", () => checkTopLevel("flow.schema.json", STEPS, ["type", "id", "label", "next", "visible"]));
  it("view components", () => checkTopLevel("view.schema.json", VIEW_COMPONENTS, ["type", "id", "visible"]));
  it("page types", () => checkTopLevel("app.schema.json", PAGE_TYPES, ["type"]));
  it("only removable steps may carry visible", () => {
    const defs = readJson<JsonSchemaNode>(join(SCHEMA_DIR, "definitions", "flow.schema.json")).$defs ?? {};
    for (const s of Object.values(STEPS)) expect(Boolean(defs[s.type]?.properties?.["visible"]), s.type).toBe(s.removable);
  });
});

describe("parseDefinition", () => {
  it("rejects non-objects and wrong kinds", () => {
    expect(parseDefinition([])).toEqual({ ok: false, errors: [{ code: "DEF_NOT_OBJECT", message: expect.any(String) as string, path: "" }] });
    const form = stem("form_merchant_followup");
    expect(parseDefinitionOfKind(form, "form").ok).toBe(true);
    const wrong = parseDefinitionOfKind(form, "flow");
    expect(wrong.ok ? [] : wrong.errors.map((e) => e.code)).toEqual(["DEF_UNKNOWN_KIND"]);
    const broken = parseDefinitionOfKind({ kind: "form" }, "form");
    expect(broken.ok).toBe(false);
  });
  it("reports minor spec versions newer than supported", () => {
    const res = parseDefinition({ ...stem("form_merchant_followup"), spec_version: "1.1" });
    expect(res.ok ? [] : res.errors.map((e) => e.code)).toEqual(["DEF_UNSUPPORTED_SPEC_VERSION"]);
  });
  it("points at the failing path", () => {
    const res = parseDefinition({ spec_version: "1.0", kind: "form", family: "t", version: 1, sections: [{ key: "s", fields: [{ key: "a/b", type: "text" }] }] });
    expect(res.ok ? null : res.errors[0]?.path).toBe("/sections/0/fields/0/key");
  });
  it("analysis of the app reaches every page", () => {
    const app = stem("app_agent_app") as AppDefinition;
    expect(analyseDefinition(app, fullBundle).errors).toEqual([]);
    const orphaned = { ...app, pages: { ...app.pages, stray: { type: "list_page", source: "jobs", item_view: "job_card" } } };
    expect(analyseDefinition(orphaned, fullBundle).errors.map((e) => e.code)).toEqual(["ORPHAN_PAGE"]);
  });
});
