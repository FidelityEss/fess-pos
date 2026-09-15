// Advice while you edit (docs/17 §4.6 "checks read as advice"): quick, local checks on the questions or the job
// information that name the thing and suggest the fix ("Question “Till photo” is never shown to anyone. Did you mean to
// hide it?"). They never block anything: the full check (the server's analysis) runs on Check and before publishing.
import { COMPONENTS } from '@/lib/engine';
import { componentWording } from './catalogue-ui';
import { asArr, asObj, asStr, isRule, type Obj, type Path, pathKey } from './doc';

export interface Advice {
  text: string;
  /** Document path of what it's about, so "Show me" can open it. */
  target: string | null;
  tone: 'warning' | 'info';
}

interface FieldInfo {
  key: string;
  name: string;
  field: Obj;
  path: Path;
  order: number;
  section: string;
}

const RULE_SLOTS = ['visible', 'required', 'read_only', 'options_filter', 'validate', 'risk_indicator', 'value', 'default', 'props', 'label'] as const;

/** Every `answers.<key>` a value reads (item.* belongs to repeating groups and is left out). */
function answerRefs(v: unknown, out: Set<string>): void {
  if (Array.isArray(v)) {
    for (const x of v) answerRefs(x, out);
    return;
  }
  const o = asObj(v);
  const keys = Object.keys(o);
  if (keys.length === 1 && keys[0] === 'var') {
    const raw = o.var;
    const path = typeof raw === 'string' ? raw : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : '';
    if (path.startsWith('answers.')) out.add(path.slice('answers.'.length).split('.')[0] ?? '');
    return;
  }
  for (const k of keys) answerRefs(o[k], out);
}

/** Comparisons of a choice answer with a fixed value: {"==": [{"var": "answers.k"}, "v"]} and {"in": [{"var": "answers.k"}, [..]]}. */
function comparedValues(v: unknown, out: { key: string; value: string }[]): void {
  if (Array.isArray(v)) {
    for (const x of v) comparedValues(x, out);
    return;
  }
  const o = asObj(v);
  for (const [op, args] of Object.entries(o)) {
    if ((op === '==' || op === '!=' || op === 'in') && Array.isArray(args) && args.length === 2) {
      const ref = asObj(args[0]).var;
      if (typeof ref === 'string' && ref.startsWith('answers.')) {
        const key = ref.slice('answers.'.length);
        const vals = op === 'in' ? asArr(args[1]) : [args[1]];
        for (const val of vals) if (typeof val === 'string') out.push({ key, value: val });
      }
    }
    comparedValues(args, out);
  }
}

function fieldName(f: Obj): string {
  const label = asStr(f.label) || asStr(f.text);
  return label ? `“${label.length > 50 ? `${label.slice(0, 50)}…` : label}”` : `the ${componentWording(asStr(f.type)).name.toLowerCase()} question`;
}

function collect(fields: unknown, basePath: Path, section: string, out: FieldInfo[]): void {
  asArr(fields).forEach((raw, i) => {
    const f = asObj(raw);
    const path = [...basePath, i];
    if (typeof f.key === 'string') out.push({ key: f.key, name: fieldName(f), field: f, path, order: out.length, section });
    if (Array.isArray(f.fields)) collect(f.fields, [...path, 'fields'], section, out);
  });
}

export interface AdviceOptions {
  mode: 'form' | 'job_schema';
  /** For questions: how many published visit steps use them, and which sections those steps show. */
  flowsUsingForm?: number;
  sectionsInSteps?: ReadonlySet<string>;
}

export function localAdvice(doc: unknown, opts: AdviceOptions): Advice[] {
  const d = asObj(doc);
  const fields: FieldInfo[] = [];
  if (opts.mode === 'job_schema') collect(d.attributes, ['attributes'], '', fields);
  else asArr(d.sections).forEach((s, i) => collect(asObj(s).fields, ['sections', i, 'fields'], asStr(asObj(s).title) || `Section ${i + 1}`, fields));
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: Advice[] = [];
  const push = (a: Advice) => {
    if (!out.some((x) => x.text === a.text)) out.push(a);
  };
  const noun = opts.mode === 'job_schema' ? 'Detail' : 'Question';

  for (const f of fields) {
    const spec = COMPONENTS[asStr(f.field.type)];
    const target = pathKey(f.path);
    const isDisplay = spec?.shape === 'display';
    if (!isDisplay && !asStr(f.field.label) && !isRule(f.field.label)) {
      push({
        text:
          opts.mode === 'job_schema'
            ? `A ${componentWording(asStr(f.field.type)).name.toLowerCase()} detail has no label yet. What should the office see on the job form?`
            : `A ${componentWording(asStr(f.field.type)).name.toLowerCase()} question in “${f.section}” has no wording yet. What should the agent be asked?`,
        target,
        tone: 'warning',
      });
    }
    if (spec?.options === 'static_or_source' && asArr(f.field.options).length === 0 && !f.field.options_source) {
      push({ text: `${noun} ${f.name} has no answers to choose from yet. Add some under its answers.`, target, tone: 'warning' });
    }
    if (f.field.visible === false) {
      push(
        f.field.required === true
          ? { text: `${noun} ${f.name} must be answered but is never shown to anyone, so the visit could never be finished. Did you mean to make it optional?`, target, tone: 'warning' }
          : { text: `${noun} ${f.name} is never shown to anyone. Did you mean to hide it? If not, set “When it shows” to Always.`, target, tone: 'info' },
      );
    }
    // What its conditions read.
    const refs = new Set<string>();
    for (const slot of RULE_SLOTS) if (f.field[slot] !== undefined) answerRefs(f.field[slot], refs);
    for (const k of refs) {
      if (!k || k === f.key) continue;
      const other = byKey.get(k);
      if (!other) {
        push({ text: `A condition on ${f.name} uses an answer that isn’t a question here any more (“${k}”). Did you remove or rename it?`, target, tone: 'warning' });
      } else if (other.order > f.order) {
        push({ text: `${f.name} depends on ${other.name}, which the agent only answers later. Did you mean to move ${other.name} up?`, target, tone: 'info' });
      }
    }
    const compared: { key: string; value: string }[] = [];
    for (const slot of RULE_SLOTS) if (f.field[slot] !== undefined) comparedValues(f.field[slot], compared);
    for (const c of compared) {
      const other = byKey.get(c.key);
      const options = asArr(other?.field.options).map((o) => asStr(asObj(o).value));
      if (other && options.length && !options.includes(c.value)) {
        push({ text: `A condition on ${f.name} checks for “${c.value}”, but that isn’t one of the answers to ${other.name}. Did the answers change?`, target, tone: 'warning' });
      }
    }
  }

  if (opts.mode === 'form') {
    asArr(d.sections).forEach((raw, i) => {
      const s = asObj(raw);
      const title = `“${asStr(s.title) || `Section ${i + 1}`}”`;
      const target = pathKey(['sections', i]);
      if (asArr(s.fields).length === 0) push({ text: `Section ${title} has no questions yet.`, target, tone: 'info' });
      if (s.visible === false) push({ text: `Section ${title} is never shown to anyone. Did you mean to hide it?`, target, tone: 'info' });
      else if ((opts.flowsUsingForm ?? 0) > 0 && opts.sectionsInSteps && !opts.sectionsInSteps.has(asStr(s.key))) {
        push({ text: `Section ${title} isn’t in any visit step, so agents never see it. Add it to a Questions step in the visit steps.`, target, tone: 'warning' });
      }
    });
  }
  return [...out.filter((a) => a.tone === 'warning'), ...out.filter((a) => a.tone === 'info')];
}
