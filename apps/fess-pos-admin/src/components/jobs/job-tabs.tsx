'use client';

// Job detail tabs: Overview, Scheduling, Allocation, Timeline.
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DateTime } from '@/components/date-time';
import { EmptyState } from '@/components/empty-state';
import { JsonView } from '@/components/json-view';
import { MapView, type MapCircle, type MapMarker } from '@/components/map/map-view';
import { StatusBadge, ToneBadge } from '@/components/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { employeeName, formatDateTime, fullName, humanize } from '@/lib/format';
import { formatLatLng, haversineM } from '@/lib/geo';
import type { StatusTone } from '@/lib/status';
import type { AssignmentResponse, ContactOutcome, JobEventVerdict } from '@/lib/types';
import { Advanced, useIsAdvanced } from '@/lib/preferences';
import { isPlainObject } from '@/lib/utils';
import { ActionButtons, type JobAction, type JobDialogKind } from './job-actions';
import { FlagBadges, formatAttributeValue, KeyValues, RISK_TIER_TONE, SectionCard } from './job-bits';
import {
  type AssignmentRow,
  type AttemptRow,
  type AttributeDef,
  bankCoordinates,
  effectiveRadius,
  formatAddress,
  formatWindow,
  type JobDetailRow,
  type JobEventRow,
  type JobFormContext,
  jobPoint,
  toNumber,
} from './job-data';

const OUTCOME_TONE: Record<ContactOutcome, StatusTone> = {
  no_answer: 'neutral',
  declined: 'danger',
  rescheduled: 'warning',
  confirmed: 'success',
  wrong_number: 'danger',
  other: 'neutral',
};
const RESPONSE_TONE: Record<AssignmentResponse, StatusTone> = {
  pending: 'info',
  accepted: 'success',
  rejected: 'danger',
  expired: 'warning',
  revoked: 'muted',
};
const VERDICT_TONE: Record<JobEventVerdict, StatusTone> = { applied: 'success', superseded: 'warning', recorded: 'neutral' };

function LoadingOr({ loading, children }: { loading: boolean; children: ReactNode }) {
  return loading ? <Skeleton className="h-32 w-full" /> : <>{children}</>;
}

// ── Overview ──────────────────────────────────────────────────────────────────────────────────
export function OverviewTab({ job, ctx, attrDefs }: { job: JobDetailRow; ctx: JobFormContext | undefined; attrDefs: AttributeDef[] }) {
  const advanced = useIsAdvanced();
  const pin = jobPoint(job);
  const bank = bankCoordinates(job.address);
  const { radiusM, source } = effectiveRadius(job, ctx);
  const profile = ctx?.profiles?.[job.location_type];
  const mismatch = pin && bank ? haversineM(pin, bank) : null;
  const markers: MapMarker[] = [];
  if (pin) markers.push({ id: 'pin', lat: pin.lat, lng: pin.lng, color: '#006b55', label: `Merchant pin · ${formatLatLng(pin)}` });
  if (bank) markers.push({ id: 'bank', lat: bank.lat, lng: bank.lng, color: '#d97706', label: `Bank-supplied coordinates · ${formatLatLng(bank)}` });
  const circles: MapCircle[] = pin && radiusM ? [{ id: 'fence', lat: pin.lat, lng: pin.lng, radiusM, color: '#006b55' }] : [];
  const attrKeys = Object.keys(job.attributes ?? {});
  const unknownAttrs = attrKeys.filter((k) => !attrDefs.some((d) => d.key === k));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard title="Merchant">
        <KeyValues
          items={[
            ['Merchant name', job.merchant_name],
            ['Trading name', job.trading_name],
            ['External reference', job.external_ref],
            ['Bank', job.bank ? `${job.bank.code} — ${job.bank.name}` : advanced ? job.bank_id : null],
            [
              'MCC',
              job.mcc ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="font-mono">{job.mcc.code}</span> {job.mcc.description} <Badge tone={RISK_TIER_TONE[job.mcc.risk_tier]}>{job.mcc.risk_tier} risk</Badge>
                </span>
              ) : (
                job.mcc_code
              ),
            ],
            ['Created', <span key="c">{formatDateTime(job.created_at)}{job.creator ? ` by ${fullName(job.creator)}` : ''}</span>],
            ['Status since', <DateTime key="s" value={job.status_changed_at} showRelative />],
            ['Parent job', job.parent_job_id ? <Link key="p" href={`/jobs/${job.parent_job_id}`} className="text-primary hover:underline">Open parent job</Link> : null],
            ['Closed', job.closed_at ? <DateTime key="cl" value={job.closed_at} /> : null],
          ]}
        />
        {job.notes ? (
          <div className="mt-4">
            <div className="text-sm text-muted-foreground">Notes</div>
            <p className="mt-0.5 whitespace-pre-wrap text-base">{job.notes}</p>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Contacts and appointment">
        <KeyValues
          items={[
            ['Merchant contact', [job.contact?.name, job.contact?.phone, job.contact?.email].filter(Boolean).join(' · ') || null],
            [
              'On-site contact',
              job.onsite_contact ? [job.onsite_contact.name, job.onsite_contact.role, job.onsite_contact.phone, job.onsite_contact.email].filter(Boolean).join(' · ') : null,
            ],
            ['Confirmed window', job.scheduled_start ? formatWindow(job.scheduled_start, job.scheduled_end) : null],
            [
              'Confirmed by',
              job.appointment_confirmed_at ? `${job.confirmed_by ? fullName(job.confirmed_by) : '—'} · ${formatDateTime(job.appointment_confirmed_at)}` : null,
            ],
            ['Assigned agent', job.agent ? employeeName(job.agent) : null],
            ['Assigned at', job.assigned_at ? <DateTime key="a" value={job.assigned_at} /> : null],
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Address and location"
        className="xl:col-span-2"
        description={
          !radiusM
            ? undefined
            : advanced
              ? `Fence ${radiusM} m (${source === 'job' ? 'job override' : `${humanize(job.location_type)} profile`}) · GPS accuracy ≤ ${job.gps_accuracy_max_m ?? toNumber(profile?.max_accuracy_m) ?? '—'} m${job.gps_accuracy_max_m ? ' (job override)' : ''}`
              : `The agent must be within ${radiusM} m of the pin to start the visit.`
        }
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          {markers.length ? (
            <MapView markers={markers} circles={circles} height={320} />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">No map pin on this job yet.</div>
          )}
          <div className="space-y-3">
            <KeyValues
              className="sm:grid-cols-1 lg:grid-cols-1"
              items={[
                ['Address', formatAddress(job.address)],
                ['Location type', humanize(job.location_type)],
                ...(advanced
                  ? ([
                      ['Merchant pin', pin ? `${formatLatLng(pin)}${job.location_source ? ` (${humanize(job.location_source)})` : ''}` : null],
                      ['Bank-supplied coordinates', bank ? formatLatLng(bank) : null],
                    ] as [ReactNode, ReactNode][])
                  : []),
              ]}
            />
            {mismatch !== null ? (
              <p className={mismatch > 250 ? 'text-sm text-amber-700' : 'text-sm text-muted-foreground'}>
                {advanced ? 'Pin is' : 'The map pin is'} {Math.round(mismatch)} m from the {advanced ? 'bank\u2019s coordinates' : 'location the bank gave'}
                {mismatch > 250 ? (advanced ? ' — flagged as a location mismatch.' : ' — please check the address.') : '.'}
              </p>
            ) : null}
            <FlagBadges flags={job.flags} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Bank attributes" description={job.job_schema_version_id ? 'Labels from the job schema version pinned when the job was created.' : 'No job schema was pinned on this job.'} className="xl:col-span-2">
        {attrDefs.length === 0 && attrKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attributes.</p>
        ) : (
          <KeyValues
            items={[
              ...attrDefs.map((d): [ReactNode, ReactNode] => [d.label, formatAttributeValue(d, job.attributes?.[d.key])]),
              ...unknownAttrs.map((k): [ReactNode, ReactNode] => [humanize(k), formatAttributeValue(undefined, job.attributes?.[k])]),
            ]}
          />
        )}
      </SectionCard>
    </div>
  );
}

// ── Scheduling ────────────────────────────────────────────────────────────────────────────────
export function SchedulingTab({
  job,
  attempts,
  loading,
  actions,
  onOpen,
  canSchedule,
  isAdmin,
}: {
  job: JobDetailRow;
  attempts: AttemptRow[];
  loading: boolean;
  actions: JobAction[];
  onOpen: (k: JobDialogKind) => void;
  canSchedule: boolean;
  isAdmin: boolean;
}) {
  return (
    <div className="space-y-4">
      {isAdmin && !canSchedule ? (
        <Alert variant="info">
          <AlertDescription>You can see the scheduling history, but logging attempts and confirming appointments needs the Schedule jobs permission.</AlertDescription>
        </Alert>
      ) : null}
      <SectionCard
        title="Appointment"
        description="The scheduler arranges the visit with the merchant; only jobs with a confirmed appointment can be given to an agent."
        actions={<ActionButtons actions={actions} kinds={['attempt', 'schedule', 'unschedule', 'not_secured']} onOpen={onOpen} />}
      >
        <KeyValues
          items={[
            ['Status', <StatusBadge key="s" status={job.status} />],
            ['Visit window', job.scheduled_start ? formatWindow(job.scheduled_start, job.scheduled_end) : 'Not arranged yet'],
            ['On-site contact', job.onsite_contact ? [job.onsite_contact.name, job.onsite_contact.role, job.onsite_contact.phone, job.onsite_contact.email].filter(Boolean).join(' · ') : null],
            ['Confirmed', job.appointment_confirmed_at ? `${formatDateTime(job.appointment_confirmed_at)}${job.confirmed_by ? ` by ${fullName(job.confirmed_by)}` : ''}` : null],
            ['Contact attempts', String(attempts.length)],
          ]}
        />
      </SectionCard>
      <SectionCard title="Contact attempts" description="Newest first. These are the evidence behind a confirmed appointment or a not-secured outcome.">
        <LoadingOr loading={loading}>
          {attempts.length === 0 ? (
            <EmptyState title="No contact attempts yet" className="py-6" />
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Proposed window</TableHead>
                    <TableHead>Spoke to</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Logged by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attempts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <DateTime value={a.attempted_at} />
                      </TableCell>
                      <TableCell>{a.channel === 'whatsapp' ? 'WhatsApp' : humanize(a.channel)}</TableCell>
                      <TableCell>
                        <ToneBadge value={a.outcome} tones={OUTCOME_TONE} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{a.proposed_start ? formatWindow(a.proposed_start, a.proposed_end) : '—'}</TableCell>
                      <TableCell>{a.contact_name ?? '—'}</TableCell>
                      <TableCell className="min-w-56 max-w-80 whitespace-pre-wrap">{a.note ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{a.by ? fullName(a.by) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </LoadingOr>
      </SectionCard>
    </div>
  );
}

// ── Allocation ────────────────────────────────────────────────────────────────────────────────
export function AllocationTab({
  job,
  assignments,
  loading,
  actions,
  onOpen,
}: {
  job: JobDetailRow;
  assignments: AssignmentRow[];
  loading: boolean;
  actions: JobAction[];
  onOpen: (k: JobDialogKind) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionCard
        title="Current assignment"
        description={job.status === 'pending' ? 'Confirm an appointment first — only scheduled jobs can be allocated.' : undefined}
        actions={<ActionButtons actions={actions} kinds={['allocate', 'reassign', 'revoke', 'cancel', 'close']} onOpen={onOpen} />}
      >
        <KeyValues
          items={[
            ['Agent', job.agent ? employeeName(job.agent) : 'Unassigned'],
            ['Assigned at', job.assigned_at ? <DateTime key="a" value={job.assigned_at} showRelative /> : null],
            ['Status', <StatusBadge key="s" status={job.status} />],
            ['Visit window', job.scheduled_start ? formatWindow(job.scheduled_start, job.scheduled_end) : null],
          ]}
        />
      </SectionCard>
      <SectionCard title="Assignment history" description="Every allocation, with the agent's response.">
        <LoadingOr loading={loading}>
          {assignments.length === 0 ? (
            <EmptyState title="Never assigned" className="py-6" />
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Response</TableHead>
                    <TableHead>Responded</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap">{a.agent ? employeeName(a.agent) : <Advanced fallback="—">{a.user_id}</Advanced>}</TableCell>
                      <TableCell>
                        <DateTime value={a.assigned_at} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{a.by ? fullName(a.by) : '—'}</TableCell>
                      <TableCell>
                        <ToneBadge value={a.response} tones={RESPONSE_TONE} />
                      </TableCell>
                      <TableCell>
                        <DateTime value={a.responded_at} />
                      </TableCell>
                      <TableCell>{a.reason_code ? <Advanced fallback={humanize(a.reason_code)}><code className="text-sm">{a.reason_code}</code></Advanced> : '—'}</TableCell>
                      <TableCell className="min-w-48 max-w-72 whitespace-pre-wrap">{a.note ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </LoadingOr>
      </SectionCard>
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────────────────────
function payloadSummary(payload: unknown): string {
  if (!isPlainObject(payload)) return '';
  return Object.entries(payload)
    .filter(([, v]) => v !== null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .slice(0, 4)
    .map(([k, v]) => `${humanize(k).toLowerCase()}: ${String(v)}`)
    .join(' · ');
}

export function TimelineTab({ events, loading }: { events: JobEventRow[]; loading: boolean }) {
  const advanced = useIsAdvanced();
  if (loading) return <Skeleton className="h-64 w-full" />;
  if (events.length === 0) return <EmptyState title="No events yet" />;
  return (
    <ol className="relative space-y-3 border-l pl-5">
      {events.map((ev) => {
        const summary = payloadSummary(ev.payload);
        const hasPayload = isPlainObject(ev.payload) && Object.keys(ev.payload).length > 0;
        return (
          <li key={ev.id} className="relative">
            <span className={`absolute -left-[26px] top-1.5 size-2.5 rounded-full border-2 border-white ${ev.verdict === 'applied' ? 'bg-primary' : 'bg-amber-500'}`} />
            <div className="rounded-md border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-medium">{humanize(ev.type)}</span>
                {ev.from_status || ev.to_status ? (
                  <span className="inline-flex items-center gap-1">
                    {ev.from_status ? <StatusBadge status={ev.from_status} /> : <span className="text-sm text-muted-foreground">new</span>}
                    {ev.to_status && ev.to_status !== ev.from_status ? (
                      <>
                        <ArrowRight className="size-4 text-muted-foreground" />
                        <StatusBadge status={ev.to_status} />
                      </>
                    ) : null}
                  </span>
                ) : null}
                {ev.verdict !== 'applied' ? <ToneBadge value={ev.verdict} tones={VERDICT_TONE} label={ev.verdict === 'superseded' ? 'Superseded — recorded, not applied' : 'Recorded — no transition'} /> : null}
                <span className="ml-auto text-sm text-muted-foreground">
                  <DateTime value={ev.created_at} seconds={advanced} />
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                <span>
                  {ev.actor ? fullName(ev.actor) : 'System'}
                  {advanced && ev.actor_role ? ` (${humanize(ev.actor_role).toLowerCase()})` : ''}
                </span>
                {ev.reason_code ? (
                  <span>
                    Reason: {advanced ? <code>{ev.reason_code}</code> : humanize(ev.reason_code)}
                  </span>
                ) : null}
                {advanced && ev.client_created_at ? <span>Device time {formatDateTime(ev.client_created_at, { seconds: true })}</span> : null}
                {advanced && ev.client_created_at ? <span>Received {formatDateTime(ev.server_received_at, { seconds: true })}</span> : null}
              </div>
              {ev.note ? <p className="mt-1.5 whitespace-pre-wrap text-base">{ev.note}</p> : null}
              {advanced && summary ? <p className="mt-1 text-sm text-muted-foreground">{summary}</p> : null}
              {(advanced && hasPayload) || ev.form_answers ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-primary">Details</summary>
                  <div className="mt-2 space-y-2">
                    {advanced && hasPayload ? <JsonView value={ev.payload} defaultExpandDepth={1} maxHeight={260} /> : null}
                    {ev.form_answers ? (
                      <>
                        <div className="text-sm text-muted-foreground">Form answers</div>
                        <JsonView value={ev.form_answers} defaultExpandDepth={1} maxHeight={260} />
                      </>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
