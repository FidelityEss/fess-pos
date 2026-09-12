// GENERATED — do not edit. Source: packages/fess_pos_engine_ts/src/definitions/parse.ts (run: node tools/vendor-engine.mjs)
/**
 * Structural parsing of definitions of any kind, with stable error codes.
 * Semantic checks (duplicate keys, cycles, missing refs…) live in the analyser.
 */
import type { z } from "npm:zod@^3.25.76";
import { isPlainObject } from "../json.ts";
import { DEFINITION_KINDS, SUPPORTED_SPEC_MAJOR, SUPPORTED_SPEC_MINOR } from "./catalogue.ts";
import type { DefinitionKind } from "./catalogue.ts";
import { AppSchema, ContentSchema, FlowSchema, FormSchema, JobSchemaSchema, ViewSchema } from "./schemas.ts";
import type { Definition } from "./types.ts";

export const DEFINITION_ERROR_CODES = [
  "DEF_NOT_OBJECT",
  "DEF_UNKNOWN_KIND",
  "DEF_UNSUPPORTED_SPEC_VERSION",
  "DEF_UNKNOWN_COMPONENT",
  "DEF_UNKNOWN_STEP_TYPE",
  "DEF_UNKNOWN_VIEW_COMPONENT",
  "DEF_UNKNOWN_PAGE_TYPE",
  "DEF_UNKNOWN_PROPERTY",
  "DEF_MISSING_PROPERTY",
  "DEF_INVALID_EXPRESSION",
  "DEF_INVALID_REGEX",
  "DEF_OPTIONS_REQUIRED",
  "DEF_INVALID_VALUE",
] as const;
export type DefinitionErrorCode = (typeof DEFINITION_ERROR_CODES)[number];

export interface DefinitionIssue {
  readonly code: string;
  readonly message: string;
  /** JSON Pointer into the definition. */
  readonly path: string;
}

export type ParseResult<T> = { ok: true; definition: T } | { ok: false; errors: DefinitionIssue[] };

const SCHEMAS: Record<DefinitionKind, z.ZodTypeAny> = {
  form: FormSchema,
  flow: FlowSchema,
  job_schema: JobSchemaSchema,
  view: ViewSchema,
  content: ContentSchema,
  app: AppSchema,
};

export function pointer(path: readonly (string | number)[]): string {
  return path.length === 0 ? "" : "/" + path.map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}

function discriminatorCode(path: readonly (string | number)[]): string {
  for (let i = path.length - 1; i >= 0; i--) {
    const seg = path[i];
    if (seg === "steps") return "DEF_UNKNOWN_STEP_TYPE";
    if (seg === "items" || seg === "tiles") return "DEF_UNKNOWN_VIEW_COMPONENT";
    if (seg === "pages") return "DEF_UNKNOWN_PAGE_TYPE";
    if (seg === "fields" || seg === "attributes") return "DEF_UNKNOWN_COMPONENT";
  }
  return "DEF_INVALID_VALUE";
}

function valueAt(input: unknown, path: readonly (string | number)[]): unknown {
  let cur = input;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    const k = String(seg);
    cur = Object.prototype.hasOwnProperty.call(cur, k) ? (cur as Record<string, unknown>)[k] : undefined;
  }
  return cur;
}

function mapIssue(issue: z.ZodIssue, input: unknown): string {
  switch (issue.code) {
    case "invalid_union_discriminator":
      return discriminatorCode(issue.path);
    case "unrecognized_keys":
      return "DEF_UNKNOWN_PROPERTY";
    case "invalid_type":
      return issue.received === "undefined" ? "DEF_MISSING_PROPERTY" : "DEF_INVALID_VALUE";
    case "custom": {
      if (valueAt(input, issue.path) === undefined) return "DEF_MISSING_PROPERTY";
      const code: unknown = issue.params?.["code"];
      return typeof code === "string" ? code : "DEF_INVALID_VALUE";
    }
    case "invalid_union": {
      const v = valueAt(input, issue.path);
      if (v === undefined) return "DEF_MISSING_PROPERTY";
      const inner = issue.unionErrors.flatMap((e) => e.issues.map((i) => mapIssue(i, input)));
      // Only an object is an attempted expression; a wrong literal ("yes" for a boolean) is a plain bad value.
      if (isPlainObject(v) && inner.includes("DEF_INVALID_EXPRESSION")) return "DEF_INVALID_EXPRESSION";
      if (inner.includes("DEF_INVALID_REGEX")) return "DEF_INVALID_REGEX";
      return "DEF_INVALID_VALUE";
    }
    default:
      return "DEF_INVALID_VALUE";
  }
}

export function zodIssues(error: z.ZodError, input?: unknown): DefinitionIssue[] {
  return error.issues.map((i) => ({ code: mapIssue(i, input), message: i.message, path: pointer(i.path) }));
}

/** Parse and structurally validate a definition of any kind. */
export function parseDefinition(input: unknown): ParseResult<Definition> {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ code: "DEF_NOT_OBJECT", message: "a definition must be a JSON object", path: "" }] };
  }
  const kind = input["kind"];
  if (typeof kind !== "string" || !(DEFINITION_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, errors: [{ code: "DEF_UNKNOWN_KIND", message: `unknown definition kind ${JSON.stringify(kind)}`, path: "/kind" }] };
  }
  const sv = input["spec_version"];
  if (typeof sv === "string") {
    const m = /^(\d+)\.(\d+)$/.exec(sv);
    if (m && (Number(m[1]) !== SUPPORTED_SPEC_MAJOR || Number(m[2]) > SUPPORTED_SPEC_MINOR)) {
      return {
        ok: false,
        errors: [{ code: "DEF_UNSUPPORTED_SPEC_VERSION", message: `spec_version ${sv} is not supported (engine supports 1.0)`, path: "/spec_version" }],
      };
    }
  }
  const schema = SCHEMAS[kind as DefinitionKind];
  const res = schema.safeParse(input);
  if (!res.success) return { ok: false, errors: zodIssues(res.error, input) };
  return { ok: true, definition: res.data as Definition };
}

/** Parse a definition that must be of `kind`. */
export function parseDefinitionOfKind<K extends DefinitionKind>(input: unknown, kind: K): ParseResult<Extract<Definition, { kind: K }>> {
  const res = parseDefinition(input);
  if (!res.ok) return res;
  if (res.definition.kind !== kind) {
    return { ok: false, errors: [{ code: "DEF_UNKNOWN_KIND", message: `expected a ${kind} definition, got ${res.definition.kind}`, path: "/kind" }] };
  }
  return { ok: true, definition: res.definition as Extract<Definition, { kind: K }> };
}
