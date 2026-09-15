// The export builders (T6-03, B6.4, D-102): the visits in, the file out, with no I/O of their own (photos come through
// the `fetch` the caller passes), so they are unit-tested (exports_test.ts). The worker in ./run.ts loads the visits,
// stores the file and records the result.
import { sha256Hex } from '../crypto.ts';
import { csvBytes } from './csv.ts';
import {
  answerTables,
  type ExportInspection,
  evidencePath,
  type FormVersion,
  localTime,
  type ManifestFile,
  manifestTable,
  questionLabels,
  sourceTable,
  type Table,
  words,
} from './tables.ts';
import { type Sheet, xlsxChunks } from './xlsx.ts';
import { ZipTooLarge, ZipWriter } from './zip.ts';

/** The export can never be made as asked: it ends as failed at once, with this message for the person who asked. */
export class ExportRefused extends Error {}

interface ExportRecord {
  id: string;
  type: string;
  scope: { from?: string; to?: string; family_id?: string; job_ids?: string[] };
  statuses: string[];
  attempts: number;
  bank_id: string | null;
  created_at: string;
}

export interface Claim {
  run: boolean;
  reason?: string;
  error?: string;
  export: ExportRecord;
  bank: { code: string; name: string } | null;
  form: { key: string; title: string } | null;
  time_zone: string;
  visits: number;
  max_file_bytes: number;
}

export interface Item {
  inspection_id: string;
  form_version_id: string | null;
  answers_hash: string | null;
  submission_hash: string | null;
  evidence_listed: number;
  evidence_included: number;
}

export interface Problem {
  severity: 'info' | 'critical';
  kind: string;
  count: number;
  message: string;
  evidence_ids: string[];
}

export interface Built {
  chunks: Uint8Array[];
  fileName: string;
  mime: string;
  items: Item[];
  problems: Problem[];
}

const MIME = {
  csv: 'text/csv',
  zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

function slug(s: string): string {
  return s.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
}

/** ABC-site_inspection-visit-answers-2026-09-01-to-2026-09-30 (no extension). */
export function fileBase(claim: Pick<Claim, 'bank' | 'form' | 'export'>, what: string, today = new Date()): string {
  const s = claim.export.scope ?? {};
  const when = s.from && s.to ? `${s.from}-to-${s.to}` : s.from ? `from-${s.from}` : `to-${s.to ?? today.toISOString().slice(0, 10)}`;
  return [claim.bank?.code ?? 'all-banks', claim.form?.key, `visit-${what}`, when].filter(Boolean).map((p) => slug(String(p))).join('-');
}

function item(i: ExportInspection, listed = 0, included = 0): Item {
  return {
    inspection_id: i.id, form_version_id: i.form_version_id, answers_hash: i.answers_hash, submission_hash: i.submission_hash,
    evidence_listed: listed, evidence_included: included,
  };
}

function aboutRows(claim: Claim, visits: number, prepared: Date): Table['rows'] {
  const s = claim.export.scope ?? {};
  const tz = claim.time_zone;
  return [
    ['About this export', ''],
    ['Export ID', claim.export.id],
    ['Asked for', localTime(claim.export.created_at, tz)],
    ['Prepared', localTime(prepared.toISOString(), tz)],
    ['Bank', claim.bank ? `${claim.bank.name} (${claim.bank.code})` : 'All banks'],
    ['Form', claim.form?.title ?? 'All forms'],
    ['Visits that reached us', s.from && s.to ? `${s.from} to ${s.to}` : s.from ? `From ${s.from}` : s.to ? `Up to ${s.to}` : 'Any date'],
    ['Visit statuses included', claim.export.statuses.map((x) => words(x)).join(', ')],
    ['Visits', visits],
    ['Corrections', 'A reviewer’s correction replaces the answer it corrects; every correction is listed, with the old value and the reason, in “Corrections after submission”.'],
    ['Fingerprints', 'The SHA-256 fingerprints on “Where each visit came from” are the ones FESS POS recorded when the answers arrived. They prove the answers weren’t changed.'],
  ];
}

// ── Builders ──────────────────────────────────────────────────────────────────────────────────
export async function buildCsv(claim: Claim, visits: ExportInspection[], versions: Record<string, FormVersion>): Promise<Built> {
  const { all, perVersion } = answerTables(visits, versions, claim.time_zone);
  const items = visits.map((i) => item(i));
  if (perVersion.length <= 1) {
    return { chunks: [csvBytes(all.rows)], fileName: `${fileBase(claim, 'answers')}.csv`, mime: MIME.csv, items, problems: [] };
  }
  const zip = new ZipWriter(claim.max_file_bytes);
  await zip.add({ name: 'all-answers.csv', data: csvBytes(all.rows), compress: true });
  for (const t of perVersion) await zip.add({ name: `answers-${slug(t.name)}.csv`, data: csvBytes(t.rows), compress: true });
  await zip.add({ name: 'where-each-visit-came-from.csv', data: csvBytes(sourceTable(visits, versions, claim.time_zone).rows), compress: true });
  return { chunks: zip.finish(), fileName: `${fileBase(claim, 'answers')}.zip`, mime: MIME.zip, items, problems: [] };
}

export async function buildXlsx(claim: Claim, visits: ExportInspection[], versions: Record<string, FormVersion>, prepared = new Date()): Promise<Built> {
  const { all, perVersion } = answerTables(visits, versions, claim.time_zone);
  const sheets: Sheet[] = [{ name: all.name, rows: all.rows }];
  if (perVersion.length > 1) for (const t of perVersion) sheets.push({ name: t.name, rows: t.rows });
  const source = sourceTable(visits, versions, claim.time_zone);
  sheets.push({ name: source.name, rows: source.rows }, { name: 'About this file', rows: aboutRows(claim, visits.length, prepared), widths: [28, 100] });
  const title = fileBase(claim, 'answers');
  return { chunks: await xlsxChunks(sheets, { title, created: prepared }), fileName: `${title}.xlsx`, mime: MIME.xlsx, items: visits.map((i) => item(i)), problems: [] };
}

type Fetch = (path: string) => Promise<Uint8Array | null>;

export async function buildEvidenceZip(claim: Claim, visits: ExportInspection[], versions: Record<string, FormVersion>, fetch: Fetch,
                                       prepared = new Date()): Promise<Built> {
  const zip = new ZipWriter(claim.max_file_bytes);
  const files: ManifestFile[] = [];
  const items: Item[] = [];
  const found: Record<string, { severity: Problem['severity']; ids: string[] }> = {};
  const note = (kind: string, severity: Problem['severity'], id: string) => {
    found[kind] ??= { severity, ids: [] };
    found[kind].ids.push(id);
  };
  try {
    for (const visit of visits) {
      const labels = questionLabels(visit.form_version_id ? versions[visit.form_version_id] ?? null : null);
      let listed = 0;
      let included = 0;
      for (const e of visit.evidence ?? []) {
        listed++;
        const base = {
          inspection_id: visit.id, job_reference: visit.job_reference, evidence_id: e.id, field_key: e.field_key,
          question: e.field_key ? labels.get(e.field_key) ?? null : null, type: e.type, mime: e.mime, captured_at: e.captured_at,
          bytes: e.bytes, sha256_recorded: e.sha256, upload_state: e.upload_state, replica_state: e.replica_state, custody: e.custody,
        };
        if (e.upload_state !== 'uploaded' && e.upload_state !== 'verified') {
          const held = e.upload_state === 'quarantined';
          files.push({ ...base, path: null, sha256_file: null, matches: null, included: false,
                       not_included_because: held ? 'Held back: it didn’t match its fingerprint when it arrived' : 'Not received from the phone yet' });
          note(held ? 'held_back' : 'not_received', held ? 'critical' : 'info', e.id);
          continue;
        }
        const bytes = await fetch(e.storage_path);
        if (!bytes) {
          files.push({ ...base, path: null, sha256_file: null, matches: null, included: false, not_included_because: 'Not found in storage' });
          note('missing_in_storage', 'critical', e.id);
          continue;
        }
        const sha = await sha256Hex(bytes);
        const matches = sha === e.sha256;
        const taken = e.captured_at ? new Date(e.captured_at) : prepared;
        const path = await zip.add({ name: evidencePath(visit, e), data: bytes, modified: Number.isNaN(taken.getTime()) ? prepared : taken });
        files.push({ ...base, bytes: bytes.length, path, sha256_file: sha, matches, included: true, not_included_because: null });
        if (!matches) note('fingerprint_mismatch', 'critical', e.id);
        included++;
      }
      items.push(item(visit, listed, included));
    }
    const enc = new TextEncoder();
    const manifest = {
      export: {
        id: claim.export.id, format: claim.export.type, asked_for: claim.export.created_at, prepared: prepared.toISOString(),
        bank: claim.bank?.code ?? null, form: claim.form?.key ?? null, scope: claim.export.scope, statuses: claim.export.statuses,
      },
      visits: visits.map((v) => ({
        id: v.id, job_reference: v.job_reference, status: v.status, attempt: v.attempt, submitted_at: v.submitted_at,
        definition_hash: v.definition_hash, answers_hash: v.answers_hash, submission_hash: v.submission_hash,
        evidence_expected: v.evidence_expected, evidence_received: v.evidence_received, evidence_verified: v.evidence_verified,
      })),
      files,
    };
    await zip.add({ name: 'manifest.csv', data: csvBytes(manifestTable(files, claim.time_zone)), compress: true, modified: prepared });
    await zip.add({ name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 2)), compress: true, modified: prepared });
    await zip.add({
      name: 'README.txt', compress: true, modified: prepared,
      data: enc.encode([
        'Photos and files from FESS POS visits.',
        '',
        'photos/<job reference>/visit-<try>/<question>-<photo id>.<type> holds each photo or file.',
        'manifest.csv (and manifest.json, for systems) lists every one, including any not in this ZIP and why.',
        'For each file it gives the SHA-256 fingerprint FESS POS recorded when it arrived, the SHA-256 of the file',
        'in this ZIP, and whether they match. A match proves the file is exactly what the agent\'s phone took.',
        '',
      ].join('\r\n')),
    });
  } catch (e) {
    if (e instanceof ZipTooLarge) {
      throw new ExportRefused(`The photos come to more than ${Math.floor(e.limit / 1048576)} MB, the most one download can hold. Choose fewer dates, and ask again.`);
    }
    throw e;
  }
  const messages: Record<string, (n: number) => string> = {
    not_received: (n) => `${n} photo${n === 1 ? '' : 's'} hadn’t reached us yet, so ${n === 1 ? 'it isn’t' : 'they aren’t'} in the ZIP. The manifest lists ${n === 1 ? 'it' : 'them'}.`,
    held_back: (n) => `${n} photo${n === 1 ? ' was' : 's were'} held back on arrival for not matching ${n === 1 ? 'its' : 'their'} fingerprint, so ${n === 1 ? 'it isn’t' : 'they aren’t'} in the ZIP.`,
    missing_in_storage: (n) => `${n} photo${n === 1 ? '' : 's'} couldn’t be found in storage. Support has been alerted.`,
    fingerprint_mismatch: (n) => `${n} photo${n === 1 ? '' : 's'} didn’t match ${n === 1 ? 'its' : 'their'} recorded fingerprint. ${n === 1 ? 'It’s' : 'They’re'} included and marked in the manifest; support has been alerted.`,
  };
  const problems: Problem[] = Object.entries(found).map(([kind, f]) => ({
    severity: f.severity, kind, count: f.ids.length, message: messages[kind]?.(f.ids.length) ?? kind, evidence_ids: f.ids.slice(0, 50),
  }));
  return { chunks: zip.finish(), fileName: `${fileBase(claim, 'photos')}.zip`, mime: MIME.zip, items, problems };
}

