// Pure helpers over sparse config layer documents (dotted paths, immutable set/delete, deep merge).
// A layer stores only the keys set at that layer; deleting a key prunes empty parent objects so the document stays sparse.
import { getPath, jsonEqual } from '@/components/ops/ops-shared';
import type { JsonObject } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';

export { getPath, jsonEqual };

export function hasPath(value: unknown, path: string): boolean {
  return getPath(value, path) !== undefined;
}

export function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** A copy of `doc` with `value` at `path` (intermediate objects created). */
export function setIn(doc: JsonObject, path: string, value: unknown): JsonObject {
  const [head, ...rest] = path.split('.');
  if (head === undefined) return doc;
  if (rest.length === 0) return { ...doc, [head]: cloneJson(value) };
  const child = isPlainObject(doc[head]) ? (doc[head] as JsonObject) : {};
  return { ...doc, [head]: setIn(child, rest.join('.'), value) };
}

/** A copy of `doc` without `path`; parents left empty by the removal are removed too. */
export function deleteIn(doc: JsonObject, path: string): JsonObject {
  const [head, ...rest] = path.split('.');
  if (head === undefined || !Object.prototype.hasOwnProperty.call(doc, head)) return doc;
  const out = { ...doc };
  if (rest.length === 0) {
    delete out[head];
    return out;
  }
  const child = doc[head];
  if (!isPlainObject(child)) return doc;
  const next = deleteIn(child as JsonObject, rest.join('.'));
  if (Object.keys(next).length === 0) delete out[head];
  else out[head] = next;
  return out;
}

/** Objects merge key by key; arrays and scalars replace (same rule as the engine and pos.jsonb_deep_merge). */
export function deepMerge(base: JsonObject, over: JsonObject): JsonObject {
  const out: JsonObject = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = isPlainObject(v) && isPlainObject(b) ? deepMerge(b as JsonObject, v as JsonObject) : v;
  }
  return out;
}

/** Leaf paths of a document ("a.b.c"); empty objects count as leaves. */
export function leafPaths(value: unknown, prefix = ''): string[] {
  if (!isPlainObject(value) || Object.keys(value).length === 0) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}

/** "Petrol station" → "petrol_station" (config keys: ^[a-z][a-z0-9_]{0,63}$). */
export function toSnakeKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 64);
}

export const CONFIG_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
