/** Test helpers: fixture loading and an ajv instance holding every JSON Schema in schema/. Node-only (tests). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { expect } from "vitest";
import { deepEqual } from "../src/json.ts";
import type { JsonValue } from "../src/json.ts";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const SCHEMA_DIR = join(REPO, "schema");
export const FIXTURES = join(SCHEMA_DIR, "fixtures");
export const SCHEMA_BASE = "https://fess-pos.invalid/schema/";

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

export interface Fixture<T> {
  readonly name: string;
  readonly path: string;
  readonly data: T;
}

/** All JSON fixtures directly under schema/fixtures/<sub> (non-recursive). */
export function fixtures<T = Record<string, unknown>>(sub: string): Fixture<T>[] {
  const dir = join(FIXTURES, sub);
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => ({ name: basename(n, ".json"), path: join(dir, n), data: readJson<T>(join(dir, n)) }));
}

type AjvLike = {
  addSchema(s: unknown): unknown;
  addVocabulary(v: string[]): unknown;
  getSchema(id: string): ValidateFunction | undefined;
  compile(s: unknown): ValidateFunction;
};
type AjvCtor = new (opts: Record<string, unknown>) => AjvLike;

const Ajv2020 = ((Ajv2020Import as unknown as { default?: AjvCtor }).default ?? Ajv2020Import) as unknown as AjvCtor;
const addFormats = ((addFormatsImport as unknown as { default?: (a: AjvLike) => void }).default ?? addFormatsImport) as unknown as (a: AjvLike) => void;

export const SCHEMA_FILES = walk(SCHEMA_DIR).filter((p) => p.endsWith(".schema.json") && !p.includes(`${join("schema", "fixtures")}`));

let shared: AjvLike | null = null;
export function ajv(): AjvLike {
  if (shared) return shared;
  const a = new Ajv2020({ strict: true, allErrors: true, strictTypes: false });
  addFormats(a);
  a.addVocabulary(["x-integrity-relevant", "x-host-overridable", "x-client-safe", "x-known-types"]);
  for (const f of SCHEMA_FILES) a.addSchema(readJson(f));
  shared = a;
  return a;
}

/** Validator for a schema file path relative to schema/, e.g. "api/receipt.schema.json". */
export function schemaFor(rel: string): ValidateFunction {
  const v = ajv().getSchema(SCHEMA_BASE + rel);
  if (!v) throw new Error(`no schema ${rel}`);
  return v;
}

export function relSchemaPath(abs: string): string {
  return relative(SCHEMA_DIR, abs).split("\\").join("/");
}

/** Strict JSON equality (treats -0 and 0 alike) with a readable diff on failure. */
export function expectJson(actual: unknown, expected: unknown): void {
  if (!deepEqual(actual as JsonValue, expected as JsonValue)) expect(actual).toEqual(expected);
}

export function errorKeys(errors: readonly { field_key: string; code: string }[]): string[] {
  return errors.map((e) => `${e.field_key}|${e.code}`).sort();
}
