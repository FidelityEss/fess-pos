// GENERATED — do not edit. Source: packages/fess_pos_engine_ts/src/analyser.ts (run: node tools/vendor-engine.mjs)
/**
 * Publish-time static analysis (docs/04 §9, B4.11). Blocks (errors): structural problems, duplicate
 * keys, invalid expressions, missing references, rule cycles, certain type mismatches,
 * required-but-never-visible fields, unreachable sections/steps, removed/bypassable integrity steps
 * (`location_check`, `declaration`, `submit`), unresolved routes, pages pointing at missing
 * views/forms/flows, pages that never reach an outcome, and orphan pages. Warnings are advisory
 * (e.g. references to later fields — docs/04 §4.4 item 2).
 *
 * Cross-definition checks run when the related definitions are supplied in `bundle`.
 */
import type { JsonObject, JsonValue } from "./json.ts";
import { isPlainObject } from "./json.ts";
import { EngineError, RuleError } from "./errors.ts";
import { argsOf, checkExpression, operatorOf } from "./rules/check.ts";
import { evaluate } from "./rules/evaluate.ts";
import { OPERATORS } from "./rules/spec.ts";
import type { RuleType } from "./rules/spec.ts";
import { inferType } from "./rules/types.ts";
import type { TypeIssue } from "./rules/types.ts";
import { ACTIONS, COMPONENTS, PAGE_TYPES, SPEC_VERSION, STEPS, VIEW_COMPONENTS, componentSpec, hasValue } from "./definitions/catalogue.ts";
import type { ComponentSpec } from "./definitions/catalogue.ts";
import { parseDefinition } from "./definitions/parse.ts";
import { isValidTemplate, templatePaths } from "./definitions/templates.ts";
import type {
  AppDefinition,
  ContentDefinition,
  Definition,
  FieldDef,
  FlowDefinition,
  FormDefinition,
  JobSchemaDefinition,
  Requires,
  StepDef,
  Target,
  ViewDefinition,
  ViewItemDef,
} from "./definitions/types.ts";
import { compileForm } from "./resolver.ts";

export interface AnalysisIssue {
  readonly code: string;
  readonly message: string;
  readonly path: string;
  readonly severity: "error" | "warning";
}

export interface AnalysisResult {
  readonly ok: boolean;
  readonly errors: AnalysisIssue[];
  readonly warnings: AnalysisIssue[];
  readonly requires?: Requires;
  readonly definition?: Definition;
}

/** Related definitions for cross-reference checks (all optional). */
export interface AnalysisBundle {
  readonly forms?: Readonly<Record<string, FormDefinition>>;
  readonly flows?: Readonly<Record<string, FlowDefinition>>;
  readonly views?: Readonly<Record<string, ViewDefinition>>;
  readonly lookup_lists?: readonly string[];
  readonly reason_code_categories?: readonly string[];
  readonly declarations?: readonly string[];
}

export const ANALYSIS_ERROR_CODES = [
  "DUPLICATE_KEY",
  "DUPLICATE_OPTION_VALUE",
  "DUPLICATE_STEP_ID",
  "MISSING_REF",
  "UNKNOWN_ROOT",
  "CYCLE",
  "TYPE_MISMATCH",
  "REQUIRED_NEVER_VISIBLE",
  "UNREACHABLE_SECTION",
  "UNREACHABLE_STEP",
  "INVALID_TEMPLATE",
  "NESTED_REPEATABLE",
  "MIN_GREATER_THAN_MAX",
  "INVALID_FALLBACK",
  "OPTION_META_NOT_SELECT",
  "INTEGRITY_STEP_MISSING",
  "INTEGRITY_STEP_DUPLICATE",
  "INTEGRITY_STEP_ORDER",
  "INTEGRITY_STEP_BYPASSABLE",
  "NO_SUBMIT_STEP",
  "DECLARATION_FIELD_MISSING",
  "MISSING_STEP_REF",
  "MISSING_SECTION_REF",
  "SECTION_NOT_IN_FLOW",
  "MISSING_FORM_REF",
  "MISSING_FLOW_REF",
  "MISSING_VIEW_REF",
  "MISSING_PAGE_REF",
  "OUTCOME_SET_MISSING",
  "OUTCOME_PAGE_INVALID",
  "ORPHAN_PAGE",
  "INVALID_STAT_TILE",
] as const;

export const ANALYSIS_WARNING_CODES = ["REFERENCES_LATER_FIELD", "UNKNOWN_OPTION_VALUE", "DYNAMIC_NEXT", "ACTION_PENDING_DECISION", "MISSING_PREVIOUS_REF", "STEP_NEVER_VISIBLE"] as const;

class Report {
  readonly errors: AnalysisIssue[] = [];
  readonly warnings: AnalysisIssue[] = [];
  error(code: string, path: string, message: string): void {
    if (!this.errors.some((e) => e.code === code && e.path === path && e.message === message)) this.errors.push({ code, path, message, severity: "error" });
  }
  warn(code: string, path: string, message: string): void {
    if (!this.warnings.some((e) => e.code === code && e.path === path && e.message === message)) this.warnings.push({ code, path, message, severity: "warning" });
  }
}

// ------------------------------------------------------------------ expression helpers

interface VarRef {
  readonly path: string;
  readonly inIteration: boolean;
}

function collectVars(expr: unknown, inIter: boolean, out: VarRef[]): void {
  if (Array.isArray(expr)) {
    expr.forEach((e) => collectVars(e, inIter, out));
    return;
  }
  const op = operatorOf(expr);
  if (op === null) return;
  const spec = OPERATORS[op];
  if (!spec) return;
  const args = argsOf((expr as JsonObject)[op] as JsonValue);
  if (op === "var" || op === "option_meta") {
    if (typeof args[0] === "string") out.push({ path: args[0], inIteration: inIter });
    if (op === "var" && args.length > 1) collectVars(args[1], inIter, out);
    return;
  }
  args.forEach((a, i) => {
    if (spec.literals?.[i] !== undefined) return;
    collectVars(a, inIter || spec.predicateArg === i, out);
  });
}

function collectOptionMeta(expr: unknown, out: string[]): void {
  if (Array.isArray(expr)) {
    expr.forEach((e) => collectOptionMeta(e, out));
    return;
  }
  const op = operatorOf(expr);
  if (op === null) return;
  const args = argsOf((expr as JsonObject)[op] as JsonValue);
  if (op === "option_meta" && typeof args[0] === "string") out.push(args[0]);
  args.forEach((a) => collectOptionMeta(a, out));
}

/** Constant value of an expression with no data dependencies (null when unknown). */
function constantOf(expr: unknown): { known: true; value: JsonValue } | { known: false } {
  if (expr === undefined) return { known: false };
  if (!isPlainObject(expr) && !Array.isArray(expr)) return { known: true, value: expr as JsonValue };
  try {
    if (checkExpression(expr).deps.length > 0) return { known: false };
    return { known: true, value: evaluate(expr, null, {}) };
  } catch {
    return { known: false };
  }
}

const constFalse = (expr: unknown): boolean => {
  const c = constantOf(expr);
  return c.known && (c.value === false || c.value === null);
};
const constTrue = (expr: unknown): boolean => {
  const c = constantOf(expr);
  return c.known && c.value === true;
};

// ------------------------------------------------------------------ form analysis

interface Scope {
  readonly roots: ReadonlySet<string>;
  /** Children of the enclosing repeatable group (item.* refs). */
  readonly itemFields?: ReadonlyMap<string, FieldDef>;
  readonly groupKey?: string;
}

const BASE_ROOTS = ["answers", "job", "agent", "inspection", "stats", "previous", "config", "derived"];

interface FormIndex {
  readonly valueFields: Map<string, FieldDef>;
  readonly allKeys: Map<string, FieldDef>;
  readonly docOrder: Map<string, number>;
}

function valueTypeOf(def: FieldDef | undefined): RuleType {
  if (!def) return "any";
  const spec = componentSpec(def.type);
  if (!spec || spec.valueType === "none") return "any";
  if (def.value !== undefined) return spec.type === "computed" ? "any" : spec.valueType;
  return spec.valueType;
}

function analyseExpression(r: Report, expr: unknown, path: string, scope: Scope, idx: FormIndex, ownerKey: string | null, expect: RuleType | null): void {
  if (expr === undefined) return;
  try {
    checkExpression(expr);
  } catch (e) {
    r.error("DEF_INVALID_EXPRESSION", path, e instanceof RuleError ? e.message : "invalid expression");
    return;
  }
  const refs: VarRef[] = [];
  collectVars(expr, false, refs);
  for (const ref of refs) checkRef(r, ref, path, scope, idx, ownerKey);
  const metaPaths: string[] = [];
  collectOptionMeta(expr, metaPaths);
  for (const p of metaPaths) {
    const key = p.split(".").pop() as string;
    const def = p.startsWith("item.") ? scope.itemFields?.get(key) : idx.valueFields.get(key);
    const spec = def ? componentSpec(def.type) : undefined;
    if (def && !spec?.options) r.error("OPTION_META_NOT_SELECT", path, `option_meta reads "${key}", which is not a choice field`);
  }
  const issues: TypeIssue[] = [];
  const t = inferType(
    expr,
    (p) => {
      const [root, key, ...rest] = p.split(".");
      if (rest.length > 0 || key === undefined) return root === "index" || root === "current_index" ? "number" : "any";
      if (root === "answers") return valueTypeOf(idx.valueFields.get(key));
      if (root === "item") return valueTypeOf(scope.itemFields?.get(key));
      if (root === "option") return key === "meta" ? "object" : "string";
      return "any";
    },
    issues,
  );
  for (const i of issues) r.error("TYPE_MISMATCH", path, i.message);
  if (expect !== null && t !== "any" && t !== "null" && t !== expect) r.error("TYPE_MISMATCH", path, `expected ${expect}, expression yields ${t}`);
  checkOptionLiterals(r, expr, path, scope, idx);
}

function checkRef(r: Report, ref: VarRef, path: string, scope: Scope, idx: FormIndex, ownerKey: string | null): void {
  if (ref.path === "") return;
  const [root, key, third] = ref.path.split(".") as [string, string | undefined, string | undefined];
  if ((root === "current" || root === "current_index") && ref.inIteration) return;
  if (!scope.roots.has(root)) {
    r.error("UNKNOWN_ROOT", path, `"${ref.path}" — "${root}" is not available here`);
    return;
  }
  if (key === undefined) return;
  if (root === "answers") {
    if (!idx.valueFields.has(key)) {
      r.error("MISSING_REF", path, `"${ref.path}" refers to no input field "${key}"`);
    } else if (ownerKey !== null && (idx.docOrder.get(key) ?? 0) > (idx.docOrder.get(ownerKey) ?? 0)) {
      r.warn("REFERENCES_LATER_FIELD", path, `"${ownerKey}" reads the later field "${key}"`);
    }
  } else if (root === "item") {
    if (!scope.itemFields?.has(key)) r.error("MISSING_REF", path, `"${ref.path}" refers to no field "${key}" in this repeatable group`);
  } else if (root === "derived") {
    const d = idx.valueFields.get(key);
    if (!d || d.type !== "id_number" || d.props?.["scheme"] !== "za_id") r.error("MISSING_REF", path, `"${ref.path}": derived values exist only for za_id id_number fields`);
  } else if (root === "previous" && key === "answers" && third !== undefined && !idx.valueFields.has(third)) {
    r.warn("MISSING_PREVIOUS_REF", path, `"${ref.path}" refers to no field of this version`);
  }
}

/** `answers.x == "literal"` where x has static options not containing the literal. */
function checkOptionLiterals(r: Report, expr: unknown, path: string, scope: Scope, idx: FormIndex): void {
  const walk = (e: unknown): void => {
    if (Array.isArray(e)) {
      e.forEach(walk);
      return;
    }
    const op = operatorOf(e);
    if (op === null) return;
    const args = argsOf((e as JsonObject)[op] as JsonValue);
    const fieldOf = (a: JsonValue | undefined): FieldDef | undefined => {
      if (operatorOf(a) !== "var") return undefined;
      const p = argsOf((a as JsonObject)["var"] as JsonValue)[0];
      if (typeof p !== "string") return undefined;
      const [root, key, rest] = p.split(".");
      if (rest !== undefined || key === undefined) return undefined;
      return root === "answers" ? idx.valueFields.get(key) : root === "item" ? scope.itemFields?.get(key) : undefined;
    };
    const checkLit = (f: FieldDef | undefined, lit: JsonValue | undefined): void => {
      if (!f?.options || typeof lit !== "string") return;
      const other = f.props?.["allow_other"] === true ? String(f.props?.["other_value"] ?? "other") : null;
      if (!f.options.some((o) => o.value === lit) && lit !== other) r.warn("UNKNOWN_OPTION_VALUE", path, `"${lit}" is not an option of "${f.key}"`);
    };
    if (op === "==" || op === "!=") {
      checkLit(fieldOf(args[0]), args[1]);
      checkLit(fieldOf(args[1]), args[0]);
    } else if (op === "in" && Array.isArray(args[1])) {
      const f = fieldOf(args[0]);
      for (const lit of args[1]) checkLit(f, lit);
    } else if (op === "contains") {
      checkLit(fieldOf(args[0]), args[1]);
    }
    args.forEach(walk);
  };
  walk(expr);
}

function analyseTemplate(r: Report, t: unknown, path: string, scope: Scope, idx: FormIndex, ownerKey: string | null): void {
  if (typeof t !== "string") {
    if (t !== undefined) analyseExpression(r, t, path, scope, idx, ownerKey, "string");
    return;
  }
  if (!isValidTemplate(t)) {
    r.error("INVALID_TEMPLATE", path, "template has unbalanced {{ }} or an invalid placeholder path");
    return;
  }
  for (const p of templatePaths(t)) checkRef(r, { path: p, inIteration: false }, path, scope, idx, ownerKey);
}

const MIN_MAX_PAIRS: readonly (readonly [string, string])[] = [
  ["min", "max"],
  ["min_length", "max_length"],
  ["min_count", "max_count"],
  ["min_select", "max_select"],
  ["min_items", "max_items"],
];

function analyseField(r: Report, def: FieldDef, path: string, scope: Scope, idx: FormIndex, containersFalse: boolean, inRepeatable: boolean): void {
  const spec = componentSpec(def.type) as ComponentSpec;
  const k = def.key;
  const boolProps = ["visible", "required", "read_only"] as const;
  for (const p of boolProps) {
    const v = def[p];
    if (v !== undefined && typeof v !== "boolean") analyseExpression(r, v, `${path}/${p}`, scope, idx, k, "boolean");
  }
  if (def.value !== undefined) analyseExpression(r, def.value, `${path}/value`, scope, idx, k, null);
  if (def.default !== undefined) analyseExpression(r, def.default, `${path}/default`, scope, idx, k, null);
  analyseTemplate(r, def.label, `${path}/label`, scope, idx, k);
  analyseTemplate(r, def.text, `${path}/text`, scope, idx, k);
  analyseTemplate(r, def.caption, `${path}/caption`, scope, idx, k);
  def.validate?.forEach((v, i) => {
    if (typeof v.rule !== "boolean") analyseExpression(r, v.rule, `${path}/validate/${i}/rule`, scope, idx, null, "boolean");
    analyseTemplate(r, v.message, `${path}/validate/${i}/message`, scope, idx, null);
  });
  if (def.risk_indicator && typeof def.risk_indicator.when !== "boolean") {
    analyseExpression(r, def.risk_indicator.when, `${path}/risk_indicator/when`, scope, idx, null, "boolean");
  }
  if (def.options_filter !== undefined && typeof def.options_filter !== "boolean") {
    const optScope: Scope = { ...scope, roots: new Set([...scope.roots, "option"]) };
    analyseExpression(r, def.options_filter, `${path}/options_filter`, optScope, idx, k, "boolean");
  }
  // props (a repeatable group's item_label renders per item, so it sees item.* and index)
  const props = (def.props ?? {}) as JsonObject;
  const itemLabelScope: Scope = { ...scope, roots: new Set([...scope.roots, "item", "index"]), itemFields: repeatableChildren(def) };
  for (const [name, value] of Object.entries(props)) {
    const ps = spec.props[name];
    if (ps?.ruleable && isPlainObject(value)) {
      const expect: RuleType = ps.kind.t === "int" || ps.kind.t === "number" ? "number" : ps.kind.t === "bool" ? "boolean" : "string";
      analyseExpression(r, value, `${path}/props/${name}`, scope, idx, k, expect);
    }
    if (ps?.kind.t === "template") {
      analyseTemplate(r, value, `${path}/props/${name}`, def.type === "repeatable_group" && name === "item_label" ? itemLabelScope : scope, idx, k);
    }
  }
  for (const [lo, hi] of MIN_MAX_PAIRS) {
    const a = props[lo];
    const b = props[hi];
    if (typeof a === "number" && typeof b === "number" && a > b) r.error("MIN_GREATER_THAN_MAX", `${path}/props`, `${lo} (${a}) is greater than ${hi} (${b})`);
    if (typeof a === "string" && typeof b === "string" && a > b) r.error("MIN_GREATER_THAN_MAX", `${path}/props`, `${lo} (${a}) is after ${hi} (${b})`);
  }
  for (const ref of ["signer_name_field", "signer_designation_field", "by_name_field"]) {
    const target = props[ref];
    if (typeof target === "string" && !(scope.itemFields?.has(target) ?? false) && !idx.valueFields.has(target)) {
      r.error("MISSING_REF", `${path}/props/${ref}`, `${ref} "${target}" is not a field of this form`);
    }
  }
  // options
  if (def.options) {
    const seen = new Set<string>();
    def.options.forEach((o, i) => {
      if (seen.has(o.value)) r.error("DUPLICATE_OPTION_VALUE", `${path}/options/${i}`, `option value "${o.value}" repeats`);
      seen.add(o.value);
    });
    const excl = props["exclusive_options"];
    if (Array.isArray(excl)) for (const x of excl) if (typeof x === "string" && !seen.has(x)) r.error("MISSING_REF", `${path}/props/exclusive_options`, `exclusive option "${x}" is not an option`);
  }
  if (def.type === "matrix") {
    const rows = Array.isArray(props["rows"]) ? (props["rows"] as JsonObject[]).map((x) => String(x["key"])) : [];
    const cols = Array.isArray(props["columns"]) ? (props["columns"] as JsonObject[]).map((x) => String(x["value"])) : [];
    if (new Set(rows).size !== rows.length) r.error("DUPLICATE_KEY", `${path}/props/rows`, "matrix row keys repeat");
    if (new Set(cols).size !== cols.length) r.error("DUPLICATE_OPTION_VALUE", `${path}/props/columns`, "matrix column values repeat");
    const req = props["required_rows"];
    if (Array.isArray(req)) for (const x of req) if (typeof x === "string" && !rows.includes(x)) r.error("MISSING_REF", `${path}/props/required_rows`, `required row "${x}" is not a row`);
  }
  if (def.fallback) {
    const fb = componentSpec(def.fallback.type);
    if (!fb || def.fallback.type === def.type || !hasValue(fb) || fb.category === "evidence" || fb.category === "legal") {
      r.error("INVALID_FALLBACK", `${path}/fallback`, `"${def.fallback.type}" cannot stand in for "${def.type}"`);
    }
  }
  // visibility reachability
  const neverVisible = containersFalse || constFalse(def.visible);
  if (neverVisible && hasValue(spec) && constTrue(def.required)) {
    r.error("REQUIRED_NEVER_VISIBLE", path, `"${k}" is required but can never be visible`);
  }
  // children
  if (def.type === "group") {
    def.fields?.forEach((f, i) => analyseField(r, f, `${path}/fields/${i}`, scope, idx, neverVisible, inRepeatable));
  }
  if (def.type === "repeatable_group") {
    if (inRepeatable) r.error("NESTED_REPEATABLE", path, "repeatable groups cannot be nested");
    const kids = new Map<string, FieldDef>();
    const collect = (fs: readonly FieldDef[]): void => {
      for (const f of fs) {
        if (kids.has(f.key)) r.error("DUPLICATE_KEY", `${path}/fields`, `key "${f.key}" repeats inside "${k}"`);
        kids.set(f.key, f);
        if (f.type === "group") collect(f.fields ?? []);
      }
    };
    collect(def.fields ?? []);
    const valueKids = new Map([...kids].filter(([, f]) => hasValue(componentSpec(f.type) as ComponentSpec)));
    const kidScope: Scope = { roots: new Set([...scope.roots, "item", "index"]), itemFields: valueKids, groupKey: k };
    def.fields?.forEach((f, i) => analyseField(r, f, `${path}/fields/${i}`, kidScope, idx, neverVisible, true));
  }
}

/** Value-bearing children of a repeatable group (groups inside it flattened). */
function repeatableChildren(def: FieldDef): Map<string, FieldDef> {
  const out = new Map<string, FieldDef>();
  if (def.type !== "repeatable_group") return out;
  const visit = (fs: readonly FieldDef[]): void => {
    for (const f of fs) {
      const s = componentSpec(f.type);
      if (s && hasValue(s)) out.set(f.key, f);
      if (f.type === "group") visit(f.fields ?? []);
    }
  };
  visit(def.fields ?? []);
  return out;
}

function indexForm(form: FormDefinition, r: Report): FormIndex {
  const valueFields = new Map<string, FieldDef>();
  const allKeys = new Map<string, FieldDef>();
  const docOrder = new Map<string, number>();
  let n = 0;
  const visit = (fs: readonly FieldDef[], base: string): void => {
    fs.forEach((f, i) => {
      if (allKeys.has(f.key)) r.error("DUPLICATE_KEY", `${base}/${i}/key`, `field key "${f.key}" is used more than once`);
      allKeys.set(f.key, f);
      docOrder.set(f.key, n++);
      if (hasValue(componentSpec(f.type) as ComponentSpec)) valueFields.set(f.key, f);
      if (f.type === "group") visit(f.fields ?? [], `${base}/${i}/fields`);
    });
  };
  const sectionKeys = new Set<string>();
  form.sections.forEach((s, i) => {
    if (sectionKeys.has(s.key)) r.error("DUPLICATE_KEY", `/sections/${i}/key`, `section key "${s.key}" is used more than once`);
    sectionKeys.add(s.key);
    visit(s.fields, `/sections/${i}/fields`);
  });
  return { valueFields, allKeys, docOrder };
}

function analyseFormBody(form: FormDefinition, r: Report, bundle: AnalysisBundle): void {
  const idx = indexForm(form, r);
  const scope: Scope = { roots: new Set(BASE_ROOTS) };
  form.sections.forEach((s, i) => {
    const base = `/sections/${i}`;
    if (s.visible !== undefined && typeof s.visible !== "boolean") analyseExpression(r, s.visible, `${base}/visible`, scope, idx, null, "boolean");
    analyseTemplate(r, s.title, `${base}/title`, scope, idx, null);
    const sectionFalse = constFalse(s.visible);
    if (sectionFalse) r.error("UNREACHABLE_SECTION", base, `section "${s.key}" can never be visible`);
    s.fields.forEach((f, j) => analyseField(r, f, `${base}/fields/${j}`, scope, idx, sectionFalse, false));
  });
  // Cross-references to supporting data.
  const walk = (fs: readonly FieldDef[], base: string): void => {
    fs.forEach((f, i) => {
      const p = `${base}/${i}`;
      if (bundle.lookup_lists) {
        const list = f.options_source?.type === "lookup_list" ? f.options_source.key : f.type === "lookup" ? f.props?.["list"] : undefined;
        if (typeof list === "string" && !bundle.lookup_lists.includes(list)) r.error("MISSING_REF", p, `lookup list "${list}" does not exist`);
      }
      if (bundle.reason_code_categories && f.options_source?.type === "reason_codes" && !bundle.reason_code_categories.includes(f.options_source.category)) {
        r.error("MISSING_REF", p, `reason-code category "${f.options_source.category}" does not exist`);
      }
      const dk = f.props?.["declaration_key"];
      if (bundle.declarations && typeof dk === "string" && !bundle.declarations.includes(dk)) r.error("MISSING_REF", p, `declaration "${dk}" does not exist`);
      if (f.fields) walk(f.fields, `${p}/fields`);
    });
  };
  form.sections.forEach((s, i) => walk(s.fields, `/sections/${i}/fields`));
  if (bundle.declarations && form.declaration_key && !bundle.declarations.includes(form.declaration_key)) {
    r.error("MISSING_REF", "/declaration_key", `declaration "${form.declaration_key}" does not exist`);
  }
  // Cycles (hard dependencies: visible / value and enclosing visibility).
  if (r.errors.length === 0) {
    try {
      compileForm(form);
    } catch (e) {
      if (e instanceof EngineError && e.code === "RESOLVER_CYCLE") r.error("CYCLE", "", e.message);
      /* c8 ignore next */ else throw e;
    }
  }
}

// ------------------------------------------------------------------ flow analysis

function stepIds(flow: FlowDefinition): string[] {
  return flow.steps.map((s, i) => s.id ?? `#${i}`);
}

/** Possible literal targets of a `next` (null = dynamic). */
function nextTargets(next: StepDef["next"]): string[] | null {
  if (next === undefined) return [];
  if (typeof next === "string") return [next];
  const out: string[] = [];
  let dynamic = false;
  const results = (e: JsonValue): void => {
    if (typeof e === "string") out.push(e);
    else if (e === null) return;
    else if (operatorOf(e) === "if") {
      const args = argsOf((e as JsonObject)["if"] as JsonValue);
      let i = 0;
      for (; i + 1 < args.length; i += 2) results(args[i + 1] as JsonValue);
      if (i < args.length) results(args[i] as JsonValue);
    } else dynamic = true;
  };
  results(next);
  return dynamic ? null : out;
}

function analyseFlowBody(flow: FlowDefinition, r: Report, bundle: AnalysisBundle): void {
  const ids = stepIds(flow);
  const seen = new Set<string>();
  flow.steps.forEach((s, i) => {
    if (s.id !== undefined) {
      if (seen.has(s.id)) r.error("DUPLICATE_STEP_ID", `/steps/${i}/id`, `step id "${s.id}" repeats`);
      seen.add(s.id);
    }
  });
  const flowScope: Scope = { roots: new Set(BASE_ROOTS) };
  const formFor = (s: StepDef): FormDefinition | undefined => {
    const fam = s.form ?? flow.form_family;
    return fam !== undefined ? bundle.forms?.[fam] : undefined;
  };
  const mainForm = flow.form_family !== undefined ? bundle.forms?.[flow.form_family] : undefined;
  const idx: FormIndex = mainForm ? indexForm(mainForm, new Report()) : { valueFields: new Map(), allKeys: new Map(), docOrder: new Map() };
  const idxKnown = mainForm !== undefined;

  // graph
  const edges: Set<number>[] = flow.steps.map(() => new Set<number>());
  flow.steps.forEach((s, i) => {
    const base = `/steps/${i}`;
    if (s.visible !== undefined && typeof s.visible !== "boolean") {
      if (idxKnown) analyseExpression(r, s.visible, `${base}/visible`, flowScope, idx, null, "boolean");
    }
    if (s.visible !== undefined && constFalse(s.visible)) r.warn("STEP_NEVER_VISIBLE", base, `step ${ids[i]} is never shown`);
    const targets = nextTargets(s.next);
    if (s.next !== undefined && typeof s.next !== "string" && idxKnown) analyseExpression(r, s.next, `${base}/next`, flowScope, idx, null, null);
    if (targets === null) {
      r.warn("DYNAMIC_NEXT", `${base}/next`, "next is computed dynamically; reachability assumes any step");
      flow.steps.forEach((_, j) => edges[i]?.add(j));
    } else {
      for (const t of targets) {
        if (t.startsWith("flow:")) {
          const fam = t.slice(5);
          if (bundle.flows && !bundle.flows[fam]) r.error("MISSING_FLOW_REF", `${base}/next`, `flow "${fam}" does not exist`);
          continue;
        }
        if (t.startsWith("page:")) continue;
        const j = ids.indexOf(t);
        if (j < 0) r.error("MISSING_STEP_REF", `${base}/next`, `next targets unknown step "${t}"`);
        else edges[i]?.add(j);
      }
      // A step without next — or whose conditional next can yield null — falls through to the following step.
      const fallsThrough = s.next === undefined || (typeof s.next !== "string" && !constTrue({ "!=": [s.next, null] }) && !(targets.length > 0 && hasElse(s.next)));
      if (fallsThrough && i + 1 < flow.steps.length) edges[i]?.add(i + 1);
    }
    if (s.type === "form") {
      const f = formFor(s);
      if (!s.form && !flow.form_family) r.error("MISSING_FORM_REF", base, "form step has no form (set step.form or flow.form_family)");
      else if (bundle.forms && !f) r.error("MISSING_FORM_REF", base, `form "${s.form ?? flow.form_family}" does not exist`);
      if (f) {
        const keys = new Set(f.sections.map((x) => x.key));
        for (const sec of s.sections ?? []) if (!keys.has(sec)) r.error("MISSING_SECTION_REF", `${base}/sections`, `section "${sec}" is not in form "${f.family}"`);
      }
    }
    if ((s.type === "job_briefing" || s.type === "receipt") && bundle.views && s.view && !bundle.views[s.view]) {
      r.error("MISSING_VIEW_REF", `${base}/view`, `view "${s.view}" does not exist`);
    }
  });

  const reach = (from: number, removed: ReadonlySet<number>): Set<number> => {
    const seenN = new Set<number>();
    if (removed.has(from)) return seenN;
    const stack = [from];
    while (stack.length) {
      const n = stack.pop() as number;
      if (seenN.has(n)) continue;
      seenN.add(n);
      for (const m of edges[n] ?? []) if (!removed.has(m)) stack.push(m);
    }
    return seenN;
  };
  const reachable = reach(0, new Set());
  flow.steps.forEach((_, i) => {
    if (!reachable.has(i)) r.error("UNREACHABLE_STEP", `/steps/${i}`, `step ${ids[i]} can never be reached`);
  });

  const action = flow.action ?? "inspection.submit";
  const indicesOf = (type: string): number[] => flow.steps.flatMap((s, i) => (s.type === type ? [i] : []));
  const submits = indicesOf("submit");
  if (submits.length === 0) {
    r.error(action === "inspection.submit" ? "INTEGRITY_STEP_MISSING" : "NO_SUBMIT_STEP", "/steps", "the flow has no submit step");
  }
  if (submits.length > 1) r.error("INTEGRITY_STEP_DUPLICATE", "/steps", "a flow has exactly one submit step");
  if (action === "inspection.submit") {
    for (const t of ["location_check", "declaration"]) {
      const at = indicesOf(t);
      if (at.length === 0) r.error("INTEGRITY_STEP_MISSING", "/steps", `integrity step "${t}" cannot be removed`);
      if (at.length > 1) r.error("INTEGRITY_STEP_DUPLICATE", "/steps", `integrity step "${t}" appears more than once`);
      const submit = submits[0];
      if (submit !== undefined && at.length > 0) {
        if (at.some((x) => x > submit)) r.error("INTEGRITY_STEP_ORDER", `/steps/${at[0]}`, `"${t}" must come before submit`);
        if (reach(0, new Set(at)).has(submit)) r.error("INTEGRITY_STEP_BYPASSABLE", `/steps/${submit}`, `submit can be reached without passing "${t}"`);
      }
    }
    if (mainForm) {
      const covered = new Set(flow.steps.filter((s) => s.type === "form" && (s.form ?? flow.form_family) === flow.form_family).flatMap((s) => s.sections ?? []));
      mainForm.sections.forEach((s, i) => {
        if (!covered.has(s.key)) r.error("SECTION_NOT_IN_FLOW", `/steps`, `section "${s.key}" of form "${mainForm.family}" is never shown (form section ${i})`);
      });
      const decl = [...idx.valueFields.values()].filter((f) => f.type === "declaration");
      if (decl.length !== 1) r.error("DECLARATION_FIELD_MISSING", "/form_family", `form "${mainForm.family}" must contain exactly one declaration field`);
    }
  }
  const submit = submits[0];
  if (submit !== undefined) {
    indicesOf("form").forEach((i) => {
      if (i > submit) r.error("INTEGRITY_STEP_ORDER", `/steps/${i}`, "form steps must come before submit");
    });
  }
  if (ACTIONS[action]?.status === "pending_decision") r.warn("ACTION_PENDING_DECISION", "/action", `action "${action}" is pending a decision (D-38)`);
}

function hasElse(next: JsonValue): boolean {
  if (operatorOf(next) !== "if") return false;
  const args = argsOf((next as JsonObject)["if"] as JsonValue);
  if (args.length % 2 === 0) return false;
  const last = args[args.length - 1] as JsonValue;
  return typeof last === "string" || hasElse(last);
}

// ------------------------------------------------------------------ view analysis

const VIEW_ROOTS = new Set(["job", "agent", "inspection", "stats", "config", "app"]);

function analyseViewItems(items: readonly ViewItemDef[], base: string, r: Report, bundle: AnalysisBundle): void {
  const noIdx: FormIndex = { valueFields: new Map(), allKeys: new Map(), docOrder: new Map() };
  items.forEach((it, i) => {
    const p = `${base}/${i}`;
    const scope: Scope = { roots: VIEW_ROOTS };
    if (it.visible !== undefined && typeof it.visible !== "boolean") analyseExpression(r, it.visible, `${p}/visible`, scope, noIdx, null, "boolean");
    for (const prop of ["bind", "stat", "sort"] as const) {
      const v = it[prop];
      if (typeof v === "string") {
        const root = v.split(".")[0] as string;
        const allowed = it.type === "job_list" && prop === "sort" ? new Set([...VIEW_ROOTS]) : VIEW_ROOTS;
        if (!allowed.has(root)) r.error("UNKNOWN_ROOT", `${p}/${prop}`, `"${v}" — "${root}" is not available in views`);
      }
    }
    for (const prop of ["text", "label", "title", "caption"] as const) {
      const t = it[prop];
      if (typeof t === "string") analyseTemplate(r, t, `${p}/${prop}`, scope, noIdx, null);
    }
    if (it.filter !== undefined && typeof it.filter !== "boolean") {
      const fScope: Scope = { roots: new Set([...VIEW_ROOTS, "record"]) };
      analyseExpression(r, it.filter, `${p}/filter`, fScope, noIdx, null, "boolean");
    }
    if (it.type === "stat_tile") {
      if (it.source === "local" && !it.collection) r.error("INVALID_STAT_TILE", p, "a local stat tile needs a collection");
      if (it.source === "server" && !(typeof it.stat === "string" && it.stat.startsWith("stats."))) r.error("INVALID_STAT_TILE", p, "a server stat tile needs stat: stats.<total>");
    }
    if (it.item_view && bundle.views && !bundle.views[it.item_view]) r.error("MISSING_VIEW_REF", `${p}/item_view`, `view "${it.item_view}" does not exist`);
    if (it.tiles) analyseViewItems(it.tiles, `${p}/tiles`, r, bundle);
  });
}

// ------------------------------------------------------------------ app analysis

function analyseAppBody(app: AppDefinition, r: Report, bundle: AnalysisBundle): void {
  const pages = app.pages;
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(pages, k);
  const sets = app.outcome_sets ?? {};
  const refPage = (k: string, path: string): void => {
    if (!has(k)) r.error("MISSING_PAGE_REF", path, `page "${k}" does not exist`);
  };
  refPage(app.home, "/home");
  app.navigation?.items.forEach((it, i) => refPage(it.page, `/navigation/items/${i}/page`));
  for (const [name, set] of Object.entries(sets)) {
    for (const outcome of ["success", "saved", "failure"] as const) {
      const pk = set[outcome];
      const path = `/outcome_sets/${name}/${outcome}`;
      if (!has(pk)) r.error("MISSING_PAGE_REF", path, `page "${pk}" does not exist`);
      else if (pages[pk]?.type !== "outcome_page" || pages[pk]?.outcome !== outcome) {
        r.error("OUTCOME_PAGE_INVALID", path, `"${pk}" must be an outcome_page with outcome "${outcome}"`);
      }
    }
  }
  const targetPages = (t: Target | undefined): string[] => {
    if (!t) return [];
    if ("page" in t) return [t.page];
    const flowPages = Object.entries(pages).filter(([, p]) => p.type === "flow" && p.flow === t.flow).map(([k]) => k);
    const set = sets["default"];
    return [...flowPages, ...(set ? [set.success, set.saved, set.failure] : [])];
  };
  const edges = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string): void => {
    (edges.get(from) ?? edges.set(from, new Set()).get(from))?.add(to);
  };
  const noIdx: FormIndex = { valueFields: new Map(), allKeys: new Map(), docOrder: new Map() };
  for (const [key, page] of Object.entries(pages)) {
    const base = `/pages/${key}`;
    const checkTarget = (t: Target | undefined, path: string): void => {
      if (!t) return;
      if ("page" in t) refPage(t.page, path);
      else if (bundle.flows && !bundle.flows[t.flow]) r.error("MISSING_FLOW_REF", path, `flow "${t.flow}" does not exist`);
      if ("flow" in t && !sets["default"]) r.error("OUTCOME_SET_MISSING", path, "starting a flow directly needs a `default` outcome set");
      for (const p of targetPages(t)) addEdge(key, p);
    };
    switch (page.type) {
      case "view_page":
        if (bundle.views && page.view && !bundle.views[page.view]) r.error("MISSING_VIEW_REF", `${base}/view`, `view "${page.view}" does not exist`);
        page.actions?.forEach((a, i) => checkTarget(a.target, `${base}/actions/${i}/target`));
        if (page.view && bundle.views?.[page.view]) {
          const visit = (items: readonly ViewItemDef[]): void => {
            items.forEach((it, i) => {
              checkTarget(it.target, `${base}/view:${page.view}/items/${i}/target`);
              checkTarget(it.on_tap, `${base}/view:${page.view}/items/${i}/on_tap`);
              if (it.tiles) visit(it.tiles);
            });
          };
          visit(bundle.views[page.view]?.items ?? []);
        }
        break;
      case "list_page": {
        if (bundle.views && page.item_view && !bundle.views[page.item_view]) r.error("MISSING_VIEW_REF", `${base}/item_view`, `view "${page.item_view}" does not exist`);
        checkTarget(page.on_tap, `${base}/on_tap`);
        if (page.filter !== undefined && typeof page.filter !== "boolean") {
          const recordRoot = page.source === "jobs" ? "job" : page.source === "inspections" ? "inspection" : "record";
          analyseExpression(r, page.filter, `${base}/filter`, { roots: new Set(["job", "agent", "stats", "config", recordRoot]) }, noIdx, null, "boolean");
        }
        break;
      }
      case "form_page":
      case "flow": {
        const setName = page.outcomes as string;
        const set = sets[setName];
        if (!set) r.error("OUTCOME_SET_MISSING", `${base}/outcomes`, `outcome set "${setName}" does not exist — the page never reaches an outcome`);
        else [set.success, set.saved, set.failure].forEach((p) => addEdge(key, p));
        if (page.type === "form_page") {
          const f = page.form !== undefined ? bundle.forms?.[page.form] : undefined;
          if (bundle.forms && !f) r.error("MISSING_FORM_REF", `${base}/form`, `form "${page.form}" does not exist`);
          if (f) {
            const keys = new Set(f.sections.map((s) => s.key));
            for (const s of page.sections ?? []) if (!keys.has(s)) r.error("MISSING_SECTION_REF", `${base}/sections`, `section "${s}" is not in form "${f.family}"`);
          }
          if (page.action && ACTIONS[page.action]?.status === "pending_decision") r.warn("ACTION_PENDING_DECISION", `${base}/action`, `action "${page.action}" is pending a decision (D-38)`);
        } else if (bundle.flows && page.flow && !bundle.flows[page.flow]) {
          r.error("MISSING_FLOW_REF", `${base}/flow`, `flow "${page.flow}" does not exist`);
        }
        break;
      }
      case "outcome_page":
        page.buttons?.forEach((b, i) => {
          checkTarget(b.target, `${base}/buttons/${i}/target`);
          if (b.action === "home") addEdge(key, app.home);
        });
        break;
    }
    if (page.title) analyseTemplate(r, page.title, `${base}/title`, { roots: new Set([...VIEW_ROOTS]) }, noIdx, null);
  }
  // Orphans: pages unreachable from home, navigation and their transitive links. Links inside views
  // count, so this needs every view a view_page shows (bundle.views) — otherwise it cannot be decided.
  const viewPages = Object.values(pages).filter((p) => p.type === "view_page");
  if (viewPages.length > 0 && !viewPages.every((p) => p.view !== undefined && bundle.views?.[p.view] !== undefined)) return;
  const start = [app.home, ...(app.navigation?.items.map((i) => i.page) ?? [])].filter(has);
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length) {
    const k = stack.pop() as string;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const n of edges.get(k) ?? []) if (has(n)) stack.push(n);
  }
  for (const k of Object.keys(pages)) if (!seen.has(k)) r.error("ORPHAN_PAGE", `/pages/${k}`, `page "${k}" cannot be reached from home or navigation`);
}

// ------------------------------------------------------------------ requires

export function computeRequires(def: Definition): Requires {
  const req: Requires = { spec: SPEC_VERSION };
  const add = (map: Record<string, number>, type: string, version: number | undefined): void => {
    if (version !== undefined) map[type] = version;
  };
  if (def.kind === "form" || def.kind === "job_schema") {
    const components: Record<string, number> = {};
    const visit = (fs: readonly FieldDef[]): void => {
      for (const f of fs) {
        add(components, f.type, COMPONENTS[f.type]?.version);
        if (f.fields) visit(f.fields);
      }
    };
    visit(def.kind === "form" ? def.sections.flatMap((s) => s.fields) : def.attributes);
    req.components = Object.fromEntries(Object.entries(components).sort(([a], [b]) => (a < b ? -1 : 1)));
  } else if (def.kind === "flow") {
    const steps: Record<string, number> = {};
    for (const s of def.steps) add(steps, s.type, STEPS[s.type]?.version);
    req.step_types = steps;
  } else if (def.kind === "view") {
    const vc: Record<string, number> = {};
    const visit = (items: readonly ViewItemDef[]): void => {
      for (const it of items) {
        add(vc, it.type, VIEW_COMPONENTS[it.type]?.version);
        if (it.tiles) visit(it.tiles);
      }
    };
    visit(def.items);
    req.view_components = vc;
  } else if (def.kind === "app") {
    const pt: Record<string, number> = {};
    for (const p of Object.values(def.pages)) add(pt, p.type, PAGE_TYPES[p.type]?.version);
    req.page_types = pt;
  }
  return req;
}

// ------------------------------------------------------------------ entry point

function jobSchemaAsForm(js: JobSchemaDefinition): FormDefinition {
  return { spec_version: js.spec_version, kind: "form", family: js.family, version: js.version, sections: [{ key: "attributes", fields: js.attributes }] };
}

function remapJobSchemaPath(p: string): string {
  return p.replace(/^\/sections\/0\/fields/, "/attributes");
}

/** Parse, then statically analyse, a definition. `ok` is false when any error was found. */
export function analyseDefinition(input: unknown, bundle: AnalysisBundle = {}): AnalysisResult {
  const parsed = parseDefinition(input);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors.map((e) => ({ ...e, severity: "error" as const })), warnings: [] };
  }
  const def = parsed.definition;
  const r = new Report();
  switch (def.kind) {
    case "form":
      analyseFormBody(def, r, bundle);
      break;
    case "job_schema": {
      const tmp = new Report();
      analyseFormBody(jobSchemaAsForm(def), tmp, bundle);
      tmp.errors.forEach((e) => r.error(e.code, remapJobSchemaPath(e.path), e.message));
      tmp.warnings.forEach((w) => r.warn(w.code, remapJobSchemaPath(w.path), w.message));
      break;
    }
    case "flow":
      analyseFlowBody(def, r, bundle);
      break;
    case "view":
      analyseViewItems(def.items, "/items", r, bundle);
      break;
    case "content":
      analyseContent(def, r);
      break;
    case "app":
      analyseAppBody(def, r, bundle);
      break;
  }
  return { ok: r.errors.length === 0, errors: r.errors, warnings: r.warnings, requires: computeRequires(def), definition: def };
}

function analyseContent(def: ContentDefinition, r: Report): void {
  for (const [k, v] of Object.entries(def.strings)) {
    if (!isValidTemplate(v)) r.error("INVALID_TEMPLATE", `/strings/${k}`, "template has unbalanced {{ }} or an invalid placeholder path");
  }
}
