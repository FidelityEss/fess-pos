// Immutable editing helpers for definition documents. Every edit copies only the objects on the path it changes and carries
// every other property through untouched, so properties the structured editors do not know about are never lost.
import { isPlainObject } from '@/lib/utils';

export type Obj = Record<string, unknown>;
export type Path = readonly (string | number)[];

export const asObj = (v: unknown): Obj => (isPlainObject(v) ? v : {});
export const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
export const isRule = (v: unknown): v is Obj => isPlainObject(v);

/** Value at `path` (undefined when any step is missing). */
export function getIn(doc: unknown, path: Path): unknown {
  let cur: unknown = doc;
  for (const seg of path) {
    if (Array.isArray(cur) && typeof seg === 'number') cur = cur[seg];
    else if (isPlainObject(cur)) cur = cur[String(seg)];
    else return undefined;
  }
  return cur;
}

/** Copy of `doc` with `fn(current)` at `path`. Returning `undefined` from fn deletes an object property. */
export function updateIn(doc: unknown, path: Path, fn: (current: unknown) => unknown): unknown {
  if (path.length === 0) return fn(doc);
  const [head, ...rest] = path;
  if (typeof head === 'number') {
    const arr = [...asArr(doc)];
    arr[head] = updateIn(arr[head], rest, fn);
    return arr;
  }
  const obj: Obj = { ...asObj(doc) };
  const next = updateIn(obj[head as string], rest, fn);
  if (next === undefined) delete obj[head as string];
  else obj[head as string] = next;
  return obj;
}

export const setIn = (doc: unknown, path: Path, value: unknown): unknown => updateIn(doc, path, () => value);

/** Set (or, with undefined / '' when `dropEmpty`, remove) one property of the object at `path`. */
export function setProp(doc: unknown, path: Path, key: string, value: unknown, dropEmpty = true): unknown {
  return updateIn(doc, path, (cur) => {
    const o: Obj = { ...asObj(cur) };
    if (value === undefined || (dropEmpty && value === '')) delete o[key];
    else o[key] = value;
    return o;
  });
}

export function insertAt(doc: unknown, arrayPath: Path, index: number, item: unknown): unknown {
  return updateIn(doc, arrayPath, (cur) => {
    const arr = [...asArr(cur)];
    arr.splice(Math.max(0, Math.min(index, arr.length)), 0, item);
    return arr;
  });
}

export function removeAt(doc: unknown, arrayPath: Path, index: number): unknown {
  return updateIn(doc, arrayPath, (cur) => asArr(cur).filter((_, i) => i !== index));
}

export function moveItem(doc: unknown, arrayPath: Path, from: number, to: number): unknown {
  return updateIn(doc, arrayPath, (cur) => {
    const arr = [...asArr(cur)];
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return arr;
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    return arr;
  });
}

/** Rename an object key in place (keeping key order). */
export function renameKey(obj: Obj, from: string, to: string): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(obj)) out[k === from ? to : k] = v;
  return out;
}

/** Reorder an object's keys: move `key` to position `to`. */
export function moveKey(obj: Obj, key: string, to: number): Obj {
  const keys = Object.keys(obj).filter((k) => k !== key);
  keys.splice(Math.max(0, Math.min(to, keys.length)), 0, key);
  const out: Obj = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

/** "Premises type (other)" → "premises_type_other" — a valid definition key (^[a-z][a-z0-9_]{0,63}$). */
export function toKey(label: string, fallback = 'item'): string {
  let k = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!/^[a-z]/.test(k)) k = k ? `${fallback}_${k}` : fallback;
  return k.slice(0, 56).replace(/_+$/, '');
}

/** `base`, else `base_2`, `base_3`… not in `taken`. */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) {
    const k = `${base}_${i}`;
    if (!set.has(k)) return k;
  }
}

export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** Every field key in a form (sections → fields → nested group fields). */
export function allFieldKeys(doc: unknown, root: 'sections' | 'attributes' = 'sections'): string[] {
  const out: string[] = [];
  const walk = (fields: unknown) => {
    for (const f of asArr(fields)) {
      const o = asObj(f);
      if (typeof o.key === 'string') out.push(o.key);
      if (Array.isArray(o.fields)) walk(o.fields);
    }
  };
  if (root === 'attributes') walk(asObj(doc).attributes);
  else for (const s of asArr(asObj(doc).sections)) walk(asObj(s).fields);
  return out;
}

/** Deep copy (JSON-safe values only — definitions are JSON). */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** After moving item `from` → `to` in the array at `arrayPath`, the selection path that follows the moved items. */
export function remapSelection(selected: string | null, arrayPath: Path, from: number, to: number): string | null {
  if (!selected) return selected;
  const prefix = `${pathKey(arrayPath)}/`;
  if (!selected.startsWith(prefix)) return selected;
  const rest = selected.slice(prefix.length).split('/');
  const idx = Number(rest[0]);
  let ni = idx;
  if (idx === from) ni = to;
  else if (from < idx && to >= idx) ni = idx - 1;
  else if (from > idx && to <= idx) ni = idx + 1;
  rest[0] = String(ni);
  return `${prefix}${rest.join('/')}`;
}

/** Give a copied field (and any nested fields) keys that are not taken yet; returns the new keys. */
export function rekeyCopy(field: Obj, taken: Set<string>): { field: Obj; keys: string[] } {
  const keys: string[] = [];
  const walk = (f: Obj): Obj => {
    const out: Obj = { ...f };
    if (typeof f.key === 'string') {
      const k = uniqueKey(`${f.key.replace(/(_copy(_\d+)?)+$/, '')}_copy`.slice(0, 60), taken);
      taken.add(k);
      keys.push(k);
      out.key = k;
    }
    if (Array.isArray(f.fields)) out.fields = f.fields.map((c) => walk(asObj(c)));
    return out;
  };
  return { field: walk(clone(field)), keys };
}

/** Path ⇄ string for selection state. */
export const pathKey = (p: Path): string => p.join('/');
export const parsePathKey = (s: string): (string | number)[] => s.split('/').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
