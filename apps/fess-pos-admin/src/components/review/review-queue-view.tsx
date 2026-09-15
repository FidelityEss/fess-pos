'use client';

// /review — inspections awaiting a decision (submitted / verifying / under_review / integrity_failed with no
// reviews row), newest first. Each row links to the job detail's Inspections tab for that attempt.
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BankSelect } from '@/components/bank-select';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { FlagBadges } from '@/components/jobs/job-bits';
import { type BankRef, JOB_LIST_LIMIT, type PersonRef, REVIEWABLE_INSPECTION_STATUSES } from '@/components/jobs/job-data';
import { PageHeader } from '@/components/page-header';
import { InspectionStatusBadge } from '@/components/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { employeeName, fullName } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { fetchRows, pos } from '@/lib/supabase';
import type { Inspection } from '@/lib/types';
import { cn } from '@/lib/utils';

type QueueRow = Pick<
  Inspection,
  'id' | 'job_id' | 'attempt' | 'status' | 'flags' | 'submitted_at_server' | 'submitted_at_device' | 'evidence_expected' | 'evidence_received' | 'evidence_verified'
> & {
  agent: PersonRef | null;
  job: { id: string; reference: string; merchant_name: string; bank_id: string; bank: BankRef | null } | null;
  reviews: { id: string }[];
};

const SELECT =
  'id,job_id,attempt,status,flags,submitted_at_server,submitted_at_device,evidence_expected,evidence_received,evidence_verified,' +
  'agent:pos_users(first_name,last_name,employee_number),job:jobs(id,reference,merchant_name,bank_id,bank:banks(code,name)),reviews(id)';

/** Flags that deserve attention in the queue. */
const HOT_FLAGS = ['geofence_override', 'non_current_version'];

function isHot(r: QueueRow): boolean {
  return r.status === 'integrity_failed' || r.flags.some((f) => HOT_FLAGS.includes(f));
}

function reviewHref(r: QueueRow): string {
  return `/jobs/${r.job_id}?tab=inspections&inspection=${r.id}`;
}

export function ReviewQueueView() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const router = useRouter();
  const [bankId, setBankId] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const canReview = staff.hasPermission('review_inspections');

  const query = useQuery({
    queryKey: ['review-queue'],
    queryFn: async () => {
      const rows = await fetchRows<QueueRow>(
        pos()
          .from('inspections')
          .select(SELECT)
          .in('status', [...REVIEWABLE_INSPECTION_STATUSES])
          .order('submitted_at_server', { ascending: false, nullsFirst: false })
          .limit(JOB_LIST_LIMIT),
      );
      return rows.filter((r) => r.reviews.length === 0);
    },
    refetchInterval: 60_000,
    enabled: canReview,
  });

  const rows = useMemo(
    () => (query.data ?? []).filter((r) => (!bankId || r.job?.bank_id === bankId) && (!onlyFlagged || isHot(r))),
    [query.data, bankId, onlyFlagged],
  );

  const columns = useMemo<ColumnDef<QueueRow>[]>(
    () => [
      {
        id: 'reference',
        accessorFn: (r) => r.job?.reference ?? '',
        header: 'Job',
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            <Link href={reviewHref(row.original)} onClick={(e) => e.stopPropagation()} className="font-mono text-sm font-medium text-primary hover:underline">
              {row.original.job?.reference ?? row.original.job_id}
            </Link>
            {!advanced && row.original.attempt > 1 ? <div className="text-sm text-muted-foreground">Visit {row.original.attempt}</div> : null}
          </div>
        ),
      },
      {
        id: 'merchant',
        accessorFn: (r) => r.job?.merchant_name ?? '',
        header: 'Merchant',
        cell: ({ row }) => <div className="min-w-44 max-w-72 break-words font-medium">{row.original.job?.merchant_name ?? '—'}</div>,
      },
      { id: 'bank', accessorFn: (r) => r.job?.bank?.code ?? '', header: 'Bank', cell: ({ row }) => <span className="whitespace-nowrap" title={row.original.job?.bank?.name}>{row.original.job?.bank?.code ?? '—'}</span> },
      {
        id: 'agent',
        accessorFn: (r) => (r.agent ? employeeName(r.agent) : ''),
        header: 'Agent',
        cell: ({ row }) => <span className="whitespace-nowrap">{row.original.agent ? (advanced ? employeeName(row.original.agent) : fullName(row.original.agent)) : '—'}</span>,
      },
      { accessorKey: 'attempt', header: 'Visit', meta: { advanced: true }, cell: ({ row }) => <span className="tabular-nums">{row.original.attempt}</span> },
      {
        id: 'submitted',
        accessorFn: (r) => r.submitted_at_server ?? '',
        header: 'Sent in',
        cell: ({ row }) => (advanced ? <DateTime value={row.original.submitted_at_server} showRelative /> : <DateTime value={row.original.submitted_at_server} mode="relative" />),
      },
      {
        id: 'evidence',
        accessorFn: (r) => (r.evidence_expected ? r.evidence_verified / r.evidence_expected : 1),
        header: 'Photos',
        cell: ({ row }) => {
          const r = row.original;
          const done = r.evidence_verified >= r.evidence_expected;
          return (
            <div className="min-w-32 space-y-0.5 whitespace-nowrap text-sm">
              <span className={cn('tabular-nums', done ? 'text-emerald-700' : 'text-amber-700')}>
                {r.evidence_verified} of {r.evidence_expected} checked
              </span>
              {r.evidence_received < r.evidence_expected ? <div className="text-muted-foreground">{r.evidence_expected - r.evidence_received} still to arrive</div> : null}
            </div>
          );
        },
      },
      {
        id: 'status',
        accessorFn: (r) => r.status,
        header: advanced ? 'Status and warnings' : 'Status',
        cell: ({ row }) => (
          <div className="flex min-w-44 max-w-64 flex-wrap items-center gap-1">
            <InspectionStatusBadge status={row.original.status} />
            <FlagBadges flags={row.original.flags} max={advanced ? undefined : 1} />
          </div>
        ),
      },
      {
        id: 'action',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <Button size="sm" variant="outline" asChild>
            <Link href={reviewHref(row.original)} onClick={(e) => e.stopPropagation()}>
              Review
            </Link>
          </Button>
        ),
      },
    ],
    [advanced],
  );

  if (!canReview) {
    return (
      <>
        <PageHeader title="To review" />
        <Alert variant="info">
          <AlertDescription>Reviewing visits needs permission to review visits. Ask an administrator if you need it.</AlertDescription>
        </Alert>
      </>
    );
  }

  const flaggedCount = (query.data ?? []).filter(isHot).length;

  return (
    <>
      <PageHeader
        title="To review"
        description={`Finished visits waiting for someone to check the answers and photos and approve them, newest first. You can read a visit while its photos are still arriving, and approve it once they’re all checked.`}
        actions={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
            {query.isFetching ? null : <RefreshCw />} Refresh
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        getRowId={(r) => r.id}
        onRowClick={(r) => router.push(reviewHref(r))}
        rowClassName={(r) => (r.status === 'integrity_failed' ? 'bg-red-50/60' : isHot(r) ? 'bg-amber-50/50' : undefined)}
        searchPlaceholder="Search by reference, merchant or agent"
        emptyTitle="Nothing to review"
        emptyDescription="Visits show here as soon as agents’ phones send them in."
        toolbar={
          <>
            <BankSelect value={bankId} onChange={setBankId} allowAll includeInactive className="w-52" />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={onlyFlagged} onCheckedChange={(v) => setOnlyFlagged(v === true)} />
              Only ones needing extra care
              {flaggedCount ? <Badge tone="warning">{flaggedCount}</Badge> : null}
            </label>
            <span className="ml-auto text-sm text-muted-foreground">
              {advanced
                ? 'Highlighted: failed a security check (red); started away from the site or used an older version of the questions (amber).'
                : 'Red rows failed a security check. Amber rows started away from the site or used an older version of the questions.'}
            </span>
          </>
        }
      />
    </>
  );
}
