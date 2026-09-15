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
    successMessage: (i) => `${i.title} turned ${i.active ? 'on' : 'off'}.`,
  });

  const columns = useMemo<ColumnDef<TrustedIssuer>[]>(
    () => [
      { accessorKey: 'title', header: 'Name', cell: ({ row }) => <span className="block max-w-md font-medium">{row.original.title}</span> },
      { accessorKey: 'key', header: 'Key', meta: { advanced: true }, cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm">{row.original.key}</span> },
      { accessorKey: 'type', header: 'How it checks', cell: ({ row }) => <Badge tone="outline">{ISSUER_TYPE_LABEL[row.original.type]}</Badge> },
      {
        accessorKey: 'primary_issuer',
        header: 'Signs in on its own',
        cell: ({ row }) => (
          <YesNo value={row.original.primary_issuer} title={row.original.primary_issuer ? 'Can sign agents in on its own' : 'Only an extra check alongside another source'} />
        ),
      },
      { accessorKey: 'active', header: 'Status', cell: ({ row }) => <ActiveBadge active={row.original.active} activeLabel="On" inactiveLabel="Off" /> },
      { accessorKey: 'updated_at', header: 'Last changed', cell: ({ row }) => <DateTime value={row.original.updated_at} /> },
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
                <PowerOff /> Turn off
              </>
            ) : (
              <>
                <Power /> Turn on
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
        <PageHeader title="Sign-in sources" />
        <ReadOnlyNotice>Only administrators for all banks can manage sign-in sources and match people to them.</ReadOnlyNotice>
      </>
    );
  }

  const activating = toggle ? !toggle.active : false;

  return (
    <>
      <PageHeader
        title="Sign-in sources"
        actions={
          <Button onClick={() => setSheet({ issuer: null })}>
            <Plus /> Add a sign-in source
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
          searchPlaceholder="Search sign-in sources…"
          emptyTitle="No sign-in sources yet"
          emptyDescription="Add one so agents can sign in to the app."
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
        title={toggle ? `${activating ? 'Turn on' : 'Turn off'} ${toggle.title}?` : ''}
        description={
          activating
            ? 'Agents can then sign in to the app through it.'
            : 'Agents can’t sign in through it any more. Anyone already signed in stays signed in.'
        }
        destructive={!activating}
        requireReason
        reasonPlaceholder="Why? This is recorded in the activity history."
        confirmLabel={activating ? 'Turn on' : 'Turn off'}
        onConfirm={(reason) => (toggle ? setActive.mutateAsync({ id: toggle.id, active: activating, reason }) : undefined)}
      >
        {toggle && activating && toggle.type !== 'dev_stub' ? (
          <Alert variant="warning">
            <ShieldAlert />
            <AlertTitle>This is a real sign-in source</AlertTitle>
            <AlertDescription>
              Only turn on a real source, such as FESS, once the FESS team has given us its credentials and a developer has stored them on the server.
              Don’t turn it on to try it out.
            </AlertDescription>
          </Alert>
        ) : toggle && activating ? (
          <Alert variant="info">
            <ShieldAlert />
            <AlertDescription>The stand-in sign-in source is for QA and local testing only. Production never uses it.</AlertDescription>
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
