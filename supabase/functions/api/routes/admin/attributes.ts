// Validation of bank-specific job attributes against the bank's active `job_schema` definition (docs/04 §3.3, B1.1,
// B4.16). Generic over the non-evidence input components: nothing here knows any particular attribute or bank.
// Rule-valued properties (e.g. `required` as an expression over job.*) cannot be evaluated before the job exists, so
// only literal values are enforced here; the module and review see the rules.

export interface AttributeIssue {
  path: string;
  message: string;
}

interface OptionDef {
  value: string;
}

interface AttributeDef {
  key: string;
  type: string;
  required?: unknown;
  props?: Record<string, unknown>;
  options?: OptionDef[];
  options_source?: unknown;
}

const TEXT = new Set(['text', 'textarea', 'email', 'phone', 'id_number', 'registration_number']);
const NUMBER = new Set(['number', 'integer', 'decimal', 'percentage', 'currency', 'rating', 'slider']);
const SINGLE = new Set(['single_select', 'radio', 'dropdown']);
const MULTI = new Set(['multi_select', 'checkbox_group']);
const DISPLAY = new Set(['info', 'callout', 'heading', 'divider', 'image']);

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

function safePattern(pattern: unknown): RegExp | null {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 200) return null;
  try {
    return new RegExp(pattern, 'u');
  } catch {
    return null;
  }
}

function attributeDefs(schema: unknown): AttributeDef[] {
  if (!schema || typeof schema !== 'object') return [];
  const attrs = (schema as { attributes?: unknown }).attributes;
  if (!Array.isArray(attrs)) return [];
  return attrs.filter((a): a is AttributeDef =>
    !!a && typeof a === 'object' && typeof (a as AttributeDef).key === 'string' && typeof (a as AttributeDef).type === 'string');
}

/** Returns validation issues (empty = valid). `schema` is the job_schema definition document or null. */
export function validateAttributes(schema: unknown, attributes: Record<string, unknown>): AttributeIssue[] {
  const issues: AttributeIssue[] = [];
  const defs = attributeDefs(schema);
  const byKey = new Map(defs.map((d) => [d.key, d]));

  for (const key of Object.keys(attributes)) {
    if (!byKey.has(key)) {
      issues.push({ path: `attributes.${key}`, message: defs.length ? 'not an attribute of this bank\'s job schema' : 'this bank has no active job schema' });
    }
  }

  for (const def of defs) {
    if (DISPLAY.has(def.type)) continue;
    const path = `attributes.${def.key}`;
    const value = attributes[def.key];
    const props = def.props ?? {};
    if (isEmpty(value)) {
      if (def.required === true) issues.push({ path, message: 'required' });
      continue;
    }
    const options = Array.isArray(def.options) ? def.options.map((o) => o.value) : null;

    if (TEXT.has(def.type)) {
      if (typeof value !== 'string') { issues.push({ path, message: 'must be text' }); continue; }
      const max = num(props.max_length) ?? (def.type === 'textarea' ? 5000 : 500);
      if (value.length > max) issues.push({ path, message: `at most ${max} characters` });
      const min = num(props.min_length);
      if (min !== undefined && value.length < min) issues.push({ path, message: `at least ${min} characters` });
      const re = safePattern(props.pattern);
      if (re && !re.test(value)) issues.push({ path, message: typeof props.pattern_message === 'string' ? props.pattern_message : 'does not match the required format' });
      if (def.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) issues.push({ path, message: 'must be an email address' });
      if (def.type === 'phone' && !/^[+0-9 ()-]{5,20}$/.test(value)) issues.push({ path, message: 'must be a phone number' });
    } else if (NUMBER.has(def.type)) {
      const n = num(value);
      if (n === undefined) { issues.push({ path, message: 'must be a number' }); continue; }
      if (def.type === 'integer' && !Number.isInteger(n)) issues.push({ path, message: 'must be a whole number' });
      if (def.type === 'currency' && !Number.isInteger(n)) issues.push({ path, message: 'money is recorded in minor units (whole number)' });
      const min = num(props.min) ?? (def.type === 'percentage' ? 0 : undefined);
      const max = num(props.max) ?? (def.type === 'percentage' ? 100 : undefined);
      if (min !== undefined && n < min) issues.push({ path, message: `at least ${min}` });
      if (max !== undefined && n > max) issues.push({ path, message: `at most ${max}` });
    } else if (def.type === 'boolean') {
      if (typeof value !== 'boolean') issues.push({ path, message: 'must be true or false' });
    } else if (def.type === 'date') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
        issues.push({ path, message: 'must be a date (YYYY-MM-DD)' });
      }
    } else if (def.type === 'datetime') {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) issues.push({ path, message: 'must be a date and time' });
    } else if (SINGLE.has(def.type)) {
      if (typeof value !== 'string') { issues.push({ path, message: 'must be one option' }); continue; }
      if (options && !options.includes(value)) issues.push({ path, message: `must be one of: ${options.join(', ')}` });
    } else if (MULTI.has(def.type)) {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) { issues.push({ path, message: 'must be a list of options' }); continue; }
      const bad = options ? value.filter((v) => !options.includes(v)) : [];
      if (bad.length) issues.push({ path, message: `unknown option(s): ${bad.join(', ')}` });
      const minItems = num(props.min_items);
      const maxItems = num(props.max_items);
      if (minItems !== undefined && value.length < minItems) issues.push({ path, message: `choose at least ${minItems}` });
      if (maxItems !== undefined && value.length > maxItems) issues.push({ path, message: `choose at most ${maxItems}` });
    }
    // other component types: accepted as given (validated by the engine where they are rendered)
  }
  return issues;
}
