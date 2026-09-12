// GENERATED — do not edit. Source: packages/fess_pos_engine_ts/src/definitions/templates.ts (run: node tools/vendor-engine.mjs)
/**
 * Label/text templates (docs/04 §3.1): `"Photos of {{answers.other_business_name}}"`.
 * A placeholder is `{{ path }}` where path is a dotted var path. Rendering: strings as-is,
 * numbers in JCS/ECMAScript form, booleans as `true`/`false`, null/missing/arrays/objects as "".
 */
import type { JsonValue } from "../json.ts";
import { readPath } from "../json.ts";
import { serializeNumber } from "../jcs.ts";

const PLACEHOLDER = /\{\{\s*([a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*)\s*\}\}/g;

/** Paths referenced by a template, in order of appearance (duplicates removed). */
export function templatePaths(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(PLACEHOLDER)) {
    const path = m[1] as string;
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

/** False when the template has stray `{{` / `}}` or placeholders with invalid paths. */
export function isValidTemplate(s: string): boolean {
  const stripped = s.replace(PLACEHOLDER, "");
  return !stripped.includes("{{") && !stripped.includes("}}");
}

export function renderScalar(v: JsonValue | undefined): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return serializeNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return "";
}

export function renderTemplate(s: string, data: JsonValue): string {
  return s.replace(PLACEHOLDER, (_m, path: string) => renderScalar(readPath(data, path)));
}
