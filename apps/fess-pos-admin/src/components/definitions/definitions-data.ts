// Reads, query keys and pure helpers for the definitions studio (docs/04 §2, §7, §9).
import { ClipboardList, ListChecks, type LucideIcon, MessageSquareText, PanelTop, Route, Smartphone } from 'lucide-react';
import { humanLabel } from '@/components/structured-view';
import { fetchMaybeRow, fetchRows, pos } from '@/lib/supabase';
import type {
  ActivationAudience,
  ApprovalSubjectType,
  DefinitionActivation,
  DefinitionDraft,
  DefinitionFamily,
  DefinitionKind,
  DefinitionTestCase,
  DefinitionTestRun,
  DefinitionVersion,
  JsonObject,
} from '@/lib/types';

/** Query keys — everything under ['definitions'] so one prefix invalidation refreshes the studio. */
export const defKeys = {
  all: ['definitions'] as const,
  families: ['definitions', 'families'] as const,
  versionsLite: ['definitions', 'versions_lite'] as const,
  activationsAll: ['definitions', 'activations_all'] as const,
  draftsLite: ['definitions', 'drafts_lite'] as const,
  family: (id: string) => ['definitions', 'family', id] as const,
  versions: (familyId: string) => ['definitions', 'versions', familyId] as const,
  version: (versionId: string) => ['definitions', 'version', versionId] as const,
  activations: (familyId: string) => ['definitions', 'activations', familyId] as const,
  draft: (familyId: string) => ['definitions', 'draft', familyId] as const,
  testCases: (familyId: string, archived: boolean) => ['definitions', 'test_cases', familyId, archived] as const,
  testRuns: (versionId: string) => ['definitions', 'test_runs', versionId] as const,
  approvals: ['approvals'] as const,
};

/** A version row without the (possibly large) definition document. */
export type VersionLite = Omit<DefinitionVersion, 'definition' | 'analysis'>;

const VERSION_LITE_COLS =
  'id,family_id,version,spec_version,definition_hash,requires,changelog,breaking,previous_version_id,published_by,approved_by,published_at';

export const fetchFamilies = () =>
  fetchRows<DefinitionFamily>(pos().from('definition_families').select('*').order('kind').order('key'));

export const fetchFamily = (id: string) =>
  fetchMaybeRow<DefinitionFamily>(pos().from('definition_families').select('*').eq('id', id).maybeSingle());

export const fetchAllVersionsLite = () =>
  fetchRows<Pick<DefinitionVersion, 'id' | 'family_id' | 'version' | 'published_at'>>(
    pos().from('definition_versions').select('id,family_id,version,published_at'),
  );

export const fetchAllActivations = () =>
  fetchRows<DefinitionActivation>(
    pos().from('definition_activations').select('*').order('effective_from', { ascending: false }).order('created_at', { ascending: false }),
  );

export const fetchAllDraftsLite = () =>
  fetchRows<Pick<DefinitionDraft, 'family_id' | 'updated_at' | 'updated_by'>>(
    pos().from('definition_drafts').select('family_id,updated_at,updated_by'),
  );

export const fetchVersions = (familyId: string) =>
  fetchRows<VersionLite>(
    pos().from('definition_versions').select(VERSION_LITE_COLS).eq('family_id', familyId).order('version', { ascending: false }),
  );

export const fetchVersion = (versionId: string) =>
  fetchMaybeRow<DefinitionVersion>(pos().from('definition_versions').select('*').eq('id', versionId).maybeSingle());

export const fetchActivations = (familyId: string) =>
  fetchRows<DefinitionActivation>(
    pos()
      .from('definition_activations')
      .select('*')
      .eq('family_id', familyId)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false }),
  );

export const fetchDraft = (familyId: string) =>
  fetchMaybeRow<DefinitionDraft>(pos().from('definition_drafts').select('*').eq('family_id', familyId).maybeSingle());

export const fetchTestCases = (familyId: string, archived: boolean) => {
  const q = pos().from('definition_test_cases').select('*').eq('family_id', familyId);
  return fetchRows<DefinitionTestCase>((archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null)).order('name'));
};

export const fetchTestRuns = (versionId: string) =>
  fetchRows<DefinitionTestRun>(
    pos().from('definition_test_runs').select('*').eq('version_id', versionId).order('run_at', { ascending: false }),
  );

// ── Approvals (four-eyes, D-31) ─────────────────────────────────────────────────────────────────
/** A pending request with the payload fields the panel summarises (the full payload is fetched on demand). */
export interface PendingApproval {
  id: string;
  subject_type: ApprovalSubjectType;
  subject_ref: string | null;
  requested_by: string | null;
  note: string | null;
  at: string;
  bank_id: string | null;
  family_id: string | null;
  kind: string | null;
  key: string | null;
  changelog: { added?: unknown[]; removed?: unknown[]; changed?: unknown[]; note?: string } | null;
  breaking: boolean | null;
  version: number | null;
  audience: ActivationAudience | null;
  layer: string | null;
  subject_id: string | null;
  changed_integrity_keys: string[] | null;
  reason: string | null;
  base_version: number | null;
  effective_from: string | null;
}

const APPROVAL_COLS = [
  'id',
  'subject_type',
  'subject_ref',
  'requested_by',
  'note',
  'at',
  'bank_id:payload->>bank_id',
  'family_id:payload->>family_id',
  'kind:payload->>kind',
  'key:payload->>key',
  'changelog:payload->changelog',
  'breaking:payload->breaking',
  'version:payload->version',
  'audience:payload->audience',
  'layer:payload->>layer',
  'subject_id:payload->>subject_id',
  'changed_integrity_keys:payload->changed_integrity_keys',
  'reason:payload->>reason',
  'base_version:payload->base_version',
  'effective_from:payload->>effective_from',
].join(',');

/** Pending requests (decision = pending) that no decision row references yet, newest first. */
export async function fetchPendingApprovals(): Promise<PendingApproval[]> {
  const [requests, decided] = await Promise.all([
    fetchRows<PendingApproval>(
      pos().from('approvals').select(APPROVAL_COLS).eq('decision', 'pending').is('request_ref', null).order('at', { ascending: false }),
    ),
    fetchRows<{ request_ref: string }>(pos().from('approvals').select('request_ref').not('request_ref', 'is', null)),
  ]);
  const done = new Set(decided.map((d) => d.request_ref));
  return requests.filter((r) => !done.has(r.id));
}

export const fetchApprovalPayload = (id: string) =>
  fetchMaybeRow<{ payload: JsonObject }>(pos().from('approvals').select('payload').eq('id', id).maybeSingle());

// ── Pure helpers ────────────────────────────────────────────────────────────────────────────────
// The pieces of "Inspection set-up" in plain words (docs/17 §4.6). Internal kind values never change; only what people
// read. `app` is the whole agent app (pages and tabs); `view` is one screen's layout, used by the app's pages.
export const KIND_LABEL: Record<DefinitionKind, string> = {
  job_schema: 'Job information',
  form: 'Questions',
  flow: 'Visit steps',
  app: 'App screens',
  view: 'Screen layouts',
  content: 'Wording',
};

/** One piece of a kind, in plain words (used as a badge and in sentences). */
export const KIND_SINGULAR: Record<DefinitionKind, string> = {
  job_schema: 'Job information',
  form: 'Questions',
  flow: 'Visit steps',
  app: 'App screens',
  view: 'Screen layout',
  content: 'Wording',
};

/** One sentence per piece: what it is and who fills it in. */
export const KIND_DESCRIPTION: Record<DefinitionKind, string> = {
  job_schema: 'What the office fills in when it creates a job, such as the merchant’s details and the visit window.',
  form: 'What the agent answers on site: the checklist, the photos and the signature.',
  flow: 'The order the agent goes through during a visit, from arriving to sending it in.',
  app: 'What the agent sees outside a visit: the start page, the tabs and the job pages.',
  view: 'What one screen of the app shows, from top to bottom. The app screens use these.',
  content: 'The words the app uses, such as messages and button labels.',
};

/** Who fills each piece in, and when (docs/17 §4.6). */
export const KIND_WHO: Record<DefinitionKind, string> = {
  job_schema: 'Filled in by the office, when it creates a job',
  form: 'Answered by the agent, on site during the visit',
  flow: 'Nobody fills it in: it guides the agent through the visit',
  app: 'Nobody fills it in: it’s what the agent sees outside a visit',
  view: 'Nobody fills it in: each app screen uses one',
  content: 'Nobody fills it in: the app reads it everywhere',
};

/** A picture for each piece, used in the set-up map and the piece guide. */
export const KIND_ICON: Record<DefinitionKind, LucideIcon> = {
  job_schema: ClipboardList,
  form: ListChecks,
  flow: Route,
  app: Smartphone,
  view: PanelTop,
  content: MessageSquareText,
};

/** Link to one tab of a piece's page (the page keeps its tab in `?tab=`), e.g. "Where it's live" after publishing. */
export const familyTabHref = (familyId: string, tab: 'draft' | 'versions' | 'activations' | 'tests') => `/definitions/${familyId}?tab=${tab}`;

/** The order the pieces are listed in: the order an office user meets them. */
export const KIND_ORDER: readonly DefinitionKind[] = ['job_schema', 'form', 'flow', 'app', 'view', 'content'];

/** Whether an activation is in effect at `now`. */
export function isInEffect(a: Pick<DefinitionActivation, 'effective_from' | 'effective_to'>, now: number): boolean {
  return Date.parse(a.effective_from) <= now && (a.effective_to === null || Date.parse(a.effective_to) > now);
}

/**
 * Activations in effect now that can still match someone, newest first (effective_from desc, created_at desc):
 * resolution takes the first whose audience matches, so everything after the first `all` is shadowed.
 */
export function liveActivations(activations: DefinitionActivation[], now: number): DefinitionActivation[] {
  const sorted = [...activations]
    .filter((a) => isInEffect(a, now))
    .sort((x, y) => Date.parse(y.effective_from) - Date.parse(x.effective_from) || Date.parse(y.created_at) - Date.parse(x.created_at));
  const out: DefinitionActivation[] = [];
  for (const a of sorted) {
    out.push(a);
    if (a.audience.type === 'all') break;
  }
  return out;
}

/** The activation in force for everyone (audience all) now, if any. */
export function currentAllActivation(activations: DefinitionActivation[], now: number): DefinitionActivation | undefined {
  const live = liveActivations(activations, now);
  const last = live[live.length - 1];
  return last?.audience.type === 'all' ? last : undefined;
}

/** Who gets a version: "All agents" / "3 chosen agents" / "10% of agents" / "Agents with Region: GP, WC". */
export function audienceLabel(audience: ActivationAudience | null | undefined): string {
  if (!audience) return '—';
  switch (audience.type) {
    case 'all':
      return 'All agents';
    case 'agents':
      return `${audience.user_ids.length} chosen agent${audience.user_ids.length === 1 ? '' : 's'}`;
    case 'percent':
      return `${audience.percent}% of agents`;
    case 'attribute':
      return `Agents with ${humanLabel(audience.key)}: ${audience.values.join(', ')}`;
    default:
      return 'Some agents';
  }
}

/**
 * "Live for Bank ABC" (a bank's own set-up, for all its agents), "Live for all banks" (shared set-up), or
 * "Live for 10% of agents" (a gradual roll-out). `bankName` is the name of the bank the piece belongs to (null = all banks).
 */
export function liveForLabel(audience: ActivationAudience | null | undefined, bankName: string | null | undefined): string {
  if (audience?.type === 'all') return `Live for ${bankName || 'all banks'}`;
  return `Live for ${audienceLabel(audience).replace(/^A/, 'a')}`;
}

/** What happens on a phone whose app is too old for the version. */
export const POLICY_LABEL: Record<string, string> = {
  block: 'Stop the agent until the app is updated',
  fallback_version: 'Use the newest version that phone can show',
  field_fallback: 'Show simpler questions where needed',
};

/** Changelog counts from a stored/returned changelog object. */
export function changelogCounts(changelog: unknown): { added: number; removed: number; changed: number } {
  const c = (changelog ?? {}) as Record<string, unknown>;
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return { added: len(c.added), removed: len(c.removed), changed: len(c.changed) };
}

/**
 * A minimal starting document for a new family of each kind (the analyser decides what is valid). `version` is the
 * document's own positive integer (required by the engine schema); the stored version number is assigned by the server.
 * Form and content templates pass analysis as-is; flow, job schema, view and app need at least one element added.
 */
export function templateFor(kind: DefinitionKind, key: string, title: string): JsonObject {
  const base = { kind, spec_version: '1.0', family: key, version: 1, title };
  switch (kind) {
    case 'form':
      return { ...base, sections: [{ key: 'main', title: 'Main', fields: [] }] };
    case 'flow':
      return { ...base, steps: [] };
    case 'job_schema':
      return { ...base, attributes: [] };
    case 'view':
      return { ...base, items: [] };
    case 'content':
      return { ...base, locale: 'en-ZA', strings: {} };
    case 'app':
      return { ...base, home: 'home', pages: {} };
    default:
      return base;
  }
}
