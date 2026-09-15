'use client';

// Inspections tab: every attempt (side by side when comparing two), with answers rendered by section and field
// label from the pinned form definition, amendments overlaid, manifest completeness, geofence result, integrity
// flags, and the review decision / amend actions.
import { AlertOctagon, Clock, Pencil, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Details } from '@/components/details';
import { EmptyState } from '@/components/empty-state';
import { DateTime } from '@/components/date-time';
import { JsonView } from '@/components/json-view';
import { AmendDialog } from '@/components/review/amend-dialog';
import { ReviewPanel } from '@/components/review/review-decision';
import { InspectionStatusBadge } from '@/components/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatDuration, fullName, humanize, shortId } from '@/lib/format';
import { Advanced, useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import type { Evidence } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';
import { EvidenceThumb, useLightbox } from './evidence-gallery';
import { FlagBadges, KeyValues, SectionCard } from './job-bits';
import {
  type AmendmentRow,
  type AnswerEntry,
  answersMap,
  type DefinitionVersionRow,
  formatAddress,
  type FormFieldDef,
  formSections,
  type InspectionRow,
  objOf,
  stableJson,
  strOf,
  toNumber,
} from './job-data';

const CLOCK_DRIFT_MS = 5 * 60_000;
/** Display-only field types that never carry an answer. */
const DISPLAY_ONLY = ['callout', 'heading', 'divider', 'paragraph', 'spacer', 'info', 'section_title', 'image_display'];
const INTEGRITY_SIGNALS = ['rooted', 'mock_location', 'emulator', 'hooked', 'debugger', 'tampered'];

// ── Answer values ─────────────────────────────────────────────────────────────────────────────
function isIdList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** "Given: Yes · At: 12 Sept 2026, 01:42". Basic view leaves out technical ids (UUIDs, *_id keys). */
function flatObjectText(o: Record<string, unknown>, advanced: boolean): string | null {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (!advanced && ((typeof v === 'string' && UUID_RE.test(v)) || /(^|_)id$/.test(k))) continue;
    if (typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v))) {
      parts.push(`${humanize(k)}: ${formatDateTime(v)}`);
    } else if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      parts.push(`${humanize(k)}: ${v === true ? 'Yes' : v === false ? 'No' : String(v ?? '—')}`);
    } else if (isPlainObject(v) && typeof v.open === 'string' && typeof v.close === 'string') {
      parts.push(`${humanize(k)}: ${v.open}–${v.close}`);
    } else return null;
  }
  return parts.join(' · ');
}

/** Human rendering of an answer value by field type (options → labels, photos → thumbnails, …). */
export function AnswerValue({
  field,
  value,
  evidenceById,
  onOpenEvidence,
}: {
  field: FormFieldDef | null;
  value: unknown;
  evidenceById: Map<string, Evidence>;
  onOpenEvidence: (ids: string[], index: number) => void;
}) {
  const advanced = useIsAdvanced();
  const type = field?.type ?? '';
  if (value === undefined || value === null || value === '') return <span className="text-muted-foreground">—</span>;
  if ((type === 'photo' || type === 'signature' || type.endsWith('_photo')) && (isIdList(value) || typeof value === 'string')) {
    const ids = typeof value === 'string' ? [value] : value;
    return (
      <div className="flex flex-wrap gap-2">
        {ids.map((id, i) => (
          <EvidenceThumb key={id} evidenceId={id} evidence={evidenceById.get(id)} className="size-20" onOpen={() => onOpenEvidence(ids, i)} />
        ))}
      </div>
    );
  }
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  const optionLabel = (x: unknown) => field?.options.find((o) => o.value === String(x))?.label ?? String(x);
  if (Array.isArray(value) && value.every((x) => typeof x === 'string' || typeof x === 'number')) {
    return <>{value.map(optionLabel).join(', ') || '—'}</>;
  }
  if (typeof value === 'number') return <>{type === 'percentage' ? `${value}%` : String(value)}</>;
  if (typeof value === 'string') return <span className="whitespace-pre-wrap">{field?.options.length ? optionLabel(value) : value}</span>;
  if (isPlainObject(value)) {
    if (typeof value.accepted === 'boolean' && 'accepted_at' in value) {
      return (
        <>
          {value.accepted ? 'Accepted' : 'Not accepted'} · {formatDateTime(strOf(value, 'accepted_at'))}
          {advanced && strOf(value, 'declaration_version_id') ? <span className="text-muted-foreground"> · version {shortId(strOf(value, 'declaration_version_id'))}</span> : null}
        </>
      );
    }
    if (typeof value.value === 'number' && typeof value.unit === 'string' && Object.keys(value).length === 2) return <>{`${value.value} ${value.unit}`}</>;
    if (typeof value.line1 === 'string') return <>{formatAddress(value)}</>;
    const flat = flatObjectText(value, advanced);
    if (flat) return <>{flat}</>;
  }
  return <JsonView value={value} defaultExpandDepth={1} maxHeight={200} copyable={false} />;
}

function metaBadges(meta: Record<string, unknown>, advanced: boolean): ReactNode {
  const badges: ReactNode[] = [];
  if (meta.flagged_differs === true) badges.push(<Badge key="f" tone="warning">The agent says this is different</Badge>);
  if (advanced) {
    if (meta.computed === true) badges.push(<Badge key="c" tone="neutral">computed</Badge>);
    if (meta.prefilled === true) badges.push(<Badge key="p" tone="neutral">prefilled</Badge>);
    if (typeof meta.rendered_as === 'string') badges.push(<Badge key="r" tone="info" title="Captured with a fallback component (docs/04 §8)">rendered as {meta.rendered_as}</Badge>);
  }
  return badges.length ? <span className="inline-flex flex-wrap gap-1">{badges}</span> : null;
}

function valueText(v: unknown, field?: FormFieldDef | null): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const label = (x: unknown) => field?.options.find((o) => o.value === String(x))?.label ?? String(x);
  if (typeof v === 'string' || typeof v === 'number') return label(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.map(label).join(', ');
  return JSON.stringify(v);
}

interface AnswerRowProps {
  fieldKey: string;
  label: string;
  field: FormFieldDef | null;
  entry: AnswerEntry | undefined;
  amendments: AmendmentRow[];
  differs: boolean;
  otherAttempt: number | null;
  evidenceById: Map<string, Evidence>;
  onOpenEvidence: (ids: string[], index: number) => void;
  onAmend: (() => void) | null;
}

function AnswerRow({ fieldKey, label, field, entry, amendments, differs, otherAttempt, evidenceById, onOpenEvidence, onAmend }: AnswerRowProps) {
  const advanced = useIsAdvanced();
  const latest = amendments[amendments.length - 1];
  const extraMeta = entry ? Object.entries(entry.meta).filter(([k]) => !['computed', 'prefilled', 'flagged_differs', 'rendered_as'].includes(k)) : [];
  return (
    <div className={cn('grid gap-1 border-t py-3 first:border-t-0 sm:grid-cols-[minmax(9rem,38%)_1fr]', differs && 'bg-amber-50/60')}>
      <div className="min-w-0 pr-2">
        <div className="text-sm text-muted-foreground">{label}</div>
        {advanced ? <code className="text-xs text-muted-foreground">{fieldKey}</code> : null}
      </div>
      <div className="min-w-0 space-y-1 text-base">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <AnswerValue field={field} value={entry?.v} evidenceById={evidenceById} onOpenEvidence={onOpenEvidence} />
          </div>
          {onAmend ? (
            <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={onAmend} title="Correct this answer" aria-label={`Correct ${label}`}>
              <Pencil /> Correct
            </Button>
          ) : null}
        </div>
        {entry ? metaBadges(entry.meta, advanced) : null}
        {advanced && extraMeta.length ? <div className="text-xs text-muted-foreground">{extraMeta.map(([k, v]) => `${humanize(k)}: ${valueText(v)}`).join(' · ')}</div> : null}
        {differs && otherAttempt !== null ? <Badge tone="warning">Different from visit {otherAttempt}</Badge> : null}
        {latest ? (
          <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
            <span className="font-medium">Corrected</span> from “<span className="break-all">{valueText(latest.old_value, field)}</span>” to “
            <span className="break-all font-medium">{valueText(latest.new_value, field)}</span>” by {latest.author ? fullName(latest.author) : 'a reviewer'} · {formatDateTime(latest.created_at)} —{' '}
            <span className="italic">{latest.justification}</span>
            {amendments.length > 1 ? <span className="text-violet-700"> ({amendments.length - 1} earlier correction{amendments.length > 2 ? 's' : ''})</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function collectKeys(fields: FormFieldDef[], into: Set<string>) {
  for (const f of fields) {
    into.add(f.key);
    collectKeys(f.fields, into);
  }
}

/** Answers by section and field label from the pinned form definition; unknown keys under "Other answers". */
function InspectionAnswers({
  insp,
  definition,
  evidenceById,
  amendments,
  other,
  canAmend,
  onAmend,
}: {
  insp: InspectionRow;
  definition: DefinitionVersionRow | undefined;
  evidenceById: Map<string, Evidence>;
  amendments: AmendmentRow[];
  other: InspectionRow | null;
  canAmend: boolean;
  onAmend: (fieldKey: string, label: string, current: unknown, field: FormFieldDef | null) => void;
}) {
  const lightbox = useLightbox();
  const usingSnapshot = !insp.answers && !!insp.snapshot_answers;
  const answers = useMemo(() => answersMap(insp.answers ?? insp.snapshot_answers), [insp.answers, insp.snapshot_answers]);
  const otherAnswers = useMemo(() => (other ? answersMap(other.answers ?? other.snapshot_answers) : null), [other]);
  const sections = useMemo(() => formSections(definition?.definition), [definition]);
  const known = useMemo(() => {
    const s = new Set<string>();
    for (const sec of sections) collectKeys(sec.fields, s);
    return s;
  }, [sections]);
  const unknownKeys = Object.keys(answers).filter((k) => !known.has(k));
  const amendByField = useMemo(() => {
    const m = new Map<string, AmendmentRow[]>();
    for (const a of amendments) m.set(a.field_key, [...(m.get(a.field_key) ?? []), a]);
    return m;
  }, [amendments]);

  const openEvidence = (ids: string[], index: number) => {
    const items = ids.map((id) => evidenceById.get(id)).filter((e): e is Evidence => !!e);
    const target = evidenceById.get(ids[index] ?? '');
    lightbox.open(items, target ? Math.max(0, items.indexOf(target)) : 0);
  };

  const row = (key: string, label: string, field: FormFieldDef | null) => {
    const entry = answers[key];
    const differs = !!otherAnswers && stableJson(entry?.v) !== stableJson(otherAnswers[key]?.v);
    return (
      <AnswerRow
        key={key}
        fieldKey={key}
        label={label}
        field={field}
        entry={entry}
        amendments={amendByField.get(key) ?? []}
        differs={differs}
        otherAttempt={other?.attempt ?? null}
        evidenceById={evidenceById}
        onOpenEvidence={openEvidence}
        onAmend={canAmend && entry ? () => onAmend(key, label, entry.v, field) : null}
      />
    );
  };

  if (Object.keys(answers).length === 0) {
    return <p className="text-sm text-muted-foreground">No answers have arrived for this visit yet.</p>;
  }

  return (
    <div className="space-y-4">
      {usingSnapshot ? (
        <Alert variant="info">
          <Clock />
          <AlertDescription>These are the answers so far, saved by the agent’s phone during the visit. The visit hasn’t been sent in yet.</AlertDescription>
        </Alert>
      ) : null}
      {!definition ? (
        <p className="text-sm text-muted-foreground">We couldn’t load the questions for this visit, so the answers are listed by their internal names.</p>
      ) : null}
      {sections.map((sec) => {
        const fields = sec.fields.filter((f) => !(DISPLAY_ONLY.includes(f.type) && !(f.key in answers)));
        if (!fields.length) return null;
        return (
          <div key={sec.key}>
            <h4 className="mb-1.5 text-sm font-semibold">{sec.title}</h4>
            <div className="rounded-md border px-4">{fields.map((f) => row(f.key, f.label, f))}</div>
          </div>
        );
      })}
      {unknownKeys.length ? (
        <div>
          <h4 className="mb-1.5 text-sm font-semibold">{definition ? 'Other answers (not in the questions)' : 'Answers'}</h4>
          <div className="rounded-md border px-4">{unknownKeys.map((k) => row(k, humanize(k), null))}</div>
        </div>
      ) : null}
      {lightbox.element}
    </div>
  );
}

// ── Panels ────────────────────────────────────────────────────────────────────────────────────
function Progress({ value, max, tone }: { value: number; max: number; tone: 'success' | 'info' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full', tone === 'success' ? 'bg-emerald-500' : 'bg-sky-500')} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ManifestBlock({ insp }: { insp: InspectionRow }) {
  const advanced = useIsAdvanced();
  const { evidence_expected: expected, evidence_received: received, evidence_verified: verified } = insp;
  const outstanding = expected - received;
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex justify-between">
            <span>Received</span>
            <span className="tabular-nums">
              {received} / {expected}
            </span>
          </div>
          <Progress value={received} max={expected} tone="info" />
        </div>
        <div>
          <div className="mb-1 flex justify-between">
            <span>Passed the security check</span>
            <span className="tabular-nums">
              {verified} / {expected}
            </span>
          </div>
          <Progress value={verified} max={expected} tone="success" />
        </div>
      </div>
      {expected === 0 && !insp.submitted_at_server ? (
        <p className="text-muted-foreground">The list of photos to expect arrives when the visit is sent in.</p>
      ) : outstanding > 0 ? (
        <p className="text-amber-700">
          Waiting for {outstanding} of {expected} photo{expected === 1 ? '' : 's'} and file{expected === 1 ? '' : 's'} from {advanced ? `device ${shortId(insp.device_id)}` : 'the agent’s phone'}. You can read the answers meanwhile; approval waits until everything is checked.
        </p>
      ) : insp.status === 'integrity_failed' || insp.flags.includes('evidence_quarantined') ? (
        <p className="text-red-700">
          Everything has arrived, but at least one photo or file failed the security check: the copy we hold doesn’t match what the
          agent’s phone took. See Security checks before deciding.
        </p>
      ) : verified < expected ? (
        <p className="text-sky-700">Everything has arrived. The security check is running.</p>
      ) : (
        <p className="text-emerald-700">Complete: every photo and file arrived and passed the security check.</p>
      )}
    </div>
  );
}

function GeofenceBlock({ insp, evidenceById, onOpenEvidence }: { insp: InspectionRow; evidenceById: Map<string, Evidence>; onOpenEvidence: (ids: string[]) => void }) {
  const gr = isPlainObject(insp.geofence_result) ? insp.geofence_result : null;
  if (!gr) return <p className="text-sm text-muted-foreground">No location check was recorded.</p>;
  const params = objOf(gr, 'profile_params');
  const fix = objOf(gr, 'fix');
  const checkin = objOf(gr, 'checkin_fix');
  const od = objOf(gr, 'override_detail');
  const photos = od && isIdList(od.photo_evidence_ids) ? od.photo_evidence_ids : [];
  const method = strOf(gr, 'method');
  return (
    <GeofenceDetail gr={gr} params={params} fix={fix} checkin={checkin} od={od} photos={photos} method={method} evidenceById={evidenceById} onOpenEvidence={onOpenEvidence} />
  );
}

function GeofenceDetail({
  gr,
  params,
  fix,
  checkin,
  od,
  photos,
  method,
  evidenceById,
  onOpenEvidence,
}: {
  gr: Record<string, unknown>;
  params: Record<string, unknown> | null;
  fix: Record<string, unknown> | null;
  checkin: Record<string, unknown> | null;
  od: Record<string, unknown> | null;
  photos: string[];
  method: string;
  evidenceById: Map<string, Evidence>;
  onOpenEvidence: (ids: string[]) => void;
}) {
  const advanced = useIsAdvanced();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {gr.passed === true ? <Badge tone="success">At the site</Badge> : <Badge tone="danger">Not confirmed at the site</Badge>}
        {advanced && method ? <Badge tone={method === 'outside_fix' ? 'warning' : 'neutral'}>{method === 'outside_fix' ? 'Checked from outside' : 'Checked from inside'}</Badge> : null}
        {advanced && gr.relaxed === true ? <Badge tone="warning">Relaxed site-area rules</Badge> : null}
        {gr.override === true ? <Badge tone="danger">Started outside the site area</Badge> : null}
      </div>
      <KeyValues
        items={[
          ['Distance from the merchant', toNumber(gr.distance_m) !== null ? `${Math.round(toNumber(gr.distance_m) ?? 0)} m` : null],
          ['Site area', params ? `${toNumber(params.radius_m) ?? '—'} m around the pin` : null],
          ['GPS accuracy', fix && toNumber(fix.accuracy_m) !== null ? `± ${Math.round(toNumber(fix.accuracy_m) ?? 0)} m${fix.is_mocked === true ? ' (fake location)' : ''}` : null],
          ...(advanced
            ? ([
                ['Site-area rules', `${humanize(strOf(gr, 'profile'))}${params ? ` · ${toNumber(params.radius_m) ?? '—'} m site area, GPS accurate to ${toNumber(params.max_accuracy_m) ?? '—'} m` : ''}`],
                ['Location taken at', fix ? formatDateTime(strOf(fix, 'ts'), { seconds: true }) : null],
                ['Check-in location', checkin ? `${formatDateTime(strOf(checkin, 'ts'))} · ± ${toNumber(checkin.accuracy_m) ?? '—'} m` : null],
                ['Measured for', toNumber(gr.sampled_seconds) !== null ? `${toNumber(gr.sampled_seconds)} s` : null],
              ] as [ReactNode, ReactNode][])
            : []),
        ]}
      />
      {od ? (
        <div className="space-y-2 rounded-md border border-red-200 bg-red-50/60 p-3 text-sm">
          <div className="font-medium text-red-800">Started outside the site area</div>
          <KeyValues
            items={[
              ['Reason', advanced ? <code key="r">{strOf(od, 'reason_code') || '—'}</code> : humanize(strOf(od, 'reason_code'))],
              ['Distance', toNumber(od.distance_m) !== null ? `${Math.round(toNumber(od.distance_m) ?? 0)} m (allowed up to ${Math.round(toNumber(od.allowed_max_m) ?? 0)} m)` : null],
              ['Note', strOf(od, 'note')],
            ]}
          />
          {photos.length ? (
            <div className="flex flex-wrap gap-2">
              {photos.map((id) => (
                <EvidenceThumb key={id} evidenceId={id} evidence={evidenceById.get(id)} className="size-16" onOpen={() => onOpenEvidence(photos)} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function IntegrityBlock({ insp }: { insp: InspectionRow }) {
  const advanced = useIsAdvanced();
  const integ = isPlainObject(insp.integrity) ? insp.integrity : null;
  const signals = INTEGRITY_SIGNALS.filter((k) => integ?.[k] === true);
  const attestation = objOf(integ, 'attestation');
  return (
    <div className="space-y-2 text-sm">
      <FlagBadges flags={insp.flags} empty={<span className="text-emerald-700">No problems found.</span>} />
      {!advanced && signals.length ? <p className="text-red-700">The phone reported a security problem ({signals.map((s) => humanize(s).toLowerCase()).join(', ')}).</p> : null}
      {advanced && integ ? (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">Warnings from the phone:</span>
          {signals.length ? signals.map((s) => <Badge key={s} tone="danger">{humanize(s)}</Badge>) : <Badge tone="success">None raised</Badge>}
          {attestation ? <span className="text-muted-foreground">· attestation {strOf(attestation, 'provider') || 'none'}{strOf(attestation, 'verdict') ? ` (${strOf(attestation, 'verdict')})` : ''}</span> : null}
        </div>
      ) : null}
      {advanced && integ ? (
        <Details summary="Full security report from the phone">
          <JsonView value={integ} defaultExpandDepth={1} maxHeight={240} />
        </Details>
      ) : null}
    </div>
  );
}

function InspectionPanel({
  jobId,
  bankId,
  insp,
  evidence,
  evidenceById,
  definition,
  amendments,
  other,
  highlighted,
}: {
  jobId: string;
  bankId: string;
  insp: InspectionRow;
  evidence: Evidence[];
  evidenceById: Map<string, Evidence>;
  definition: DefinitionVersionRow | undefined;
  amendments: AmendmentRow[];
  other: InspectionRow | null;
  highlighted: boolean;
}) {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const lightbox = useLightbox();
  const [amending, setAmending] = useState<{ key: string; label: string; current: unknown; field: FormFieldDef | null } | null>(null);
  const canAmend = staff.hasPermission('review_inspections');
  const drift = insp.clock_offset_ms !== null && Math.abs(insp.clock_offset_ms) > CLOCK_DRIFT_MS;
  const review = insp.reviews[0];
  const gr = isPlainObject(insp.geofence_result) ? insp.geofence_result : null;

  return (
    <div id={`inspection-${insp.id}`} className={cn('min-w-0 space-y-4 rounded-lg', highlighted && 'ring-2 ring-primary/40 ring-offset-2')}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">Visit {insp.attempt}</h3>
        <InspectionStatusBadge status={insp.status} />
        <Advanced>
          {gr?.relaxed === true ? <Badge tone="warning">Relaxed site-area rules</Badge> : null}
          {strOf(gr, 'method') === 'outside_fix' ? <Badge tone="warning">Checked from outside</Badge> : null}
        </Advanced>
        {insp.flags.includes('geofence_override') ? <Badge tone="danger">{advanced ? 'Geofence override' : 'Started outside the site area'}</Badge> : null}
        {advanced && review ? <Badge tone={review.decision === 'approved' ? 'success' : review.decision === 'returned' ? 'warning' : 'danger'}>Reviewed: {humanize(review.decision)}</Badge> : null}
      </div>

      {insp.status === 'integrity_failed' ? (
        <Alert variant="destructive">
          <AlertOctagon />
          <AlertTitle>Failed a security check</AlertTitle>
          <AlertDescription>
            {advanced
              ? 'At least one photo or file failed verification, or another security check failed. You can still review the visit: check the warnings and the file hashes before deciding.'
              : 'At least one photo or file doesn’t match what the agent’s phone sent, so it may have been changed. You can still review this visit: check Security checks and the photos before deciding.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <SectionCard title="About this visit">
        <KeyValues
          items={[
            ['Agent', insp.agent ? fullName(insp.agent) : shortId(insp.user_id)],
            ...(advanced
              ? ([
                  ['Device', <span key="d" className="font-mono text-sm" title={insp.device_id}>{shortId(insp.device_id)} · {insp.client_type}</span>],
                  ['Started', <span key="s" className="text-sm">{formatDateTime(insp.started_at_device, { seconds: true })} (device)<br />{formatDateTime(insp.started_at_server, { seconds: true })} (server)</span>],
                  ['Sent in', <span key="u" className="text-sm">{formatDateTime(insp.submitted_at_device, { seconds: true })} (device)<br />{formatDateTime(insp.submitted_at_server, { seconds: true })} (server)</span>],
                ] as [ReactNode, ReactNode][])
              : ([
                  ['Started', formatDateTime(insp.started_at_server ?? insp.started_at_device)],
                  ['Sent in', insp.submitted_at_server || insp.submitted_at_device ? formatDateTime(insp.submitted_at_server ?? insp.submitted_at_device) : 'Not yet'],
                ] as [ReactNode, ReactNode][])),
            [
              advanced ? 'Clock offset' : 'Phone clock',
              insp.clock_offset_ms === null ? null : drift ? (
                <Badge key="c" tone="warning">
                  <Clock /> {advanced ? 'Device clock' : 'The phone’s clock was'} off by {formatDuration(Math.abs(insp.clock_offset_ms))}{advanced ? ' — device times may be wrong' : ''}
                </Badge>
              ) : advanced ? (
                `${Math.round(insp.clock_offset_ms / 1000)} s`
              ) : (
                'Correct'
              ),
            ],
            [
              'Questions',
              definition ? (
                <span key="f">
                  {staff.isAdmin ? (
                    <Link href={`/definitions/${definition.family_id}`} className="text-primary underline-offset-4 hover:underline">
                      {definition.family?.title ?? definition.family?.key ?? 'Questions'}
                    </Link>
                  ) : (
                    (definition.family?.title ?? definition.family?.key ?? 'Questions')
                  )}{' '}
                  (version {definition.version}){' '}
                  {advanced ? <span className="font-mono text-sm text-muted-foreground" title={insp.definition_hash ?? ''}>{shortId(insp.definition_hash, 8, 4)}</span> : null}
                  {insp.flags.includes('non_current_version') ? <Badge tone="warning" className="ml-1">{advanced ? 'not current' : 'older version'}</Badge> : null}
                </span>
              ) : insp.form_version_id ? (
                advanced ? shortId(insp.form_version_id) : 'Couldn’t load the questions'
              ) : null,
            ],
          ]}
        />
        {insp.unable_reason_code ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            <div className="font-medium text-amber-900">
              The agent couldn’t do the visit: {advanced ? <code>{insp.unable_reason_code}</code> : humanize(insp.unable_reason_code)}
            </div>
            {insp.unable_answers ? (
              <Details summary="What the agent filled in" className="mt-2">
                <JsonView value={insp.unable_answers} defaultExpandDepth={1} maxHeight={200} />
              </Details>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title={advanced ? 'Evidence manifest' : 'Photos and files'} description={`${evidence.length} received for this visit.`}>
        <ManifestBlock insp={insp} />
      </SectionCard>

      <SectionCard title="Location check">
        <GeofenceBlock insp={insp} evidenceById={evidenceById} onOpenEvidence={(ids) => lightbox.open(ids.map((id) => evidenceById.get(id)).filter((e): e is Evidence => !!e), 0)} />
      </SectionCard>

      <SectionCard title={<span className="inline-flex items-center gap-1.5"><ShieldAlert className="size-4" /> Security checks</span>}>
        <IntegrityBlock insp={insp} />
      </SectionCard>

      <SectionCard title="Review">
        <ReviewPanel jobId={jobId} bankId={bankId} insp={insp} />
      </SectionCard>

      <SectionCard title="Answers" description={canAmend ? 'Use Correct to fix an answer. The agent’s original stays as it was, and your correction is saved next to it.' : undefined}>
        <InspectionAnswers
          insp={insp}
          definition={definition}
          evidenceById={evidenceById}
          amendments={amendments}
          other={other}
          canAmend={canAmend}
          onAmend={(key, label, current, field) => setAmending({ key, label, current, field })}
        />
      </SectionCard>

      {amending ? (
        <AmendDialog jobId={jobId} inspectionId={insp.id} fieldKey={amending.key} fieldLabel={amending.label} field={amending.field} currentValue={amending.current} onClose={() => setAmending(null)} />
      ) : null}
      {lightbox.element}
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────────────────────
export function InspectionsTab({
  jobId,
  bankId,
  inspections,
  loading,
  evidence,
  definitions,
  amendments,
  selectedId,
}: {
  jobId: string;
  bankId: string;
  inspections: InspectionRow[];
  loading: boolean;
  evidence: Evidence[];
  definitions: DefinitionVersionRow[];
  amendments: AmendmentRow[];
  selectedId: string | null;
}) {
  const sorted = useMemo(() => [...inspections].sort((a, b) => b.attempt - a.attempt), [inspections]);
  const [compare, setCompare] = useState<string[]>([]);
  const evidenceById = useMemo(() => new Map(evidence.map((e) => [e.id, e])), [evidence]);

  const defaultSelection = useMemo(() => {
    if (selectedId && sorted.some((i) => i.id === selectedId)) {
      const other = sorted.find((i) => i.id !== selectedId);
      return other ? [selectedId, other.id] : [selectedId];
    }
    return sorted.slice(0, 2).map((i) => i.id);
  }, [sorted, selectedId]);
  const valid = compare.filter((id) => sorted.some((i) => i.id === id));
  const shown = (valid.length ? valid : defaultSelection)
    .map((id) => sorted.find((i) => i.id === id))
    .filter((i): i is InspectionRow => !!i)
    .sort((a, b) => a.attempt - b.attempt);

  useEffect(() => {
    if (!selectedId || loading) return;
    const el = document.getElementById(`inspection-${selectedId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedId, loading]);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (sorted.length === 0) {
    return <EmptyState title="No visits yet" description="A visit shows here as soon as the agent starts it on their phone (if they’re offline, once the phone can send it)." />;
  }

  const toggle = (id: string, on: boolean) => {
    const current = valid.length ? valid : defaultSelection;
    if (on) setCompare([...current.filter((x) => x !== id), id].slice(-2));
    else setCompare(current.filter((x) => x !== id).length ? current.filter((x) => x !== id) : current);
  };

  return (
    <div className="space-y-4">
      {sorted.length > 1 ? (
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 text-sm font-medium text-muted-foreground">All visits. Tick two to compare them side by side.</div>
          <div className="flex flex-wrap gap-2">
            {sorted.map((i) => {
              const on = shown.some((s) => s.id === i.id);
              return (
                <label key={i.id} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm', on && 'border-primary/50 bg-accent')}>
                  <Checkbox checked={on} onCheckedChange={(v) => toggle(i.id, v === true)} />
                  Visit {i.attempt}
                  <InspectionStatusBadge status={i.status} />
                  <span className="text-sm text-muted-foreground">
                    <DateTime value={i.submitted_at_server ?? i.started_at_server} />
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className={cn('grid gap-6', shown.length === 2 && 'xl:grid-cols-2')}>
        {shown.map((insp) => {
          const other = shown.length === 2 ? (shown.find((s) => s.id !== insp.id) ?? null) : null;
          return (
            <InspectionPanel
              key={insp.id}
              jobId={jobId}
              bankId={bankId}
              insp={insp}
              evidence={evidence.filter((e) => e.inspection_id === insp.id)}
              evidenceById={evidenceById}
              definition={definitions.find((d) => d.id === insp.form_version_id)}
              amendments={amendments.filter((a) => a.inspection_id === insp.id)}
              other={other}
              highlighted={insp.id === selectedId}
            />
          );
        })}
      </div>
    </div>
  );
}
