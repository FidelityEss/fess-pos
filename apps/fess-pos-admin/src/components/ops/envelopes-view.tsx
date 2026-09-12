'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { RefreshCw } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AgentSelect } from '@/components/agent-select';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { ToneBadge } from '@/components/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { humanize, shortId } from '@/lib/format';
import { useStaff } from '@/lib/staff';
import { ENVELOPE_STATE_TONE } from '@/lib/status';
import { fetchRows, pos } from '@/lib/supabase';
import type { IngestEnvelope } from '@/lib/types';
import { EnvelopeDetailSheet, envelopeKeys } from './envelope-detail';
import { describeError, FilterSelect, HOUR_MS, UserName } from './ops-shared';

type EnvelopeRow = Pick<
  IngestEnvelope,
  | 'id'
  | 'type'
  | 'type_version'
  | 'state'
  | 'received_at'
  | 'last_seen_at'
  | 'user_id'
  | 'device_id'
  | 'attempts'
  | 'error'
  | 'resolution'
  | 'resolved_at'
  | 'module_version'
>;

const LIST_COLS = 'id,type,type_version,state,received_at,last_seen_at,user_id,device_id,attempts,error,waiting_on,resolution,resolved_at,module_version';

/** Held = the rule the backend uses (pos_rpc.ingest_hold / admin_envelope_resolve): received with waiting_on.reprocess. */
function isHeld(e: { state: string; waiting_on?: unknown }): boolean {
  return e.state === 'received' && typeof e.waiting_on === 'object' && e.waiting_on !== null && 'reprocess' in e.waiting_on;
}

const STATE_FILTERS = [
  { value: 'attention', label: 'Needs attention' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'conflict', label: 'Conflict' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'held', label: 'Held (waiting to be reprocessed)' },
  { value: 'stuck', label: 'Stuck > 1 h (received / deferred)' },
  { value: 'received', label: 'Received (all)' },
  { value: 'committed', label: 'Committed' },
  { value: 'duplicate', label: 'Duplicate' },
] as const;

type ResolvedFilter = 'open' | 'resolved';

function fetchEnvelopes(state: string, agentId: string | null): Promise<EnvelopeRow[]> {
  let q = pos().from('ingest_envelopes').select(LIST_COLS);
  switch (state) {
    case 'attention':
      q = q.or('state.in.(rejected,conflict,deferred),and(state.eq.received,waiting_on->reprocess.not.is.null)');
      break;
    case 'held':
      q = q.eq('state', 'received').not('waiting_on->reprocess', 'is', null);
      break;
    case 'stuck':
      q = q.in('state', ['received', 'deferred']).lt('received_at', new Date(Date.now() - HOUR_MS).toISOString());
      break;
    case 'all':
      break;
    default:
      q = q.eq('state', state);
  }
  if (agentId) q = q.eq('user_id', agentId);
  return fetchRows<EnvelopeRow>(q.order('received_at', { ascending: false }).limit(500));
}

/** Open = no final resolution yet (a reprocessed envelope counts as open until it commits or is resolved). */
function isOpen(e: Pick<EnvelopeRow, 'resolution'>): boolean {
  return e.resolution === null || e.resolution === 'reprocessed';
}

/** /envelopes — the envelope inbox (docs/12 §5): rejected, conflict, deferred and held envelopes, with reprocess / resolve. */
export function EnvelopesView() {
  const staff = useStaff();
  const params = useSearchParams();
  const [state, setState] = useState<string | null>(params.get('attention') === 'stuck' ? 'stuck' : (params.get('state') ?? 'attention'));
  const [resolved, setResolved] = useState<ResolvedFilter | null>('open');
  const [type, setType] = useState('');
  const [device, setDevice] = useState('');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get('id'));

  const stateKey = state ?? 'all';
  const query = useQuery({
    queryKey: envelopeKeys.list({ state: stateKey, agentId }),
    queryFn: () => fetchEnvelopes(stateKey, agentId),
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => {
    const t = type.trim().toLowerCase();
    const d = device.trim().toLowerCase();
    return (query.data ?? []).filter((e) => {
      if (resolved === 'open' && !isOpen(e)) return false;
      if (resolved === 'resolved' && isOpen(e)) return false;
      if (t && !e.type.toLowerCase().includes(t)) return false;
      if (d && !(e.device_id ?? '').toLowerCase().includes(d)) return false;
      return true;
    });
  }, [query.data, resolved, type, device]);

  const columns = useMemo<ColumnDef<EnvelopeRow>[]>(
    () => [
      {
        accessorKey: 'received_at',
        header: 'Received',
        cell: ({ row }) => <DateTime value={row.original.received_at} showRelative />,
      },
      {
        accessorKey: 'type',
        header: 'Type',
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-sm">
            {row.original.type} <span className="text-muted-foreground">v{row.original.type_version}</span>
          </span>
        ),
      },
      {
        accessorKey: 'state',
        header: 'State',
        cell: ({ row }) => (
          <span className="inline-flex gap-1">
            <ToneBadge value={row.original.state} tones={ENVELOPE_STATE_TONE} />
            {isHeld(row.original) ? <Badge tone="warning">Held</Badge> : null}
          </span>
        ),
      },
      {
        accessorKey: 'user_id',
        header: 'Agent',
        cell: ({ row }) => <UserName id={row.original.user_id} className="text-sm" />,
      },
      {
        accessorKey: 'device_id',
        header: 'Device',
        cell: ({ row }) => <code className="text-xs" title={row.original.device_id ?? undefined}>{shortId(row.original.device_id)}</code>,
      },
      {
        accessorKey: 'attempts',
        header: 'Attempts',
        meta: { className: 'text-right tabular-nums', headerClassName: 'text-right' },
      },
      {
        id: 'error',
        accessorFn: (r) => describeError(r.error) ?? '',
        header: 'Error',
        cell: ({ row }) => {
          const msg = describeError(row.original.error);
          return msg ? (
            <span className="line-clamp-2 max-w-xs text-sm text-red-800" title={msg}>
              {msg}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        accessorKey: 'resolution',
        header: 'Resolution',
        cell: ({ row }) =>
          row.original.resolution ? (
            <span className="text-sm">
              <Badge tone={row.original.resolution === 'reprocessed' ? 'info' : 'success'}>{humanize(row.original.resolution)}</Badge>{' '}
              <DateTime value={row.original.resolved_at} mode="relative" className="text-muted-foreground" />
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Open</span>
          ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Envelope inbox"
        description="Every device write lands first and is never refused for business reasons. Rejected, conflicting, deferred and held envelopes wait here with their payload and error — reprocess after a fix, attach to a job, or resolve with a reason."
        actions={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
            {query.isFetching ? null : <RefreshCw />} Refresh
          </Button>
        }
      />
      {!staff.isGlobalAdmin ? (
        <Alert variant="info" className="mb-4">
          <AlertDescription>You can inspect envelopes. Reprocess and resolve need an all-bank admin, because envelopes carry no bank (D-44).</AlertDescription>
        </Alert>
      ) : null}
      <DataTable
        columns={columns}
        data={rows}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(r) => setOpenId(r.id)}
        getRowId={(r) => r.id}
        searchPlaceholder="Search loaded envelopes…"
        emptyTitle={stateKey === 'attention' ? 'Inbox is clear' : 'No envelopes'}
        emptyDescription={stateKey === 'attention' ? 'Nothing is rejected, conflicting, deferred or held.' : 'Nothing matches these filters.'}
        toolbar={
          <>
            <FilterSelect value={state} onChange={setState} options={STATE_FILTERS} allLabel="All states" aria-label="State" className="w-60" />
            <FilterSelect
              value={resolved}
              onChange={(v) => setResolved(v as ResolvedFilter | null)}
              options={[
                { value: 'open', label: 'Open' },
                { value: 'resolved', label: 'Resolved / attached' },
              ]}
              allLabel="Open and resolved"
              aria-label="Resolution"
            />
            <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Type, e.g. submission" className="w-44" aria-label="Type" />
            <Input value={device} onChange={(e) => setDevice(e.target.value)} placeholder="Device id" className="w-40 font-mono" aria-label="Device id" />
            <div className="w-56">
              <AgentSelect value={agentId} onChange={(id) => setAgentId(id)} placeholder="Any agent" />
            </div>
            {agentId ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setAgentId(null)}>
                Clear agent
              </Button>
            ) : null}
          </>
        }
      />
      <p className="mt-2 text-sm text-muted-foreground">Shows up to the 500 newest envelopes for the chosen state and agent.</p>
      <EnvelopeDetailSheet envelopeId={openId} onClose={() => setOpenId(null)} canAct={staff.isGlobalAdmin} />
    </>
  );
}
