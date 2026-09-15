// The tables inside an export (T6-03, B6.4, D-102), built from the visits the database hands the worker. Pure: no I/O,
// so it's unit-tested (exports_test.ts).
//
//   answerTables  → one table per form version, plus one "all answers" table: the union of every version's columns,
//                   matched by field key, labelled from the newest version that has the field;
//   sourceTable   → one row per visit with the fingerprints that prove what was submitted (the trace to the source);
//   photoManifest → one row per photo in a photo ZIP: its file, visit, recorded and actual SHA-256, and custody.
//
// Labels come from the pinned form (export.column_label, else the label, else the key; option labels for choices), as
// the bank API gives them (labelledAnswers). Fields the form marks export.include: false stay out. Answers the form
// doesn't describe are kept, labelled with their key, so nothing captured is dropped. A reviewer's corrections
// (amendments) replace the value of the field they correct, and every correction is also listed with the old value and
// the reason, so nothing is hidden.
import { formFieldList } from '../engine-adapter.ts';
import { type LabelledAnswer, labelledAnswers, type StoredAnswer } from '../bank.ts';
import type { Cell } from './csv.ts';

export interface ExportAmendment {
  field_key: string;
  old_value: unknown;
  new_value: unknown;
  justification: string;
  created_at: string;
}

export interface ExportEvidence {
  id: string;
  field_key: string | null;
  category: string | null;
  type: string;
  mime: string | null;
  bytes: number | null;
  captured_at: string | null;
  sha256: string;
  integrity_verified: boolean | null;
  upload_state: string;
  replica_state: string;
  storage_path: string;
  custody: Array<{ event: string; at: string }>;
}

/** One visit as pos_rpc.export_page returns it. */
export interface ExportInspection {
  id: string;
  sort_at: string;
  job_id: string;
  job_reference: string;
  external_ref: string | null;
  merchant_name: string;
  trading_name: string | null;
  bank_code: string;
  status: string;
  attempt: number;
  submitted_at: string | null;
  decision: { decision: string; reason_code: string | null; decided_at: string } | null;
  form_version_id: string | null;
  definition_hash: string | null;
  answers_hash: string | null;
  submission_hash: string | null;
  answers: Record<string, StoredAnswer> | null;
  amendments: ExportAmendment[];
  evidence_expected: number;
  evidence_received: number;
  evidence_verified: number;
  evidence?: ExportEvidence[];
}

export interface FormVersion {
  id: string;
  family_key: string;
  title: string;
  version: number;
  definition: unknown;
}

export interface Table {
  name: string;
  /** The form version the table is for; null for "all answers" and the other tables. */
  versionId: string | null;
  rows: Cell[][];
}

// ── Formatting ────────────────────────────────────────────────────────────────────────────────
/** "2026-09-15 14:03:07 +02:00" in the configured time zone; the ISO text as given when the zone can't be used. */
export function localTime(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', timeZoneName: 'longOffset',
    }).formatToParts(d).map((p) => [p.type, p.value]));
    const offset = (parts.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00';
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${offset}`;
  } catch {
    return d.toISOString();
  }
}

/** A time as a cell: text in a CSV ("2026-09-15 14:03:07 +02:00"), a date in Excel. */
export function timeCell(iso: string | null | undefined, timeZone: string): Cell {
  const text = localTime(iso, timeZone);
  return text === null ? null : { time: text };
}

/** Words for a status or decision code: under_review → Under review. */
export function words(code: string | null | undefined): string | null {
  if (!code) return null;
  const s = code.replaceAll('_', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function raw(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** An answer as a cell: option labels for choices, evidence ids for photos, Yes/No, numbers as numbers, the rest as JSON. */
export function answerCell(a: LabelledAnswer): Cell {
  if (a.evidence_ids) return a.evidence_ids.length ? a.evidence_ids.join('; ') : null;
  if (a.value_label !== undefined) {
    if (Array.isArray(a.value_label)) {
      const values = Array.isArray(a.value) ? a.value : [];
      return a.value_label.map((l, i) => l ?? String(raw(values[i]) ?? '')).join('; ') || null;
    }
    return a.value_label ?? raw(a.value);
  }
  return raw(a.value);
}

/** An amendment value may be the raw value or a stored answer ({v: …}). */
function unwrap(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'v')) return (value as { v: unknown }).v;
  return value;
}

/** The answers with the latest correction of each top-level field applied. Nested corrections stay in the corrections list. */
export function correctedAnswers(i: ExportInspection): Record<string, StoredAnswer> {
  const out: Record<string, StoredAnswer> = { ...(i.answers ?? {}) };
  for (const a of [...i.amendments].sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    if (!/^[a-z][a-z0-9_]*$/.test(a.field_key)) continue;
    out[a.field_key] = { ...(out[a.field_key] ?? {}), v: unwrap(a.new_value) };
  }
  return out;
}

function corrections(i: ExportInspection, labels: Map<string, string>): Cell {
  if (!i.amendments.length) return null;
  const show = (v: unknown) => {
    const c = raw(unwrap(v));
    return c === null ? '(empty)' : String(c);
  };
  return i.amendments
    .map((a) => `${labels.get(a.field_key.replace(/\[.*$/, '')) ?? a.field_key}: ${show(a.old_value)} → ${show(a.new_value)} (${a.justification})`)
    .join('\n');
}

// ── Answer tables ─────────────────────────────────────────────────────────────────────────────
const LEAD: Array<[string, (i: ExportInspection, v: FormVersion | null, tz: string) => Cell]> = [
  ['Job reference', (i) => i.job_reference],
  ['Bank’s reference', (i) => i.external_ref],
  ['Merchant', (i) => i.merchant_name],
  ['Bank', (i) => i.bank_code],
  ['Visit ID', (i) => i.id],
  ['Try', (i) => i.attempt],
  ['Visit status', (i) => words(i.status)],
  ['Decision', (i) => words(i.decision?.decision)],
  ['Decided', (i, _v, tz) => timeCell(i.decision?.decided_at, tz)],
  ['Submitted', (i, _v, tz) => timeCell(i.submitted_at, tz)],
  ['Form', (_i, v) => v?.title ?? null],
  ['Form version', (_i, v) => v?.version ?? null],
];
const TAIL = ['Corrections after submission', 'Answers fingerprint (SHA-256)'];

interface Column {
  key: string;
  label: string;
}

function versionLabel(v: FormVersion | null): string {
  return v ? `${v.title} v${v.version}` : 'No form recorded';
}

/** Distinct labels: a label used by two keys gets its key in brackets. */
function distinct(columns: Column[]): Column[] {
  const counts = new Map<string, number>();
  for (const c of columns) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  return columns.map((c) => ((counts.get(c.label) ?? 0) > 1 ? { ...c, label: `${c.label} (${c.key})` } : c));
}

function table(name: string, versionId: string | null, visits: ExportInspection[], versions: Record<string, FormVersion>,
               columns: Column[], tz: string): Table {
  const cols = distinct(columns);
  const header: Cell[] = [...LEAD.map(([h]) => h), ...cols.map((c) => c.label), ...TAIL];
  const rows: Cell[][] = [header];
  for (const i of visits) {
    const v = i.form_version_id ? versions[i.form_version_id] ?? null : null;
    const labelled = new Map(labelledAnswers(v?.definition ?? null, correctedAnswers(i)).map((a) => [a.key, a]));
    const labels = new Map(formFieldList(v?.definition ?? null).map((f) => [f.key, f.label]));
    rows.push([
      ...LEAD.map(([, get]) => get(i, v, tz)),
      ...cols.map((c) => {
        const a = labelled.get(c.key);
        return a ? answerCell(a) : null;
      }),
      corrections(i, labels),
      i.answers_hash,
    ]);
  }
  return { name, versionId, rows };
}

function ordered(visits: ExportInspection[]): ExportInspection[] {
  return [...visits].sort((a, b) => a.sort_at.localeCompare(b.sort_at) || a.id.localeCompare(b.id));
}

/** Columns a version contributes: its exported fields in form order, then any answer keys it doesn't describe. */
function versionColumns(v: FormVersion | null, visits: ExportInspection[]): Column[] {
  const cols: Column[] = [];
  const seen = new Set<string>();
  const described = new Set<string>();
  for (const f of formFieldList(v?.definition ?? null)) {
    described.add(f.key);
    if (!f.exported || seen.has(f.key)) continue;
    seen.add(f.key);
    cols.push({ key: f.key, label: f.label });
  }
  for (const i of visits) {
    for (const key of Object.keys(correctedAnswers(i))) {
      if (described.has(key) || seen.has(key)) continue;
      seen.add(key);
      cols.push({ key, label: key });
    }
  }
  return cols;
}

/** One table per form version (newest first within a form) and the flattened union of them all. */
export function answerTables(visits: ExportInspection[], versions: Record<string, FormVersion>, tz: string): { all: Table; perVersion: Table[] } {
  const sorted = ordered(visits);
  const groups = new Map<string, ExportInspection[]>();
  for (const i of sorted) {
    const k = i.form_version_id ?? '';
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const va = versions[a];
    const vb = versions[b];
    if (!va || !vb) return va ? -1 : vb ? 1 : 0;
    return va.title.localeCompare(vb.title) || vb.version - va.version;
  });
  const perVersion: Table[] = [];
  const union: Column[] = [];
  const inUnion = new Set<string>();
  for (const k of keys) {
    const v = versions[k] ?? null;
    const cols = versionColumns(v, groups.get(k)!);
    perVersion.push(table(versionLabel(v), k || null, groups.get(k)!, versions, cols, tz));
    for (const c of cols) {
      if (inUnion.has(c.key)) continue;
      inUnion.add(c.key);
      union.push(c);
    }
  }
  return { all: table('All answers', null, sorted, versions, union, tz), perVersion };
}

/** One row per visit: where it came from and the fingerprints that prove it. */
export function sourceTable(visits: ExportInspection[], versions: Record<string, FormVersion>, tz: string): Table {
  const rows: Cell[][] = [[
    'Visit ID', 'Job reference', 'Bank', 'Visit status', 'Submitted', 'Form', 'Form version', 'Form fingerprint (SHA-256)',
    'Answers fingerprint (SHA-256)', 'Submission fingerprint (SHA-256)', 'Photos expected', 'Photos received', 'Photos checked',
  ]];
  for (const i of ordered(visits)) {
    const v = i.form_version_id ? versions[i.form_version_id] ?? null : null;
    rows.push([
      i.id, i.job_reference, i.bank_code, words(i.status), timeCell(i.submitted_at, tz), v?.title ?? null, v?.version ?? null,
      i.definition_hash, i.answers_hash, i.submission_hash, i.evidence_expected, i.evidence_received, i.evidence_verified,
    ]);
  }
  return { name: 'Where each visit came from', versionId: null, rows };
}

// ── Photo ZIP manifest ────────────────────────────────────────────────────────────────────────
export interface ManifestFile {
  path: string | null;
  inspection_id: string;
  job_reference: string;
  evidence_id: string;
  field_key: string | null;
  question: string | null;
  type: string;
  mime: string | null;
  captured_at: string | null;
  bytes: number | null;
  sha256_recorded: string;
  sha256_file: string | null;
  matches: boolean | null;
  upload_state: string;
  replica_state: string;
  custody: Array<{ event: string; at: string }>;
  included: boolean;
  not_included_because: string | null;
}

export function evidenceExtension(mime: string | null, storagePath: string): string {
  const fromPath = /\.([a-z0-9]{2,5})$/i.exec(storagePath)?.[1]?.toLowerCase();
  if (fromPath) return fromPath;
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/json': 'json' } as Record<string, string>)[mime ?? ''] ?? 'bin';
}

/** photos/<job reference>/visit-<try>/<question key>-<photo id>.<ext> */
export function evidencePath(i: ExportInspection, e: ExportEvidence): string {
  return `photos/${i.job_reference}/visit-${i.attempt}/${e.field_key ?? e.category ?? e.type}-${e.id}.${evidenceExtension(e.mime, e.storage_path)}`;
}

export function questionLabels(v: FormVersion | null): Map<string, string> {
  return new Map(formFieldList(v?.definition ?? null).map((f) => [f.key, f.label]));
}

export function manifestTable(files: ManifestFile[], tz: string): Cell[][] {
  const rows: Cell[][] = [[
    'File in this ZIP', 'Visit ID', 'Job reference', 'Question', 'Photo ID', 'Type', 'Taken (phone clock)', 'Size (bytes)',
    'Recorded SHA-256', 'SHA-256 of this file', 'Matches', 'Checked on arrival', 'Backed up', 'Chain of custody', 'Included',
    'Why not included',
  ]];
  for (const f of files) {
    rows.push([
      f.path, f.inspection_id, f.job_reference, f.question ?? f.field_key, f.evidence_id, f.type, timeCell(f.captured_at, tz), f.bytes,
      f.sha256_recorded, f.sha256_file, f.matches === null ? null : f.matches ? 'Yes' : 'NO', words(f.upload_state), words(f.replica_state),
      f.custody.map((c) => `${c.event} ${localTime(c.at, tz)}`).join('; ') || null, f.included ? 'Yes' : 'No', f.not_included_because,
    ]);
  }
  return rows;
}
