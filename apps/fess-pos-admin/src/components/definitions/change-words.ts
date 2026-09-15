// What a publish changes, in plain words (docs/17 §4.6 "a summary of what changes"): the server's changelog is keyed by
// technical names (field keys, step ids, page keys, "section:<key>"); this names each entry the way the editor shows it
// ("Section “Premises”", "“Till photo”", "the step “Review answers”") and says what changed about it.
import { humanLabel } from '@/components/structured-view';
import { stepWording, viewWording } from './studio/catalogue-ui';
import { asArr, asObj, asStr } from './studio/doc';

const PROP_WORDS: Record<string, string> = {
  type: 'the kind of question',
  label: 'the wording',
  required: 'whether it must be answered',
  visible: 'when it shows',
  read_only: 'whether it can be changed',
  options: 'the answers to choose from',
  options_source: 'the list of answers',
  props: 'its settings',
  validate: 'its checks',
  value: 'its automatic value',
  default: 'its starting value',
  display: 'how it looks',
  next: 'where it goes next',
  title: 'the title',
  fields: 'its questions',
  description: 'the description',
};

function findField(fields: unknown, key: string): Record<string, unknown> | null {
  for (const raw of asArr(fields)) {
    const f = asObj(raw);
    if (f.key === key) return f;
    const inner = findField(f.fields, key);
    if (inner) return inner;
  }
  return null;
}

/** The name of one changelog entry, looked up in the new document first, then the old one. */
export function changeName(kind: string, key: string, docs: readonly unknown[]): string {
  const quote = (s: string) => `“${s}”`;
  if (kind === 'form' || kind === 'job_schema') {
    if (key.startsWith('section:')) {
      const sk = key.slice('section:'.length);
      for (const d of docs) for (const s of asArr(asObj(d).sections)) if (asObj(s).key === sk) return `the section ${quote(asStr(asObj(s).title) || humanLabel(sk))}`;
      return `the section ${quote(humanLabel(sk))}`;
    }
    const fk = key.split('.').pop() ?? key;
    for (const d of docs) {
      const o = asObj(d);
      const f = kind === 'job_schema' ? findField(o.attributes, fk) : asArr(o.sections).map((s) => findField(asObj(s).fields, fk)).find(Boolean);
      const label = f ? asStr(f.label) || asStr(f.text) : '';
      if (label) return quote(label.length > 60 ? `${label.slice(0, 60)}…` : label);
    }
    return quote(humanLabel(fk));
  }
  if (kind === 'flow' || kind === 'view') {
    const [type, idx] = key.includes('#') ? key.split('#') : [null, null];
    for (const d of docs) {
      const list = asArr(asObj(d)[kind === 'flow' ? 'steps' : 'items']).map(asObj);
      const hit = type !== null ? list[Number(idx)] : list.find((x) => x.id === key);
      if (hit) {
        const name = kind === 'flow' ? asStr(hit.label) || stepWording(asStr(hit.type)).name : asStr(hit.label) || viewWording(asStr(hit.type)).name;
        return kind === 'flow' ? `the step ${quote(name)}` : quote(name);
      }
    }
    return quote(humanLabel(type ?? key));
  }
  if (kind === 'app') {
    if (key === 'navigation') return 'the tabs and start page';
    for (const d of docs) {
      const page = asObj(asObj(asObj(d).pages)[key]);
      if (Object.keys(page).length) return `the page ${quote(asStr(page.title) || humanLabel(key))}`;
    }
    return `the page ${quote(humanLabel(key))}`;
  }
  if (kind === 'content') return `the text ${quote(key)}`;
  return quote(humanLabel(key));
}

export interface ChangeSummary {
  added: string[];
  removed: string[];
  changed: string[];
}

/** The changelog as named, plain sentences' parts. `doc` is the new document, `previousDoc` the version it's compared with. */
export function changeSummary(changelog: { added?: unknown[]; removed?: unknown[]; changed?: unknown[] } | null | undefined, doc: unknown, previousDoc?: unknown): ChangeSummary {
  const kind = asStr(asObj(doc).kind) || asStr(asObj(previousDoc).kind);
  const keyOf = (e: unknown) => (typeof e === 'string' ? e : asStr(asObj(e).key));
  const name = (e: unknown, docs: unknown[]) => changeName(kind, keyOf(e), docs);
  return {
    added: asArr(changelog?.added).map((e) => name(e, [doc])),
    removed: asArr(changelog?.removed).map((e) => name(e, [previousDoc, doc])),
    changed: asArr(changelog?.changed).map((e) => {
      const what = asArr(asObj(e).changes)
        .map((c) => PROP_WORDS[String(c)] ?? humanLabel(String(c)).toLowerCase())
        .filter(Boolean);
      return what.length ? `${name(e, [doc, previousDoc])} (${what.join(', ')})` : name(e, [doc, previousDoc]);
    }),
  };
}
