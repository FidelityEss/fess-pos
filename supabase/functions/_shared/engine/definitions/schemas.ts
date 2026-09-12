// GENERATED — do not edit. Source: packages/fess_pos_engine_ts/src/definitions/schemas.ts (run: node tools/vendor-engine.mjs)
/**
 * Zod mirrors of `schema/definitions/*.schema.json`, built from the catalogue. Fixture tests run every
 * valid/invalid definition through both these and ajv so the two cannot drift.
 */
import { z } from "npm:zod@^3.25.76";
import type { JsonObject, JsonValue } from "../json.ts";
import { isJsonValue, isPlainObject } from "../json.ts";
import { isValidExpression } from "../rules/check.ts";
import { checkSafeRegex } from "../rules/regex.ts";
import {
  COMPONENTS,
  COMPONENT_TYPES,
  FLOW_ACTIONS,
  NAV_STYLES,
  OUTCOME_BUTTON_ACTIONS,
  PAGE_TYPES,
  STEPS,
  VIEW_COMPONENTS,
} from "./catalogue.ts";
import type { ComponentSpec, PropKind, PropSpec } from "./catalogue.ts";
import type {
  AppDefinition,
  ContentDefinition,
  Definition,
  FieldDef,
  FlowDefinition,
  FormDefinition,
  JobSchemaDefinition,
  PageDef,
  StepDef,
  ViewDefinition,
  ViewItemDef,
} from "./types.ts";

// ------------------------------------------------------------------ primitives (common.schema.json)

export const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const PATH_RE = /^[a-z_][a-z0-9_]*(\.[a-z0-9_]+)*$/;
export const CONTENT_KEY_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,9})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const LOCALE_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
export const STEP_TARGET_RE = /^((flow|page):)?[a-z][a-z0-9_]{0,63}$/;
export const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]*$/;
export const META_KEY_RE = /^[a-z][a-z0-9_]*$/;

export const zKey = z.string().regex(KEY_RE);
export const zUuid = z.string().regex(UUID_RE);
export const zPath = z.string().max(200).regex(PATH_RE);
export const zContentKey = z.string().max(200).regex(CONTENT_KEY_RE);
export const zTemplate = z.string().max(2000);
export const zDate = z.string().regex(DATE_RE);
export const zTime = z.string().regex(TIME_RE);
export const zDateTime = z.string().regex(DATETIME_RE);
export const zSha256 = z.string().regex(SHA256_RE);
export const zLocale = z.string().regex(LOCALE_RE);
export const zJson = z.custom<JsonValue>((v) => isJsonValue(v), { message: "must be a JSON value" });
export const zJsonObject = z.custom<JsonObject>((v) => isPlainObject(v) && isJsonValue(v), { message: "must be a JSON object" });

/** Operator object that passes the static rule check (docs/04 §4). */
export const zOperation = z.custom<JsonObject>((v) => isPlainObject(v) && isValidExpression(v), {
  message: "invalid rule expression",
  params: { code: "DEF_INVALID_EXPRESSION" },
});
/** Any expression: a literal, an array or an operator object. */
export const zExpression = z.custom<JsonValue>((v) => isValidExpression(v), {
  message: "invalid rule expression",
  params: { code: "DEF_INVALID_EXPRESSION" },
});

export const R = <T extends z.ZodTypeAny>(literal: T) => z.union([literal, zOperation]);

const zRegex = z
  .string()
  .max(256)
  .superRefine((s, ctx) => {
    try {
      checkSafeRegex(s);
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: e instanceof Error ? e.message : "invalid regex", params: { code: "DEF_INVALID_REGEX" } });
    }
  });

const unique = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(item)
    .min(1)
    .refine((a) => new Set(a.map((x) => JSON.stringify(x))).size === a.length, { message: "items must be unique" });

export const zAsset = z.object({ sha256: zSha256, alt: zTemplate.optional() }).strict();
export const zTarget = z.union([z.object({ page: zKey }).strict(), z.object({ flow: zKey }).strict()]);

const zStatTile: z.ZodTypeAny = z.lazy(() => viewItemMember("stat_tile"));

function defSchema(name: string): z.ZodTypeAny {
  switch (name) {
    case "guidance":
      return z.object({ text: zTemplate, asset: zAsset.optional() }).strict();
    case "tri_labels":
      return z.object({ yes: zTemplate.optional(), no: zTemplate.optional(), na: zTemplate.optional() }).strict();
    case "matrix_rows":
      return z.array(z.object({ key: zKey, label: zTemplate }).strict()).min(1);
    case "matrix_columns":
      return z.array(z.object({ value: z.string().min(1).max(100), label: zTemplate }).strict()).min(1);
    case "required_rows":
      return z.union([z.literal("all"), unique(zKey)]);
    case "stat_tiles":
      return z.array(zStatTile).min(1).max(4);
    case "buttons":
      return z.array(z.object({ label: zTemplate, action: z.enum(OUTCOME_BUTTON_ACTIONS), target: zTarget.optional() }).strict()).max(4);
    case "page_actions":
      return z.array(z.object({ label: zTemplate, target: zTarget }).strict()).max(4);
    case "messages":
      return z.record(zKey, zContentKey);
    /* c8 ignore next 2 */
    default:
      throw new Error(`unknown def ${name}`);
  }
}

function kindSchema(k: PropKind): z.ZodTypeAny {
  switch (k.t) {
    case "string": {
      let s = z.string().min(1).max(k.max ?? 500);
      if (k.pattern) s = s.regex(new RegExp(k.pattern));
      return s;
    }
    case "template":
      return zTemplate;
    case "bool":
      return z.boolean();
    case "int": {
      let n = z.number().int();
      if (k.min !== undefined) n = n.min(k.min);
      if (k.max !== undefined) n = n.max(k.max);
      return n;
    }
    case "number": {
      let n = z.number();
      if (k.min !== undefined) n = n.min(k.min);
      if (k.max !== undefined) n = n.max(k.max);
      if (k.positive) n = n.positive();
      return n;
    }
    case "enum":
      return z.enum(k.values as [string, ...string[]]);
    case "enum_list":
      return unique(z.enum(k.values as [string, ...string[]]));
    case "string_list":
      return z.array(z.string().min(1).max(200)).min(1);
    case "key":
      return zKey;
    case "key_list":
      return unique(zKey);
    case "path":
      return zPath;
    case "regex":
      return zRegex;
    case "date":
      return zDate;
    case "time":
      return zTime;
    case "datetime":
      return zDateTime;
    case "asset":
      return zAsset;
    case "target":
      return zTarget;
    case "def":
      return defSchema(k.def);
  }
}

export function propSchema(spec: PropSpec): z.ZodTypeAny {
  const base = kindSchema(spec.kind);
  return spec.ruleable ? R(base) : base;
}

function propsShape(props: Readonly<Record<string, PropSpec>>): z.ZodRawShape {
  const shape: z.ZodRawShape = {};
  for (const [name, spec] of Object.entries(props)) {
    const s = propSchema(spec);
    shape[name] = spec.required ? s : s.optional();
  }
  return shape;
}

const anyRequired = (props: Readonly<Record<string, PropSpec>>): boolean => Object.values(props).some((s) => s.required === true);

// ------------------------------------------------------------------ components (components.schema.json)

export const zOption = z
  .object({
    value: z.string().min(1).max(100),
    label: zTemplate,
    help_text: zTemplate.optional(),
    meta: z.record(z.string().regex(META_KEY_RE), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  })
  .strict();

export const zOptionsSource = z.discriminatedUnion("type", [
  z.object({ type: z.literal("lookup_list"), key: zKey }).strict(),
  z.object({ type: z.literal("reason_codes"), category: zKey }).strict(),
]);

const zValidateRule = z.object({ rule: R(z.boolean()), message: zTemplate, code: z.string().regex(ERROR_CODE_RE).optional() }).strict();
const zRisk = z.object({ when: R(z.boolean()), level: z.enum(["info", "elevated", "high"]), label: zTemplate.optional() }).strict();
const zExport = z.object({ include: z.boolean().optional(), column_label: z.string().min(1).max(100).optional() }).strict();
const zPdf = z.object({ include: z.boolean().optional(), layout: z.enum(["full", "compact", "table"]).optional() }).strict();
const zFallback = z
  .object({ type: z.enum(COMPONENT_TYPES as [string, ...string[]]), display: z.string().min(1).max(50).optional(), props: zJsonObject.optional() })
  .strict();

const inputCommon: z.ZodRawShape = {
  key: zKey,
  id: zUuid.optional(),
  label: R(zTemplate).optional(),
  help_text: zTemplate.optional(),
  required: R(z.boolean()).optional(),
  visible: R(z.boolean()).optional(),
  read_only: R(z.boolean()).optional(),
  value: zExpression.optional(),
  default: zExpression.optional(),
  validate: z.array(zValidateRule).max(20).optional(),
  risk_indicator: zRisk.optional(),
  reviewer_note: zTemplate.optional(),
  export: zExport.optional(),
  pdf: zPdf.optional(),
  fallback: zFallback.optional(),
};

// Recursive: groups and repeatable groups contain fields.
export const FieldSchema: z.ZodType<FieldDef> = z.lazy(() => fieldUnion()) as unknown as z.ZodType<FieldDef>;

function componentMember(spec: ComponentSpec): z.AnyZodObject {
  const shape: z.ZodRawShape = { type: z.literal(spec.type) };
  if (spec.shape === "display") {
    Object.assign(shape, { key: zKey, id: zUuid.optional(), visible: R(z.boolean()).optional(), pdf: zPdf.optional() }, propsShape(spec.props));
    return z.object(shape).strict();
  }
  if (spec.shape === "group") {
    Object.assign(shape, {
      key: zKey,
      id: zUuid.optional(),
      label: R(zTemplate).optional(),
      help_text: zTemplate.optional(),
      visible: R(z.boolean()).optional(),
      pdf: zPdf.optional(),
      props: z.object(propsShape(spec.props)).strict().optional(),
      fields: z.array(FieldSchema),
    });
    return z.object(shape).strict();
  }
  Object.assign(shape, inputCommon);
  if (spec.displays.length > 0) shape["display"] = z.enum(spec.displays as [string, ...string[]]).optional();
  const props = z.object(propsShape(spec.props)).strict();
  shape["props"] = anyRequired(spec.props) ? props : props.optional();
  if (spec.requiresValue) shape["value"] = zExpression;
  if (spec.options === "static_or_source") {
    shape["options"] = z.array(zOption).min(1).optional();
    shape["options_source"] = zOptionsSource.optional();
    shape["options_filter"] = R(z.boolean()).optional();
  } else if (spec.options === "filter_only") {
    shape["options_filter"] = R(z.boolean()).optional();
  }
  if (spec.hasFields) shape["fields"] = z.array(FieldSchema).min(1);
  return z.object(shape).strict();
}

type DUOption = z.ZodDiscriminatedUnionOption<"type">;
const asOptions = (xs: z.AnyZodObject[]) => xs as unknown as [DUOption, DUOption, ...DUOption[]];

let fieldUnionCache: z.ZodTypeAny | null = null;
function fieldUnion(): z.ZodTypeAny {
  if (fieldUnionCache) return fieldUnionCache;
  const members = Object.values(COMPONENTS).map(componentMember);
  fieldUnionCache = z.discriminatedUnion("type", asOptions(members)).superRefine(optionsRefinement);
  return fieldUnionCache;
}

function optionsRefinement(f: { type?: unknown; options?: unknown; options_source?: unknown }, ctx: z.RefinementCtx): void {
  const spec = typeof f.type === "string" ? COMPONENTS[f.type] : undefined;
  if (spec?.options !== "static_or_source") return;
  const n = (f.options !== undefined ? 1 : 0) + (f.options_source !== undefined ? 1 : 0);
  if (n !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "exactly one of `options` or `options_source` is required",
      params: { code: "DEF_OPTIONS_REQUIRED" },
    });
  }
}

export const AttributeSchema: z.ZodType<FieldDef> = z
  .discriminatedUnion(
    "type",
    asOptions(
      Object.values(COMPONENTS)
        .filter((s) => s.jobSchema)
        .map(componentMember),
    ),
  )
  .superRefine(optionsRefinement) as unknown as z.ZodType<FieldDef>;

export const SectionSchema = z
  .object({
    key: zKey,
    id: zUuid.optional(),
    title: R(zTemplate).optional(),
    description: zTemplate.optional(),
    visible: R(z.boolean()).optional(),
    page_break: z.boolean().optional(),
    fields: z.array(FieldSchema),
  })
  .strict();

// ------------------------------------------------------------------ headers

const zRequires = z
  .object({
    spec: z.string().regex(/^\d+\.\d+$/),
    components: z.record(z.string(), z.number().int().min(1)).optional(),
    step_types: z.record(z.string(), z.number().int().min(1)).optional(),
    view_components: z.record(z.string(), z.number().int().min(1)).optional(),
    page_types: z.record(z.string(), z.number().int().min(1)).optional(),
  })
  .strict();

const header = {
  spec_version: z.string().regex(/^1\.[0-9]+$/),
  family: zKey,
  version: z.number().int().min(1),
  scope: z.union([z.null(), z.object({ bank_id: z.union([z.null(), zUuid]) }).strict()]).optional(),
  id: zUuid.optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  locale: zLocale.optional(),
  requires: zRequires.optional(),
};

export const FormSchema = z
  .object({ ...header, kind: z.literal("form"), declaration_key: zKey.optional(), sections: z.array(SectionSchema).min(1) })
  .strict();

// ------------------------------------------------------------------ flow

function stepMember(type: string): z.AnyZodObject {
  const spec = STEPS[type];
  /* c8 ignore next */
  if (!spec) throw new Error(`unknown step ${type}`);
  const shape: z.ZodRawShape = {
    type: z.literal(type),
    id: zKey.optional(),
    label: zTemplate.optional(),
    next: z.union([z.string().regex(STEP_TARGET_RE), zOperation]).optional(),
    ...propsShape(spec.props),
  };
  if (spec.removable) shape["visible"] = R(z.boolean()).optional();
  return z.object(shape).strict();
}

export const StepSchema: z.ZodType<StepDef> = z.discriminatedUnion("type", asOptions(Object.keys(STEPS).map(stepMember))) as unknown as z.ZodType<StepDef>;

export const FlowSchema = z
  .object({
    ...header,
    kind: z.literal("flow"),
    form_family: zKey.optional(),
    action: z.enum(FLOW_ACTIONS as [string, ...string[]]).optional(),
    steps: z.array(StepSchema).min(1),
  })
  .strict();

// ------------------------------------------------------------------ job schema

export const JobSchemaSchema = z
  .object({ ...header, kind: z.literal("job_schema"), attributes: z.array(AttributeSchema).min(1) })
  .strict();

// ------------------------------------------------------------------ view

function viewItemMember(type: string): z.AnyZodObject {
  const spec = VIEW_COMPONENTS[type];
  /* c8 ignore next */
  if (!spec) throw new Error(`unknown view component ${type}`);
  return z
    .object({ type: z.literal(type), id: zKey.optional(), visible: R(z.boolean()).optional(), ...propsShape(spec.props) })
    .strict();
}

export const ViewItemSchema: z.ZodType<ViewItemDef> = z.discriminatedUnion(
  "type",
  asOptions(Object.keys(VIEW_COMPONENTS).map(viewItemMember)),
) as unknown as z.ZodType<ViewItemDef>;

export const ViewSchema = z.object({ ...header, kind: z.literal("view"), items: z.array(ViewItemSchema).min(1) }).strict();

// ------------------------------------------------------------------ content

export const ContentSchema = z
  .object({ ...header, kind: z.literal("content"), locale: zLocale, strings: z.record(zContentKey, z.string().max(5000)) })
  .strict();

// ------------------------------------------------------------------ app

function pageMember(type: string): z.AnyZodObject {
  const spec = PAGE_TYPES[type];
  /* c8 ignore next */
  if (!spec) throw new Error(`unknown page type ${type}`);
  return z.object({ type: z.literal(type), ...propsShape(spec.props) }).strict();
}

export const PageSchema: z.ZodType<PageDef> = z.discriminatedUnion("type", asOptions(Object.keys(PAGE_TYPES).map(pageMember))) as unknown as z.ZodType<PageDef>;

export const AppSchema = z
  .object({
    ...header,
    kind: z.literal("app"),
    home: zKey,
    navigation: z
      .object({
        style: z.enum(NAV_STYLES),
        items: z.array(z.object({ label: zTemplate, icon: z.string().min(1).max(50).optional(), page: zKey }).strict()).max(6),
      })
      .strict()
      .optional(),
    pages: z.record(zKey, PageSchema),
    outcome_sets: z.record(zKey, z.object({ success: zKey, saved: zKey, failure: zKey }).strict()).optional(),
  })
  .strict();

// ------------------------------------------------------------------ any definition

export const DefinitionSchema = z.discriminatedUnion("kind", [FormSchema, FlowSchema, JobSchemaSchema, ViewSchema, ContentSchema, AppSchema]);

/** Typed views of the Zod outputs (the Zod-inferred types are structurally identical but noisier). */
export type ParsedForm = FormDefinition;
export type ParsedFlow = FlowDefinition;
export type ParsedJobSchema = JobSchemaDefinition;
export type ParsedView = ViewDefinition;
export type ParsedContent = ContentDefinition;
export type ParsedApp = AppDefinition;
export type ParsedDefinition = Definition;
