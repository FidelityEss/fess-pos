'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Power, PowerOff, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActiveBadge, ReadOnlyNotice, YesNo } from '@/components/admin/admin-ui';
import { useTrustedIssuers } from '@/components/admin/queries';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { adminApi } from '@/lib/api';
import { useMutationWithToast } from '@/lib/mutations';
import { useStaff } from '@/lib/staff';
import type { TrustedIssuer } from '@/lib/types';
import { ISSUER_TYPE_LABEL, IssuerSheet } from './_components/issuer-sheet';
import { LinkRequests } from './_components/link-requests';

export default function TrustedIssuersPage() {
  const staff = useStaff();
  const issuers = useTrustedIssuers();
  const [sheet, setSheet] = useState<{ issuer: TrustedIssuer | null } | null>(null);
  const [toggle, setToggle] = useState<TrustedIssuer | null>(null);
  const setActive = useMutationWithToast({
    mutationFn: (v: { id: string; active: boolean; reason: string }) => adminApi.issuers.setActive(v.id, { active: v.active, reason: v.reason }),
    invalidate: [['trusted_issuers'], ['alerts']],
    toastErrors: false,
    successMessage: (i) => `${i.key} ${i.active ? 'activated' : 'deactivated'}`,
  });

  const columns = useMemo<ColumnDef<TrustedIssuer>[]>(
    () => [
      { accessorKey: 'key', header: 'Key', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm font-medium">{row.original.key}</span> },
      { accessorKey: 'type', header: 'Type', cell: ({ row }) => <Badge tone="outline">{ISSUER_TYPE_LABEL[row.original.type]}</Badge> },
      { accessorKey: 'title', header: 'Title', cell: ({ row }) => <span className="block max-w-md">{row.original.title}</span> },
      { accessorKey: 'primary_issuer', header: 'Primary', cell: ({ row }) => <YesNo value={row.original.primary_issuer} title={row.original.primary_issuer ? 'Primary' : 'Secondary signal only'} /> },
      { accessorKey: 'active', header: 'Status', cell: ({ row }) => <ActiveBadge active={row.original.active} /> },
      { accessorKey: 'updated_at', header: 'Updated', cell: ({ row }) => <DateTime value={row.original.updated_at} /> },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { className: 'text-right', headerClassName: 'w-px' },
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setToggle(row.original);
            }}
          >
            {row.original.active ? (
              <>
                <PowerOff /> Deactivate
              </>
            ) : (
              <>
                <Power /> Activate
              </>
            )}
          </Button>
        ),
      },
    ],
    [],
  );

  if (!staff.isGlobalAdmin) {
    return (
      <>
        <PageHeader title="Trusted issuers" />
        <ReadOnlyNotice>Trusted issuers and identity links are managed by all-bank administrators (D-44).</ReadOnlyNotice>
      </>
    );
  }

  const activating = toggle ? !toggle.active : false;

  return (
    <>
      <PageHeader
        title="Trusted issuers"
        description="Identity issuers whose tokens the POS API accepts, how each is verified, and how a person’s employee number is found (docs/07 §2)."
        actions={
          <Button onClick={() => setSheet({ issuer: null })}>
            <Plus /> New issuer
          </Button>
        }
      />
      <div className="space-y-8">
        <DataTable
          columns={columns}
          data={issuers.data}
          isLoading={issuers.isPending}
          error={issuers.error}
          onRetry={() => void issuers.refetch()}
          getRowId={(i) => i.id}
          onRowClick={(i) => setSheet({ issuer: i })}
          searchPlaceholder="Search issuers…"
          emptyTitle="No trusted issuers"
        />
        <LinkRequests />
      </div>

      <IssuerSheet
        open={sheet !== null}
        issuer={sheet?.issuer ?? null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
      />
      <ConfirmDialog
        open={toggle !== null}
        onOpenChange={(open) => {
          if (!open) setToggle(null);
        }}
        title={toggle ? `${activating ? 'Activate' : 'Deactivate'} ${toggle.key}?` : ''}
        description={toggle?.title}
        destructive={!activating}
        requireReason
        confirmLabel={activating ? 'Activate issuer' : 'Deactivate issuer'}
        onConfirm={(reason) => (toggle ? setActive.mutateAsync({ id: toggle.id, active: activating, reason }) : undefined)}
      >
        {toggle && activating && toggle.type !== 'dev_stub' ? (
          <Alert variant="warning">
            <ShieldAlert />
            <AlertTitle>Production identity issuer</AlertTitle>
            <AlertDescription>
              Activating a real issuer — such as a FESS issuer — must follow D-05: a person does it once FESS has provided the
              credentials and the function secret is set. Don’t activate it to try it out.
            </AlertDescription>
          </Alert>
        ) : toggle && activating ? (
          <Alert variant="info">
            <ShieldAlert />
            <AlertDescription>Stand-in issuers are for development and staging only.</AlertDescription>
          </Alert>
        ) : toggle ? (
          <p className="text-sm text-muted-foreground">
            New sign-ins with this issuer’s tokens are refused from now on. POS sessions already issued are not revoked.
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
