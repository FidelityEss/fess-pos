'use client';

// external_identities for one user (docs/07 §2): which issuer subjects sign in as this POS user.
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Link2, Unlink } from 'lucide-react';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { MonoId, ReadOnlyNotice, SectionHeading } from '@/components/admin/admin-ui';
import { useTrustedIssuers } from '@/components/admin/queries';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { apiFieldErrors, type FieldErrors, FormField, zodFieldErrors } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminApi } from '@/lib/api';
import { employeeName, fullName, humanize } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import { type IdentityLinkCreateBody, identityLinkCreateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import { fetchRows, pos } from '@/lib/supabase';
import type { ExternalIdentity, PosUser } from '@/lib/types';

type LinkRow = ExternalIdentity & { linker: { first_name: string; last_name: string; employee_number: string } | null };

const INVALIDATE = [['identity_links'], ['alerts'], ['auth_events']];

export function IdentityLinks({ user }: { user: PosUser }) {
  const staff = useStaff();
  const canLink = staff.isGlobalAdmin;
  const [linkOpen, setLinkOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<LinkRow | null>(null);
  const links = useQuery({
    queryKey: ['identity_links', 'user', user.id],
    queryFn: () =>
      fetchRows<LinkRow>(
        pos()
          .from('external_identities')
          .select('*,linker:pos_users!linked_by(first_name,last_name,employee_number)')
          .eq('user_id', user.id)
          .order('linked_at', { ascending: false }),
      ),
  });
  const revoke = useMutationWithToast({
    mutationFn: (v: { id: string; reason: string }) => adminApi.identityLinks.revoke(v.id, { reason: v.reason }),
    invalidate: INVALIDATE,
    toastErrors: false,
    successMessage: 'Identity link revoked',
  });

  const columns = useMemo<ColumnDef<LinkRow>[]>(
    () => [
      { accessorKey: 'issuer_key', header: 'Issuer', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm">{row.original.issuer_key}</span> },
      {
        accessorKey: 'subject',
        header: 'Subject',
        cell: ({ row }) => <MonoId value={row.original.subject} head={24} tail={6} />,
      },
      { accessorKey: 'linked_via', header: 'Linked via', cell: ({ row }) => humanize(row.original.linked_via) },
      {
        id: 'linked_by',
        header: 'Linked by',
        accessorFn: (l) => (l.linker ? fullName(l.linker) : ''),
        cell: ({ row }) => (row.original.linker ? employeeName(row.original.linker) : <span className="text-muted-foreground">Automatic</span>),
      },
      { accessorKey: 'linked_at', header: 'Linked at', cell: ({ row }) => <DateTime value={row.original.linked_at} /> },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (l) => (l.revoked_at ? 'revoked' : 'active'),
        cell: ({ row }) =>
          row.original.revoked_at ? (
            <span className="grid gap-0.5">
              <Badge tone="danger">Revoked</Badge>
              <DateTime value={row.original.revoked_at} className="text-sm text-muted-foreground" />
            </span>
          ) : (
            <Badge tone="success">Active</Badge>
          ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { className: 'text-right', headerClassName: 'w-px' },
        cell: ({ row }) =>
          canLink && !row.original.revoked_at ? (
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRevokeTarget(row.original)}>
              <Unlink /> Revoke link
            </Button>
          ) : null,
      },
    ],
    [canLink],
  );

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Identity links"
        description="Issuer identities that sign in as this user. Most are created automatically from the verified employee number."
        actions={
          canLink ? (
            <Button size="sm" onClick={() => setLinkOpen(true)}>
              <Link2 /> Link identity
            </Button>
          ) : null
        }
      />
      {!canLink ? <ReadOnlyNotice>Identity links are managed by all-bank administrators (D-44).</ReadOnlyNotice> : null}
      <DataTable
        columns={columns}
        data={links.data}
        isLoading={links.isPending}
        error={links.error}
        onRetry={() => void links.refetch()}
        getRowId={(l) => l.id}
        enableSearch={false}
        emptyTitle="No identity links"
        emptyDescription="A link is created the first time this person signs in through a trusted issuer, or by an administrator."
      />
      <LinkIdentityDialog user={user} open={linkOpen} onOpenChange={setLinkOpen} />
      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title="Revoke this identity link?"
        description={revokeTarget ? `${revokeTarget.issuer_key} · ${revokeTarget.subject}` : undefined}
        destructive
        requireReason
        confirmLabel="Revoke link"
        onConfirm={(reason) => (revokeTarget ? revoke.mutateAsync({ id: revokeTarget.id, reason }) : undefined)}
      >
        <p className="text-sm text-muted-foreground">
          This identity can no longer sign in as {fullName(user)}. Sessions already issued are not revoked — revoke them under
          Devices &amp; sessions if needed.
        </p>
      </ConfirmDialog>
    </section>
  );
}

function LinkIdentityDialog({ user, open, onOpenChange }: { user: PosUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? <LinkIdentityForm user={user} onClose={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function LinkIdentityForm({ user, onClose }: { user: PosUser; onClose: () => void }) {
  const uid = useId();
  const issuers = useTrustedIssuers();
  const [issuerKey, setIssuerKey] = useState('');
  const [subject, setSubject] = useState('');
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const create = useMutationWithToast({
    mutationFn: (body: IdentityLinkCreateBody) => adminApi.identityLinks.create(body),
    invalidate: INVALIDATE,
    toastErrors: false,
    successMessage: 'Identity linked',
    onSuccess: () => onClose(),
  });
  const errors: FieldErrors = { ...apiFieldErrors(create.error), ...clientErrors };

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = identityLinkCreateSchema.safeParse({ user_id: user.id, issuer_key: issuerKey, subject });
    if (!parsed.success) {
      setClientErrors(zodFieldErrors(parsed.error));
      return;
    }
    setClientErrors({});
    create.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Link an identity to {fullName(user)}</DialogTitle>
        <DialogDescription>For edge cases the automatic employee-number binding can’t handle. The link is audited.</DialogDescription>
      </DialogHeader>
      <FormField label="Issuer" htmlFor={`${uid}-issuer`} required error={errors.issuer_key}>
        <Select value={issuerKey} onValueChange={setIssuerKey} disabled={issuers.isPending}>
          <SelectTrigger id={`${uid}-issuer`} aria-invalid={!!errors.issuer_key || undefined}>
            <SelectValue placeholder={issuers.isPending ? 'Loading issuers…' : 'Choose an issuer'} />
          </SelectTrigger>
          <SelectContent>
            {(issuers.data ?? []).map((i) => (
              <SelectItem key={i.id} value={i.key}>
                <span className="font-mono">{i.key}</span> — {i.title}
                {!i.active ? ' (inactive)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Subject" htmlFor={`${uid}-subject`} required error={errors.subject} hint="The issuer’s stable identifier for this person (the value of its subject claim).">
        <Input id={`${uid}-subject`} value={subject} onChange={(e) => setSubject(e.target.value)} className="font-mono" maxLength={500} aria-invalid={!!errors.subject || undefined} />
      </FormField>
      <ApiErrorAlert error={create.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Link identity
        </Button>
      </DialogFooter>
    </form>
  );
}
