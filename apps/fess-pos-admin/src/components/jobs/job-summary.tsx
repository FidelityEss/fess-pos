'use client';

// The job page's summary (docs/17 §4.7, T3-36): where the job is, in words; the next step with its button; and the
// agent, the visit time, the place and the bank, each linking to the related screen. Technical detail sits in "Details".
import { CalendarClock, Landmark, MapPin, UserRound } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DateTime } from '@/components/date-time';
import { Details } from '@/components/details';
import { useCanAccessPath } from '@/components/shell/nav';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime, fullName, humanize } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import { dashboardStatus, JOB_STATUS_MEANING } from '@/lib/status';
import type { JobAction, JobDialogKind } from './job-actions';
import { FlagBadges } from './job-bits';
import { formatAddress, formatWindow, type JobDetailRow } from './job-data';

/** The next step for a job: a sentence, and either an action (opens its dialog) or a tab to open. */
export interface JobNextStep {
  text: string;
  action: JobAction | null;
  tab: { key: string; label: string } | null;
}

/** Work out the obvious next step from the job's status and what this person can do (docs/06 §1a–2). */
export function jobNextStep(
  job: Pick<JobDetailRow, 'status' | 'agent' | 'scheduled_start' | 'scheduled_end'>,
  opts: { actions: JobAction[]; attemptsCount: number; awaitingReview: number; canSchedule: boolean; canReview: boolean; hasVisits: boolean },
): JobNextStep {
  const find = (kind: JobDialogKind) => opts.actions.find((a) => a.kind === kind && a.enabled) ?? null;
  const agent = job.agent ? fullName(job.agent) : 'The agent';
  const visitTab = { key: 'inspections', label: 'See the visit' };
  switch (job.status) {
    case 'pending':
      if (!opts.canSchedule) return { text: 'Someone who books visits needs to agree a visit time with the merchant.', action: null, tab: null };
      return opts.attemptsCount === 0
        ? { text: 'Call or message the merchant to agree a visit time, and log each try.', action: find('attempt'), tab: null }
        : { text: 'When the merchant agrees a time, confirm it here. Keep logging calls until then.', action: find('schedule'), tab: null };
    case 'scheduled':
      return { text: `The visit is booked for ${formatWindow(job.scheduled_start, job.scheduled_end)}. Assign an agent to do it.`, action: find('allocate'), tab: null };
    case 'assigned':
      return { text: `Waiting for ${job.agent ? fullName(job.agent) : 'the agent'} to accept the job in their app.`, action: null, tab: null };
    case 'accepted':
      return { text: `${agent} will visit ${formatWindow(job.scheduled_start, job.scheduled_end)}. Nothing to do until then.`, action: null, tab: null };
    case 'in_progress':
    case 'paused':
      return { text: 'The agent is on the visit. Answers and photos show here as their phone sends them.', action: null, tab: visitTab };
    case 'submitted':
    case 'under_review':
      if (opts.awaitingReview > 0 && opts.canReview) {
        return { text: 'Check the answers and photos, then approve the visit or send it back.', action: null, tab: { key: 'inspections', label: 'Review the visit' } };
      }
      return { text: 'Waiting for someone who reviews visits to check it.', action: null, tab: opts.hasVisits ? visitTab : null };
    case 'returned':
      return { text: 'Waiting for the agent to fix the visit and send it in again.', action: null, tab: visitTab };
    case 'closed':
      return { text: 'Nothing more to do.', action: null, tab: null };
    default:
      return { text: 'Nothing more to do. Archive the job when you no longer need it on your lists.', action: find('close'), tab: null };
  }
}

function Fact({ icon: Icon, label, children }: { icon: typeof MapPin; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2.5">
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-words text-base">{children}</dd>
      </div>
    </div>
  );
}

const linkClass = 'text-primary underline-offset-4 hover:underline';

/** Summary card at the top of the job page. */
export function JobSummary({
  job,
  next,
  awaitingReview,
  onAction,
  onTab,
}: {
  job: JobDetailRow;
  next: JobNextStep;
  awaitingReview: number;
  onAction: (kind: JobDialogKind) => void;
  onTab: (tab: string) => void;
}) {
  const advanced = useIsAdvanced();
  const canAccessPath = useCanAccessPath();
  const address = formatAddress(job.address);
  const d = dashboardStatus(job.status);

  return (
    <section aria-label="Summary" className="mb-6 rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={job.status} />
            {awaitingReview ? <Badge tone="warning">{awaitingReview === 1 ? 'A visit to review' : `${awaitingReview} visits to review`}</Badge> : null}
            <FlagBadges flags={job.flags} />
          </div>
          <p className="text-base">{JOB_STATUS_MEANING[job.status]}</p>
        </div>
        <span className="text-sm text-muted-foreground">
          Last change <DateTime value={job.updated_at} mode="relative" />
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-divider px-5 py-3.5">
        <span className="text-sm font-semibold uppercase tracking-wide text-brand-gold-text">Next step</span>
        <span className="min-w-0 flex-1 text-base">{next.text}</span>
        {next.action ? (
          <Button onClick={() => onAction(next.action!.kind)} disabled={!next.action.enabled} title={next.action.reason}>
            {next.action.label}
          </Button>
        ) : next.tab ? (
          <Button variant={next.tab.label.startsWith('Review') ? 'default' : 'outline'} onClick={() => onTab(next.tab!.key)}>
            {next.tab.label}
          </Button>
        ) : null}
      </div>

      <dl className="grid gap-x-6 gap-y-4 border-t border-divider px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact icon={UserRound} label="Agent">
          {job.agent ? (
            <span className="flex flex-col">
              {job.assigned_to && canAccessPath('/users') ? (
                <Link href={`/users/${job.assigned_to}`} className={linkClass}>
                  {fullName(job.agent)}
                </Link>
              ) : (
                fullName(job.agent)
              )}
              {job.assigned_to ? (
                <Link href={`/jobs?agent=${job.assigned_to}`} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
                  Their other jobs
                </Link>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">No agent yet</span>
          )}
        </Fact>
        <Fact icon={CalendarClock} label="Visit time">
          {job.scheduled_start ? formatWindow(job.scheduled_start, job.scheduled_end) : <span className="text-muted-foreground">Not booked yet</span>}
        </Fact>
        <Fact icon={MapPin} label="Where">
          <span className="flex flex-col">
            <span>{address}</span>
            <span className="text-sm text-muted-foreground">{humanize(job.location_type)}</span>
          </span>
        </Fact>
        <Fact icon={Landmark} label="Bank">
          <span className="flex flex-col">
            {job.bank && canAccessPath('/banks') ? (
              <Link href={`/banks?open=${job.bank_id}`} className={linkClass}>
                {job.bank.name}
              </Link>
            ) : (
              (job.bank?.name ?? '—')
            )}
            <Link href={`/jobs?bank=${job.bank_id}`} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              This bank’s jobs
            </Link>
          </span>
        </Fact>
      </dl>

      <div className="border-t border-divider px-5 py-3">
        <Details>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <div>
              <dt className="inline text-muted-foreground">Bank report group: </dt>
              <dd className="inline">{d.displayLabel}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Created: </dt>
              <dd className="inline">{formatDateTime(job.created_at)}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">In this status since: </dt>
              <dd className="inline">{formatDateTime(job.status_changed_at)}</dd>
            </div>
            {advanced ? (
              <>
                <div>
                  <dt className="inline text-muted-foreground">Status value: </dt>
                  <dd className="inline font-mono text-xs">{job.status}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="inline text-muted-foreground">Job id: </dt>
                  <dd className="inline font-mono text-xs">{job.id}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </Details>
      </div>
    </section>
  );
}
