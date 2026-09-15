// The rule builder's model (T3-10, docs/04 §4.5): "when [what] [how] [value]", grouped with all / any / none, and its
// exact translation to and from the rules JSON (docs/04 §4.1). Reading a rule back gives the same model, and building a
// model read from JSON gives the same JSON, byte for byte after serialisation, so opening a rule in the builder never
// changes it. A rule the builder can't show exactly (arithmetic, dates, `if`, a value on the left…) reads as `null` and
// stays as it is, editable as JSON in Advanced view.
//
// Pure and dependency-free on purpose: the engine package's tests import this file to check the round trip against the
// rules fixtures (packages/fess_pos_engine_ts/test/admin-rule-builder.test.ts).

export type Literal = string | number | boolean | null;

/** How a condition compares. Each id maps to exactly one JSON shape (see `buildRule`). */
export type OpId =
  | 'eq'
  | 'ne'
  | 'answered'
  | 'unanswered'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'between'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'empty'
  | 'not_empty'
  | 'starts_with'
  | 'matches';

export interface Condition {
  t: 'cond';
  /** What it reads, as a rules data path: "answers.premises_type", "job.attributes.risk_tier", "inspection.geofence.profile". */
  path: string;
  op: OpId;
  /** The value compared with (eq, ne, lt…, contains, starts_with, matches), or the low end of `between`. */
  value?: Literal;
  /** The high end of `between`. */
  to?: Literal;
  /** The values for `in` / `not_in`. */
  values?: Literal[];
  /** `{"empty": {"var": …}}` was written without the argument list (both forms mean the same). */
  bare?: true;
  /** `{"!": [{"in": …}]}` was written with the argument list. */
  notArray?: true;
}

export interface Group {
  t: 'group';
  /** and: all of these are true; or: any of them is. */
  join: 'and' | 'or';
  items: RuleNode[];
  /** Wrapped in "not": none of these (or) / not all of these (and). `array` = `{"!": [ … ]}`. */
  not?: 'object' | 'array';
}

export type RuleNode = Condition | Group;

/** Operators whose value is a single literal. */
const VALUE_OPS: ReadonlySet<OpId> = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'starts_with', 'matches']);
const ORDER_JSON: Record<'lt' | 'lte' | 'gt' | 'gte', string> = { lt: '<', lte: '<=', gt: '>', gte: '>=' };
const ORDER_ID: Record<string, 'lt' | 'lte' | 'gt' | 'gte'> = { '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' };

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isLiteral(v: unknown): v is Literal {
  return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}

/** The one operator of a rule node, or null when it isn't `{op: args}`. */
function single(v: unknown): [string, unknown] | null {
  if (!isObj(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 1) return null;
  const op = keys[0] as string;
  return [op, v[op]];
}

/** The path of exactly `{"var": "path"}` (no default, no list form). */
function varPath(v: unknown): string | null {
  const s = single(v);
  return s && s[0] === 'var' && typeof s[1] === 'string' && s[1].length > 0 ? s[1] : null;
}

function parseCondition(op: string, raw: unknown): Condition | null {
  if (!Array.isArray(raw)) {
    if (op === 'empty' || op === 'not_empty') {
      const path = varPath(raw);
      return path ? { t: 'cond', path, op, bare: true } : null;
    }
    return null;
  }
  const args: unknown[] = raw;
  const path = varPath(args[0]);
  if (!path) return null;
  const [, a, b] = args;
  switch (op) {
    case '==':
    case '!=':
      if (args.length !== 2 || !isLiteral(a)) return null;
      if (a === null) return { t: 'cond', path, op: op === '==' ? 'unanswered' : 'answered' };
      return { t: 'cond', path, op: op === '==' ? 'eq' : 'ne', value: a };
    case '<':
    case '<=':
    case '>':
    case '>=':
      return args.length === 2 && typeof a === 'number' && Number.isFinite(a) ? { t: 'cond', path, op: ORDER_ID[op] as OpId, value: a } : null;
    case 'between':
      return args.length === 3 && typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) ? { t: 'cond', path, op: 'between', value: a, to: b } : null;
    case 'in':
      return args.length === 2 && Array.isArray(a) && a.length > 0 && a.every((x) => isLiteral(x) && x !== null) ? { t: 'cond', path, op: 'in', values: [...(a as Literal[])] } : null;
    case 'contains':
      return args.length === 2 && isLiteral(a) && a !== null ? { t: 'cond', path, op: 'contains', value: a } : null;
    case 'empty':
    case 'not_empty':
      return args.length === 1 ? { t: 'cond', path, op } : null;
    case 'starts_with':
    case 'matches':
      return args.length === 2 && typeof a === 'string' ? { t: 'cond', path, op, value: a } : null;
    default:
      return null;
  }
}

function parseNode(v: unknown): RuleNode | null {
  const s = single(v);
  if (!s) return null;
  const [op, raw] = s;
  if (op === 'and' || op === 'or') {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const items: RuleNode[] = [];
    for (const x of raw) {
      const n = parseNode(x);
      if (!n) return null;
      items.push(n);
    }
    return { t: 'group', join: op, items };
  }
  if (op === '!') {
    const asList = Array.isArray(raw);
    if (asList && raw.length !== 1) return null;
    const inner = parseNode(asList ? raw[0] : raw);
    if (!inner) return null;
    if (inner.t === 'group' && !inner.not) return { ...inner, not: asList ? 'array' : 'object' };
    if (inner.t === 'cond' && inner.op === 'in') return asList ? { ...inner, op: 'not_in', notArray: true } : { ...inner, op: 'not_in' };
    return null;
  }
  return parseCondition(op, raw);
}

/** The builder's model of a rule, or null when the builder can't show it exactly (it's then kept as JSON). */
export function parseRule(rule: unknown): RuleNode | null {
  return parseNode(rule);
}

function buildCondition(c: Condition): unknown {
  const subject = { var: c.path };
  switch (c.op) {
    case 'eq':
      return { '==': [subject, c.value ?? null] };
    case 'ne':
      return { '!=': [subject, c.value ?? null] };
    case 'answered':
      return { '!=': [subject, null] };
    case 'unanswered':
      return { '==': [subject, null] };
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return { [ORDER_JSON[c.op]]: [subject, c.value ?? null] };
    case 'between':
      return { between: [subject, c.value ?? null, c.to ?? null] };
    case 'in':
      return { in: [subject, [...(c.values ?? [])]] };
    case 'not_in': {
      const inner = { in: [subject, [...(c.values ?? [])]] };
      return { '!': c.notArray ? [inner] : inner };
    }
    case 'contains':
      return { contains: [subject, c.value ?? null] };
    case 'empty':
    case 'not_empty':
      return { [c.op]: c.bare ? subject : [subject] };
    case 'starts_with':
    case 'matches':
      return { [c.op]: [subject, c.value ?? ''] };
  }
}

/** The rules JSON for a model. */
export function buildRule(node: RuleNode): unknown {
  if (node.t === 'cond') return buildCondition(node);
  const inner = { [node.join]: node.items.map(buildRule) };
  if (!node.not) return inner;
  return { '!': node.not === 'array' ? [inner] : inner };
}

/** Whether every condition says what it checks and has the values it needs (only then is it written to the draft). */
export function isComplete(node: RuleNode): boolean {
  if (node.t === 'group') return node.items.length > 0 && node.items.every(isComplete);
  if (!node.path) return false;
  if (VALUE_OPS.has(node.op)) return node.value !== undefined && node.value !== null && node.value !== '';
  if (node.op === 'between') return typeof node.value === 'number' && typeof node.to === 'number';
  if (node.op === 'in' || node.op === 'not_in') return (node.values?.length ?? 0) > 0;
  return true;
}

/** Plain words for each way of comparing (the dropdown in the builder). */
export const OP_LABEL: Record<OpId, string> = {
  eq: 'is',
  ne: 'is not',
  answered: 'is answered',
  unanswered: 'is not answered',
  lt: 'is less than',
  lte: 'is at most',
  gt: 'is more than',
  gte: 'is at least',
  between: 'is between',
  in: 'is one of',
  not_in: 'is none of',
  contains: 'includes',
  empty: 'is empty',
  not_empty: 'is filled in',
  starts_with: 'starts with',
  matches: 'matches the pattern',
};

/** Whether an operator takes one value, two (between), a list (in / not in) or none. */
export function valueShape(op: OpId): 'one' | 'two' | 'list' | 'none' {
  if (VALUE_OPS.has(op)) return 'one';
  if (op === 'between') return 'two';
  if (op === 'in' || op === 'not_in') return 'list';
  return 'none';
}
