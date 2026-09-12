/**
 * Server-authoritative submission validation (docs/04 §5–6). The same rules the device applied are
 * re-run against the pinned form and the recorded context snapshot:
 *
 * - unknown keys are rejected; display components and groups carry no answers;
 * - hidden-by-rule fields must be absent;
 * - required-when-visible answers must be present (null, "", [], {} count as missing);
 * - every present value must match its component's value shape and resolved constraints;
 * - choices must be among the (filtered) options, or the declared "other" value with `other_text`;
 * - `validate[]` rules run on visible, non-empty answers (their `code` or VALIDATION_RULE_FAILED);
 * - computed values are recomputed and must match (and be marked `computed: true`);
 * - prefilled values must equal their context source;
 * - `answers_hash` must equal sha256(JCS(answers)) (validateSubmission).
 */
import type { JsonObject, JsonValue } from "./json.ts";
import { deepEqual, isJsonValue, isPlainObject } from "./json.ts";
import { answersHash } from "./hash.ts";
import { evaluate } from "./rules/evaluate.ts";
import { RuleError } from "./errors.ts";
import { compileForm, resolveForm } from "./resolver.ts";
import type { RawAnswers, ResolveContext, ResolveLists, ResolvedField, ResolvedForm } from "./resolver.ts";
import { componentSpec, hasValue } from "./definitions/catalogue.ts";
import { renderTemplate } from "./definitions/templates.ts";
import type { FieldDef, FormDefinition } from "./definitions/types.ts";
import { isEmptyAnswer, validateValue } from "./values.ts";
import type { ComponentSpec } from "./definitions/catalogue.ts";

export interface AnswerEntry {
  v: JsonValue;
  prefilled?: boolean;
  flagged_differs?: boolean;
  computed?: boolean;
  rendered_as?: string;
  other_text?: string;
  unknown?: boolean;
}

export type AnswersMap = Record<string, AnswerEntry>;

export interface AnswersDocument {
  definition_refs?: JsonObject;
  config_version_id?: string | null;
  context_snapshot?: JsonObject;
  answers: AnswersMap;
  field_timings?: JsonObject;
  answers_hash?: string;
}

export interface ValidationError {
  readonly field_key: string;
  readonly code: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: ValidationError[];
  readonly resolved?: ResolvedForm;
}

export const VALIDATION_ERROR_CODES = [
  "INVALID_ANSWERS",
  "INVALID_ENTRY",
  "UNKNOWN_FIELD",
  "HIDDEN_FIELD_PRESENT",
  "REQUIRED",
  "INVALID_OPTION",
  "OTHER_TEXT_REQUIRED",
  "INVALID_RENDERED_AS",
  "COMPUTED_MISMATCH",
  "PREFILL_MISMATCH",
  "TOO_FEW_ITEMS",
  "TOO_MANY_ITEMS",
  "VALIDATION_RULE_FAILED",
  "RULE_ERROR",
  "ANSWERS_HASH_MISMATCH",
] as const;

const ENTRY_KEYS = new Set(["v", "prefilled", "flagged_differs", "computed", "rendered_as", "other_text", "unknown"]);
const BOOL_ENTRY_KEYS = ["prefilled", "flagged_differs", "computed", "unknown"] as const;

function entryProblem(entry: unknown): string | null {
  if (!isPlainObject(entry)) return "an answer entry must be an object {v, …}";
  if (!Object.prototype.hasOwnProperty.call(entry, "v")) return "an answer entry needs `v`";
  for (const k of Object.keys(entry)) if (!ENTRY_KEYS.has(k)) return `unknown answer entry property "${k}"`;
  for (const k of BOOL_ENTRY_KEYS) if (entry[k] !== undefined && typeof entry[k] !== "boolean") return `${k} must be boolean`;
  if (entry["rendered_as"] !== undefined && typeof entry["rendered_as"] !== "string") return "rendered_as must be a string";
  if (entry["other_text"] !== undefined && typeof entry["other_text"] !== "string") return "other_text must be a string";
  if (!isJsonValue(entry["v"])) return "v must be a JSON value";
  return null;
}

interface Ctx {
  readonly errors: ValidationError[];
  readonly resolved: ResolvedForm;
  readonly context: ResolveContext;
}

const push = (ctx: Ctx, field_key: string, code: string, message: string): void => {
  ctx.errors.push({ field_key, code, message });
};

function childMap(def: FieldDef): Map<string, FieldDef> {
  const out = new Map<string, FieldDef>();
  const visit = (fs: readonly FieldDef[]): void => {
    for (const f of fs) {
      out.set(f.key, f);
      if (f.type === "group") visit(f.fields ?? []);
    }
  };
  visit(def.fields ?? []);
  return out;
}

/** Validate the answers map (entries `{v, …}`) of a form. Synchronous; see validateSubmission for the hash. */
export function validateAnswers(form: FormDefinition, answers: unknown, context: ResolveContext = {}, lists: ResolveLists = {}): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isPlainObject(answers)) {
    return { ok: false, errors: [{ field_key: "", code: "INVALID_ANSWERS", message: "answers must be an object keyed by field key" }] };
  }
  const compiled = compileForm(form);
  const raw: Record<string, JsonValue> = {};
  const entries: Record<string, AnswerEntry> = {};
  for (const [key, entry] of Object.entries(answers)) {
    const cf = compiled.byKey.get(key);
    if (!cf || !hasValue(cf.spec)) {
      errors.push({ field_key: key, code: "UNKNOWN_FIELD", message: `"${key}" is not an input field of this form` });
      continue;
    }
    const problem = entryProblem(entry);
    if (problem) {
      errors.push({ field_key: key, code: "INVALID_ENTRY", message: problem });
      continue;
    }
    const e = entry as unknown as AnswerEntry;
    entries[key] = e;
    raw[key] = cf.spec.type === "repeatable_group" ? itemsToRaw(e.v, cf.def, key, errors) : e.v;
  }

  const resolved = resolveForm(form, context, raw as RawAnswers, lists);
  const ctx: Ctx = { errors, resolved, context };
  for (const cf of compiled.fields) {
    if (!hasValue(cf.spec)) continue;
    const rf = resolved.fields[cf.def.key] as ResolvedField;
    checkField(ctx, cf.def, cf.spec, rf, entries[cf.def.key], rf.path, resolved.data);
  }
  for (const issue of resolved.errors) {
    const rf = resolved.fields[issue.path.split("[")[0] as string];
    if (rf && !rf.visible) continue;
    push(ctx, issue.path, "RULE_ERROR", `${issue.property}: ${issue.message}`);
  }
  return { ok: errors.length === 0, errors, resolved };
}

function itemsToRaw(v: JsonValue, def: FieldDef, key: string, errors: ValidationError[]): JsonValue {
  if (!Array.isArray(v)) return v;
  const kids = childMap(def);
  return v.map((item, i) => {
    if (!isPlainObject(item)) {
      errors.push({ field_key: `${key}[${i}]`, code: "INVALID_ENTRY", message: "each item must be an object of answer entries" });
      return {};
    }
    const out: JsonObject = {};
    for (const [ck, ce] of Object.entries(item)) {
      const kd = kids.get(ck);
      const path = `${key}[${i}].${ck}`;
      if (!kd || kd.type === "group" || ["info", "callout", "divider", "image"].includes(kd.type)) {
        errors.push({ field_key: path, code: "UNKNOWN_FIELD", message: `"${ck}" is not an input field of this group` });
        continue;
      }
      const problem = entryProblem(ce);
      if (problem) {
        errors.push({ field_key: path, code: "INVALID_ENTRY", message: problem });
        continue;
      }
      out[ck] = (ce as JsonObject)["v"] as JsonValue;
    }
    return out;
  });
}

function checkField(ctx: Ctx, def: FieldDef, spec: ComponentSpec, rf: ResolvedField, entry: AnswerEntry | undefined, path: string, data: JsonObject): void {
  const present = entry !== undefined;
  if (!rf.visible) {
    if (present) push(ctx, path, "HIDDEN_FIELD_PRESENT", "this field is hidden by a rule and must be omitted");
    return;
  }
  const v: JsonValue = present ? entry.v : null;

  if (def.value !== undefined) {
    const expected = rf.value;
    const ok = expected === null ? !present || entry.v === null : present && entry.computed === true && deepEqual(entry.v, expected);
    if (!ok) push(ctx, path, "COMPUTED_MISMATCH", "computed value does not match the server's recomputation");
    return;
  }
  if (spec.type === "prefilled") {
    if ((present || rf.value !== null) && !deepEqual(v, rf.value)) push(ctx, path, "PREFILL_MISMATCH", "prefilled value differs from the job/agent snapshot");
    return;
  }

  const unknownOk = present && entry.unknown === true && spec.type === "date" && rf.props["allow_unknown"] === true;
  if (present && entry.unknown === true && !unknownOk) {
    push(ctx, path, "INVALID_ENTRY", "`unknown` is only allowed on date fields with allow_unknown");
    return;
  }
  if (unknownOk) {
    if (entry.v !== null) push(ctx, path, "INVALID_ENTRY", "an unknown date must have v = null");
    return;
  }
  if (isEmptyAnswer(v)) {
    if (rf.required) push(ctx, path, "REQUIRED", "this answer is required");
    if (present && entry.other_text !== undefined) push(ctx, path, "INVALID_ENTRY", "other_text given without the other option");
    return;
  }

  let type = spec.type;
  let props = rf.props;
  if (present && entry.rendered_as !== undefined) {
    if (!def.fallback || def.fallback.type !== entry.rendered_as) {
      push(ctx, path, "INVALID_RENDERED_AS", `rendered_as "${entry.rendered_as}" is not this field's declared fallback`);
      return;
    }
    type = def.fallback.type;
    props = (def.fallback.props ?? {}) as JsonObject;
  }
  const issues = validateValue(type, v, props, { job: ctx.context.job, today: ctx.context.today ?? null });
  for (const i of issues) push(ctx, path, i.code, i.message);

  if (type === spec.type && (type === "single_select" || type === "multi_select" || type === "lookup")) {
    const allowed = new Set((rf.options ?? []).map((o) => o.value));
    const otherValue = typeof props["other_value"] === "string" ? props["other_value"] : "other";
    const allowOther = props["allow_other"] === true;
    const chosen = Array.isArray(v) ? v : [v];
    let otherChosen = false;
    for (const c of chosen) {
      if (typeof c !== "string") continue;
      if (allowOther && c === otherValue && !allowed.has(c)) {
        otherChosen = true;
        continue;
      }
      if (allowOther && c === otherValue) otherChosen = true;
      if (!allowed.has(c)) push(ctx, path, "INVALID_OPTION", `"${c}" is not an available option`);
    }
    const otherText = present ? entry.other_text : undefined;
    if (otherChosen && (otherText === undefined || otherText.trim() === "")) push(ctx, path, "OTHER_TEXT_REQUIRED", "describe the other option");
    if (!otherChosen && otherText !== undefined) push(ctx, path, "INVALID_ENTRY", "other_text given without the other option");
  } else if (present && entry.other_text !== undefined) {
    push(ctx, path, "INVALID_ENTRY", "other_text is only allowed on choice fields");
  }

  if (spec.type === "repeatable_group" && Array.isArray(v)) {
    const min = typeof rf.props["min_items"] === "number" ? rf.props["min_items"] : null;
    const max = typeof rf.props["max_items"] === "number" ? rf.props["max_items"] : null;
    if (min !== null && v.length < min) push(ctx, path, "TOO_FEW_ITEMS", `add at least ${min}`);
    if (max !== null && v.length > max) push(ctx, path, "TOO_MANY_ITEMS", `at most ${max} allowed`);
    const kids = childMap(def);
    (rf.items ?? []).forEach((item) => {
      const rawItem = v[item.index];
      const itemEntries: Record<string, AnswerEntry> = isPlainObject(rawItem) ? (rawItem as unknown as Record<string, AnswerEntry>) : {};
      for (const [ck, kf] of Object.entries(item.fields)) {
        const kd = kids.get(ck) as FieldDef;
        const kspec = compileSpec(kd);
        if (!kspec || !hasValue(kspec)) continue;
        const ke = itemEntries[ck];
        checkField(ctx, kd, kspec, kf, ke !== undefined && entryProblem(ke) === null ? ke : undefined, kf.path, item.data);
      }
    });
  }

  if (issues.length === 0) runValidateRules(ctx, def, path, data);
}

function compileSpec(def: FieldDef): ComponentSpec | undefined {
  return componentSpec(def.type);
}

function runValidateRules(ctx: Ctx, def: FieldDef, path: string, data: JsonObject): void {
  for (const rule of def.validate ?? []) {
    let ok: boolean;
    try {
      const r = typeof rule.rule === "boolean" ? rule.rule : evaluate(rule.rule, data, ctx.resolved.env);
      if (r !== null && typeof r !== "boolean") {
        push(ctx, path, "RULE_ERROR", "validate rule must evaluate to a boolean");
        continue;
      }
      ok = r === true;
    } catch (e) {
      if (e instanceof RuleError) {
        push(ctx, path, "RULE_ERROR", `validate: ${e.message}`);
        continue;
      }
      /* c8 ignore next */
      throw e;
    }
    if (!ok) push(ctx, path, rule.code ?? "VALIDATION_RULE_FAILED", renderTemplate(rule.message, data));
  }
}

/** Context for server re-validation from the recorded `context_snapshot` (docs/04 §5). */
export function contextFromSnapshot(snapshot: JsonObject | undefined): ResolveContext {
  if (!snapshot) return {};
  const today = snapshot["today"];
  return {
    today: typeof today === "string" ? today : null,
    job: snapshot["job"] ?? null,
    agent: snapshot["agent"] ?? null,
    inspection: snapshot["inspection"] ?? null,
    stats: snapshot["stats"] ?? null,
    config: snapshot["config"] ?? null,
    previous: snapshot["previous"] ?? null,
  };
}

/** Full server-side check of an answers document: answers against the form + answers_hash. */
export async function validateSubmission(
  form: FormDefinition,
  document: AnswersDocument,
  options: { lists?: ResolveLists; context?: ResolveContext } = {},
): Promise<ValidationResult> {
  const context = options.context ?? contextFromSnapshot(document.context_snapshot);
  const res = validateAnswers(form, document.answers, context, options.lists ?? {});
  const errors = [...res.errors];
  if (document.answers_hash !== undefined) {
    let hash: string | null = null;
    try {
      hash = await answersHash(document.answers);
    } catch {
      hash = null;
    }
    if (hash !== document.answers_hash) errors.push({ field_key: "", code: "ANSWERS_HASH_MISMATCH", message: "answers_hash does not match sha256(JCS(answers))" });
  }
  return res.resolved ? { ok: errors.length === 0, errors, resolved: res.resolved } : { ok: errors.length === 0, errors };
}
