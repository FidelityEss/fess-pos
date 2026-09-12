'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Bell, ClipboardCheck, FileWarning, Inbox, type LucideIcon, RefreshCw, Smartphone } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { useNow } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { useCanAccessPath } from '@/components/shell/nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi } from '@/lib/api';
import { ageMs, formatDuration, formatNumber, formatTime, humanize } from '@/lib/format';
import { queryKeys } from '@/lib/hooks';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { DASHBOARD_GROUPS, type DashboardGroup, dashboardStatus, JOB_STATUS_LABEL, type StatusTone } from '@/lib/status';
import { callRpc } from '@/lib/supabase';
import type { DashboardSummary, JobStatus, QueueDepths } from '@/lib/types';
import { cn } from '@/lib/utils';

const TONE_BORDER: Record<StatusTone, string> = {
  neutral: 'border-l-slate-400',
  info: 'border-l-sky-500',
  accent: 'border-l-blue-600',
  progress: 'border-l-violet-500',
  success: 'border-l-emerald-500',
  warning: 'border-l-amber-500',
  danger: 'border-l-red-500',
  muted: 'border-l-slate-300',
};

const DAY_MS = 24 * 3600_000;

function breakdownLabel(status: JobStatus): string {
  return status === 'scheduled' ? 'Appointment confirmed' : JOB_STATUS_LABEL[status];
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-lg font-semibold">{children}</h2>;
}

/** One of the six scope dashboard statuses; links to /jobs?dash=<key>. */
function StatusCard({ group, counts, loading }: { group: DashboardGroup; counts: Partial<Record<JobStatus, number>>; loading: boolean }) {
  const total = group.statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  return (
    <Link
      href={`/jobs?dash=${group.key}`}
      className={cn(
        'group block rounded-lg border border-l-4 bg-card p-4 shadow-xs transition hover:border-primary/40 hover:shadow-sm',
        TONE_BORDER[group.tone],
      )}
    >
      <div className="text-base font-medium text-slate-700 group-hover:text-foreground">{group.label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{loading ? <Skeleton className="h-9 w-14" /> : formatNumber(total)}</div>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {group.statuses.map((s) => (
          <li key={s} className="flex justify-between gap-2 leading-snug" title={dashboardStatus(s).displayLabel}>
            <span>{breakdownLabel(s)}</span>
            <span className="tabular-nums">{loading ? '–' : formatNumber(counts[s] ?? 0)}</span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

/** Operational metric tile; links when `href` is set and accessible. */
function OpsTile({
  icon: Icon,
  title,
  value,
  href,
  tone = 'default',
  loading,
  children,
}: {
  icon: LucideIcon;
  title: string;
  value: number | undefined;
  href?: string;
  tone?: 'default' | 'warning' | 'danger';
  loading: boolean;
  children?: ReactNode;
}) {
  const className = cn(
    'block rounded-lg border bg-card p-4 shadow-xs',
    tone === 'danger' && 'border-red-200 bg-red-50/60',
    tone === 'warning' && 'border-amber-200 bg-amber-50/50',
    href && 'transition hover:border-primary/40 hover:shadow-sm',
  );
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-medium text-slate-700">{title}</span>
        <Icon className={cn('size-5', tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-muted-foreground')} />
      </div>
      <div className={cn('mt-1 text-3xl font-semibold tabular-nums', tone === 'danger' && 'text-red-700')}>
        {loading ? <Skeleton className="h-9 w-14" /> : formatNumber(value ?? 0)}
      </div>
      {children && !loading ? <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">{children}</div> : null}
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function toCount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Pair each queue with its `<name>_dlq` dead-letter queue. */
function queueRows(q: QueueDepths): { name: string; depth: number | null; dlq: number | null }[] {
  const names = new Set<string>();
  for (const k of Object.keys(q)) names.add(k.endsWith('_dlq') ? k.slice(0, -4) : k);
  return [...names].sort().map((name) => ({ name, depth: toCount(q[name]), dlq: toCount(q[`${name}_dlq`]) }));
}

function QueueDepthsCard({ query }: { query: UseQueryResult<QueueDepths, Error> }) {
  if (query.error) return <ApiErrorAlert error={query.error} title="Queue depths unavailable" onRetry={() => void query.refetch()} />;
  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  const rows = queueRows(query.data);
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Queue</TableHead>
            <TableHead className="text-right">Depth</TableHead>
            <TableHead className="text-right">Dead letters</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                No queues reported
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell>
                  <span className="font-medium">{humanize(r.name)}</span> <code className="ml-1 text-xs text-muted-foreground">{r.name}</code>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.depth === null ? '—' : formatNumber(r.depth)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.dlq === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : r.dlq > 0 ? (
                    <Badge tone="danger">{formatNumber(r.dlq)}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Dashboard: six status cards, operational tiles and queue depths. Data: pos.admin_dashboard() + GET /queues. */
export function DashboardView() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const canAccessPath = useCanAccessPath();
  const now = useNow();
  const summary = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => callRpc<DashboardSummary>('admin_dashboard'),
    refetchInterval: 60_000,
  });
  const queues = useQuery({
    queryKey: queryKeys.queues,
    queryFn: () => adminApi.queues(),
    refetchInterval: 60_000,
    enabled: staff.isAdmin && advanced,
  });

  const s = summary.data;
  const loading = summary.isPending;
  const counts = s?.jobs_by_status ?? {};
  const linkIf = (href: string) => (canAccessPath(href) ? href : undefined);
  const critical = s?.open_alerts_critical ?? 0;
  const oldestAge = ageMs(s?.custody?.oldest_pending_at, now);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Welcome, ${staff.me.first_name}. Live overview ${staff.me.bank_ids === null ? 'across all banks' : 'for your banks'} — refreshes every minute.`}
        actions={
          <>
            {summary.dataUpdatedAt ? <span className="text-sm text-muted-foreground">Updated {formatTime(summary.dataUpdatedAt)}</span> : null}
            <Button
              variant="outline"
              size="sm"
              loading={summary.isFetching || queues.isFetching}
              onClick={() => {
                void summary.refetch();
                if (staff.isAdmin && advanced) void queues.refetch();
              }}
            >
              {summary.isFetching || queues.isFetching ? null : <RefreshCw />} Refresh
            </Button>
          </>
        }
      />

      {summary.error ? (
        <ApiErrorAlert error={summary.error} title="Dashboard summary unavailable" onRetry={() => void summary.refetch()} className="mb-5" />
      ) : null}

      <section className="mb-8">
        <SectionTitle>Jobs by status</SectionTitle>
        {/* Breakpoints don't grow with the text size, so at Large / Extra large the six cards use three columns. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 [[data-text-size=large]_&]:xl:grid-cols-3 [[data-text-size=xlarge]_&]:xl:grid-cols-3">
          {DASHBOARD_GROUPS.map((g) => (
            <StatusCard key={g.key} group={g} counts={counts} loading={loading && !summary.error} />
          ))}
        </div>
        {(counts.closed ?? 0) > 0 ? <p className="mt-2 text-sm text-muted-foreground">Archived (closed): {formatNumber(counts.closed)}</p> : null}
      </section>

      <section className="mb-8">
        <SectionTitle>{advanced ? 'Operations' : 'Needs your attention'}</SectionTitle>
        <div className={cn('grid gap-3 sm:grid-cols-2', advanced ? 'xl:grid-cols-5 [[data-text-size=large]_&]:xl:grid-cols-3 [[data-text-size=xlarge]_&]:xl:grid-cols-3' : 'xl:grid-cols-3')}>
          <OpsTile
            icon={Bell}
            title="Open alerts"
            value={s?.open_alerts}
            href={linkIf('/alerts')}
            loading={loading && !summary.error}
            tone={critical > 0 ? 'danger' : 'default'}
          >
            {critical > 0 ? <Badge tone="danger">{formatNumber(critical)} critical</Badge> : <span>None critical</span>}
          </OpsTile>
          <OpsTile
            icon={ClipboardCheck}
            title="Awaiting review"
            value={s?.awaiting_review}
            href={linkIf('/review')}
            loading={loading && !summary.error}
          />
          <OpsTile
            icon={Smartphone}
            title={advanced ? 'Custody backlog (pending items)' : 'Still on agents’ phones'}
            value={s?.custody?.pending_items}
            href={advanced ? linkIf('/custody') : undefined}
            loading={loading && !summary.error}
            tone={oldestAge !== null && oldestAge > DAY_MS ? 'warning' : 'default'}
          >
            {advanced ? (
              <>
                <p>{formatNumber(s?.custody?.devices_with_backlog ?? 0)} devices with backlog</p>
                <p>Oldest pending: {oldestAge === null ? '—' : `${formatDuration(oldestAge)} ago`}</p>
              </>
            ) : (
              <p>
                Items waiting to upload from {formatNumber(s?.custody?.devices_with_backlog ?? 0)} phone{s?.custody?.devices_with_backlog === 1 ? '' : 's'}
                {oldestAge !== null ? ` · oldest ${formatDuration(oldestAge)}` : ''}
              </p>
            )}
          </OpsTile>
          {advanced ? (
            <>
              <OpsTile
                icon={FileWarning}
                title="Incomplete manifests"
                value={s?.incomplete_manifests}
                href={linkIf('/custody')}
                loading={loading && !summary.error}
                tone={(s?.incomplete_manifests ?? 0) > 0 ? 'warning' : 'default'}
              />
              <OpsTile
                icon={Inbox}
                title="Envelopes needing attention"
                value={s?.envelopes_needing_attention}
                href={linkIf('/envelopes')}
                loading={loading && !summary.error}
                tone={(s?.envelopes_needing_attention ?? 0) > 0 ? 'warning' : 'default'}
              />
            </>
          ) : null}
        </div>
      </section>

      {staff.isAdmin && advanced ? (
        <section>
          <SectionTitle>Queues</SectionTitle>
          <QueueDepthsCard query={queues} />
        </section>
      ) : null}
    </>
  );
}
