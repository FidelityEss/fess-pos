'use client';

// Data layer for the jobs and review screens: row shapes, PostgREST select strings, query hooks and small helpers.
// Reads go through PostgREST under RLS; every write goes through /v1/admin/* (see job-actions.tsx, job-form.tsx).
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { isApiError } from '@/lib/api';
import { formatDateTime, formatTime, humanize } from '@/lib/format';
import { parsePoint } from '@/lib/geo';
import { isUuid } from '@/lib/hooks';
import type { StatusTone } from '@/lib/status';
import { callRpc, fetchMaybeRow, fetchRows, pos } from '@/lib/supabase';
import type {
  Amendment,
  AppointmentAttempt,
  CustodyEvent,
  DefinitionVersion,
  Evidence,
  Inspection,
  Job,
  JobAssignment,
  JobEvent,
  JobStatus,
  JsonObject,
  LatLng,
  LocationTrace,
  MccRiskTier,
  Review,
} from '@/lib/types';
import { isPlainObject } from '@/lib/utils';

// ── Embedded references ───────────────────────────────────────────────────────────────────────
export interface PersonRef {
  id?: string;
  first_name: string | null;
  last_name: string | null;
  employee_number?: string | null;
}
export interface BankRef {
  code: string;
  name: string;
}
export interface MccRef {
  code: string;
  description: string;
  risk_tier: MccRiskTier;
}

/** Maximum rows the list screens load (newest / best-sorted first). */
export const JOB_LIST_LIMIT = 500;

export const JOB_LIST_SELECT =
  'id,reference,bank_id,external_ref,merchant_name,trading_name,address,location,location_type,status,status_changed_at,' +
  'assigned_to,scheduled_start,scheduled_end,flags,created_at,closed_at,' +
  'bank:banks(code,name),agent:pos_users!jobs_assigned_to_fkey(id,first_name,last_name,employee_number)';

export type JobListRow = Pick<
  Job,
  | 'id'
  | 'reference'
  | 'bank_id'
  | 'external_ref'
  | 'merchant_name'
  | 'trading_name'
  | 'address'
  | 'location'
  | 'location_type'
  | 'status'
  | 'status_changed_at'
  | 'assigned_to'
  | 'scheduled_start'
  | 'scheduled_end'
  | 'flags'
  | 'created_at'
  | 'closed_at'
> & { bank: BankRef | null; agent: PersonRef | null };

const JOB_DETAIL_SELECT =
  '*,bank:banks(code,name),agent:pos_users!jobs_assigned_to_fkey(id,first_name,last_name,employee_number),' +
  'confirmed_by:pos_users!jobs_appointment_confirmed_by_fkey(first_name,last_name),' +
  'creator:pos_users!jobs_created_by_fkey(first_name,last_name),mcc:mcc_codes(code,description,risk_tier)';

export type JobDetailRow = Job & {
  bank: BankRef | null;
  agent: PersonRef | null;
  confirmed_by: PersonRef | null;
  creator: PersonRef | null;
  mcc: MccRef | null;
};

export type JobEventRow = JobEvent & { actor: PersonRef | null };
export type AttemptRow = AppointmentAttempt & { by: PersonRef | null };
export type AssignmentRow = JobAssignment & { agent: PersonRef | null; by: PersonRef | null };
export type ReviewRow = Review & { reviewer: PersonRef | null };
export type InspectionRow = Inspection & { agent: PersonRef | null; reviews: ReviewRow[] };
export type AmendmentRow = Amendment & { author: PersonRef | null };
export type DefinitionVersionRow = Pick<
  DefinitionVersion,
  'id' | 'family_id' | 'version' | 'definition' | 'definition_hash' | 'published_at'
> & { family: { key: string; title: string; kind: string } | null };

// ── Form context (pos.admin_job_form_context) ─────────────────────────────────────────────────
export interface GeofenceProfile {
  radius_m?: number;
  max_accuracy_m?: number;
  exit_consecutive_fixes?: number;
  prompt_checkin_on_arrival?: boolean;
}
export interface JobFormContext {
  job_schema: { family_id: string; key: string; version_id: string; definition: JsonObject } | null;
  location_types: string[];
  default_location_type: string;
  profiles: Record<string, GeofenceProfile>;
}

// ── Definitions (rendered generically; never hard-coded) ──────────────────────────────────────
export interface OptionDef {
  value: string;
  label: string;
}
export interface AttributeDef {
  key: string;
  type: string;
  label: string;
  required: boolean;
  help_text: string | null;
  props: JsonObject;
  options: OptionDef[];
}
export interface FormFieldDef {
  key: string;
  type: string;
  label: string;
  options: OptionDef[];
  props: JsonObject;
  fields: FormFieldDef[];
}
export interface FormSectionDef {
  key: string;
  title: string;
  fields: FormFieldDef[];
}

function parseOptions(v: unknown): OptionDef[] {
  if (!Array.isArray(v)) return [];
  const out: OptionDef[] = [];
  for (const o of v) {
    if (isPlainObject(o) && (typeof o.value === 'string' || typeof o.value === 'number')) {
      out.push({ value: String(o.value), label: typeof o.label === 'string' ? o.label : String(o.value) });
    }
  }
  return out;
}

/** Attribute definitions from a job_schema definition (`definition.attributes[]`). */
export function attributeDefs(definition: unknown): AttributeDef[] {
  if (!isPlainObject(definition) || !Array.isArray(definition.attributes)) return [];
  const out: AttributeDef[] = [];
  for (const a of definition.attributes) {
    if (!isPlainObject(a) || typeof a.key !== 'string') continue;
    out.push({
      key: a.key,
      type: typeof a.type === 'string' ? a.type : 'text',
      label: typeof a.label === 'string' ? a.label : humanize(a.key),
      // `required` may be a rule expression; only a literal true is enforced here (the server has the final say).
      required: a.required === true,
      help_text: typeof a.help_text === 'string' ? a.help_text : null,
      props: isPlainObject(a.props) ? a.props : {},
      options: parseOptions(a.options),
    });
  }
  return out;
}

function parseField(f: unknown): FormFieldDef | null {
  if (!isPlainObject(f) || typeof f.key !== 'string') return null;
  const sub = Array.isArray(f.fields) ? f.fields.map(parseField).filter((x): x is FormFieldDef => x !== null) : [];
  return {
    key: f.key,
    type: typeof f.type === 'string' ? f.type : 'text',
    label: typeof f.label === 'string' ? f.label : humanize(f.key),
    options: parseOptions(f.options),
    props: isPlainObject(f.props) ? f.props : {},
    fields: sub,
  };
}

/** Sections and fields of a form definition (`definition.sections[].fields[]`). */
export function formSections(definition: unknown): FormSectionDef[] {
  if (!isPlainObject(definition) || !Array.isArray(definition.sections)) return [];
  const out: FormSectionDef[] = [];
  for (const s of definition.sections) {
    if (!isPlainObject(s)) continue;
    const key = typeof s.key === 'string' ? s.key : `section_${out.length + 1}`;
    out.push({
      key,
      title: typeof s.title === 'string' ? s.title : humanize(key),
      fields: Array.isArray(s.fields) ? s.fields.map(parseField).filter((x): x is FormFieldDef => x !== null) : [],
    });
  }
  return out;
}

/** An answers entry `{ v, computed?, prefilled?, rendered_as?, flagged_differs? … }`. */
export interface AnswerEntry {
  v: unknown;
  meta: JsonObject;
}

/** The answers map of an inspection (`answers` may be the map itself or a full answers document with `.answers`). */
export function answersMap(raw: unknown): Record<string, AnswerEntry> {
  if (!isPlainObject(raw)) return {};
  const source = isPlainObject(raw.answers) && !('v' in raw.answers) ? raw.answers : raw;
  const out: Record<string, AnswerEntry> = {};
  for (const [k, entry] of Object.entries(source)) {
    if (isPlainObject(entry) && 'v' in entry) {
      const { v, ...meta } = entry;
      out[k] = { v, meta };
    } else {
      out[k] = { v: entry, meta: {} };
    }
  }
  return out;
}

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────
/** Deterministic JSON (sorted keys, undefined dropped) for change / difference detection. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** A string field of an unknown object ('' when absent). */
export function strOf(o: unknown, key: string): string {
  if (!isPlainObject(o)) return '';
  const v = o[key];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

/** A nested object field of an unknown object (null when absent). */
export function objOf(o: unknown, key: string): Record<string, unknown> | null {
  if (!isPlainObject(o)) return null;
  const v = o[key];
  return isPlainObject(v) ? v : null;
}
/** Number from number | numeric string; null otherwise. */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** "YYYY-MM-DD" of an instant in SAST. */
export function sastDay(value: string | number | Date | null | undefined): string {
  const d = value === null || value === undefined ? new Date() : new Date(value);
  const t = Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
  return new Date(t + 2 * 3600_000).toISOString().slice(0, 10);
}

/** Add days to a "YYYY-MM-DD" date. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO instant of SAST midnight at the start of a "YYYY-MM-DD" day. */
export function sastDayStartIso(day: string): string {
  const d = new Date(`${day}T00:00:00+02:00`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function jobPoint(job: Pick<Job, 'location'>): LatLng | null {
  return parsePoint(job.location);
}

/** Bank-supplied coordinates stored at `address.bank_coordinates`. */
export function bankCoordinates(address: unknown): LatLng | null {
  if (!isPlainObject(address)) return null;
  return parsePoint(address.bank_coordinates);
}

/** Fence radius: the job override, else the location type's profile radius. */
export function effectiveRadius(
  job: Pick<Job, 'geofence_radius_m' | 'location_type'>,
  ctx: JobFormContext | null | undefined,
): { radiusM: number | null; source: 'job' | 'profile' | null } {
  if (job.geofence_radius_m) return { radiusM: job.geofence_radius_m, source: 'job' };
  const r = toNumber(ctx?.profiles?.[job.location_type]?.radius_m);
  return r ? { radiusM: r, source: 'profile' } : { radiusM: null, source: null };
}

/** "12 Sep 2026, 09:00 – 11:00" (SAST); the end date is repeated only when it falls on another day. */
export function formatWindow(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return '—';
  if (!end) return formatDateTime(start);
  return sastDay(start) === sastDay(end) ? `${formatDateTime(start)} – ${formatTime(end)}` : `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

/** Human one-line address. */
export function formatAddress(address: unknown): string {
  if (!isPlainObject(address)) return '—';
  const parts = ['line1', 'line2', 'suburb', 'city', 'province', 'postal_code', 'country']
    .map((k) => address[k])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return parts.length ? parts.join(', ') : '—';
}

/** Status tone → hex colour for map markers. */
export const TONE_HEX: Record<StatusTone, string> = {
  neutral: '#64748b',
  info: '#0284c7',
  accent: '#006b55',
  progress: '#7c3aed',
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
  muted: '#94a3b8',
};

export interface FlagInfo {
  /** Technical label (Advanced view). */
  label: string;
  tone: StatusTone;
  description: string;
  /** Plain-language summary for Basic view, e.g. "A photo failed the tamper check". */
  plain: string;
}

const FLAG_INFO: Record<string, FlagInfo> = {
  location_mismatch: { label: 'Location mismatch', plain: 'Map pin far from the bank’s address', tone: 'warning', description: 'The map pin is more than 250 m from the bank-supplied coordinates.' },
  geofence_override: { label: 'Geofence override', plain: 'Started outside the site area', tone: 'danger', description: 'Started outside the fence through the override form. Must be acknowledged before approval.' },
  non_current_version: { label: 'Non-current version', plain: 'An older form version was used', tone: 'warning', description: 'Captured on a form version that was not the current one.' },
  submitted_after_cancel: { label: 'Submitted after cancel', plain: 'Sent in after the job was cancelled', tone: 'danger', description: 'The submission arrived after the job was cancelled.' },
  submitted_by_unassigned: { label: 'Submitted by unassigned agent', plain: 'Sent in by a different agent', tone: 'danger', description: 'The submitting agent was not the assigned agent.' },
  unexpected_evidence: { label: 'Unexpected evidence', plain: 'An unexpected photo arrived', tone: 'warning', description: 'Evidence arrived that was not in the manifest.' },
  web_client: { label: 'Web client', plain: 'Captured on the web version', tone: 'info', description: 'Captured on the web fallback client.' },
  profile_mismatch: { label: 'Profile mismatch', plain: 'Agent’s details differ from our records', tone: 'warning', description: 'The identity profile differed from the POS record.' },
  after_deactivation: { label: 'After deactivation', plain: 'Captured after the agent was deactivated', tone: 'danger', description: 'Captured after the agent was deactivated.' },
  mock_location: { label: 'Mock location', plain: 'Fake GPS location detected', tone: 'danger', description: 'The device reported a mocked location.' },
  trace_mock_location: { label: 'Mocked trace fix', plain: 'Fake GPS location detected', tone: 'danger', description: 'At least one trace fix was mocked.' },
  evidence_mock_location: { label: 'Mocked evidence location', plain: 'A photo has a fake GPS location', tone: 'danger', description: 'At least one evidence item had a mocked location.' },
  device_rooted: { label: 'Rooted device', plain: 'The phone may have been tampered with', tone: 'danger', description: 'The device reported root / jailbreak.' },
  clock_drift: { label: 'Clock drift', plain: 'The phone’s clock was wrong', tone: 'warning', description: 'Device clock differed from server time by more than 5 minutes.' },
  evidence_quarantined: { label: 'Evidence quarantined', plain: 'A photo failed the tamper check', tone: 'danger', description: 'At least one evidence item failed verification.' },
  duplicate_evidence_hash: { label: 'Duplicate evidence hash', plain: 'The same photo was used twice', tone: 'warning', description: 'The same file hash appears more than once.' },
  probable_duplicate: { label: 'Probable duplicate', plain: 'Looks like a duplicate submission', tone: 'warning', description: 'Looks like a duplicate of another submission.' },
  photo_missing: { label: 'Photo missing', plain: 'A required photo is missing', tone: 'warning', description: 'A required photo is missing.' },
  submission_hash_mismatch: { label: 'Submission hash mismatch', plain: 'The submission failed the tamper check', tone: 'danger', description: 'The recomputed submission hash did not match.' },
  answers_hash_mismatch: { label: 'Answers hash mismatch', plain: 'The answers failed the tamper check', tone: 'danger', description: 'The recomputed answers hash did not match.' },
  manifest_hash_mismatch: { label: 'Manifest hash mismatch', plain: 'A photo failed the tamper check', tone: 'danger', description: 'An evidence hash did not match the manifest.' },
  conflicting_submission: { label: 'Conflicting submission', plain: 'Two different submissions for one visit', tone: 'danger', description: 'A different submission exists for this attempt.' },
  evidence_conflict: { label: 'Evidence conflict', plain: 'Conflicting photos were received', tone: 'danger', description: 'Conflicting evidence was received.' },
};

/** Label, tone and description for a job or inspection flag (unknown flags are humanised). */
export function flagInfo(flag: string): FlagInfo {
  const known = FLAG_INFO[flag];
  if (known) return known;
  if (flag.startsWith('token_')) {
    return {
      label: `Session token: ${humanize(flag.slice(6)).toLowerCase()}`,
      plain: 'A security check on the visit needs attention',
      tone: 'warning',
      description: 'Inspection session token check (docs/07 §3).',
    };
  }
  return { label: humanize(flag), plain: humanize(flag), tone: 'neutral', description: flag };
}

/** Flags offered as job-list filters. `job` flags live on jobs.flags; `inspection` flags on any attempt's flags. */
export const FILTER_FLAGS: { flag: string; on: 'job' | 'inspection' }[] = [
  { flag: 'location_mismatch', on: 'job' },
  { flag: 'geofence_override', on: 'inspection' },
  { flag: 'non_current_version', on: 'inspection' },
  { flag: 'mock_location', on: 'inspection' },
  { flag: 'clock_drift', on: 'inspection' },
  { flag: 'submitted_after_cancel', on: 'inspection' },
];

/** Inspection statuses that are awaiting a review decision (when there is no reviews row). */
export const REVIEWABLE_INSPECTION_STATUSES = ['submitted', 'verifying', 'under_review', 'integrity_failed'] as const;

export const CONFLICT_CODES = ['CONFLICT', 'INVALID_TRANSITION', 'ALREADY_EXISTS'];
export function isConflictError(e: unknown): boolean {
  return isApiError(e) && CONFLICT_CODES.includes(e.code);
}

/** Invalidate everything that depends on a job (detail, its sub-queries, lists, review queue, dashboard). */
export async function invalidateJob(queryClient: QueryClient, jobId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['job', jobId] }),
    queryClient.invalidateQueries({ queryKey: ['jobs'] }),
    queryClient.invalidateQueries({ queryKey: ['review-queue'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
  ]);
}

export function jobKeys(jobId: string) {
  return {
    all: ['job', jobId] as const,
    detail: ['job', jobId, 'detail'] as const,
    events: ['job', jobId, 'events'] as const,
    attempts: ['job', jobId, 'attempts'] as const,
    assignments: ['job', jobId, 'assignments'] as const,
    inspections: ['job', jobId, 'inspections'] as const,
    evidence: ['job', jobId, 'evidence'] as const,
    amendments: ['job', jobId, 'amendments'] as const,
    traces: (inspectionId: string) => ['job', jobId, 'traces', inspectionId] as const,
    custody: (subjects: string[]) => ['job', jobId, 'custody', subjects] as const,
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────────────────────
export function useJob(jobId: string) {
  return useQuery({
    queryKey: jobKeys(jobId).detail,
    queryFn: () => fetchMaybeRow<JobDetailRow>(pos().from('jobs').select(JOB_DETAIL_SELECT).eq('id', jobId).maybeSingle()),
    enabled: isUuid(jobId),
  });
}

export function useJobFormContext(bankId: string | null | undefined) {
  const bank = isUuid(bankId) ? bankId : null;
  return useQuery({
    queryKey: ['job-form-context', bank],
    queryFn: () => callRpc<JobFormContext>('admin_job_form_context', { p_bank_id: bank }),
    enabled: bank !== null,
    staleTime: 5 * 60_000,
  });
}

const DEFINITION_VERSION_SELECT = 'id,family_id,version,definition,definition_hash,published_at,family:definition_families(key,title,kind)';

/** Published definition versions by id (immutable → cached for long). */
export function useDefinitionVersions(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => isUuid(x)))].sort();
  return useQuery({
    queryKey: ['definition-versions', unique],
    queryFn: () => fetchRows<DefinitionVersionRow>(pos().from('definition_versions').select(DEFINITION_VERSION_SELECT).in('id', unique)),
    enabled: unique.length > 0,
    staleTime: 30 * 60_000,
  });
}

export function useJobEvents(jobId: string) {
  return useQuery({
    queryKey: jobKeys(jobId).events,
    queryFn: () =>
      fetchRows<JobEventRow>(
        pos().from('job_events').select('*,actor:pos_users(first_name,last_name,employee_number)').eq('job_id', jobId).order('created_at').limit(1000),
      ),
  });
}

export function useAppointmentAttempts(jobId: string) {
  return useQuery({
    queryKey: jobKeys(jobId).attempts,
    queryFn: () =>
      fetchRows<AttemptRow>(
        pos().from('appointment_attempts').select('*,by:pos_users(first_name,last_name)').eq('job_id', jobId).order('attempted_at', { ascending: false }),
      ),
  });
}

export function useJobAssignments(jobId: string) {
  return useQuery({
    queryKey: jobKeys(jobId).assignments,
    queryFn: () =>
      fetchRows<AssignmentRow>(
        pos()
          .from('job_assignments')
          .select(
            '*,agent:pos_users!job_assignments_user_id_fkey(first_name,last_name,employee_number),by:pos_users!job_assignments_assigned_by_fkey(first_name,last_name)',
          )
          .eq('job_id', jobId)
          .order('assigned_at', { ascending: false }),
      ),
  });
}

export function useJobInspections(jobId: string) {
  return useQuery({
    queryKey: jobKeys(jobId).inspections,
    queryFn: () =>
      fetchRows<InspectionRow>(
        pos()
          .from('inspections')
          .select('*,agent:pos_users(first_name,last_name,employee_number),reviews(*,reviewer:pos_users(first_name,last_name))')
          .eq('job_id', jobId)
          .order('attempt'),
      ),
    refetchInterval: 60_000,
  });
}

export function useJobEvidence(jobId: string) {
  return useQuery({
    queryKey: jobKeys(jobId).evidence,
    queryFn: () => fetchRows<Evidence>(pos().from('evidence').select('*').eq('job_id', jobId).order('captured_at_device').limit(1000)),
    refetchInterval: 60_000,
  });
}

export function useJobAmendments(jobId: string, inspectionIds: string[]) {
  const ids = [...inspectionIds].sort();
  return useQuery({
    queryKey: [...jobKeys(jobId).amendments, ids],
    queryFn: () =>
      fetchRows<AmendmentRow>(
        pos().from('amendments').select('*,author:pos_users(first_name,last_name)').in('inspection_id', ids).order('created_at'),
      ),
    enabled: ids.length > 0,
  });
}

export function useInspectionTraces(jobId: string, inspectionId: string | null) {
  return useQuery({
    queryKey: jobKeys(jobId).traces(inspectionId ?? 'none'),
    queryFn: () =>
      fetchRows<LocationTrace>(
        pos().from('location_traces').select('*').eq('inspection_id', inspectionId ?? '').order('ts_device').limit(5000),
      ),
    enabled: isUuid(inspectionId),
  });
}

/** Custody events for a set of subjects (inspection, its evidence, its envelopes, the job), ordered by server time. */
export function useCustodyEvents(jobId: string, subjectIds: string[]) {
  const ids = [...new Set(subjectIds.filter(isUuid))].sort();
  return useQuery({
    queryKey: jobKeys(jobId).custody(ids),
    queryFn: () => fetchRows<CustodyEvent>(pos().from('custody_events').select('*').in('subject_id', ids).order('at_server').limit(3000)),
    enabled: ids.length > 0,
  });
}

// ── Status-based action availability (docs/06 §2) ─────────────────────────────────────────────
export const CORE_EDITABLE: readonly JobStatus[] = ['pending', 'scheduled'];
export const LOCATION_TYPE_EDITABLE: readonly JobStatus[] = ['pending', 'scheduled', 'assigned', 'accepted'];
export const CANCELLABLE: readonly JobStatus[] = [
  'pending', 'scheduled', 'assigned', 'accepted', 'in_progress', 'paused', 'returned', 'unable_to_complete',
];
export const CLOSABLE: readonly JobStatus[] = ['approved', 'rejected', 'unable_to_complete', 'appointment_not_secured', 'cancelled'];
export const RESCHEDULABLE: readonly JobStatus[] = ['scheduled', 'assigned', 'accepted'];
export const ATTEMPT_LOGGABLE: readonly JobStatus[] = ['pending', 'scheduled', 'assigned', 'accepted'];
