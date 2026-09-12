'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActiveBadge } from '@/components/admin/admin-ui';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBanks } from '@/lib/hooks';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import type { Bank } from '@/lib/types';
import { BankSheet } from './_components/bank-sheet';

function contactCount(b: Bank): number {
  return Array.isArray(b.contacts) ? b.contacts.length : 0;
}

export default function BanksPage() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const banks = useBanks({ includeInactive: true });
  const [sheet, setSheet] = useState<{ bank: Bank | null } | null>(null);

  const columns = useMemo<ColumnDef<Bank>[]>(
    () => [
      { accessorKey: 'code', header: 'Code', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm font-medium">{row.original.code}</span> },
      { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { accessorKey: 'active', header: 'Status', cell: ({ row }) => <ActiveBadge active={row.original.active} /> },
      {
        accessorKey: 'four_eyes_enabled',
        header: advanced ? 'Four-eyes' : 'Second approval',
        cell: ({ row }) => (row.original.four_eyes_enabled ? <Badge tone="accent">On</Badge> : <Badge tone="muted">Off</Badge>),
      },
      { id: 'contacts', header: 'Contacts', accessorFn: contactCount, cell: ({ row }) => <span className="tabular-nums">{contactCount(row.original)}</span> },
      {
        id: 'billing',
        header: 'Billing settings',
        accessorFn: (b) => Object.keys(b.billing_settings ?? {}).length,
        cell: ({ row }) => {
          const n = Object.keys(row.original.billing_settings ?? {}).length;
          return n ? `Custom (${n} categor${n === 1 ? 'y' : 'ies'})` : <span className="text-muted-foreground">Standard</span>;
        },
      },
      { accessorKey: 'updated_at', header: 'Updated', meta: { advanced: true }, cell: ({ row }) => <DateTime value={row.original.updated_at} /> },
    ],
    [advanced],
  );

  return (
    <>
      <PageHeader
        title="Banks"
        description={
          advanced
            ? 'Banks, contacts, billing and export settings, and four-eyes approval. Creating a bank needs an all-bank administrator.'
            : 'Banks, their contacts, which outcomes are billable, and whether changes need a second approval.'
        }
        actions={
          staff.isGlobalAdmin ? (
            <Button onClick={() => setSheet({ bank: null })}>
              <Plus /> New bank
            </Button>
          ) : null
        }
      />
      <DataTable
        columns={columns}
        data={banks.data}
        isLoading={banks.isPending}
        error={banks.error}
        onRetry={() => void banks.refetch()}
        getRowId={(b) => b.id}
        onRowClick={(b) => setSheet({ bank: b })}
        searchPlaceholder="Search banks…"
        emptyTitle="No banks yet"
        emptyDescription={staff.isGlobalAdmin ? 'Create the first bank to start adding jobs.' : 'No banks are in your scope.'}
        initialSorting={[{ id: 'name', desc: false }]}
      />
      <BankSheet
        open={sheet !== null}
        bank={sheet?.bank ?? null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
      />
    </>
  );
}
