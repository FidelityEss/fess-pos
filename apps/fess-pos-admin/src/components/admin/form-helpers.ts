// Form plumbing shared by the administration screens.
import { parseJsonText } from '@/components/json-editor';
import { api } from '@/lib/api';
import type { JsonObject } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** JSON object text → object. Blank text is an empty object. */
export function parseObjectText(text: string, label: string): Parsed<JsonObject> {
  if (!text.trim()) return { ok: true, value: {} };
  const result = parseJsonText(text, { requireObject: true });
  if (!result.ok) {
    const where = result.error.line !== null ? `line ${result.error.line}, column ${result.error.column}: ` : '';
    return { ok: false, message: `${label}: ${where}${result.error.message}` };
  }
  return isPlainObject(result.value) ? { ok: true, value: result.value } : { ok: false, message: `${label} must be a JSON object` };
}

/** Trimmed text, or null when blank (to clear a nullable column). */
export function blankToNull(value: string): string | null {
  const t = value.trim();
  return t ? t : null;
}

/** Same members regardless of order. */
export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/** Same bank scope (null = all banks). */
export function sameBankIds(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return sameMembers(a, b);
}

/** Structural equality for JSON values (key order sensitive; good enough to skip unchanged fields). */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

let rowSeq = 0;
/** Stable React key for editable rows. */
export function newRowId(prefix = 'row'): string {
  rowSeq += 1;
  return `${prefix}-${rowSeq}`;
}

/**
 * A key suggested from a plain name, e.g. "Business closed" → "business_closed": lowercase letters, digits and _,
 * starting with a letter, at most `max` characters (KEY_REGEX). Blank when the name has no letters.
 */
export function keyFromText(text: string, max = 64): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, max)
    .replace(/_+$/, '');
}

/** Integer text input → number; blank → undefined; not an integer → null. */
export function parseIntText(text: string): number | undefined | null {
  const t = text.trim();
  if (!t) return undefined;
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

/**
 * PATCH /v1/admin/<path> with a body that may carry explicit nulls. The shared Zod-inferred body types turn blank text
 * into `undefined` (= "leave unchanged"), so they cannot clear a nullable column (email, phone, description, notes,
 * issuer fields); screens that let you clear a value send it through here. `path` must already be URL-encoded.
 */
export function patchAdmin<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return api<T>('PATCH', `/v1/admin${path}`, body);
}
