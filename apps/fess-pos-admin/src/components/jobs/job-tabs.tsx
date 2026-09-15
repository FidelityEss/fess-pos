'use client';

// Job page tabs: Job details, Booking, Agent and History (docs/17 §4.7). Visits, Photos, Location trail and Delivery record
// live in their own files.
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DateTime } from '@/components/date-time';
import { Details } from '@/components/details';
import { EmptyState } from '@/components/empty-state';
import { JsonView } from '@/components/json-view';
import { MapView, type MapCircle, type MapMarker } from '@/components/map/map-view';
import { StatusBadge, ToneBadge } from '@/components/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { employeeName, formatDateTime, fullName, humanize } from '@/lib/format';
import { formatLatLng, haversineM } from '@/lib/geo';
import { ASSIGNMENT_RESPONSE_LABEL, CONTACT_CHANNEL_LABEL, CONTACT_OUTCOME_LABEL } from '@/lib/labels';
import { Advanced, useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import type { StatusTone } from '@/lib/status';
import type { AssignmentResponse, ContactOutcome, JobEventVerdict } from '@/lib/types';
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

/** What happened, in words, for the job history. Unknown event types fall back to their humanised name. */
const EVENT_LABEL: Record<string, string> = {
  created: 'Job created',
  job_created: 'Job created',
  imported: 'Imported from a spreadsheet',
  updated: 'Details changed',
  job_updated: 'Details changed',
  location_type_changed: 'Type of place changed',
  contact_attempt: 'Call or message logged',
  scheduled: 'Visit time confirmed',
  job_scheduled: 'Visit time confirmed',
  rescheduled: 'Visit time changed',
  job_rescheduled: 'Visit time changed',
  unscheduled: 'Booking cancelled',
  allocated: 'Agent assigned',
  assigned: 'Agent assigned',
  job_assigned: 'Agent assigned',
  reassigned: 'Agent changed',
  revoked: 'Taken off the agent',
  job_revoked: 'Taken off the agent',
  assignment_revoked: 'Taken off the agent',
  accepted: 'Agent accepted',
  job_rejected_by_agent: 'Agent turned it down',
  assignment_rejected: 'Agent turned it down',
  assignment_expired: 'Agent didn’t answer in time',
  started: 'Visit started',
  inspection_started: 'Visit started',
  paused: 'Visit paused',
  resumed: 'Visit carried on',
  submitted: 'Visit sent in',
  inspection_submitted: 'Visit sent in',
  reviewed: 'Visit reviewed',
  returned: 'Sent back to the agent',
  job_returned: 'Sent back to the agent',
  approved: 'Approved',
  rejected: 'Rejected',
  unable_to_complete: 'The agent couldn’t do the visit',
  appointment_not_secured: 'Couldn’t book a visit',
  not_secured: 'Couldn’t book a visit',
  cancelled: 'Job cancelled',
  job_cancelled: 'Job cancelled',
  closed: 'Job archived',
};
const eventLabel = (type: string) => EVENT_LABEL[type] ?? humanize(type.replace(/^job_/, ''));

function LoadingOr({ loading, children }: { loading: boolean; children: ReactNode }) {
  return loading ? <Skeleton className="h-32 w-full" /> : <>{children}</>;
}

// ── Job details ───────────────────────────────────────────────────────────────────────────────
export function OverviewTab({
  job,
  ctx,
  attrDefs,
  schemaFamilyId,
}: {
  job: JobDetailRow;
  ctx: JobFormContext | undefined;
  attrDefs: AttributeDef[];
  /** The Job information set-up this job's extra details come from (links to Inspection set-up). */
  schemaFamilyId?: string | null;
}) {
  const advanced = useIsAdvanced();
  const staff = useStaff();
  const pin = jobPoint(job);
  const bank = bankCoordinates(job.address);
  const { radiusM, source } = effectiveRadius(job, ctx);
  const profile = ctx?.profiles?.[job.location_type];
  const mismatch = pin && bank ? haversineM(pin, bank) : null;
  const markers: MapMarker[] = [];
  if (pin) markers.push({ id: 'pin', lat: pin.lat, lng: pin.lng, color: '#006b55', label: `Merchant pin · ${formatLatLng(pin)}` });
  if (bank) markers.push({ id: 'bank', lat: bank.lat, lng: bank.lng, color: '#d97706', label: `Location from the bank · ${formatLatLng(bank)}` });
  const circles: MapCircle[] = pin && radiusM ? [{ id: 'fence', lat: pin.lat, lng: pin.lng, radiusM, color: '#006b55' }] : [];
  const attrKeys = Object.keys(job.attributes ?? {});
  const unknownAttrs = attrKeys.filter((k) => !attrDefs.some((d) => d.key === k));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard title="Merchant">
        <KeyValues
          items={[
            ['Merchant name', job.merchant_name],
            ['Trading as', job.trading_name],
            ['Bank’s reference', job.external_ref],
            ['Bank', job.bank ? job.bank.name : advanced ? job.bank_id : null],
            [
              'Business type',
              job.mcc ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {job.mcc.description} <Badge tone={RISK_TIER_TONE[job.mcc.risk_tier]}>{job.mcc.risk_tier} risk</Badge>
                  <Advanced>
                    <span className="font-mono text-sm text-muted-foreground">MCC {job.mcc.code}</span>
                  </Advanced>
                </span>
              ) : (
                job.mcc_code
              ),
            ],
            ['Created', <span key="c">{formatDateTime(job.created_at)}{job.creator ? ` by ${fullName(job.creator)}` : ''}</span>],
            ['Follows on from', job.parent_job_id ? <Link key="p" href={`/jobs/${job.parent_job_id}`} className="text-primary hover:underline">The earlier job</Link> : null],
            ['Archived', job.closed_at ? <DateTime key="cl" value={job.closed_at} /> : null],
          ]}
        />
        {job.notes ? (
          <div className="mt-4">
            <div className="text-sm text-muted-foreground">Notes for the agent</div>
            <p className="mt-0.5 whitespace-pre-wrap text-base">{job.notes}</p>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Contacts and visit time">
        <KeyValues
          items={[
            ['Merchant contact', [job.contact?.name, job.contact?.phone, job.contact?.email].filter(Boolean).join(' · ') || null],
            [
              'Who meets the agent',
              job.onsite_contact ? [job.onsite_contact.name, job.onsite_contact.role, job.onsite_contact.phone, job.onsite_contact.email].filter(Boolean).join(' · ') : null,
            ],
            ['Visit time', job.scheduled_start ? formatWindow(job.scheduled_start, job.scheduled_end) : null],
            [
              'Booked by',
              job.appointment_confirmed_at ? `${job.confirmed_by ? fullName(job.confirmed_by) : '—'} · ${formatDateTime(job.appointment_confirmed_at)}` : null,
            ],
            ['Agent', job.agent ? employeeName(job.agent) : null],
            ['Given to the agent', job.assigned_at ? <DateTime key="a" value={job.assigned_at} /> : null],
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Address and map"
        className="xl:col-span-2"
        description={
          !radiusM
            ? undefined
            : advanced
              ? `Site area ${radiusM} m (${source === 'job' ? 'set on this job' : `the default for ${humanize(job.location_type).toLowerCase()}`}) · GPS must be accurate to ${job.gps_accuracy_max_m ?? toNumber(profile?.max_accuracy_m) ?? '—'} m${job.gps_accuracy_max_m ? ' (set on this job)' : ''}`
              : `The agent must be within ${radiusM} m of the pin to start the visit.`
        }
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          {markers.length ? (
            <MapView markers={markers} circles={circles} height={320} />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">No map pin on this job yet. Add one with Edit.</div>
          )}
          <div className="space-y-3">
            <KeyValues
              className="sm:grid-cols-1 lg:grid-cols-1"
              items={[
                ['Address', formatAddress(job.address)],
                ['Type of place', humanize(job.location_type)],
                ...(advanced
                  ? ([
                      ['Map pin', pin ? `${formatLatLng(pin)}${job.location_source ? ` (${humanize(job.location_source)})` : ''}` : null],
                      ['Location from the bank', bank ? formatLatLng(bank) : null],
                    ] as [ReactNode, ReactNode][])
                  : []),
              ]}
            />
            {mismatch !== null ? (
              <p className={mismatch > 250 ? 'text-sm text-amber-700' : 'text-sm text-muted-foreground'}>
                The map pin is {Math.round(mismatch)} m from the location the bank gave{mismatch > 250 ? '. Please check the address.' : '.'}
              </p>
            ) : null}
            <FlagBadges flags={job.flags} />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Job information"
        description={
          job.job_schema_version_id
            ? 'The extra details the bank asked for, as set up under Inspection set-up.'
            : 'This job has no extra details from the bank.'
        }
        actions={
          staff.isAdmin && schemaFamilyId ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/definitions/${schemaFamilyId}`}>See how it’s set up</Link>
            </Button>
          ) : null
        }
        className="xl:col-span-2"
      >
        {attrDefs.length === 0 && attrKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No extra details.</p>
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

// ── Booking ───────────────────────────────────────────────────────────────────────────────────
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
          <AlertDescription>You can see the booking history. Logging calls and confirming visit times needs permission to book visits.</AlertDescription>
        </Alert>
      ) : null}
      <SectionCard
        title="Visit time"
        description="Someone agrees a visit time with the merchant first. Only a booked job can go to an agent."
        actions={<ActionButtons actions={actions} kinds={['attempt', 'schedule', 'unschedule', 'not_secured']} onOpen={onOpen} />}
      >
        <KeyValues
          items={[
            ['Status', <StatusBadge key="s" status={job.status} />],
            ['Visit time', job.scheduled_start ? formatWindow(job.scheduled_start, job.scheduled_end) : 'Not booked yet'],
            ['Who meets the agent', job.onsite_contact ? [job.onsite_contact.name, job.onsite_contact.role, job.onsite_contact.phone, job.onsite_contact.email].filter(Boolean).join(' · ') : null],
            ['Confirmed', job.appointment_confirmed_at ? `${formatDateTime(job.appointment_confirmed_at)}${job.confirmed_by ? ` by ${fullName(job.confirmed_by)}` : ''}` : null],
            ['Calls and messages', String(attempts.length)],
          ]}
        />
      </SectionCard>
      <SectionCard title="Calls and messages to the merchant" description="Newest first. They’re the proof behind a booking, or behind “couldn’t book a visit”.">
        <LoadingOr loading={loading}>
          {attempts.length === 0 ? (
            <EmptyState title="No calls or messages logged yet" className="py-6" />
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>How</TableHead>
                    <TableHead>What happened</TableHead>
                    <TableHead>Time they suggested</TableHead>
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
                      <TableCell>{CONTACT_CHANNEL_LABEL[a.channel] ?? humanize(a.channel)}</TableCell>
                      <TableCell>
                        <ToneBadge value={a.outcome} tones={OUTCOME_TONE} labels={CONTACT_OUTCOME_LABEL} />
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

// ── Agent ─────────────────────────────────────────────────────────────────────────────────────
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
        title="Current agent"
        description={job.status === 'pending' ? 'Book a visit time first. Only a booked job can go to an agent.' : undefined}
        actions={<ActionButtons actions={actions} kinds={['allocate', 'reassign', 'revoke']} onOpen={onOpen} />}
      >
        <KeyValues
          items={[
            ['Agent', job.agent ? employeeName(job.agent) : 'No agent yet'],
            ['Given to them', job.assigned_at ? <DateTime key="a" value={job.assigned_at} showRelative /> : null],
            ['Status', <StatusBadge key="s" status={job.status} />],
            ['Visit time', job.scheduled_start ? formatWindow(job.scheduled_start, job.scheduled_end) : null],
          ]}
        />
      </SectionCard>
      <SectionCard title="Who has had this job" description="Every time the job was given to an agent, and what they did.">
        <LoadingOr loading={loading}>
          {assignments.length === 0 ? (
            <EmptyState title="Not given to an agent yet" className="py-6" />
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Given to them</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Their answer</TableHead>
                    <TableHead>Answered</TableHead>
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
                        <ToneBadge value={a.response} tones={RESPONSE_TONE} labels={ASSIGNMENT_RESPONSE_LABEL} />
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

// ── History ───────────────────────────────────────────────────────────────────────────────────
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
  if (events.length === 0) return <EmptyState title="Nothing has happened to this job yet" />;
  return (
    <ol className="relative space-y-3 border-l border-divider pl-5">
      {events.map((ev) => {
        const summary = payloadSummary(ev.payload);
        const hasPayload = isPlainObject(ev.payload) && Object.keys(ev.payload).length > 0;
        return (
          <li key={ev.id} className="relative">
            <span className={`absolute -left-[26px] top-1.5 size-2.5 rounded-full border-2 border-white ${ev.verdict === 'applied' ? 'bg-primary' : 'bg-amber-500'}`} />
            <div className="rounded-md border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-medium">{eventLabel(ev.type)}</span>
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
                {ev.verdict !== 'applied' ? (
                  <ToneBadge
                    value={ev.verdict}
                    tones={VERDICT_TONE}
                    label={ev.verdict === 'superseded' ? 'Saved, but a later change came first' : 'Saved (status unchanged)'}
                  />
                ) : null}
                <span className="ml-auto text-sm text-muted-foreground">
                  <DateTime value={ev.created_at} seconds={advanced} />
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                <span>
                  {ev.actor ? fullName(ev.actor) : 'The system'}
                  {advanced && ev.actor_role ? ` (${humanize(ev.actor_role).toLowerCase()})` : ''}
                </span>
                {ev.reason_code ? (
                  <span>
                    Reason: {advanced ? <code>{ev.reason_code}</code> : humanize(ev.reason_code)}
                  </span>
                ) : null}
                {advanced && ev.client_created_at ? <span>Phone time {formatDateTime(ev.client_created_at, { seconds: true })}</span> : null}
                {advanced && ev.client_created_at ? <span>Received {formatDateTime(ev.server_received_at, { seconds: true })}</span> : null}
              </div>
              {ev.note ? <p className="mt-1.5 whitespace-pre-wrap text-base">{ev.note}</p> : null}
              {advanced && summary ? <p className="mt-1 text-sm text-muted-foreground">{summary}</p> : null}
              {(advanced && hasPayload) || ev.form_answers ? (
                <Details className="mt-2">
                  {advanced && hasPayload ? <JsonView value={ev.payload} defaultExpandDepth={1} maxHeight={260} /> : null}
                  {ev.form_answers ? (
                    <>
                      <div className="text-sm text-muted-foreground">Answers sent with it</div>
                      <JsonView value={ev.form_answers} defaultExpandDepth={1} maxHeight={260} />
                    </>
                  ) : null}
                </Details>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
