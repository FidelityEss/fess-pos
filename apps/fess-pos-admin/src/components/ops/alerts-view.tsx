'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCheck, ExternalLink, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BankSelect } from '@/components/bank-select';
import { CopyButton } from '@/components/copy-button';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { Details } from '@/components/details';
import { JsonView } from '@/components/json-view';
import { PageHeader } from '@/components/page-header';
import { navItem } from '@/components/shell/nav';
import { ToneBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminApi } from '@/lib/api';
import { shortId } from '@/lib/format';
import { isUuid, queryKeys, useBankLookup } from '@/lib/hooks';
import { labelFrom } from '@/lib/labels';
import { toastError } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { ALERT_SEVERITY_LABEL, ALERT_SEVERITY_TONE } from '@/lib/status';
import { fetchRows, pos } from '@/lib/supabase';
import { ALERT_SEVERITIES, type Alert as AlertRow } from '@/lib/types';
import { ALERT_KIND_LABEL, ALERT_SUBJECT_LABEL } from './ops-labels';
import { DetailList, FilterSelect, UserName } from './ops-shared';

type Mode = 'open' | 'acknowledged';

/** Link to the subject of an alert where the panel has a screen for it, with the button text (else null). */
function subjectLink(a: AlertRow): { href: string; label: string } | null {
  const id = a.subject_id;
  const detailJob = typeof a.detail?.job_id === 'string' && isUuid(a.detail.job_id) ? a.detail.job_id : null;
  switch (a.subject_type) {
    case 'job':
      return id ? { href: `/jobs/${id}`, label: 'Open the job' } : null;
    case 'envelope':
      return id ? { href: `/envelopes?id=${id}`, label: 'Open the incoming data' } : null;
    case 'approval':
      return { href: '/definitions', label: `Open ${navItem('/definitions')?.label ?? 'Inspection set-up'}` };
    case 'device':
      return { href: '/devices', label: `Open ${navItem('/devices')?.label ?? 'Phones and sign-ins'}` };
    case 'user':
      return id ? { href: `/users/${id}`, label: 'Open the person' } : null;
    default:
      return detailJob ? { href: `/jobs/${detailJob}`, label: 'Open the job' } : null;
  }
}

/** /alerts — operational alerts: open / dealt with, filters, mark several as dealt with, detail with links. */
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
      toast.success(`${res.acknowledged} alert${res.acknowledged === 1 ? '' : 's'} marked as dealt with.`, {
        description: res.acknowledged < ids.length ? 'Some were already marked, or belong to banks you can’t see.' : undefined,
      });
      setSelected([]);
      setTableKey((k) => k + 1);
      setDetail(null);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['alerts'] }), queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })]);
    } catch (e) {
      toastError(e, 'Couldn’t mark the alerts as dealt with. Try again.');
    } finally {
      setAcking(false);
    }
  }

  const columns = useMemo<ColumnDef<AlertRow>[]>(
    () => [
      {
        accessorKey: 'severity',
        header: 'How urgent',
        cell: ({ row }) => <ToneBadge value={row.original.severity} tones={ALERT_SEVERITY_TONE} labels={ALERT_SEVERITY_LABEL} />,
      },
      {
        accessorKey: 'kind',
        header: 'Type',
        cell: ({ row }) => (
          <span className="whitespace-nowrap" title={advanced ? row.original.kind : undefined}>
            {labelFrom(ALERT_KIND_LABEL, row.original.kind)}
          </span>
        ),
      },
      { accessorKey: 'message', header: 'What happened', cell: ({ row }) => <div className="min-w-72 max-w-xl break-words">{row.original.message}</div> },
      {
        id: 'subject',
        accessorFn: (a) => `${a.subject_type ?? ''} ${a.subject_id ?? ''}`,
        header: 'About',
        cell: ({ row }) =>
          row.original.subject_type ? (
            <span className="whitespace-nowrap">
              {labelFrom(ALERT_SUBJECT_LABEL, row.original.subject_type)}
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
        header: mode === 'open' ? 'Noticed' : 'Dealt with',
        cell: ({ row }) => <DateTime value={mode === 'open' ? row.original.created_at : row.original.acknowledged_at} showRelative />,
      },
    ],
    [bankLookup, mode, advanced],
  );

  const link = detail ? subjectLink(detail) : null;

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Problems the system noticed, such as a phone that stopped sending. Once you’ve sorted one out, mark it as dealt with: that records who handled it, but doesn’t fix anything by itself."
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
          <TabsTrigger value="open">Still open</TabsTrigger>
          <TabsTrigger value="acknowledged">Dealt with</TabsTrigger>
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
        emptyTitle={mode === 'open' ? 'No open alerts' : 'Nothing dealt with yet'}
        emptyDescription={mode === 'open' ? 'Nothing needs your attention right now.' : 'Alerts you mark as dealt with appear here.'}
        toolbar={
          <>
            <FilterSelect
              value={severity}
              onChange={setSeverity}
              options={ALERT_SEVERITIES.map((s) => ({ value: s, label: ALERT_SEVERITY_LABEL[s] }))}
              allLabel="Any urgency"
              aria-label="How urgent"
              className="w-40"
            />
            <FilterSelect
              value={kind}
              onChange={setKind}
              options={kinds.map((k) => ({ value: k, label: labelFrom(ALERT_KIND_LABEL, k) }))}
              allLabel="Any type"
              aria-label="Type"
              className="w-60"
            />
            <div className="w-52">
              <BankSelect value={bankId} onChange={setBankId} allowAll includeInactive />
            </div>
            {mode === 'open' && staff.isAdmin ? (
              <Button
                type="button"
                size="sm"
                disabled={selected.length === 0}
                loading={acking}
                onClick={() => void acknowledge(selected.map((a) => a.id))}
                title="Records that you’ve dealt with the ticked alerts. It doesn’t fix the problem itself."
              >
                {acking ? null : <CheckCheck />} Mark as dealt with{selected.length ? ` (${selected.length})` : ''}
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
                  <ToneBadge value={detail.severity} tones={ALERT_SEVERITY_TONE} labels={ALERT_SEVERITY_LABEL} />{' '}
                  <span>{labelFrom(ALERT_KIND_LABEL, detail.kind)}</span>
                </SheetTitle>
                <SheetDescription>{detail.message}</SheetDescription>
              </SheetHeader>
              <SheetBody className="space-y-4">
                <DetailList
                  items={[
                    ['Noticed', <DateTime key="c" value={detail.created_at} seconds showRelative />],
                    ['About', detail.subject_type ? labelFrom(ALERT_SUBJECT_LABEL, detail.subject_type) : '—'],
                    ['Bank', detail.bank_id ? (bankLookup(detail.bank_id)?.name ?? (advanced ? detail.bank_id : '—')) : 'Not tied to one bank'],
                    [
                      'Dealt with',
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
                {link ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={link.href}>
                      <ExternalLink /> {link.label}
                    </Link>
                  </Button>
                ) : null}
                <Details summary="Technical details">
                  <DetailList
                    items={[
                      ['Type code', <code key="k" className="text-xs">{detail.kind}</code>],
                      [
                        'About (ID)',
                        detail.subject_id ? (
                          <span key="s" className="inline-flex flex-wrap items-center gap-1">
                            <code className="break-all text-xs">{detail.subject_id}</code>
                            <CopyButton value={detail.subject_id} title="Copy ID" />
                          </span>
                        ) : (
                          '—'
                        ),
                      ],
                      ['Repeat key', detail.dedupe_key ? <code key="d" className="break-all text-xs">{detail.dedupe_key}</code> : '—'],
                    ]}
                  />
                  <JsonView value={detail.detail} defaultExpandDepth={2} />
                </Details>
                {!detail.acknowledged_at && staff.isAdmin ? (
                  <div className="space-y-1.5">
                    <Button type="button" onClick={() => void acknowledge([detail.id])} loading={acking}>
                      {acking ? null : <CheckCheck />} Mark as dealt with
                    </Button>
                    <p className="text-sm text-muted-foreground">This records that you handled it. It doesn’t fix the problem itself.</p>
                  </div>
                ) : null}
              </SheetBody>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
