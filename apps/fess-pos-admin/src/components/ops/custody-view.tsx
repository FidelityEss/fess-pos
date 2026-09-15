'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { BatteryWarning, Clock, Inbox, type LucideIcon, RefreshCw, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useMemo } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { DataTable } from '@/components/data-table';
import { DateTime, useNow } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { ToneBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi } from '@/lib/api';
import { ageMs, formatDuration, formatNumber, shortId } from '@/lib/format';
import { queryKeys } from '@/lib/hooks';
import { labelFrom } from '@/lib/labels';
import { useIsAdvanced } from '@/lib/preferences';
import { INSPECTION_STATUS_LABEL, INSPECTION_STATUS_TONE } from '@/lib/status';
import { DbError, fetchRows, pos } from '@/lib/supabase';
import type { DeviceSyncStatus, Inspection, QueueDepths } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ENVELOPE_TYPE_LABEL, QUEUE_LABEL } from './ops-labels';
import { AgeBadge, HOUR_MS, SectionTitle, toCount, UserName } from './ops-shared';

// Timeliness thresholds (docs/12 §9, proposed D-34).
const PENDING_WARN = 4 * HOUR_MS;
const PENDING_ALERT = 24 * HOUR_MS;
const MANIFEST_WARN = 6 * HOUR_MS;
const MANIFEST_ALERT = 24 * HOUR_MS;
const LOW_STORAGE_MB = 200;

/** What a phone still holds, by kind (sync_report.pending keys; free-form, so unknown keys are humanized). */
const PENDING_KIND_LABEL: Record<string, string> = {
  ...ENVELOPE_TYPE_LABEL,
  envelopes: 'Data',
  evidence: 'Photos',
  photos: 'Photos',
  traces: 'Location trail',
};

type ManifestRow = Pick<
  Inspection,
  'id' | 'job_id' | 'user_id' | 'device_id' | 'status' | 'evidence_expected' | 'evidence_received' | 'evidence_verified' | 'submitted_at_server'
> & { job: { id: string; reference: string; bank_id: string } | null };

const custodyKeys = {
  status: ['custody', 'device_sync_status'] as const,
  manifests: ['custody', 'incomplete_manifests'] as const,
  stuck: ['custody', 'stuck_envelopes'] as const,
};

function Tile({ icon: Icon, title, value, tone = 'default', href, children, loading }: {
  icon: LucideIcon;
  title: string;
  value: ReactNode;
  tone?: 'default' | 'warning' | 'danger';
  href?: string;
  children?: ReactNode;
  loading?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <Icon className={cn('size-4', tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-muted-foreground')} />
      </div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'danger' && 'text-red-700')}>{loading ? <Skeleton className="h-8 w-14" /> : value}</div>
      {children ? <div className="mt-1 text-sm text-muted-foreground">{children}</div> : null}
    </>
  );
  const className = cn(
    'block rounded-lg border bg-card p-3.5',
    tone === 'danger' && 'border-red-200 bg-red-50/60',
    tone === 'warning' && 'border-amber-200 bg-amber-50/50',
    href && 'transition-colors hover:border-primary/40',
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function queueRows(q: QueueDepths) {
  const names = new Set<string>();
  for (const k of Object.keys(q)) names.add(k.endsWith('_dlq') ? k.slice(0, -4) : k);
  return [...names].sort().map((name) => ({ name, depth: toCount(q[name]), dlq: toCount(q[`${name}_dlq`]) }));
}

function QueuesCard({ query }: { query: UseQueryResult<QueueDepths, Error> }) {
  const advanced = useIsAdvanced();
  if (query.error) return <ApiErrorAlert error={query.error} title="Couldn’t load the background work" onRetry={() => void query.refetch()} />;
  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  const rows = queueRows(query.data);
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Work</TableHead>
            <TableHead className="text-right">Waiting</TableHead>
            <TableHead className="text-right">Failed after several tries</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.name} className={cn(r.dlq !== null && r.dlq > 0 && 'bg-red-50/60')}>
              <TableCell>
                <span className="font-medium">{labelFrom(QUEUE_LABEL, r.name)}</span>
                {advanced ? <code className="ml-1 text-xs text-muted-foreground">{r.name}</code> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.depth === null ? '—' : formatNumber(r.depth)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.dlq === null ? <span className="text-muted-foreground">—</span> : r.dlq > 0 ? <Badge tone="danger">{formatNumber(r.dlq)}</Badge> : <span className="text-muted-foreground">0</span>}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                No background work reported.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </Card>
  );
}

/** /custody — data delivery (B7.7, docs/12 §7–10): what phones still hold, visits missing photos, background work and stuck incoming data. */
export function CustodyView() {
  const now = useNow(30_000);
  const status = useQuery({
    queryKey: custodyKeys.status,
    queryFn: () =>
      fetchRows<DeviceSyncStatus>(pos().from('device_sync_status').select('*').order('oldest_pending_at', { ascending: true, nullsFirst: false }).limit(1000)),
    refetchInterval: 60_000,
  });
  const manifests = useQuery({
    queryKey: custodyKeys.manifests,
    queryFn: async () => {
      const rows = await fetchRows<ManifestRow>(
        pos()
          .from('inspections')
          .select('id,job_id,user_id,device_id,status,evidence_expected,evidence_received,evidence_verified,submitted_at_server,job:jobs(id,reference,bank_id)')
          .in('status', ['submitted', 'verifying'])
          .order('submitted_at_server', { ascending: true })
          .limit(1000),
      );
      return rows.filter((r) => r.evidence_verified < r.evidence_expected);
    },
    refetchInterval: 60_000,
  });
  const queues = useQuery({ queryKey: queryKeys.queues, queryFn: () => adminApi.queues(), refetchInterval: 60_000 });
  const stuck = useQuery({
    queryKey: custodyKeys.stuck,
    queryFn: async () => {
      const { count, error } = await pos()
        .from('ingest_envelopes')
        .select('id', { count: 'exact', head: true })
        .in('state', ['received', 'deferred'])
        .lt('received_at', new Date(Date.now() - HOUR_MS).toISOString())
        .or('resolution.is.null,resolution.eq.reprocessed');
      if (error) throw new DbError(error);
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });

  const devices = status.data ?? [];
  const withBacklog = devices.filter((d) => d.pending_total > 0);
  const pendingTotal = devices.reduce((s, d) => s + d.pending_total, 0);
  const oldest = withBacklog.map((d) => ageMs(d.oldest_pending_at, now)).filter((x): x is number => x !== null).sort((a, b) => b - a)[0] ?? null;
  const batteryRestricted = devices.filter((d) => d.battery_restricted).length;
  const dlqTotal = queues.data ? Object.entries(queues.data).filter(([k]) => k.endsWith('_dlq')).reduce((s, [, v]) => s + (toCount(v) ?? 0), 0) : 0;

  const deviceColumns = useMemo<ColumnDef<DeviceSyncStatus>[]>(
    () => [
      { accessorKey: 'user_id', header: 'Agent', cell: ({ row }) => <UserName id={row.original.user_id} className="text-sm" /> },
      {
        accessorKey: 'device_id',
        header: 'Phone ID',
        meta: { advanced: true },
        cell: ({ row }) => (
          <code className="text-xs" title={row.original.device_id}>
            {shortId(row.original.device_id)}
          </code>
        ),
      },
      { accessorKey: 'pending_total', header: 'Waiting to send', meta: { className: 'text-right tabular-nums font-medium', headerClassName: 'text-right' } },
      {
        id: 'pending_by_type',
        accessorFn: (r) => JSON.stringify(r.pending),
        header: 'What’s waiting',
        enableSorting: false,
        cell: ({ row }) => {
          const entries = Object.entries(row.original.pending ?? {}).filter(([, v]) => (toCount(v) ?? 0) > 0);
          return entries.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {entries.map(([k, v]) => (
                <Badge key={k} tone="neutral" title={k}>
                  {labelFrom(PENDING_KIND_LABEL, k)}: {String(v)}
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        id: 'oldest',
        accessorFn: (r) => (r.oldest_pending_at ? Date.parse(r.oldest_pending_at) : Number.POSITIVE_INFINITY),
        header: 'Oldest has waited',
        cell: ({ row }) =>
          row.original.pending_total > 0 ? <AgeBadge ms={ageMs(row.original.oldest_pending_at, now)} warnMs={PENDING_WARN} alertMs={PENDING_ALERT} /> : <span className="text-muted-foreground">—</span>,
      },
      { accessorKey: 'last_success_at', header: 'Last sent', cell: ({ row }) => <DateTime value={row.original.last_success_at} mode="relative" /> },
      { accessorKey: 'received_at', header: 'Last check-in', cell: ({ row }) => <DateTime value={row.original.received_at} mode="relative" /> },
      {
        accessorKey: 'battery_restricted',
        header: 'Battery saving',
        cell: ({ row }) =>
          row.original.battery_restricted ? (
            <Badge tone="warning" title="The phone may hold data back to save battery">
              <BatteryWarning /> On
            </Badge>
          ) : row.original.battery_restricted === false ? (
            <span className="text-sm text-muted-foreground">Off</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'free_storage_mb',
        header: 'Free space',
        meta: { className: 'text-right tabular-nums', headerClassName: 'text-right' },
        cell: ({ row }) => {
          const mb = row.original.free_storage_mb;
          return mb === null ? '—' : <span className={cn(mb < LOW_STORAGE_MB && 'font-medium text-amber-700')}>{formatNumber(mb)} MB</span>;
        },
      },
      { accessorKey: 'module_version', header: 'App version', cell: ({ row }) => <span className="whitespace-nowrap text-sm">{row.original.module_version ?? '—'}</span> },
    ],
    [now],
  );

  const refreshing = status.isFetching || manifests.isFetching || queues.isFetching || stuck.isFetching;

  return (
    <>
      <PageHeader
        title="Data delivery"
        actions={
          <Button
            variant="outline"
            size="sm"
            loading={refreshing}
            onClick={() => {
              void status.refetch();
              void manifests.refetch();
              void queues.refetch();
              void stuck.refetch();
            }}
          >
            {refreshing ? null : <RefreshCw />} Refresh
          </Button>
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile icon={Smartphone} title="Phones still holding data" value={formatNumber(withBacklog.length)} loading={status.isPending}>
          {formatNumber(devices.length)} phones checked in · {formatNumber(pendingTotal)} items waiting to be sent
        </Tile>
        <Tile
          icon={Clock}
          title="Longest wait"
          value={oldest === null ? '—' : formatDuration(oldest)}
          tone={oldest !== null && oldest > PENDING_ALERT ? 'danger' : oldest !== null && oldest > PENDING_WARN ? 'warning' : 'default'}
          loading={status.isPending}
        >
          Amber after 4 hours, red after 24 hours
        </Tile>
        <Tile
          icon={BatteryWarning}
          title="Phones on battery saving"
          value={formatNumber(batteryRestricted)}
          tone={batteryRestricted > 0 ? 'warning' : 'default'}
          loading={status.isPending}
        >
          These phones may hold data back to save battery
        </Tile>
        <Tile
          icon={Inbox}
          title="Incoming data stuck over an hour"
          value={stuck.error ? '—' : formatNumber(stuck.data ?? 0)}
          tone={(stuck.data ?? 0) > 0 ? 'warning' : 'default'}
          href="/envelopes?attention=stuck"
          loading={stuck.isPending}
        >
          Arrived but not saved yet
        </Tile>
        <Tile icon={Inbox} title="Failed after several tries" value={formatNumber(dlqTotal)} tone={dlqTotal > 0 ? 'danger' : 'default'} loading={queues.isPending}>
          This should always be 0
        </Tile>
      </section>
      {stuck.error ? <ApiErrorAlert error={stuck.error} title="Couldn’t count the stuck incoming data. Try refreshing." className="mb-4" /> : null}

      <section className="mb-6">
        <SectionTitle>What each phone still has to send (from its last check-in)</SectionTitle>
        <DataTable
          columns={deviceColumns}
          data={devices}
          isLoading={status.isPending}
          error={status.error}
          onRetry={() => void status.refetch()}
          getRowId={(r) => r.id}
          initialSorting={[{ id: 'oldest', desc: false }]}
          rowClassName={(r) => {
            const age = r.pending_total > 0 ? ageMs(r.oldest_pending_at, now) : null;
            return age !== null && age > PENDING_ALERT ? 'bg-red-50/50' : age !== null && age > PENDING_WARN ? 'bg-amber-50/40' : undefined;
          }}
          searchPlaceholder="Search phones…"
          emptyTitle="No phones have checked in yet"
          emptyDescription="Each phone reports what it still has to send whenever it connects."
        />
      </section>

      <section className="mb-6">
        <SectionTitle>Visits sent in with photos still missing</SectionTitle>
        {manifests.error ? <ApiErrorAlert error={manifests.error} onRetry={() => void manifests.refetch()} /> : null}
        <Card className="overflow-hidden">
          {manifests.isPending ? (
            <Skeleton className="m-4 h-20" />
          ) : (manifests.data ?? []).length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Every visit that was sent in has all its photos, and they passed their checks.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Visit status</TableHead>
                  <TableHead className="text-right">Photos checked / received / expected</TableHead>
                  <TableHead>Sent in</TableHead>
                  <TableHead>Waiting for</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(manifests.data ?? []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Link href={`/jobs/${m.job_id}`} className="whitespace-nowrap font-mono text-sm hover:underline">
                        {m.job?.reference ?? shortId(m.job_id)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <UserName id={m.user_id} />
                    </TableCell>
                    <TableCell>
                      <ToneBadge value={m.status} tones={INSPECTION_STATUS_TONE} labels={INSPECTION_STATUS_LABEL} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="font-medium">{m.evidence_verified}</span> / {m.evidence_received} / {m.evidence_expected}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <DateTime value={m.submitted_at_server} />
                    </TableCell>
                    <TableCell>
                      <AgeBadge ms={ageMs(m.submitted_at_server, now)} warnMs={MANIFEST_WARN} alertMs={MANIFEST_ALERT} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle>Background work</SectionTitle>
        <QueuesCard query={queues} />
      </section>
    </>
  );
}
