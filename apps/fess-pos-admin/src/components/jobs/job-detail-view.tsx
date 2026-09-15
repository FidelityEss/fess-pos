'use client';

// /jobs/[id] — a calm job page (docs/17 §4.7, T3-36): the title and actions, a summary (status in words, the next step,
// agent, when, where, bank), then clearly named tabs: Job details, Booking, Agent, Visits (review and amend), Photos,
// Location trail, Delivery record and History. `?tab=` and `?inspection=` are kept in the URL (the tab keys don't change).
import { RefreshCw } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ErrorState } from '@/components/api-error-alert';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isUuid } from '@/lib/hooks';
import { useStaff } from '@/lib/staff';
import { useQueryClient } from '@tanstack/react-query';
import { EvidenceGallery } from './evidence-gallery';
import { CustodyTimeline } from './custody-timeline';
import { type AgentConflict, ConflictsBanner, JobActionBar, JobDialogs, type JobDialogKind, jobActions } from './job-actions';
import {
  attributeDefs,
  effectiveRadius,
  formSections,
  invalidateJob,
  LOCATION_TYPE_EDITABLE,
  REVIEWABLE_INSPECTION_STATUSES,
  useAppointmentAttempts,
  useDefinitionVersions,
  useJob,
  useJobAmendments,
  useJobAssignments,
  useJobEvents,
  useJobEvidence,
  useJobFormContext,
  useJobInspections,
} from './job-data';
import { InspectionsTab } from './job-inspections';
import { jobNextStep, JobSummary } from './job-summary';
import { AllocationTab, OverviewTab, SchedulingTab, TimelineTab } from './job-tabs';
import { TraceMapPanel } from './trace-map';

/** Tabs in the order a job moves through them. The keys are the URL values and never change. */
const TABS = ['overview', 'scheduling', 'allocation', 'inspections', 'evidence', 'trace', 'custody', 'timeline'] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABEL: Record<TabKey, string> = {
  overview: 'Job details',
  scheduling: 'Booking',
  allocation: 'Agent',
  inspections: 'Visits',
  evidence: 'Photos',
  trace: 'Location trail',
  custody: 'Delivery record',
  timeline: 'History',
};
const isTab = (v: string | null): v is TabKey => v !== null && (TABS as readonly string[]).includes(v);

export function JobDetailView({ id }: { id: string }) {
  const staff = useStaff();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const tabParam = searchParams.get('tab');
  const inspectionParam = searchParams.get('inspection');

  const job = useJob(id);
  const ctx = useJobFormContext(job.data?.bank_id);
  const attempts = useAppointmentAttempts(id);
  const assignments = useJobAssignments(id);
  const events = useJobEvents(id);
  const inspections = useJobInspections(id);
  const evidence = useJobEvidence(id);
  const inspectionIds = useMemo(() => (inspections.data ?? []).map((i) => i.id), [inspections.data]);
  const amendments = useJobAmendments(id, inspectionIds);
  const definitions = useDefinitionVersions([job.data?.job_schema_version_id, ...(inspections.data ?? []).map((i) => i.form_version_id)]);
  const [dialog, setDialog] = useState<JobDialogKind | null>(null);
  const [conflicts, setConflicts] = useState<AgentConflict[]>([]);

  const fieldLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const d of definitions.data ?? []) {
      for (const s of formSections(d.definition)) for (const f of s.fields) out[f.key] ??= f.label;
    }
    return out;
  }, [definitions.data]);

  const setTab = (t: string) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set('tab', t);
    if (t !== 'inspections') p.delete('inspection');
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  if (!isUuid(id)) return <ErrorState error={new Error('This link doesn’t point to a job. Open the job from the Jobs list instead.')} title="We couldn’t find that job" />;
  if (job.isPending) return <PageSpinner label="Loading the job…" />;
  if (job.error) return <ErrorState error={job.error} onRetry={() => void job.refetch()} />;
  const j = job.data;
  if (!j) {
    return <ErrorState error={new Error('It may have been removed, or it belongs to a bank you can’t see.')} title="We couldn’t find that job" />;
  }

  const attemptRows = attempts.data ?? [];
  const inspectionRows = inspections.data ?? [];
  const actions = jobActions(j, staff, attemptRows.length);
  const schemaDef = definitions.data?.find((d) => d.id === j.job_schema_version_id);
  const attrDefs = attributeDefs(schemaDef?.definition);
  const { radiusM } = effectiveRadius(j, ctx.data);
  const awaitingReview = inspectionRows.filter((i) => (REVIEWABLE_INSPECTION_STATUSES as readonly string[]).includes(i.status) && i.reviews.length === 0).length;
  const canEdit = staff.isAdmin && LOCATION_TYPE_EDITABLE.includes(j.status);
  const refreshing = job.isFetching || inspections.isFetching || events.isFetching;
  const next = jobNextStep(j, {
    actions,
    attemptsCount: attemptRows.length,
    awaitingReview,
    canSchedule: staff.hasPermission('schedule_jobs'),
    canReview: staff.hasPermission('review_inspections'),
    hasVisits: inspectionRows.length > 0,
  });
  // The summary shows the next step's action; the tabs and the "More actions" menu offer the rest (never the same button twice).
  const otherActions = actions.filter((a) => a !== next.action);
  // Without a ?tab=, open on the visits once there are any (that's where the work is), else on the job details.
  const tab: TabKey = isTab(tabParam) ? tabParam : inspectionRows.length > 0 ? 'inspections' : 'overview';

  const badge: Partial<Record<TabKey, number>> = {
    scheduling: attemptRows.length,
    timeline: events.data?.length,
    inspections: inspectionRows.length,
    evidence: evidence.data?.length,
  };

  return (
    <>
      <PageHeader
        title={j.merchant_name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-base">
            <span className="font-mono text-sm text-foreground">{j.reference}</span>
            {j.trading_name ? <span>· trading as {j.trading_name}</span> : null}
            {j.external_ref ? <span>· bank’s reference {j.external_ref}</span> : null}
          </span>
        }
        back={{ href: '/jobs', label: 'Jobs' }}
        actions={
          <>
            <Button variant="ghost" size="icon-sm" onClick={() => void invalidateJob(queryClient, id)} title="Refresh" aria-label="Refresh" disabled={refreshing}>
              <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
            </Button>
            <JobActionBar actions={otherActions} onOpen={setDialog} editHref={canEdit ? `/jobs/${id}/edit` : null} />
          </>
        }
      />

      <JobSummary job={j} next={next} awaitingReview={awaitingReview} onAction={setDialog} onTab={setTab} />

      <ConflictsBanner conflicts={conflicts} onDismiss={() => setConflicts([])} />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList className="min-w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABEL[t]}
                {badge[t] ? <span className="rounded bg-muted px-1.5 text-sm tabular-nums text-muted-foreground">{badge[t]}</span> : null}
                {t === 'inspections' && awaitingReview ? <span className="size-2 rounded-full bg-amber-500" aria-label="waiting for review" /> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">
          <OverviewTab job={j} ctx={ctx.data} attrDefs={attrDefs} schemaFamilyId={schemaDef?.family_id ?? null} />
        </TabsContent>
        <TabsContent value="scheduling">
          <SchedulingTab
            job={j}
            attempts={attemptRows}
            loading={attempts.isPending}
            actions={otherActions}
            onOpen={setDialog}
            canSchedule={staff.hasPermission('schedule_jobs')}
            isAdmin={staff.isAdmin}
          />
        </TabsContent>
        <TabsContent value="allocation">
          <AllocationTab job={j} assignments={assignments.data ?? []} loading={assignments.isPending} actions={otherActions} onOpen={setDialog} />
        </TabsContent>
        <TabsContent value="inspections">
          <InspectionsTab
            jobId={id}
            bankId={j.bank_id}
            inspections={inspectionRows}
            loading={inspections.isPending}
            evidence={evidence.data ?? []}
            definitions={definitions.data ?? []}
            amendments={amendments.data ?? []}
            selectedId={isUuid(inspectionParam) ? inspectionParam : null}
          />
        </TabsContent>
        <TabsContent value="evidence">
          <EvidenceGallery evidence={evidence.data} inspections={inspectionRows} fieldLabels={fieldLabels} isLoading={evidence.isPending} />
        </TabsContent>
        <TabsContent value="trace">
          <TraceMapPanel job={j} inspections={inspectionRows} fallbackRadius={radiusM} />
        </TabsContent>
        <TabsContent value="custody">
          <CustodyTimeline job={j} inspections={inspectionRows} evidence={evidence.data ?? []} fieldLabels={fieldLabels} />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineTab events={events.data ?? []} loading={events.isPending} />
        </TabsContent>
      </Tabs>

      <JobDialogs job={j} dialog={dialog} onClose={() => setDialog(null)} attempts={attemptRows} onConflicts={setConflicts} />
    </>
  );
}
