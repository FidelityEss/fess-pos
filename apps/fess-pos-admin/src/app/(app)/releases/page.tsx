'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { ToneBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useStaff } from '@/lib/staff';
import { RELEASE_STATUS_LABEL, RELEASE_STATUS_TONE } from '@/lib/status';
import { fetchRows, pos } from '@/lib/supabase';
import type { ModuleRelease } from '@/lib/types';
import { RELEASE_STATUS_HINT, ReleaseSheet } from './_components/release-form';

const keyCount = (o: object | null | undefined) => Object.keys(o ?? {}).length;

export default function ModuleReleasesPage() {
  const staff = useStaff();
  const [sheet, setSheet] = useState<{ release: ModuleRelease | null } | null>(null);
  const releases = useQuery({
    queryKey: ['module_releases'],
    queryFn: () => fetchRows<ModuleRelease>(pos().from('module_releases').select('*').order('released_at', { ascending: false })),
  });

  const columns = useMemo<ColumnDef<ModuleRelease>[]>(
    () => [
      { accessorKey: 'version', header: 'Version', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm font-medium">{row.original.version}</span> },
      { accessorKey: 'released_at', header: 'Released', cell: ({ row }) => <DateTime value={row.original.released_at} /> },
      {
        accessorKey: 'status',
        header: 'Can agents use it?',
        cell: ({ row }) => (
          <span title={RELEASE_STATUS_HINT[row.original.status]}>
            <ToneBadge value={row.original.status} tones={RELEASE_STATUS_TONE} labels={RELEASE_STATUS_LABEL} />
          </span>
        ),
      },
      {
        id: 'api_versions',
        header: 'Server connection versions',
        meta: { advanced: true },
        accessorFn: (r) => r.api_versions.join(', '),
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.api_versions.length ? row.original.api_versions.join(', ') : '—'}</span>,
      },
      {
        accessorKey: 'spec_range',
        header: 'Set-up versions',
        meta: { advanced: true },
        cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm">{row.original.spec_range}</span>,
      },
      {
        id: 'components',
        header: 'Question and screen types',
        meta: { advanced: true },
        accessorFn: (r) => keyCount(r.components),
        cell: ({ row }) => <span className="tabular-nums">{keyCount(row.original.components)}</span>,
      },
      {
        id: 'page_types',
        header: 'Kinds of page',
        meta: { advanced: true },
        accessorFn: (r) => keyCount(r.page_types),
        cell: ({ row }) => <span className="tabular-nums">{keyCount(row.original.page_types)}</span>,
      },
      {
        accessorKey: 'notes',
        header: 'Notes',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.notes ? (
            <span className="line-clamp-2 max-w-xs break-words text-muted-foreground" title={row.original.notes}>
              {row.original.notes}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="App versions"
        actions={
          staff.isGlobalAdmin ? (
            <Button onClick={() => setSheet({ release: null })}>
              <Plus /> Add a version
            </Button>
          ) : null
        }
      />
      <DataTable
        columns={columns}
        data={releases.data}
        isLoading={releases.isPending}
        error={releases.error}
        onRetry={() => void releases.refetch()}
        getRowId={(r) => r.id}
        onRowClick={(r) => setSheet({ release: r })}
        searchPlaceholder="Search versions…"
        emptyTitle="No app versions yet"
        emptyDescription={staff.isGlobalAdmin ? 'Add a version when a new build of the phone app is released.' : undefined}
      />
      <ReleaseSheet
        open={sheet !== null}
        release={sheet?.release ?? null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
      />
    </>
  );
}
