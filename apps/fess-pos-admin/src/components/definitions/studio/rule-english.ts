// JSON-logic → plain English (docs/04 §4.5): "Shown when Premises type is Other", "Minimum 4 when Premises type is
// Private home, otherwise 2". Read-only rendering — editing rules visually is the rule builder (T3-10). Anything this
// renderer does not recognise comes out as "a custom rule" rather than a guess.
import { humanLabel } from '@/components/structured-view';
import { isPlainObject } from '@/lib/utils';

export interface RuleVocabulary {
  /** Field label for an answer key (answers.<key>). */
  fieldLabel?: (key: string) => string | undefined;
  /** Option label for a choice field's value. */
  optionLabel?: (key: string, value: string) => string | undefined;
  /** Yes/No wording for a boolean field. */
  booleanLabel?: (key: string, value: boolean) => string | undefined;
  /** Label for a job attribute (job.attributes.<key>). */
  attributeLabel?: (key: string) => string | undefined;
}

const PATH_WORDS: Record<string, string> = {
  'inspection.geofence.profile': 'the location profile',
  'inspection.geofence.method': 'the location check method',
  'inspection.geofence.inside': 'the agent is inside the expected location',
  'inspection.geofence.override': 'the location check was overridden',
  'inspection.geofence.relaxed': 'the location check is relaxed',
  'inspection.attempt': 'the attempt number',
  'inspection.client_type': 'the kind of device',
  'job.status': 'the job status',
  'job.scheduled_start': 'the scheduled start',
  'job.merchant_name': 'the merchant name',
  'job.notes': 'the job notes',
  'job.reference': 'the job reference',
  'job.location_type': 'the location type',
  'job.mcc.code': 'the merchant category code',
  'agent.attributes.region': "the agent's region",
};

const VALUE_WORDS: Record<string, string> = {
  outside_fix: 'recorded outside the premises',
  inside_fix: 'recorded inside the premises',
  shopping_centre: 'shopping centre',
  office_park: 'office park',
  large_site: 'large site',
};

type Ctx = { vocab: RuleVocabulary; subjectKey?: string };

function opOf(v: unknown): [string, unknown[]] | null {
  if (!isPlainObject(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 1) return null;
  const op = keys[0] as string;
  const raw = v[op];
  return [op, Array.isArray(raw) ? raw : [raw]];
}

function varPath(v: unknown): string | null {
  const o = opOf(v);
  if (!o || o[0] !== 'var') return null;
  return typeof o[1][0] === 'string' ? o[1][0] : null;
}

function answerKey(v: unknown): string | null {
  const p = varPath(v);
  return p?.startsWith('answers.') ? p.slice('answers.'.length).split('.')[0] ?? null : p?.startsWith('item.') ? p.slice(5).split('.')[0] ?? null : null;
}

function describePath(path: string, ctx: Ctx): string {
  if (path.startsWith('answers.') || path.startsWith('item.')) {
    const key = path.split('.')[1] ?? path;
    return ctx.vocab.fieldLabel?.(key) ?? humanLabel(key);
  }
  if (path.startsWith('previous.answers.')) {
    const key = path.split('.')[2] ?? path;
    return `the previous answer to ${ctx.vocab.fieldLabel?.(key) ?? humanLabel(key)}`;
  }
  if (PATH_WORDS[path]) return PATH_WORDS[path];
  if (path.startsWith('job.attributes.')) {
    const key = path.slice('job.attributes.'.length);
    return `the job's ${(ctx.vocab.attributeLabel?.(key) ?? humanLabel(key)).replace(/^Bank /, 'bank ').toLowerCase()}`;
  }
  const [root, ...rest] = path.split('.');
  const tail = humanLabel(rest.join('_')).toLowerCase();
  switch (root) {
    case 'job':
      return `the job's ${tail}`;
    case 'agent':
      return `the agent's ${tail}`;
    case 'stats':
      return `the agent's ${tail} total`;
    case 'inspection':
      return `the inspection's ${tail}`;
    case 'config':
      return `the setting ${tail}`;
    case 'current':
      return rest.length ? `its ${tail}` : 'it';
    default:
      return humanLabel(path).toLowerCase();
  }
}

function literal(v: unknown, ctx: Ctx, key?: string | null): string {
  if (v === null) return 'empty';
  if (typeof v === 'boolean') {
    const custom = key ? ctx.vocab.booleanLabel?.(key, v) : undefined;
    return custom ?? (v ? 'Yes' : 'No');
  }
  if (typeof v === 'number') return v.toLocaleString('en-ZA');
  if (typeof v === 'string') {
    const opt = key ? ctx.vocab.optionLabel?.(key, v) : undefined;
    if (opt) return opt;
    if (VALUE_WORDS[v]) return VALUE_WORDS[v];
    return key || /[\s]/.test(v) ? v : humanLabel(v);
  }
  if (Array.isArray(v)) return list(v.map((x) => literal(x, ctx, key)), 'or');
  return value(v, ctx);
}

function list(parts: string[], joiner: 'and' | 'or'): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} ${joiner} ${parts[parts.length - 1]}`;
}

/** An expression that yields a value (number, text, date…). */
function value(v: unknown, ctx: Ctx, key?: string | null): string {
  const o = opOf(v);
  if (!o) return literal(v, ctx, key);
  const [op, args] = o;
  switch (op) {
    case 'var':
      return typeof args[0] === 'string' ? describePath(args[0], ctx) : 'a value';
    case 'today':
      return "today's date";
    case '+':
      return args.map((a) => value(a, ctx)).join(' + ');
    case '-':
      return args.length === 1 ? `minus ${value(args[0], ctx)}` : `${value(args[0], ctx)} − ${value(args[1], ctx)}`;
    case '*':
      return args.map((a) => value(a, ctx)).join(' × ');
    case '/':
      return `${value(args[0], ctx)} ÷ ${value(args[1], ctx)}`;
    case 'min':
      return `the smallest of ${list(args.map((a) => value(a, ctx)), 'and')}`;
    case 'max':
      return `the largest of ${list(args.map((a) => value(a, ctx)), 'and')}`;
    case 'round':
      return `${value(args[0], ctx)} rounded`;
    case 'abs':
      return `the size of ${value(args[0], ctx)}`;
    case 'length':
      return `the length of ${value(args[0], ctx)}`;
    case 'count':
      return args.length > 1 ? `the number of ${value(args[0], ctx)} where ${condition(args[1], ctx)}` : `the number of ${value(args[0], ctx)}`;
    case 'lower':
      return value(args[0], ctx);
    case 'concat':
      return args.map((a) => value(a, ctx)).join(' followed by ');
    case 'date_diff':
      return `the ${typeof args[2] === 'string' ? args[2] : 'time'} between ${value(args[0], ctx)} and ${value(args[1], ctx)}`;
    case 'date_add':
      return `${value(args[0], ctx)} plus ${value(args[1], ctx)} ${typeof args[2] === 'string' ? args[2] : ''}`.trim();
    case 'distance_m':
      return `the distance in metres between ${value(args[0], ctx)} and ${value(args[1], ctx)}`;
    case 'option_meta': {
      const k = typeof args[0] === 'string' ? args[0] : '';
      const meta = typeof args[1] === 'string' ? humanLabel(args[1]).toLowerCase() : 'detail';
      return `the ${meta} of the chosen ${ctx.vocab.fieldLabel?.(k) ?? humanLabel(k)}`;
    }
    case 'if':
      return ifChain(args, ctx, (x) => value(x, ctx, key));
    default:
      if (isCondition(op)) return condition(v, ctx);
      return 'a calculated value';
  }
}

const CONDITION_OPS = new Set(['==', '!=', '<', '<=', '>', '>=', 'between', 'in', 'contains', 'some', 'all', 'none', 'empty', 'not_empty', 'and', 'or', '!', 'starts_with', 'matches', 'within_m']);
const isCondition = (op: string) => CONDITION_OPS.has(op);

function ifChain(args: unknown[], ctx: Ctx, render: (x: unknown) => string): string {
  const parts: string[] = [];
  let i = 0;
  for (; i + 1 < args.length; i += 2) parts.push(`${render(args[i + 1])} when ${condition(args[i], ctx)}`);
  const otherwise = i < args.length ? render(args[i]) : null;
  return otherwise !== null ? `${parts.join('; ')}, otherwise ${otherwise}` : parts.join('; ');
}

function comparison(op: string, a: unknown, b: unknown, ctx: Ctx): string {
  // Put the field on the left: 100 >= x → x <= 100.
  const flip: Record<string, string> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '==': '==', '!=': '!=' };
  if (!opOf(a) && opOf(b)) return comparison(flip[op] ?? op, b, a, ctx);
  const key = answerKey(a);
  const subject = value(a, ctx);
  if (b === null) return op === '==' ? `${subject} is not answered` : op === '!=' ? `${subject} is answered` : `${subject} ${op} empty`;
  const obj = value(b, ctx, key);
  const isBoolPath = typeof b === 'boolean' && !key && varPath(a) !== null;
  if (isBoolPath && (op === '==' || op === '!=')) {
    const positive = (op === '==') === b;
    const s = describePath(varPath(a) as string, ctx);
    return positive ? s : `not (${s})`;
  }
  switch (op) {
    case '==':
      return `${subject} is ${obj}`;
    case '!=':
      return `${subject} is not ${obj}`;
    case '<':
      return `${subject} is less than ${obj}`;
    case '<=':
      return `${subject} is at most ${obj}`;
    case '>':
      return `${subject} is more than ${obj}`;
    case '>=':
      return `${subject} is at least ${obj}`;
    default:
      return `${subject} ${op} ${obj}`;
  }
}

/** An expression that yields true / false. */
function condition(v: unknown, ctx: Ctx, nested = false): string {
  if (v === true) return 'always';
  if (v === false) return 'never';
  const o = opOf(v);
  if (!o) return literal(v, ctx);
  const [op, args] = o;
  const wrap = (s: string) => (nested ? `(${s})` : s);
  switch (op) {
    case 'var':
      return value(v, ctx);
    case '==':
    case '!=':
    case '<':
    case '<=':
    case '>':
    case '>=':
      return comparison(op, args[0], args[1], ctx);
    case 'between':
      return `${value(args[0], ctx)} is between ${value(args[1], ctx)} and ${value(args[2], ctx)}`;
    case 'in': {
      const [needle, hay] = args;
      if (Array.isArray(hay)) {
        const key = answerKey(needle);
        return `${value(needle, ctx)} is ${list(hay.map((h) => literal(h, ctx, key)), 'or')}`;
      }
      const key = answerKey(hay);
      return `${value(hay, ctx)} includes ${literal(needle, ctx, key)}`;
    }
    case 'contains': {
      const key = answerKey(args[0]);
      return `${value(args[0], ctx)} includes ${literal(args[1], ctx, key)}`;
    }
    case 'some':
      return `any of ${value(args[0], ctx)} matches: ${condition(args[1], ctx)}`;
    case 'all':
      return `all of ${value(args[0], ctx)} match: ${condition(args[1], ctx)}`;
    case 'none':
      return `none of ${value(args[0], ctx)} match: ${condition(args[1], ctx)}`;
    case 'empty':
      return `${value(args[0], ctx)} is empty`;
    case 'not_empty':
      return `${value(args[0], ctx)} is filled in`;
    case 'starts_with':
      return `${value(args[0], ctx)} starts with ${value(args[1], ctx)}`;
    case 'matches':
      return `${value(args[0], ctx)} matches the pattern ${typeof args[1] === 'string' ? args[1] : ''}`;
    case 'within_m':
      return `${value(args[0], ctx)} is within ${value(args[2], ctx)} m of ${value(args[1], ctx)}`;
    case 'and':
      return wrap(list(args.map((a) => condition(a, ctx, true)), 'and'));
    case 'or':
      return wrap(list(args.map((a) => condition(a, ctx, true)), 'or'));
    case '!':
      return `not ${condition(args[0], ctx, true)}`;
    case 'if':
      return ifChain(args, ctx, (x) => condition(x, ctx, true));
    default:
      return 'a custom rule';
  }
}

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The condition itself, e.g. "Premises type is Other". */
export function conditionText(rule: unknown, vocab: RuleVocabulary = {}): string {
  return capitalise(condition(rule, { vocab }));
}

/** A value-producing rule, e.g. "4 when Premises type is Private home, otherwise 2". */
export function valueText(rule: unknown, vocab: RuleVocabulary = {}): string {
  return value(rule, { vocab });
}

export type RuleSlot = 'visible' | 'required' | 'read_only' | 'options_filter' | 'filter' | 'step_visible' | 'next';

/** A whole sentence for a rule slot: "Shown when …", "Required when …", "Always shown". */
export function slotSentence(slot: RuleSlot, rule: unknown, vocab: RuleVocabulary = {}): string {
  const c = () => condition(rule, { vocab });
  switch (slot) {
    case 'visible':
    case 'step_visible':
      return rule === undefined || rule === true ? 'Always shown' : rule === false ? 'Never shown' : `Shown when ${c()}`;
    case 'required':
      return rule === true ? 'Required' : rule === undefined || rule === false ? 'Optional' : `Required when ${c()}`;
    case 'read_only':
      return rule === true ? 'Read-only' : rule === undefined || rule === false ? 'Editable' : `Read-only when ${c()}`;
    case 'options_filter':
      return `Only offers options where ${c()}`;
    case 'filter':
      return rule === undefined || rule === true ? 'Everything' : `Only where ${c()}`;
    case 'next':
      return typeof rule === 'string' ? `Then goes to step "${rule}"` : `Next step: ${valueText(rule, vocab)}`;
    default:
      return c();
  }
}

/** A rule-valued number prop: "Minimum 4 when Premises type is Private home, otherwise 2". */
export function numberPropSentence(label: string, rule: unknown, vocab: RuleVocabulary = {}): string {
  return `${label}: ${valueText(rule, vocab)}`;
}
