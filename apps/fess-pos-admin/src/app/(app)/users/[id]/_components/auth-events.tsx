'use client';

// Recent auth_events for one user: exchanges, refusals, refreshes, downgrades, revocations.
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { MonoId, SectionHeading } from '@/components/admin/admin-ui';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { ToneBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import type { StatusTone } from '@/lib/status';
import { fetchRows, pos } from '@/lib/supabase';
import type { AuthEvent, AuthEventType } from '@/lib/types';

const EVENT_TONE: Record<AuthEventType, StatusTone> = {
  exchange: 'success',
  exchange_refused: 'danger',
  refresh: 'neutral',
  reuse_detected: 'danger',
  downgrade: 'warning',
  revoke: 'danger',
  link_request: 'info',
  reverify: 'info',
};

function detailText(detail: AuthEvent['detail']): string {
  const keys = Object.keys(detail ?? {});
  return keys.length ? JSON.stringify(detail) : '';
}

export function AuthEventsTable({ userId }: { userId: string }) {
  const events = useQuery({
    queryKey: ['auth_events', 'user', userId],
    queryFn: () =>
      fetchRows<AuthEvent>(
        pos()
          .from('auth_events')
          .select('id,user_id,issuer_key,event,device_id,session_id,ip,user_agent,profile_mismatch,detail,request_id,at')
          .eq('user_id', userId)
          .order('at', { ascending: false })
          .limit(50),
      ),
  });

  const columns = useMemo<ColumnDef<AuthEvent>[]>(
    () => [
      { accessorKey: 'at', header: 'When', cell: ({ row }) => <DateTime value={row.original.at} seconds /> },
      {
        accessorKey: 'event',
        header: 'Event',
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1">
            <ToneBadge value={row.original.event} tones={EVENT_TONE} />
            {row.original.profile_mismatch ? (
              <Badge tone="warning" title={JSON.stringify(row.original.profile_mismatch)}>
                Profile mismatch
              </Badge>
            ) : null}
          </span>
        ),
      },
      { accessorKey: 'issuer_key', header: 'Issuer', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm">{row.original.issuer_key ?? '—'}</span> },
      { accessorKey: 'device_id', header: 'Device', cell: ({ row }) => <MonoId value={row.original.device_id} /> },
      { accessorKey: 'session_id', header: 'Session', cell: ({ row }) => <MonoId value={row.original.session_id} /> },
      {
        id: 'detail',
        header: 'Detail',
        accessorFn: (e) => detailText(e.detail),
        enableSorting: false,
        cell: ({ row }) => {
          const text = detailText(row.original.detail);
          return text ? (
            <code className="line-clamp-2 max-w-md break-all font-mono text-xs text-muted-foreground" title={text}>
              {text}
            </code>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      { accessorKey: 'ip', header: 'IP', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm">{row.original.ip ?? '—'}</span> },
    ],
    [],
  );

  return (
    <section>
      <SectionHeading title="Sign-in activity" description="The 50 most recent authentication events for this user." />
      <DataTable
        columns={columns}
        data={events.data}
        isLoading={events.isPending}
        error={events.error}
        onRetry={() => void events.refetch()}
        getRowId={(e) => e.id}
        searchPlaceholder="Search events…"
        pageSize={25}
        emptyTitle="No sign-in activity yet"
      />
    </section>
  );
}
