// Builds the rule vocabulary (field labels, option labels, Yes/No wording, job attribute labels) from a form or job
// schema document so rule sentences read "Premises type is Private home" rather than "answers.premises_type == home".
import { asArr, asObj, asStr } from './doc';
import type { RuleVocabulary } from './rule-english';

export function buildVocab(doc: unknown, jobSchema?: unknown): RuleVocabulary {
  const labels = new Map<string, string>();
  const options = new Map<string, Map<string, string>>();
  const bools = new Map<string, { t?: string; f?: string }>();
  const walk = (fields: unknown) => {
    for (const raw of asArr(fields)) {
      const f = asObj(raw);
      const key = asStr(f.key);
      if (!key) continue;
      const label = asStr(f.label);
      if (label) labels.set(key, label);
      if (Array.isArray(f.options)) options.set(key, new Map(f.options.map((o) => [asStr(asObj(o).value), asStr(asObj(o).label)])));
      if (f.type === 'boolean') {
        const p = asObj(f.props);
        bools.set(key, { t: asStr(p.true_label) || undefined, f: asStr(p.false_label) || undefined });
      }
      if (Array.isArray(f.fields)) walk(f.fields);
    }
  };
  const d = asObj(doc);
  for (const s of asArr(d.sections)) walk(asObj(s).fields);
  walk(d.attributes);
  const attrs = new Map<string, string>();
  for (const a of asArr(asObj(jobSchema).attributes)) {
    const o = asObj(a);
    if (typeof o.key === 'string' && typeof o.label === 'string') attrs.set(o.key, o.label);
  }
  return {
    fieldLabel: (k) => labels.get(k),
    optionLabel: (k, v) => options.get(k)?.get(v) || undefined,
    booleanLabel: (k, v) => (v ? bools.get(k)?.t : bools.get(k)?.f),
    attributeLabel: (k) => attrs.get(k),
  };
}
