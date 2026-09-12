// GENERATED — do not edit. Source: packages/fess_pos_engine_ts/src/json.ts (run: node tools/vendor-engine.mjs)
/**
 * JSON value types and small, dependency-free helpers shared by every module.
 * Everything the engine reads (definitions, answers, contexts) is plain JSON.
 */

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonTypeName = "null" | "boolean" | "number" | "string" | "array" | "object";

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** True for `{}`-style objects (not arrays, not class instances, not null). */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function isJsonObject(v: unknown): v is JsonObject {
  return isPlainObject(v);
}

/** Own-property read that never reaches the prototype chain. */
export function getOwn(o: JsonObject, key: string): JsonValue | undefined {
  return hasOwn(o, key) ? o[key] : undefined;
}

export function hasOwnKey(o: object, key: string): boolean {
  return hasOwn(o, key);
}

export function jsonTypeOf(v: JsonValue): JsonTypeName {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    default:
      return "object";
  }
}

/** Strict structural equality: no type coercion, key order irrelevant. */
export function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i] as JsonValue, b[i] as JsonValue)) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as JsonObject;
  const bo = b as JsonObject;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!hasOwn(bo, k)) return false;
    if (!deepEqual(ao[k] as JsonValue, bo[k] as JsonValue)) return false;
  }
  return true;
}

/** True when `v` is a finite-number/JSON tree (rejects undefined, NaN, functions, class instances). */
export function isJsonValue(v: unknown, depth = 0): v is JsonValue {
  if (depth > 256) return false;
  if (v === null) return true;
  switch (typeof v) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(v);
    case "object":
      if (Array.isArray(v)) return v.every((x) => isJsonValue(x, depth + 1));
      if (!isPlainObject(v)) return false;
      return Object.keys(v).every((k) => isJsonValue(v[k], depth + 1));
    default:
      return false;
  }
}

/** Read a dotted path (`a.b.0.c`) from a JSON tree. Missing → undefined. */
export function readPath(root: JsonValue, path: string): JsonValue | undefined {
  if (path === "") return root;
  let cur: JsonValue | undefined = root;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9][0-9]*)$/.test(seg)) return undefined;
      const idx = Number(seg);
      cur = idx < cur.length ? cur[idx] : undefined;
    } else if (typeof cur === "object") {
      cur = getOwn(cur, seg);
    } else {
      return undefined;
    }
  }
  return cur;
}

export function cloneJson<T extends JsonValue>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
