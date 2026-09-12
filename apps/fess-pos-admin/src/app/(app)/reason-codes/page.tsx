'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActiveBadge, BankScopeBadge, YesNo } from '@/components/admin/admin-ui';
import { useAllReasonCodes } from '@/components/admin/queries';
import { DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { humanize } from '@/lib/format';
import { useBanks } from '@/lib/hooks';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { REASON_CATEGORIES, type ReasonCategory, type ReasonCode } from '@/lib/types';
import { CATEGORY_HINT, ReasonCodeSheet, type ReasonSheetState } from './_components/reason-code-sheet';

const ALL = '__all__';
const GLOBAL = '__global__';

export default function ReasonCodesPage() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const codes = useAllReasonCodes();
  const banks = useBanks({ includeInactive: true });
  const [category, setCategory] = useState<ReasonCategory>('assignment_reject');
  const [scope, setScope] = useState<string>(ALL);
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [sheet, setSheet] = useState<ReasonSheetState | null>(null);

  const counts = useMemo(() => {
    const out: Partial<Record<ReasonCategory, number>> = {};
    for (const c of codes.data ?? []) out[c.category] = (out[c.category] ?? 0) + 1;
    return out;
  }, [codes.data]);

  const rows = useMemo(
    () =>
      (codes.data ?? []).filter(
        (c) =>
          c.category === category &&
          (scope === ALL || (scope === GLOBAL ? c.bank_id === null : c.bank_id === scope)) &&
          (status === 'all' || c.active === (status === 'active')),
      ),
    [codes.data, category, scope, status],
  );

  const columns = useMemo<ColumnDef<ReasonCode>[]>(
    () => [
      { accessorKey: 'sort_order', header: 'Order', meta: { advanced: true }, cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.sort_order}</span> },
      { accessorKey: 'code', header: 'Code', meta: { advanced: true }, cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm font-medium">{row.original.code}</span> },
      {
        accessorKey: 'label',
        header: advanced ? 'Label' : 'Reason',
        cell: ({ row }) => (
          <div className="grid min-w-56 max-w-lg">
            <span className="font-medium">{row.original.label}</span>
            {row.original.description ? <span className="break-words text-sm text-muted-foreground">{row.original.description}</span> : null}
          </div>
        ),
      },
      { accessorKey: 'requires_note', header: 'Needs a note', cell: ({ row }) => <YesNo value={row.original.requires_note} title="Requires a note" /> },
      { accessorKey: 'requires_photo', header: 'Needs a photo', cell: ({ row }) => <YesNo value={row.original.requires_photo} title="Requires a photo" /> },
      { accessorKey: 'billable', header: 'Billable', cell: ({ row }) => <YesNo value={row.original.billable} title="Billable by default" /> },
      { id: 'scope', header: 'Scope', accessorFn: (r) => r.bank_id ?? '', cell: ({ row }) => <BankScopeBadge bankId={row.original.bank_id} /> },
      { accessorKey: 'active', header: 'Status', cell: ({ row }) => <ActiveBadge active={row.original.active} /> },
    ],
    [advanced],
  );

  return (
    <>
      <PageHeader
        title="Reason codes"
        description="Reason catalogues per category — global, or specific to one bank. Codes are never deleted; deactivate them instead."
        actions={
          staff.isAdmin ? (
            <Button onClick={() => setSheet({ mode: 'create', category })}>
              <Plus /> New reason code
            </Button>
          ) : null
        }
      />
      <Tabs value={category} onValueChange={(v) => setCategory(v as ReasonCategory)}>
        <div className="overflow-x-auto">
          <TabsList className="w-max min-w-full">
            {REASON_CATEGORIES.map((c) => (
              <TabsTrigger key={c} value={c}>
                {humanize(c)}
                <span className="text-sm tabular-nums text-muted-foreground">{counts[c] ?? 0}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
      <p className="mb-4 mt-4 text-base text-muted-foreground">{CATEGORY_HINT[category]}</p>
      <DataTable
        key={category}
        columns={columns}
        data={codes.isPending ? undefined : rows}
        isLoading={codes.isPending}
        error={codes.error}
        onRetry={() => void codes.refetch()}
        getRowId={(r) => r.id}
        onRowClick={(r) => setSheet({ mode: 'edit', code: r })}
        searchPlaceholder="Search codes…"
        emptyTitle="No reason codes in this category"
        initialSorting={[{ id: 'sort_order', desc: false }]}
        rowClassName={(r) => (r.active ? undefined : 'opacity-60')}
        toolbar={
          <>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="w-52" aria-label="Filter by scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Global and bank codes</SelectItem>
                <SelectItem value={GLOBAL}>Global only</SelectItem>
                {(banks.data ?? []).length > 0 ? <SelectSeparator /> : null}
                {(banks.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="font-mono text-sm text-muted-foreground">{b.code}</span> {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as 'all' | 'active' | 'inactive')}>
              <SelectTrigger className="w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />
      <ReasonCodeSheet
        state={sheet}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
      />
    </>
  );
}
