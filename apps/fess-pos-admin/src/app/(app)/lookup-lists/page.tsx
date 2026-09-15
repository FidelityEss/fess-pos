'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BankScopeBadge } from '@/components/admin/admin-ui';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStaff } from '@/lib/staff';
import { fetchRows, pos } from '@/lib/supabase';
import { CreateListDialog } from './_components/create-list-dialog';
import { LookupListSheet } from './_components/list-sheet';
import { latestItems, latestVersion, type ListRow } from './_components/types';

export default function LookupListsPage() {
  const staff = useStaff();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const lists = useQuery({
    queryKey: ['lookup_lists', 'admin-list'],
    queryFn: () =>
      fetchRows<ListRow>(
        pos()
          .from('lookup_lists')
          .select('*,lookup_list_versions(id,version,items,published_at)')
          .order('version', { referencedTable: 'lookup_list_versions', ascending: false })
          .limit(1, { referencedTable: 'lookup_list_versions' })
          .order('key'),
      ),
  });
  // Derive the open list from fresh data so the sheet updates after a publish.
  const selected = (lists.data ?? []).find((l) => l.id === selectedId) ?? null;

  const columns = useMemo<ColumnDef<ListRow>[]>(
    () => [
      { accessorKey: 'title', header: 'List', cell: ({ row }) => <span className="font-medium">{row.original.title}</span> },
      { accessorKey: 'key', header: 'Key', meta: { advanced: true }, cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm">{row.original.key}</span> },
      { id: 'scope', header: 'Which banks', accessorFn: (l) => l.bank_id ?? '', cell: ({ row }) => <BankScopeBadge bankId={row.original.bank_id} /> },
      {
        id: 'latest',
        header: 'Version',
        accessorFn: (l) => latestVersion(l)?.version ?? 0,
        cell: ({ row }) => {
          const v = latestVersion(row.original);
          return v ? <span className="tabular-nums">Version {v.version}</span> : <Badge tone="warning">Not published yet</Badge>;
        },
      },
      { id: 'items', header: 'Choices', accessorFn: (l) => latestItems(l).length, cell: ({ row }) => <span className="tabular-nums">{latestItems(row.original).length}</span> },
      {
        id: 'published_at',
        header: 'Last published',
        accessorFn: (l) => latestVersion(l)?.published_at ?? '',
        cell: ({ row }) => <DateTime value={latestVersion(row.original)?.published_at} />,
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Drop-down lists"
        actions={
          staff.isAdmin ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Add a list
            </Button>
          ) : null
        }
      />
      <DataTable
        columns={columns}
        data={lists.data}
        isLoading={lists.isPending}
        error={lists.error}
        onRetry={() => void lists.refetch()}
        getRowId={(l) => l.id}
        onRowClick={(l) => setSelectedId(l.id)}
        searchPlaceholder="Search lists…"
        emptyTitle="No drop-down lists yet"
        emptyDescription={
          staff.isAdmin ? (
            <>
              Add the first one, then add its choices.
              <span className="mt-3 block">
                <Button onClick={() => setCreating(true)}>
                  <Plus /> Add a list
                </Button>
              </span>
            </>
          ) : undefined
        }
      />
      <CreateListDialog open={creating} onOpenChange={setCreating} onCreated={setSelectedId} />
      <LookupListSheet
        list={selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </>
  );
}
