// Exports (T6-03, T6-04, B6.4, D-102): what the admin reads under RLS (pos.exports) and the POS API calls to ask for an
// export, try a failed one again and download a ready one. Progress is worked out from the row itself, so the screen
// never shows something as done that isn't (A-07).
import { api } from '@/lib/api';
import { fetchRows, pos } from '@/lib/supabase';
import type { StatusTone } from '@/lib/status';

export type ExportFormat = 'csv' | 'xlsx' | 'evidence_zip' | 'pdf' | 'spec_pdf' | 'billing_csv';
export type ExportDbStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ExportProblem {
  severity: 'info' | 'critical';
  kind: string;
  count: number;
  message: string;
  evidence_ids?: string[];
}

export interface ExportRecord {
  id: string;
  type: ExportFormat;
  scope: { bank_id?: string; from?: string; to?: string; family_id?: string; job_ids?: string[] };
  requested_by: string | null;
  api_key_id: string | null;
  recipient: string | null;
  status: ExportDbStatus;
  error: string | null;
  attempts: number;
  bank_id: string | null;
  family_id: string | null;
  statuses: string[] | null;
  storage_path: string | null;
  file_name: string | null;
  mime: string | null;
  bytes: number | null;
  sha256: string | null;
  inspection_count: number | null;
  evidence_count: number | null;
  problems: ExportProblem[] | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  expires_at: string | null;
  download_count: number;
  last_downloaded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExportRequestBody {
  type: ExportFormat;
  scope: { bank_id?: string; from?: string; to?: string; family_id?: string; job_ids?: string[] };
  recipient?: string;
}

export interface ExportDownload {
  url: string;
  expires_in_s: number;
  file_name: string;
  bytes: number;
  sha256: string;
}

export const exportKeys = {
  list: ['exports', 'list'] as const,
  formats: ['exports', 'formats'] as const,
  keys: (ids: string[]) => ['exports', 'keys', ...ids] as const,
};

const A = '/v1/admin';
const id = encodeURIComponent;

export const exportsApi = {
  formats: () => api<{ ready: string[] }>('GET', `${A}/exports/formats`),
  create: (body: ExportRequestBody) => api<ExportRecord>('POST', `${A}/exports`, body),
  retry: (exportId: string) => api<ExportRecord>('POST', `${A}/exports/${id(exportId)}/retry`),
  download: (exportId: string) => api<ExportDownload>('POST', `${A}/exports/${id(exportId)}/download`),
};

export function fetchExports(): Promise<ExportRecord[]> {
  return fetchRows<ExportRecord>(pos().from('exports').select('*').order('created_at', { ascending: false }).limit(200));
}

/** The names of the bank API keys that asked for exports (admins read their banks' keys under RLS). Never the fingerprint. */
export function fetchKeyNames(ids: string[]): Promise<Array<{ id: string; label: string; last_four: string | null }>> {
  return fetchRows(pos().from('api_keys').select('id,label,last_four').in('id', ids));
}

/** What each format is, in words. `available` comes from the server (exports.formats_ready), never from here. */
export const FORMAT_INFO: Record<ExportFormat, { title: string; description: string; short: string }> = {
  csv: {
    title: 'Answers as a spreadsheet (CSV)',
    description: 'Opens in Excel or any spreadsheet. When visits used different versions of a form, you get a ZIP with one file for all of them and one per version.',
    short: 'Answers (CSV)',
  },
  xlsx: {
    title: 'Answers as an Excel workbook',
    description: 'One sheet with every answer, one per form version, and a sheet showing where each visit came from.',
    short: 'Answers (Excel)',
  },
  evidence_zip: {
    title: 'Photos (ZIP)',
    description: 'Every photo and file, with a list that proves each one is exactly what the agent’s phone took.',
    short: 'Photos (ZIP)',
  },
  pdf: { title: 'Visit reports (PDF)', description: 'One report per visit, with the chain of custody.', short: 'Visit reports (PDF)' },
  spec_pdf: { title: 'Set-up description (PDF)', description: 'A document describing a form.', short: 'Set-up description (PDF)' },
  billing_csv: { title: 'Billing list (CSV)', description: 'The outcomes each bank is charged for.', short: 'Billing list (CSV)' },
};

export interface Progress {
  label: string;
  tone: StatusTone;
  detail: string | null;
  canDownload: boolean;
  canRetry: boolean;
}

const MINUTE = 60_000;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-ZA')} ${n === 1 ? one : many}`;
}

export function sizeText(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** Where an export stands, in words, from its row alone (A-07: waiting, retrying, being prepared, ready, expired, failed). */
export function progressOf(e: ExportRecord, now: number): Progress {
  const none = { canDownload: false, canRetry: false };
  if (e.status === 'failed') return { ...none, label: 'Failed', tone: 'danger', detail: e.error ?? 'It failed without a reason. Try again, or tell support.', canRetry: true };
  if (e.status === 'done') {
    if (e.expires_at && Date.parse(e.expires_at) <= now) {
      return { ...none, label: 'Expired', tone: 'muted', detail: 'Files can be downloaded for a limited time. Ask for it again.' };
    }
    const parts = [
      e.inspection_count !== null ? plural(e.inspection_count, 'visit') : null,
      e.type === 'evidence_zip' && e.evidence_count !== null ? plural(e.evidence_count, 'photo') : null,
      sizeText(e.bytes),
    ].filter(Boolean);
    return { ...none, label: 'Ready', tone: 'success', detail: parts.join(' · ') || null, canDownload: true };
  }
  if (e.status === 'running') {
    const started = e.started_at ? Date.parse(e.started_at) : now;
    if (now - started > 15 * MINUTE) {
      return { ...none, label: 'Taking longer than usual', tone: 'warning', detail: 'If it stopped, it will be tried again by itself within 15 minutes.' };
    }
    return { ...none, label: 'Being prepared', tone: 'progress', detail: e.attempts > 1 ? `Try ${e.attempts}` : null };
  }
  if (e.error) return { ...none, label: 'Waiting to try again', tone: 'warning', detail: e.error };
  if (now - Date.parse(e.created_at) > 5 * MINUTE) {
    return { ...none, label: 'Still waiting to start', tone: 'warning', detail: 'Exports usually start within a minute. If it stays like this, the export service may be stopped: tell support.' };
  }
  return { ...none, label: 'Waiting to start', tone: 'neutral', detail: 'It usually starts within a minute.' };
}

export function isActive(e: ExportRecord): boolean {
  return e.status === 'queued' || e.status === 'running';
}
