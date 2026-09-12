// GENERATED — do not edit. Source: packages/fess_pos_engine_ts/src/resolver.ts (run: node tools/vendor-engine.mjs)
/**
 * Form resolver (docs/04 §4.3–4.4): given a form, a context and the current answers, computes per
 * field: visibility, required, read-only, computed value, dynamic props, filtered options and
 * rendered labels. Hidden ⇒ absent: a hidden field's value is null for every rule.
 *
 * Evaluation order: fields are topologically sorted on their *hard* dependencies — the answers read
 * by their own `visible` / `value` rules and by the `visible` rules of their section and groups —
 * so every field's effective value is final before anything reads it. Everything else (required,
 * read_only, labels, dynamic props, options, defaults, validate[]) is evaluated afterwards against
 * the final values. Cycles in hard dependencies are rejected (publish-time analysis reports them).
 */
import { EngineError, RuleError } from "./errors.ts";
import type { JsonObject, JsonValue } from "./json.ts";
import { isPlainObject, readPath } from "./json.ts";
import { dependencies } from "./rules/check.ts";
import { evaluate } from "./rules/evaluate.ts";
import type { OptionMetaMap, RuleEnv } from "./rules/evaluate.ts";
import { componentSpec, hasValue } from "./definitions/catalogue.ts";
import type { ComponentSpec, PropSpec } from "./definitions/catalogue.ts";
import { renderTemplate } from "./definitions/templates.ts";
import type { Expression, FieldDef, FormDefinition, OptionDef, SectionDef } from "./definitions/types.ts";
import { zaIdDerived } from "./values.ts";

export interface ResolveContext {
  /** Frozen date (YYYY-MM-DD) used by `today`; normally context_snapshot.today. */
  readonly today?: string | null;
  readonly job?: JsonValue;
  readonly agent?: JsonValue;
  readonly inspection?: JsonValue;
  readonly stats?: JsonValue;
  readonly config?: JsonValue;
  /** `{ answers: {...} }` of the previous attempt (rework). */
  readonly previous?: JsonValue;
}

export interface ResolveLists {
  /** Lookup list key → items (value/label/meta). */
  readonly lookup_lists?: Readonly<Record<string, readonly OptionDef[]>>;
  /** Reason-code category → items (value = code). */
  readonly reason_codes?: Readonly<Record<string, readonly OptionDef[]>>;
}

/** Raw answer values by field key; a repeatable group's value is an array of item objects. */
export type RawAnswers = Readonly<Record<string, JsonValue>>;

export interface RuleIssue {
  /** Field path, e.g. `premises_type` or `other_businesses[0].name`; section issues use `§<key>`. */
  readonly path: string;
  readonly property: string;
  readonly code: string;
  readonly message: string;
}

export interface ResolvedItem {
  readonly index: number;
  readonly fields: Record<string, ResolvedField>;
  /** Evaluation data for this item (answers, item, index, context roots). */
  readonly data: JsonObject;
}

export interface ResolvedField {
  readonly key: string;
  readonly path: string;
  readonly type: string;
  readonly section: string;
  readonly visible: boolean;
  readonly required: boolean;
  readonly read_only: boolean;
  /** Effective value (null when hidden or unanswered). */
  readonly value: JsonValue;
  /** True when the value comes from a `value` rule (docs/04 §4.4 item 4). */
  readonly computed: boolean;
  readonly default_value?: JsonValue;
  readonly label?: string;
  /** Rendered text of display components (info, callout, image caption). */
  readonly text?: string;
  /** Props with rule-able entries evaluated. */
  readonly props: JsonObject;
  /** Options after `options_filter` (choice components). */
  readonly options?: OptionDef[];
  /** Items of a repeatable group. */
  readonly items?: ResolvedItem[];
}

export interface ResolvedSection {
  readonly key: string;
  readonly visible: boolean;
  readonly title?: string;
}

export interface ResolvedForm {
  readonly sections: Record<string, ResolvedSection>;
  /** Top-level fields (including group children, groups and display components) by key. */
  readonly fields: Record<string, ResolvedField>;
  /** Document order of `fields`. */
  readonly order: readonly string[];
  /** Effective answers (what `answers.*` reads). Hidden fields are absent. */
  readonly values: JsonObject;
  readonly data: JsonObject;
  readonly env: RuleEnv;
  readonly errors: readonly RuleIssue[];
}

// ------------------------------------------------------------------ compilation (cached per form object)

interface CompiledField {
  readonly def: FieldDef;
  readonly spec: ComponentSpec;
  readonly section: string;
  /** `visible` of the section and enclosing groups, outermost first. */
  readonly containers: readonly Expression[];
  readonly docIndex: number;
  /** Keys under `answers.` this field's effective value depends on. */
  readonly hardDeps: ReadonlySet<string>;
  /** Keys under `item.` (repeatable children only). */
  readonly itemDeps: ReadonlySet<string>;
  /** Children of a repeatable group, in evaluation order. */
  readonly children?: readonly CompiledField[];
}

export interface CompiledForm {
  readonly form: FormDefinition;
  readonly fields: readonly CompiledField[];
  readonly byKey: ReadonlyMap<string, CompiledField>;
  readonly order: readonly CompiledField[];
  readonly staticOptionMeta: Record<string, Record<string, JsonObject>>;
}

const compiledForms = new WeakMap<FormDefinition, CompiledForm>();

function refsUnder(expr: unknown, root: string): string[] {
  if (expr === undefined) return [];
  let deps: string[];
  try {
    deps = dependencies(expr);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const d of deps) {
    const parts = d.split(".");
    if (parts[0] === root && parts[1] !== undefined) out.push(parts[1]);
  }
  return out;
}

function hardExprs(def: FieldDef, containers: readonly Expression[]): unknown[] {
  return [...containers, def.visible, def.value];
}

/** Field keys an expression reads through `answers.<key>` or `derived.<key>` (derived facts come from that field). */
function answerRefs(expr: unknown): string[] {
  return [...refsUnder(expr, "answers"), ...refsUnder(expr, "derived")];
}

function specOf(def: FieldDef): ComponentSpec {
  const spec = componentSpec(def.type);
  if (!spec) throw new EngineError("UNSUPPORTED_COMPONENT", `unsupported component "${def.type}"`, { key: def.key });
  return spec;
}

function flatten(fields: readonly FieldDef[], section: string, containers: readonly Expression[], out: { def: FieldDef; containers: readonly Expression[] }[]): void {
  for (const def of fields) {
    out.push({ def, containers });
    if (def.type === "group") {
      const inner = def.visible === undefined ? containers : [...containers, def.visible];
      flatten(def.fields ?? [], section, inner, out);
    }
  }
}

function topoSort(nodes: readonly CompiledField[], depsOf: (n: CompiledField) => ReadonlySet<string>, what: string): CompiledField[] {
  const byKey = new Map(nodes.map((n) => [n.def.key, n]));
  const pending = new Map<string, Set<string>>();
  for (const n of nodes) {
    pending.set(n.def.key, new Set([...depsOf(n)].filter((k) => byKey.has(k))));
  }
  const order: CompiledField[] = [];
  const done = new Set<string>();
  while (order.length < nodes.length) {
    let next: CompiledField | undefined;
    for (const n of nodes) {
      if (done.has(n.def.key)) continue;
      const deps = pending.get(n.def.key) as Set<string>;
      if ([...deps].every((d) => done.has(d))) {
        next = n;
        break;
      }
    }
    if (!next) {
      const stuck = nodes.filter((n) => !done.has(n.def.key)).map((n) => n.def.key);
      throw new EngineError("RESOLVER_CYCLE", `rule dependency cycle among ${what}: ${stuck.join(", ")}`, { keys: stuck });
    }
    done.add(next.def.key);
    order.push(next);
  }
  return order;
}

function collectOptionMeta(defs: readonly FieldDef[], out: Record<string, Record<string, JsonObject>>): void {
  for (const d of defs) {
    if (d.options) {
      const table: Record<string, JsonObject> = {};
      for (const o of d.options) table[o.value] = (o.meta ?? {}) as JsonObject;
      out[d.key] = table;
    }
    if (d.fields) collectOptionMeta(d.fields, out);
  }
}

export function compileForm(form: FormDefinition): CompiledForm {
  const hit = compiledForms.get(form);
  if (hit) return hit;
  const flat: { def: FieldDef; containers: readonly Expression[]; section: string }[] = [];
  for (const s of form.sections) {
    const tmp: { def: FieldDef; containers: readonly Expression[] }[] = [];
    flatten(s.fields, s.key, s.visible === undefined ? [] : [s.visible], tmp);
    for (const t of tmp) flat.push({ ...t, section: s.key });
  }
  const fields: CompiledField[] = flat.map(({ def, containers, section }, docIndex) => {
    const spec = specOf(def);
    const hard = new Set<string>();
    for (const e of hardExprs(def, containers)) answerRefs(e).forEach((k) => hard.add(k));
    let children: CompiledField[] | undefined;
    if (def.type === "repeatable_group") {
      const tmp: { def: FieldDef; containers: readonly Expression[] }[] = [];
      flatten(def.fields ?? [], section, [], tmp);
      const kids: CompiledField[] = tmp.map((t, i) => {
        const kidSpec = specOf(t.def);
        const itemDeps = new Set<string>();
        for (const e of hardExprs(t.def, t.containers)) {
          refsUnder(e, "item").forEach((k) => itemDeps.add(k));
          answerRefs(e).forEach((k) => hard.add(k));
        }
        return { def: t.def, spec: kidSpec, section, containers: t.containers, docIndex: i, hardDeps: new Set(), itemDeps };
      });
      children = topoSort(kids, (n) => n.itemDeps, `children of ${def.key}`);
    }
    return { def, spec, section, containers, docIndex, hardDeps: hard, itemDeps: new Set(), ...(children ? { children } : {}) };
  });
  const byKey = new Map(fields.map((f) => [f.def.key, f]));
  const order = topoSort(fields, (n) => n.hardDeps, "fields");
  const staticOptionMeta: Record<string, Record<string, JsonObject>> = {};
  collectOptionMeta(
    form.sections.flatMap((s) => s.fields),
    staticOptionMeta,
  );
  const compiled: CompiledForm = { form, fields, byKey, order, staticOptionMeta };
  compiledForms.set(form, compiled);
  return compiled;
}

// ------------------------------------------------------------------ resolution

class Evaluator {
  readonly issues: RuleIssue[] = [];
  constructor(readonly env: RuleEnv) {}

  eval(expr: unknown, data: JsonValue, path: string, property: string): { ok: true; value: JsonValue } | { ok: false } {
    try {
      return { ok: true, value: evaluate(expr, data, this.env) };
    } catch (e) {
      if (e instanceof RuleError) {
        this.issues.push({ path, property, code: e.code, message: e.message });
        return { ok: false };
      }
      /* c8 ignore next */
      throw e;
    }
  }

  bool(expr: unknown, fallback: boolean, onError: boolean, data: JsonValue, path: string, property: string): boolean {
    if (expr === undefined) return fallback;
    if (typeof expr === "boolean") return expr;
    const r = this.eval(expr, data, path, property);
    if (!r.ok) return onError;
    if (r.value === null) return false;
    if (typeof r.value === "boolean") return r.value;
    this.issues.push({ path, property, code: "RULE_TYPE_ERROR", message: `${property} must evaluate to a boolean` });
    return onError;
  }

  text(t: unknown, data: JsonValue, path: string, property: string): string | undefined {
    if (t === undefined) return undefined;
    if (typeof t === "string") return renderTemplate(t, data);
    const r = this.eval(t, data, path, property);
    if (!r.ok) return undefined;
    if (r.value === null) return "";
    if (typeof r.value === "string") return r.value;
    this.issues.push({ path, property, code: "RULE_TYPE_ERROR", message: `${property} must evaluate to a string` });
    return undefined;
  }
}

function isOperation(v: unknown): v is JsonObject {
  return isPlainObject(v);
}

function scalarKindMatches(spec: PropSpec, v: JsonValue): boolean {
  if (v === null) return true;
  switch (spec.kind.t) {
    case "int":
      return typeof v === "number" && Number.isInteger(v);
    case "number":
      return typeof v === "number";
    case "bool":
      return typeof v === "boolean";
    default:
      return typeof v === "string";
  }
}

function resolveProps(spec: ComponentSpec, raw: JsonObject | undefined, ev: Evaluator, data: JsonValue, path: string): JsonObject {
  const out: JsonObject = {};
  if (!raw) return out;
  for (const [name, value] of Object.entries(raw)) {
    const ps = spec.props[name];
    if (ps?.ruleable && isOperation(value)) {
      const r = ev.eval(value, data, path, `props.${name}`);
      if (!r.ok) continue;
      if (!scalarKindMatches(ps, r.value)) {
        ev.issues.push({ path, property: `props.${name}`, code: "RULE_TYPE_ERROR", message: `props.${name} evaluated to the wrong type` });
        continue;
      }
      if (r.value !== null) out[name] = r.value;
    } else {
      out[name] = value;
    }
  }
  return out;
}

function baseOptions(def: FieldDef, spec: ComponentSpec, props: JsonObject, lists: ResolveLists): readonly OptionDef[] {
  if (def.options) return def.options;
  const src = def.options_source;
  if (src?.type === "lookup_list") return lists.lookup_lists?.[src.key] ?? [];
  if (src?.type === "reason_codes") return lists.reason_codes?.[src.category] ?? [];
  if (spec.type === "lookup" && typeof props["list"] === "string") return lists.lookup_lists?.[props["list"]] ?? [];
  return [];
}

function optionMetaFor(compiled: CompiledForm, lists: ResolveLists): OptionMetaMap {
  const out: Record<string, Record<string, JsonObject>> = { ...compiled.staticOptionMeta };
  const visit = (defs: readonly FieldDef[]): void => {
    for (const d of defs) {
      if (!d.options) {
        const spec = componentSpec(d.type);
        const opts = spec ? baseOptions(d, spec, (d.props ?? {}) as JsonObject, lists) : [];
        if (opts.length > 0) {
          const table: Record<string, JsonObject> = {};
          for (const o of opts) table[o.value] = (o.meta ?? {}) as JsonObject;
          out[d.key] = table;
        }
      }
      if (d.fields) visit(d.fields);
    }
  };
  visit(compiled.form.sections.flatMap((s) => s.fields));
  return out;
}

const orNull = (v: JsonValue | undefined): JsonValue => (v === undefined ? null : v);

/** Resolve a form against a context and raw answers. */
export function resolveForm(form: FormDefinition, context: ResolveContext = {}, answers: RawAnswers = {}, lists: ResolveLists = {}): ResolvedForm {
  const compiled = compileForm(form);
  const env: RuleEnv = { today: context.today ?? null, optionMeta: optionMetaFor(compiled, lists) };
  const ev = new Evaluator(env);
  const values: JsonObject = {};
  const derived: JsonObject = {};
  const data: JsonObject = {
    answers: values,
    job: orNull(context.job),
    agent: orNull(context.agent),
    inspection: orNull(context.inspection),
    stats: orNull(context.stats),
    config: orNull(context.config),
    previous: orNull(context.previous),
    derived,
  };
  const visible = new Map<string, boolean>();
  const itemsState = new Map<string, { data: JsonObject; values: JsonObject; visible: Map<string, boolean> }[]>();

  const effectiveValue = (cf: CompiledField, raw: JsonValue | undefined, scope: JsonObject, path: string): JsonValue => {
    if (cf.def.value !== undefined) {
      const r = ev.eval(cf.def.value, scope, path, "value");
      return r.ok ? r.value : null;
    }
    if (cf.spec.type === "prefilled") {
      const src = cf.def.props?.["source"];
      return typeof src === "string" ? orNull(readPath(scope, src)) : null;
    }
    return orNull(raw);
  };

  // Phase 1 — visibility and effective values in dependency order.
  for (const cf of compiled.order) {
    const key = cf.def.key;
    const vis = cf.containers.every((c) => ev.bool(c, true, true, data, key, "container.visible")) && ev.bool(cf.def.visible, true, true, data, key, "visible");
    visible.set(key, vis);
    if (!hasValue(cf.spec)) continue;
    if (!vis) {
      delete values[key];
      continue;
    }
    if (cf.spec.type === "repeatable_group") {
      const raw = answers[key];
      if (!Array.isArray(raw)) {
        values[key] = orNull(raw);
        itemsState.set(key, []);
        continue;
      }
      const states: { data: JsonObject; values: JsonObject; visible: Map<string, boolean> }[] = [];
      const effective: JsonValue[] = raw.map((item, index) => {
        const itemValues: JsonObject = {};
        const itemData: JsonObject = { ...data, item: itemValues, index };
        const kidVisible = new Map<string, boolean>();
        const rawItem: JsonObject = isPlainObject(item) ? (item as JsonObject) : {};
        for (const kid of cf.children ?? []) {
          const path = `${key}[${index}].${kid.def.key}`;
          const kv = kid.containers.every((c) => ev.bool(c, true, true, itemData, path, "container.visible")) && ev.bool(kid.def.visible, true, true, itemData, path, "visible");
          kidVisible.set(kid.def.key, kv);
          if (!hasValue(kid.spec)) continue;
          if (kv) itemValues[kid.def.key] = effectiveValue(kid, rawItem[kid.def.key], itemData, path);
        }
        states.push({ data: itemData, values: itemValues, visible: kidVisible });
        return itemValues;
      });
      itemsState.set(key, states);
      values[key] = effective;
      continue;
    }
    const v = effectiveValue(cf, answers[key], data, key);
    values[key] = v;
    if (cf.spec.type === "id_number" && cf.def.props?.["scheme"] === "za_id" && typeof v === "string") {
      const d = zaIdDerived(v, context.today);
      if (d) derived[key] = d;
    }
  }

  // Phase 2 — everything that reads final values.
  const resolveOne = (cf: CompiledField, isVisible: boolean, scope: JsonObject, path: string, value: JsonValue): ResolvedField => {
    const base = { key: cf.def.key, path, type: cf.def.type, section: cf.section };
    const computed = cf.def.value !== undefined;
    if (!isVisible) return { ...base, visible: false, required: false, read_only: computed, value: null, computed, props: {} };
    const props = resolveProps(cf.spec, cf.def.props, ev, scope, path);
    const out: {
      -readonly [K in keyof ResolvedField]: ResolvedField[K];
    } = {
      ...base,
      visible: true,
      required: hasValue(cf.spec) ? ev.bool(cf.def.required, false, false, scope, path, "required") : false,
      read_only: computed || cf.spec.type === "prefilled" ? true : ev.bool(cf.def.read_only, false, false, scope, path, "read_only"),
      value,
      computed,
      props,
    };
    const label = ev.text(cf.def.label, scope, path, "label");
    if (label !== undefined) out.label = label;
    const text = ev.text(cf.def.text ?? cf.def.caption, scope, path, "text");
    if (text !== undefined) out.text = text;
    if (cf.def.default !== undefined) {
      const r = ev.eval(cf.def.default, scope, path, "default");
      if (r.ok) out.default_value = r.value;
    }
    if (cf.spec.options) {
      const opts = baseOptions(cf.def, cf.spec, props, listsRef);
      const filter = cf.def.options_filter;
      out.options =
        filter === undefined
          ? [...opts]
          : opts.filter((o) =>
              ev.bool(filter, true, true, { ...scope, option: { value: o.value, label: o.label, meta: (o.meta ?? {}) as JsonObject } }, path, "options_filter"),
            );
    }
    return out;
  };
  const listsRef = lists;

  const fields: Record<string, ResolvedField> = {};
  for (const cf of compiled.fields) {
    const key = cf.def.key;
    const vis = visible.get(key) ?? false;
    const rf = resolveOne(cf, vis, data, key, vis && hasValue(cf.spec) ? orNull(values[key]) : null);
    if (cf.spec.type === "repeatable_group" && vis) {
      const states = itemsState.get(key) ?? [];
      const items: ResolvedItem[] = states.map((st, index) => {
        const kids: Record<string, ResolvedField> = {};
        for (const kid of cf.children ?? []) {
          const kv = st.visible.get(kid.def.key) ?? false;
          kids[kid.def.key] = resolveOne(kid, kv, st.data, `${key}[${index}].${kid.def.key}`, kv && hasValue(kid.spec) ? orNull(st.values[kid.def.key]) : null);
        }
        return { index, fields: kids, data: st.data };
      });
      fields[key] = { ...rf, items };
    } else {
      fields[key] = rf;
    }
  }

  const sections: Record<string, ResolvedSection> = {};
  for (const s of form.sections as SectionDef[]) {
    const vis = ev.bool(s.visible, true, true, data, `§${s.key}`, "visible");
    const title = vis ? ev.text(s.title, data, `§${s.key}`, "title") : undefined;
    sections[s.key] = title === undefined ? { key: s.key, visible: vis } : { key: s.key, visible: vis, title };
  }

  return { sections, fields, order: compiled.fields.map((f) => f.def.key), values, data, env, errors: dedupeIssues(ev.issues) };
}

function dedupeIssues(issues: RuleIssue[]): RuleIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.path} ${i.property} ${i.code}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
