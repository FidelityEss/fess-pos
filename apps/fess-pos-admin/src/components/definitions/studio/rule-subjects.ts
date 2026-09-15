// What a condition can check: the first dropdown of the rule builder (T3-10). The questions of these questions (earlier
// ones first; later ones are marked), the job's information, a few facts about the job, the visit and the agent. Paths
// are the rules engine's data paths (docs/04 §4.2); the words are what an office user would say.
import { humanLabel } from '@/components/structured-view';
import { COMPONENTS, DEFAULT_GEOFENCE_PROFILES } from '@/lib/engine';
import { asArr, asObj, asStr, type Obj } from './doc';

export type SubjectKind = 'choice' | 'multi' | 'boolean' | 'number' | 'date' | 'text';

export interface SubjectOption {
  value: string;
  label: string;
}

export interface Subject {
  path: string;
  label: string;
  /** Heading it's listed under: "Questions", "Job information", "The job", "The visit", "The agent". */
  group: string;
  kind: SubjectKind;
  options?: SubjectOption[];
  /** A short note beside it, such as "asked later". */
  note?: string;
}

const DATE_TYPES = new Set(['date', 'datetime', 'time']);
const YES_NO: SubjectOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

/** How a question's answer is compared, or null when the builder doesn't compare it (photos, addresses, map pins…). */
function kindOf(field: Obj): SubjectKind | null {
  const type = asStr(field.type);
  const spec = COMPONENTS[type];
  if (!spec || spec.valueType === 'none' || spec.category === 'evidence') return null;
  if (DATE_TYPES.has(type)) return 'date';
  switch (spec.valueType) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'array':
      return 'multi';
    case 'string':
      return asArr(field.options).length ? 'choice' : 'text';
    default:
      return null;
  }
}

function optionsOf(field: Obj, kind: SubjectKind): SubjectOption[] | undefined {
  if (kind === 'boolean') {
    const p = asObj(field.props);
    return [
      { value: 'true', label: asStr(p.true_label) || 'Yes' },
      { value: 'false', label: asStr(p.false_label) || 'No' },
    ];
  }
  const opts = asArr(field.options)
    .map((o) => ({ value: asStr(asObj(o).value), label: asStr(asObj(o).label) || asStr(asObj(o).value) }))
    .filter((o) => o.value);
  return opts.length ? opts : undefined;
}

const PROFILE_OPTIONS: SubjectOption[] = Object.keys(DEFAULT_GEOFENCE_PROFILES).map((k) => ({ value: k, label: humanLabel(k) }));

const JOB_CORE: Subject[] = [
  { path: 'job.location_type', label: 'Type of place', group: 'The job', kind: 'choice', options: PROFILE_OPTIONS },
  { path: 'job.merchant_name', label: 'Merchant name', group: 'The job', kind: 'text' },
  { path: 'job.mcc.code', label: 'Business type code (MCC)', group: 'The job', kind: 'text' },
  { path: 'job.notes', label: 'Notes for the agent', group: 'The job', kind: 'text' },
];

const VISIT: Subject[] = [
  { path: 'inspection.geofence.profile', label: 'Kind of site (location profile)', group: 'The visit', kind: 'choice', options: PROFILE_OPTIONS },
  {
    path: 'inspection.geofence.method',
    label: 'Where the location was recorded',
    group: 'The visit',
    kind: 'choice',
    options: [
      { value: 'inside_fix', label: 'Inside the premises' },
      { value: 'outside_fix', label: 'Outside the premises' },
    ],
  },
  { path: 'inspection.geofence.inside', label: 'The agent is inside the site area', group: 'The visit', kind: 'boolean', options: YES_NO },
  { path: 'inspection.geofence.override', label: 'The location check was overridden', group: 'The visit', kind: 'boolean', options: YES_NO },
  { path: 'inspection.attempt', label: 'Attempt number', group: 'The visit', kind: 'number' },
  { path: 'agent.attributes.region', label: 'The agent’s region', group: 'The agent', kind: 'text' },
];

export interface SubjectOptions {
  /** The question the condition belongs to: left out of the list, and the questions after it are marked "asked later". */
  currentKey?: string;
  /** Leave out the questions (a visit step's condition, which can't see this form's answers in order). */
  withoutQuestions?: boolean;
}

export function ruleSubjects(formDoc: unknown, jobSchema: unknown, opts: SubjectOptions = {}): Subject[] {
  const out: Subject[] = [];
  let pastCurrent = false;
  const walk = (fields: unknown) => {
    for (const raw of asArr(fields)) {
      const f = asObj(raw);
      const key = asStr(f.key);
      if (key && key === opts.currentKey) {
        pastCurrent = true;
        continue;
      }
      // Answers inside a repeating group are read per item (item.*), which the builder doesn't offer.
      if (asStr(f.type) === 'repeatable_group') continue;
      if (Array.isArray(f.fields)) {
        walk(f.fields);
        continue;
      }
      const kind = kindOf(f);
      if (!key || !kind) continue;
      out.push({ path: `answers.${key}`, label: asStr(f.label) || humanLabel(key), group: 'Questions', kind, options: optionsOf(f, kind), note: pastCurrent ? 'asked later' : undefined });
    }
  };
  if (!opts.withoutQuestions) for (const s of asArr(asObj(formDoc).sections)) walk(asObj(s).fields);
  for (const raw of asArr(asObj(jobSchema).attributes)) {
    const f = asObj(raw);
    const key = asStr(f.key);
    const kind = kindOf(f);
    if (!key || !kind) continue;
    out.push({ path: `job.attributes.${key}`, label: asStr(f.label) || humanLabel(key), group: 'Job information', kind, options: optionsOf(f, kind) });
  }
  out.push(...JOB_CORE, ...VISIT);
  return out;
}
