'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { ActiveBadge } from '@/components/admin/admin-ui';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { useBanks } from '@/lib/hooks';
import { useStaff } from '@/lib/staff';
import type { Bank } from '@/lib/types';
import { BankSheet } from './_components/bank-sheet';

function contactCount(b: Bank): number {
  return Array.isArray(b.contacts) ? b.contacts.length : 0;
}

// `?open=<bank id>` opens that bank's sheet (the job page links its bank here, docs/17 §4.5); useSearchParams → Suspense.
export default function BanksPage() {
  return (
    <Suspense fallback={<PageSpinner label="Loading banks…" />}>
      <BanksView />
    </Suspense>
  );
}

function BanksView() {
  const staff = useStaff();
  const banks = useBanks({ includeInactive: true });
  const openId = useSearchParams().get('open');
  const [sheet, setSheet] = useState<{ bank: Bank | null } | null>(null);
  // The bank named in `?open=` shows until its sheet is closed once; after that the parameter is ignored.
  const [dismissedOpenId, setDismissedOpenId] = useState<string | null>(null);
  const linked = openId && openId !== dismissedOpenId ? ((banks.data ?? []).find((b) => b.id === openId) ?? null) : null;
  const shown = sheet ?? (linked ? { bank: linked } : null);

  const columns = useMemo<ColumnDef<Bank>[]>(
    () => [
      { accessorKey: 'code', header: 'Code', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm font-medium">{row.original.code}</span> },
      { accessorKey: 'name', header: 'Bank', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { accessorKey: 'active', header: 'Status', cell: ({ row }) => <ActiveBadge active={row.original.active} /> },
      {
        accessorKey: 'four_eyes_enabled',
        header: 'Second approval',
        cell: ({ row }) => (row.original.four_eyes_enabled ? <Badge tone="accent">On</Badge> : <Badge tone="muted">Off</Badge>),
      },
      { id: 'contacts', header: 'Contacts', accessorFn: contactCount, cell: ({ row }) => <span className="tabular-nums">{contactCount(row.original)}</span> },
      {
        id: 'billing',
        header: 'What’s billed',
        accessorFn: (b) => Object.keys(b.billing_settings ?? {}).length,
        cell: ({ row }) => {
          const n = Object.keys(row.original.billing_settings ?? {}).length;
          return n ? `Set for ${n} situation${n === 1 ? '' : 's'}` : <span className="text-muted-foreground">Standard</span>;
        },
      },
      { accessorKey: 'updated_at', header: 'Last changed', meta: { advanced: true }, cell: ({ row }) => <DateTime value={row.original.updated_at} /> },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Banks"
        actions={
          staff.isGlobalAdmin ? (
            <Button onClick={() => setSheet({ bank: null })}>
              <Plus /> Add a bank
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
        emptyDescription={
          staff.isGlobalAdmin ? (
            <>
              Add the first bank, then you can create jobs for it.
              <span className="mt-3 block">
                <Button onClick={() => setSheet({ bank: null })}>
                  <Plus /> Add a bank
                </Button>
              </span>
            </>
          ) : (
            'You don’t have access to any banks yet. Ask an administrator to give you access.'
          )
        }
        initialSorting={[{ id: 'name', desc: false }]}
      />
      <BankSheet
        open={shown !== null}
        bank={shown?.bank ?? null}
        onOpenChange={(open) => {
          if (open) return;
          setSheet(null);
          if (openId) setDismissedOpenId(openId);
        }}
      />
    </>
  );
}
