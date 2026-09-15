// Pure helpers for bank API keys and the bank read API (T6-06, D-100): the key format, the change cursor and the labelled
// answers. Kept free of I/O so they are unit-tested (bank_test.ts).
import { formFieldList } from './engine-adapter.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const RANDOM_LENGTH = 43; // 43 characters of 62 ≈ 256 bits

/** fpos_<env>_<43 random letters and digits>. The environment is in the key so a QA key is recognisable at a glance. */
export const BANK_KEY_PATTERN = /^fpos_[a-z]{2,10}_[A-Za-z0-9]{43}$/;

export function keyEnvironment(posEnv: string): string {
  if (posEnv === 'production') return 'prod';
  return (posEnv.toLowerCase().replace(/[^a-z]/g, '') || 'dev').slice(0, 10).padEnd(2, 'x');
}

/** A new key, shown once. Only sha256(key) and the last four characters are stored. */
export function newBankKey(posEnv: string): { key: string; lastFour: string } {
  let random = '';
  while (random.length < RANDOM_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(64))) {
      // 248 = 4 × 62: rejecting 248–255 keeps every character equally likely.
      if (b < 248 && random.length < RANDOM_LENGTH) random += ALPHABET[b % 62];
    }
  }
  return { key: `fpos_${keyEnvironment(posEnv)}_${random}`, lastFour: random.slice(-4) };
}

// ── Change cursor ─────────────────────────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export interface Cursor {
  changed_at: string;
  id: string;
}

/** Opaque to the bank: base64url of {t, id}. */
export function encodeCursor(c: Cursor): string {
  return btoa(JSON.stringify({ t: c.changed_at, id: c.id })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeCursor(s: string): Cursor | null {
  if (!/^[A-Za-z0-9_-]{1,400}$/.test(s)) return null;
  try {
    const j = JSON.parse(atob(s.replaceAll('-', '+').replaceAll('_', '/'))) as { t?: unknown; id?: unknown };
    if (typeof j.t === 'string' && TIMESTAMP.test(j.t) && typeof j.id === 'string' && UUID.test(j.id)) return { changed_at: j.t, id: j.id };
  } catch {
    // not a cursor we made
  }
  return null;
}

// ── Labelled answers ──────────────────────────────────────────────────────────────────────────
export interface StoredAnswer {
  v?: unknown;
  prefilled?: boolean;
  computed?: boolean;
}

export interface LabelledAnswer {
  section: string | null;
  section_title: string | null;
  key: string;
  label: string;
  type: string | null;
  value: unknown;
  /** The option labels for choice fields with inline options. */
  value_label?: string | null | Array<string | null>;
  /** For photos, signatures and other evidence: the evidence ids, matching `evidence[].id`. */
  evidence_ids?: string[];
  /** Who gave the value: the agent, the office (prefilled from the job) or the form (computed). */
  source: 'agent' | 'prefilled' | 'computed';
}

function sourceOf(a: StoredAnswer | undefined): LabelledAnswer['source'] {
  return a?.prefilled ? 'prefilled' : a?.computed ? 'computed' : 'agent';
}

/**
 * The stored answers in form order with their labels. Fields the form marks `export.include: false` are left out. Answers
 * the pinned form doesn't describe are still returned (labelled with their key), so nothing captured is silently dropped.
 */
export function labelledAnswers(definition: unknown, answers: Record<string, StoredAnswer> | null | undefined): LabelledAnswer[] {
  const stored = answers ?? {};
  const out: LabelledAnswer[] = [];
  const described = new Set<string>();
  for (const f of formFieldList(definition)) {
    described.add(f.key);
    if (!f.exported || !Object.hasOwn(stored, f.key)) continue;
    const a = stored[f.key];
    const value = a?.v ?? null;
    const entry: LabelledAnswer = {
      section: f.section, section_title: f.sectionTitle, key: f.key, label: f.label, type: f.type, value, source: sourceOf(a),
    };
    if (f.options) {
      const opts = f.options;
      entry.value_label = Array.isArray(value) ? value.map((x) => opts[String(x)] ?? null) : value === null ? null : opts[String(value)] ?? null;
    }
    if (f.evidence) entry.evidence_ids = (Array.isArray(value) ? value : value === null ? [] : [value]).filter((x): x is string => typeof x === 'string');
    out.push(entry);
  }
  for (const [key, a] of Object.entries(stored)) {
    if (described.has(key)) continue;
    out.push({ section: null, section_title: null, key, label: key, type: null, value: a?.v ?? null, source: sourceOf(a) });
  }
  return out;
}

/** /api/v1/bank/inspections/<uuid> → /v1/bank/inspections/:id, for the call record. */
export function routeName(path: string): string {
  return path.replace(/^\/api/, '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').slice(0, 200);
}
