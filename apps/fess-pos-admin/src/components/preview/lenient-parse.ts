// Lenient parsing for the phone preview (T3-23). The studio previews in-progress drafts: we render every element that
// is valid on its own (per-element engine schemas) and report the rest as gentle notices instead of refusing the whole
// document. The strict engine parse is tried first, so a valid definition is exactly what the phone would load.
import {
  AttributeSchema,
  type DefinitionIssue,
  FieldSchema,
  PageSchema,
  parseDefinitionOfKind,
  SectionSchema,
  StepSchema,
  ViewItemSchema,
} from '@/lib/engine';
import { isPlainObject } from '@/lib/utils';
import type { PreviewKind } from './definition-preview';

export interface PreviewIssue {
  /** Human location, e.g. `Field "premises_type"` or `Step 3 (form)`. */
  where: string;
  message: string;
  /** JSON pointer (Advanced mode). */
  path?: string;
}

export interface LenientResult {
  /** The renderable document (strictly valid, or assembled from the valid elements). Null when nothing is usable. */
  definition: Record<string, unknown> | null;
  /** True when the strict engine parse accepted it as-is. */
  strict: boolean;
  issues: PreviewIssue[];
}

interface ZodLike {
  safeParse: (v: unknown) => { success: true } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };
}

const HEADER_KEYS = ['spec_version', 'kind', 'family', 'version', 'scope', 'id', 'title', 'description', 'locale', 'requires'];
const KIND_KEYS: Record<PreviewKind, string[]> = {
  form: ['declaration_key', 'sections'],
  flow: ['form_family', 'action', 'steps'],
  job_schema: ['attributes'],
  view: ['items'],
  content: ['strings'],
  app: ['home', 'navigation', 'pages', 'outcome_sets'],
};

const UNKNOWN_TYPE = /^Invalid discriminator value/;
const KEY_LIKE = /^[a-z][a-z0-9_]{0,63}$/;

type IssueList = { path: (string | number)[]; message: string }[];

function isUnknownType(issues: IssueList): boolean {
  return issues.some((i) => UNKNOWN_TYPE.test(i.message) && i.path.length === 1 && i.path[0] === 'type');
}

function describeIssues(value: unknown, issues: IssueList): string {
  if (isUnknownType(issues)) {
    const type = isPlainObject(value) && typeof value.type === 'string' ? value.type : '?';
    return `unknown type “${type}” — shown as a placeholder`;
  }
  const i = issues[0];
  if (!i) return 'is not valid';
  return i.path.length ? `${i.message} (at ${i.path.join('.')})` : i.message;
}

function firstIssue(schema: ZodLike, value: unknown): string | null {
  const r = schema.safeParse(value);
  return r.success ? null : describeIssues(value, r.error.issues);
}

/** In-place stand-ins for elements of a type this engine does not know (docs/11: "<type> — preview not available yet"). */
const fieldPlaceholder = (el: unknown, i: number): unknown => {
  const o = isPlainObject(el) ? el : {};
  const key = typeof o.key === 'string' && KEY_LIKE.test(o.key) ? o.key : `preview_placeholder_${i + 1}`;
  return { key, type: 'info', text: `\`${typeof o.type === 'string' ? o.type : '?'}\` — preview not available yet` };
};
const viewItemPlaceholder = (el: unknown): unknown => {
  const o = isPlainObject(el) ? el : {};
  return { type: 'markdown', text: `\`${typeof o.type === 'string' ? o.type : '?'}\` — preview not available yet` };
};

function describeElement(prefix: string, el: unknown, index: number): string {
  if (!isPlainObject(el)) return `${prefix} ${index + 1}`;
  const name = typeof el.key === 'string' ? el.key : typeof el.id === 'string' ? el.id : null;
  const type = typeof el.type === 'string' ? el.type : null;
  return `${prefix} ${name ? `“${name}”` : index + 1}${type ? ` (${type})` : ''}`;
}

function keepValid(
  list: unknown,
  schema: ZodLike,
  prefix: string,
  basePath: string,
  issues: PreviewIssue[],
  placeholder?: (el: unknown, i: number) => unknown,
): unknown[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((el, i) => {
    const r = schema.safeParse(el);
    if (r.success) return [el];
    issues.push({ where: describeElement(prefix, el, i), message: describeIssues(el, r.error.issues), path: `${basePath}/${i}` });
    if (placeholder && isUnknownType(r.error.issues)) {
      const stand = placeholder(el, i);
      if (schema.safeParse(stand).success) return [stand];
    }
    return [];
  });
}

function sanitizeForm(input: Record<string, unknown>, issues: PreviewIssue[]): Record<string, unknown> {
  const sections = Array.isArray(input.sections) ? input.sections : [];
  const out = sections.flatMap((s, si) => {
    if (!isPlainObject(s) || typeof s.key !== 'string') {
      issues.push({ where: `Section ${si + 1}`, message: 'needs a key', path: `/sections/${si}` });
      return [];
    }
    const fields = keepValid(s.fields, FieldSchema as unknown as ZodLike, 'Field', `/sections/${si}/fields`, issues, fieldPlaceholder);
    const section: Record<string, unknown> = { ...s, fields };
    const problem = firstIssue(SectionSchema as unknown as ZodLike, section);
    if (problem) {
      // keep the fields; drop only the section-level settings that are wrong
      issues.push({ where: `Section “${s.key}”`, message: problem, path: `/sections/${si}` });
      const minimal: Record<string, unknown> = { key: s.key, fields };
      if (typeof s.title === 'string') minimal.title = s.title;
      return firstIssue(SectionSchema as unknown as ZodLike, minimal) ? [] : [minimal];
    }
    return [section];
  });
  return { ...input, sections: out };
}

function sanitizeApp(input: Record<string, unknown>, issues: PreviewIssue[]): Record<string, unknown> {
  const pages: Record<string, unknown> = {};
  if (isPlainObject(input.pages)) {
    for (const [id, page] of Object.entries(input.pages)) {
      const problem = firstIssue(PageSchema as unknown as ZodLike, page);
      if (problem) issues.push({ where: `Page “${id}”${isPlainObject(page) && typeof page.type === 'string' ? ` (${page.type})` : ''}`, message: problem, path: `/pages/${id}` });
      else pages[id] = page;
    }
  }
  const out: Record<string, unknown> = { ...input, pages };
  if (isPlainObject(input.navigation) && Array.isArray(input.navigation.items)) {
    out.navigation = { ...input.navigation, items: input.navigation.items.filter((it) => isPlainObject(it) && typeof it.page === 'string' && typeof it.label === 'string') };
  }
  if (typeof input.home !== 'string' || !(input.home in pages)) {
    const first = Object.keys(pages)[0];
    if (first) out.home = first;
  }
  return out;
}

function sanitize(kind: PreviewKind, input: Record<string, unknown>, issues: PreviewIssue[]): Record<string, unknown> {
  switch (kind) {
    case 'form':
      return sanitizeForm(input, issues);
    case 'flow':
      return { ...input, steps: keepValid(input.steps, StepSchema as unknown as ZodLike, 'Step', '/steps', issues) };
    case 'view':
      return { ...input, items: keepValid(input.items, ViewItemSchema as unknown as ZodLike, 'Item', '/items', issues, viewItemPlaceholder) };
    case 'job_schema':
      return { ...input, attributes: keepValid(input.attributes, AttributeSchema as unknown as ZodLike, 'Attribute', '/attributes', issues) };
    case 'content': {
      const strings: Record<string, string> = {};
      if (isPlainObject(input.strings)) {
        for (const [k, v] of Object.entries(input.strings)) {
          if (typeof v === 'string') strings[k] = v;
          else issues.push({ where: `String “${k}”`, message: 'must be text', path: `/strings/${k}` });
        }
      }
      return { ...input, strings };
    }
    case 'app':
      return sanitizeApp(input, issues);
    default:
      return input;
  }
}

function issueFrom(i: DefinitionIssue): PreviewIssue {
  return { where: i.path ? i.path.replace(/^\//, '').replace(/\//g, ' › ') : 'This draft', message: i.message, path: i.path };
}

/** Parse `input` as a `kind` definition, keeping every element that is valid on its own. Never throws. */
export function lenientParse(kind: PreviewKind, input: unknown): LenientResult {
  if (!isPlainObject(input)) {
    return { definition: null, strict: false, issues: [{ where: 'This draft', message: 'is empty so far' }] };
  }
  try {
    const strict = parseDefinitionOfKind(input, kind);
    if (strict.ok) return { definition: strict.definition as unknown as Record<string, unknown>, strict: true, issues: [] };

    const issues: PreviewIssue[] = [];
    const known = new Set([...HEADER_KEYS, ...KIND_KEYS[kind]]);
    const base: Record<string, unknown> = { spec_version: '1.0', family: 'preview', version: 1 };
    for (const [k, v] of Object.entries(input)) if (known.has(k)) base[k] = v;
    base.kind = kind;
    if (kind === 'content' && typeof base.locale !== 'string') base.locale = 'en-ZA';
    const doc = sanitize(kind, base, issues);
    const again = parseDefinitionOfKind(doc, kind);
    if (!again.ok && issues.length === 0) issues.push(...again.errors.slice(0, 6).map(issueFrom));
    return { definition: again.ok ? (again.definition as unknown as Record<string, unknown>) : doc, strict: false, issues };
  } catch (e) {
    return { definition: null, strict: false, issues: [{ where: 'This draft', message: e instanceof Error ? e.message : 'couldn’t be read' }] };
  }
}
