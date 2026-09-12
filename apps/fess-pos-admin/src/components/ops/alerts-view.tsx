'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCheck, ExternalLink, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BankSelect } from '@/components/bank-select';
import { CopyButton } from '@/components/copy-button';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { JsonView } from '@/components/json-view';
import { PageHeader } from '@/components/page-header';
import { ToneBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminApi } from '@/lib/api';
import { humanize, shortId } from '@/lib/format';
import { isUuid, queryKeys, useBankLookup } from '@/lib/hooks';
import { toastError } from '@/lib/mutations';
import { Advanced, useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { ALERT_SEVERITY_TONE } from '@/lib/status';
import { fetchRows, pos } from '@/lib/supabase';
import { ALERT_SEVERITIES, type Alert as AlertRow } from '@/lib/types';
import { DetailList, FilterSelect, SectionTitle, UserName } from './ops-shared';

type Mode = 'open' | 'acknowledged';

/** Link to the subject of an alert where the panel has a screen for it (else null). */
function subjectHref(a: AlertRow): string | null {
  const id = a.subject_id;
  const detailJob = typeof a.detail?.job_id === 'string' && isUuid(a.detail.job_id) ? a.detail.job_id : null;
  switch (a.subject_type) {
    case 'job':
      return id ? `/jobs/${id}` : null;
    case 'envelope':
      return id ? `/envelopes?id=${id}` : null;
    case 'approval':
      return '/definitions';
    case 'device':
      return '/devices';
    case 'user':
      return id ? `/users/${id}` : null;
    default:
      return detailJob ? `/jobs/${detailJob}` : null;
  }
}

/** /alerts — operational alerts: open / acknowledged, filters, multi-select acknowledge, detail with subject links. */
export function AlertsView() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const queryClient = useQueryClient();
  const bankLookup = useBankLookup();
  const [mode, setMode] = useState<Mode>('open');
  const [severity, setSeverity] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [bankId, setBankId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AlertRow[]>([]);
  const [tableKey, setTableKey] = useState(0);
  const [detail, setDetail] = useState<AlertRow | null>(null);
  const [acking, setAcking] = useState(false);

  const query = useQuery({
    queryKey: ['alerts', { mode, severity, bankId }],
    queryFn: () => {
      let q = pos().from('alerts').select('*');
      q = mode === 'open' ? q.is('acknowledged_at', null) : q.not('acknowledged_at', 'is', null);
      if (severity) q = q.eq('severity', severity);
      if (bankId) q = q.eq('bank_id', bankId);
      return fetchRows<AlertRow>(q.order(mode === 'open' ? 'created_at' : 'acknowledged_at', { ascending: false }).limit(500));
    },
    refetchInterval: 60_000,
  });

  const kinds = useMemo(() => [...new Set((query.data ?? []).map((a) => a.kind))].sort(), [query.data]);
  const rows = useMemo(() => (query.data ?? []).filter((a) => !kind || a.kind === kind), [query.data, kind]);

  async function acknowledge(ids: string[]) {
    if (ids.length === 0) return;
    setAcking(true);
    try {
      const res = await adminApi.alerts.ack({ ids });
      toast.success(`${res.acknowledged} alert${res.acknowledged === 1 ? '' : 's'} acknowledged`, {
        description: res.acknowledged < ids.length ? 'Some were already acknowledged or are outside your banks.' : undefined,
      });
      setSelected([]);
      setTableKey((k) => k + 1);
      setDetail(null);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['alerts'] }), queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })]);
    } catch (e) {
      toastError(e, 'Could not acknowledge');
    } finally {
      setAcking(false);
    }
  }

  const columns = useMemo<ColumnDef<AlertRow>[]>(
    () => [
      {
        accessorKey: 'severity',
        header: 'Severity',
        cell: ({ row }) => <ToneBadge value={row.original.severity} tones={ALERT_SEVERITY_TONE} />,
      },
      { accessorKey: 'kind', header: 'Kind', meta: { advanced: true }, cell: ({ row }) => <code className="whitespace-nowrap text-xs">{row.original.kind}</code> },
      { accessorKey: 'message', header: 'Message', cell: ({ row }) => <div className="min-w-72 max-w-xl break-words">{row.original.message}</div> },
      {
        id: 'subject',
        accessorFn: (a) => `${a.subject_type ?? ''} ${a.subject_id ?? ''}`,
        header: 'About',
        cell: ({ row }) =>
          row.original.subject_type ? (
            <span className="whitespace-nowrap">
              {humanize(row.original.subject_type)}
              {advanced ? <code className="ml-1 text-xs text-muted-foreground">{shortId(row.original.subject_id)}</code> : null}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'bank_id',
        header: 'Bank',
        cell: ({ row }) => <span className="whitespace-nowrap">{row.original.bank_id ? (bankLookup(row.original.bank_id)?.code ?? (advanced ? shortId(row.original.bank_id) : '—')) : '—'}</span>,
      },
      {
        accessorKey: 'created_at',
        header: mode === 'open' ? 'Raised' : 'Acknowledged',
        cell: ({ row }) => <DateTime value={mode === 'open' ? row.original.created_at : row.original.acknowledged_at} showRelative />,
      },
    ],
    [bankLookup, mode, advanced],
  );

  const href = detail ? subjectHref(detail) : null;

  return (
    <>
      <PageHeader
        title="Alerts"
        description={
          advanced
            ? 'Operational alerts — dead letters, quarantines, SLO breaches, conflicts and approval requests. Acknowledging records who handled it; it does not fix the cause.'
            : 'Things that need someone to look at them. Acknowledging records who handled an alert; it does not fix the cause.'
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
            {query.isFetching ? null : <RefreshCw />} Refresh
          </Button>
        }
      />
      <Tabs
        value={mode}
        onValueChange={(v) => {
          setMode(v as Mode);
          setSelected([]);
          setTableKey((k) => k + 1);
        }}
        className="mb-3"
      >
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="acknowledged">Acknowledged</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable
        key={tableKey}
        columns={columns}
        data={rows}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        getRowId={(r) => r.id}
        onRowClick={setDetail}
        selectable={mode === 'open' && staff.isAdmin}
        onSelectionChange={setSelected}
        searchPlaceholder="Search alerts…"
        emptyTitle={mode === 'open' ? 'No open alerts' : 'No acknowledged alerts'}
        emptyDescription={mode === 'open' ? 'Everything raised so far has been handled.' : undefined}
        toolbar={
          <>
            <FilterSelect
              value={severity}
              onChange={setSeverity}
              options={ALERT_SEVERITIES.map((s) => ({ value: s, label: humanize(s) }))}
              allLabel="All severities"
              aria-label="Severity"
              className="w-40"
            />
            {advanced ? <FilterSelect value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: k }))} allLabel="All kinds" aria-label="Kind" className="w-52" /> : null}
            <div className="w-52">
              <BankSelect value={bankId} onChange={setBankId} allowAll includeInactive />
            </div>
            {mode === 'open' && staff.isAdmin ? (
              <Button type="button" size="sm" disabled={selected.length === 0} loading={acking} onClick={() => void acknowledge(selected.map((a) => a.id))}>
                {acking ? null : <CheckCheck />} Acknowledge{selected.length ? ` ${selected.length}` : ''}
              </Button>
            ) : null}
          </>
        }
      />

      <Sheet open={detail !== null} onOpenChange={(o) => (!o ? setDetail(null) : undefined)}>
        <SheetContent size="lg">
          {detail ? (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <ToneBadge value={detail.severity} tones={ALERT_SEVERITY_TONE} />{' '}
                  {advanced ? <code className="text-sm font-normal">{detail.kind}</code> : <span>{humanize(detail.kind)}</span>}
                </SheetTitle>
                <SheetDescription>{detail.message}</SheetDescription>
              </SheetHeader>
              <SheetBody className="space-y-4">
                <DetailList
                  items={[
                    ['Raised', <DateTime key="c" value={detail.created_at} seconds showRelative />],
                    [
                      'Subject',
                      detail.subject_type ? (
                        <span key="s" className="inline-flex flex-wrap items-center gap-1">
                          {humanize(detail.subject_type)}
                          {advanced && detail.subject_id ? (
                            <>
                              <code className="text-xs">{detail.subject_id}</code>
                              <CopyButton value={detail.subject_id} title="Copy subject id" />
                            </>
                          ) : null}
                        </span>
                      ) : (
                        '—'
                      ),
                    ],
                    ['Bank', detail.bank_id ? (bankLookup(detail.bank_id)?.name ?? detail.bank_id) : 'None (all banks)'],
                    ...(advanced ? ([['Dedupe key', detail.dedupe_key ? <code key="d" className="break-all text-xs">{detail.dedupe_key}</code> : '—']] as [ReactNode, ReactNode][]) : []),
                    [
                      'Acknowledged',
                      detail.acknowledged_at ? (
                        <span key="a">
                          <UserName id={detail.acknowledged_by} /> · <DateTime value={detail.acknowledged_at} />
                        </span>
                      ) : (
                        'Not yet'
                      ),
                    ],
                  ]}
                />
                {href ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={href}>
                      <ExternalLink /> Open {humanize(detail.subject_type ?? 'job')}
                    </Link>
                  </Button>
                ) : null}
                <div>
                  <SectionTitle>Details</SectionTitle>
                  <JsonView value={detail.detail} defaultExpandDepth={2} />
                  <Advanced>
                    <span className="sr-only">Raw JSON is available above.</span>
                  </Advanced>
                </div>
                {!detail.acknowledged_at && staff.isAdmin ? (
                  <Button type="button" onClick={() => void acknowledge([detail.id])} loading={acking}>
                    {acking ? null : <CheckCheck />} Acknowledge
                  </Button>
                ) : null}
              </SheetBody>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
