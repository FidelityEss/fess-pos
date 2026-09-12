'use client';

// /jobs/[id] — header with status, flags and actions; tabs for overview, scheduling, allocation, timeline,
// inspections (review + amend), evidence, trace map and custody. `?tab=` and `?inspection=` are kept in the URL.
import { RefreshCw } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ErrorState } from '@/components/api-error-alert';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { DashboardStatusBadge, StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { employeeName, fullName, humanize } from '@/lib/format';
import { isUuid } from '@/lib/hooks';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { useQueryClient } from '@tanstack/react-query';
import { EvidenceGallery } from './evidence-gallery';
import { CustodyTimeline } from './custody-timeline';
import { type AgentConflict, ConflictsBanner, JobActionBar, JobDialogs, type JobDialogKind, jobActions } from './job-actions';
import { FlagBadges } from './job-bits';
import {
  attributeDefs,
  effectiveRadius,
  formatWindow,
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
import { AllocationTab, OverviewTab, SchedulingTab, TimelineTab } from './job-tabs';
import { TraceMapPanel } from './trace-map';

const TABS = ['overview', 'scheduling', 'allocation', 'timeline', 'inspections', 'evidence', 'trace', 'custody'] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABEL: Record<TabKey, string> = {
  overview: 'Overview',
  scheduling: 'Scheduling',
  allocation: 'Allocation',
  timeline: 'Timeline',
  inspections: 'Inspections',
  evidence: 'Evidence',
  trace: 'Trace map',
  custody: 'Custody',
};
/** Plain names for the technical tabs in Basic view. */
const BASIC_TAB_LABEL: Partial<Record<TabKey, string>> = { trace: 'Location trail', custody: 'Chain of custody' };
const isTab = (v: string | null): v is TabKey => v !== null && (TABS as readonly string[]).includes(v);

export function JobDetailView({ id }: { id: string }) {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const tabParam = searchParams.get('tab');
  const tab: TabKey = isTab(tabParam) ? tabParam : 'overview';
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

  if (!isUuid(id)) return <ErrorState error={new Error('That is not a valid job id.')} title="Not found" />;
  if (job.isPending) return <PageSpinner label="Loading job…" />;
  if (job.error) return <ErrorState error={job.error} onRetry={() => void job.refetch()} />;
  const j = job.data;
  if (!j) return <ErrorState error={new Error('This job does not exist, or it belongs to a bank outside your scope.')} title="Job not found" />;

  const attemptRows = attempts.data ?? [];
  const inspectionRows = inspections.data ?? [];
  const actions = jobActions(j, staff, attemptRows.length);
  const schemaDef = definitions.data?.find((d) => d.id === j.job_schema_version_id);
  const attrDefs = attributeDefs(schemaDef?.definition);
  const { radiusM } = effectiveRadius(j, ctx.data);
  const awaitingReview = inspectionRows.filter((i) => (REVIEWABLE_INSPECTION_STATUSES as readonly string[]).includes(i.status) && i.reviews.length === 0).length;
  const canEdit = staff.isAdmin && LOCATION_TYPE_EDITABLE.includes(j.status);
  const refreshing = job.isFetching || inspections.isFetching || events.isFetching;

  const badge: Partial<Record<TabKey, number>> = {
    scheduling: attemptRows.length,
    timeline: events.data?.length,
    inspections: inspectionRows.length,
    evidence: evidence.data?.length,
  };

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{j.reference}</span>
            <span className="font-normal text-muted-foreground">{j.merchant_name}</span>
          </span>
        }
        description={[j.bank ? `${j.bank.code} — ${j.bank.name}` : null, j.trading_name ? `t/a ${j.trading_name}` : null, j.external_ref ? `Bank ref ${j.external_ref}` : null]
          .filter(Boolean)
          .join(' · ')}
        back={{ href: '/jobs', label: 'Jobs' }}
        actions={
          <>
            <Button variant="ghost" size="icon-sm" onClick={() => void invalidateJob(queryClient, id)} title="Refresh" aria-label="Refresh" disabled={refreshing}>
              <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
            </Button>
            <JobActionBar actions={actions} onOpen={setDialog} editHref={canEdit ? `/jobs/${id}/edit` : null} />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={j.status} />
          {advanced ? <DashboardStatusBadge status={j.status} /> : null}
          <FlagBadges flags={j.flags} />
          {awaitingReview ? <Badge tone="warning">Awaiting review</Badge> : null}
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{humanize(j.location_type)}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{j.agent ? (advanced ? employeeName(j.agent) : fullName(j.agent)) : 'Unassigned'}</span>
          {j.scheduled_start ? (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{formatWindow(j.scheduled_start, j.scheduled_end)}</span>
            </>
          ) : null}
          <span className="ml-auto text-sm text-muted-foreground">
            Updated <DateTime value={j.updated_at} mode="relative" />
          </span>
        </div>
      </PageHeader>

      <ConflictsBanner conflicts={conflicts} onDismiss={() => setConflicts([])} />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList className="min-w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {(!advanced && BASIC_TAB_LABEL[t]) || TAB_LABEL[t]}
                {badge[t] ? <span className="rounded bg-slate-100 px-1.5 text-sm tabular-nums text-muted-foreground">{badge[t]}</span> : null}
                {t === 'inspections' && awaitingReview ? <span className="size-2 rounded-full bg-amber-500" aria-label="awaiting review" /> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">
          <OverviewTab job={j} ctx={ctx.data} attrDefs={attrDefs} />
        </TabsContent>
        <TabsContent value="scheduling">
          <SchedulingTab
            job={j}
            attempts={attemptRows}
            loading={attempts.isPending}
            actions={actions}
            onOpen={setDialog}
            canSchedule={staff.hasPermission('schedule_jobs')}
            isAdmin={staff.isAdmin}
          />
        </TabsContent>
        <TabsContent value="allocation">
          <AllocationTab job={j} assignments={assignments.data ?? []} loading={assignments.isPending} actions={actions} onOpen={setDialog} />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineTab events={events.data ?? []} loading={events.isPending} />
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
      </Tabs>

      <JobDialogs job={j} dialog={dialog} onClose={() => setDialog(null)} attempts={attemptRows} onConflicts={setConflicts} />
    </>
  );
}
