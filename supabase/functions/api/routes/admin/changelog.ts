// Publish changelog (docs/04 §7): what changed between the previous version and the candidate, keyed by the stable
// identifiers of each kind (field keys for forms/job schemas, step ids for flows, item ids for views, string keys for
// content, page keys for apps). Removing a key or changing a field's type is breaking.

export interface ChangeEntry {
  key: string;
  changes: string[];
}

export interface Changelog {
  added: string[];
  removed: string[];
  changed: ChangeEntry[];
  note?: string;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

function collectFields(fields: unknown, out: Map<string, Obj>, prefix = ''): void {
  if (!Array.isArray(fields)) return;
  for (const f of fields) {
    if (!isObj(f) || typeof f.key !== 'string') continue;
    out.set(prefix + f.key, f);
    if (Array.isArray(f.fields)) collectFields(f.fields, out, `${prefix}${f.key}.`);
  }
}

/** Keyed entries per definition kind. */
function entries(kind: string, def: unknown): Map<string, Obj> {
  const out = new Map<string, Obj>();
  if (!isObj(def)) return out;
  if (kind === 'form' && Array.isArray(def.sections)) {
    for (const s of def.sections) {
      if (!isObj(s)) continue;
      if (typeof s.key === 'string') out.set(`section:${s.key}`, { ...s, fields: undefined });
      collectFields(s.fields, out);
    }
  } else if (kind === 'job_schema') {
    collectFields(def.attributes, out);
  } else if (kind === 'flow' && Array.isArray(def.steps)) {
    def.steps.forEach((s, i) => { if (isObj(s)) out.set(typeof s.id === 'string' ? s.id : `${String(s.type)}#${i}`, s); });
  } else if (kind === 'view' && Array.isArray(def.items)) {
    def.items.forEach((s, i) => { if (isObj(s)) out.set(typeof s.id === 'string' ? s.id : `${String(s.type)}#${i}`, s); });
  } else if (kind === 'content' && isObj(def.strings)) {
    for (const [k, v] of Object.entries(def.strings)) out.set(k, { value: v });
  } else if (kind === 'app' && isObj(def.pages)) {
    for (const [k, v] of Object.entries(def.pages)) out.set(k, isObj(v) ? v : { value: v });
    out.set('navigation', { value: def.navigation, home: def.home });
  }
  return out;
}

const WATCHED = ['type', 'label', 'required', 'visible', 'read_only', 'options', 'options_source', 'props', 'validate', 'value', 'default', 'display', 'next'];

export function changelogOf(kind: string, previous: unknown, next: unknown): { changelog: Changelog; breaking: boolean } {
  const before = entries(kind, previous);
  const after = entries(kind, next);
  const added = [...after.keys()].filter((k) => !before.has(k)).sort();
  const removed = [...before.keys()].filter((k) => !after.has(k)).sort();
  const changed: ChangeEntry[] = [];
  let typeChanged = false;
  for (const [key, a] of after) {
    const b = before.get(key);
    if (!b) continue;
    const props = new Set([...Object.keys(a), ...Object.keys(b)]);
    const diffs = [...props].filter((p) => (WATCHED.includes(p) || kind === 'content' || kind === 'app') && stable(a[p]) !== stable(b[p]));
    if (diffs.length) {
      changed.push({ key, changes: diffs.sort() });
      if (diffs.includes('type')) typeChanged = true;
    }
  }
  changed.sort((x, y) => x.key.localeCompare(y.key));
  const removedFields = removed.filter((k) => !k.startsWith('section:'));
  const breaking = previous !== null && previous !== undefined && (removedFields.length > 0 || typeChanged);
  return { changelog: { added, removed, changed }, breaking };
}
