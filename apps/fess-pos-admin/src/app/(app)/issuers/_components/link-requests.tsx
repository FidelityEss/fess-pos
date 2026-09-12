'use client';

// Open `link_request` alerts: someone verified by a trusted issuer signed in but no POS user is bound to that identity.
// Linking acknowledges the alert (pos_rpc.admin_identity_link).
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Link2 } from 'lucide-react';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { MonoId, SectionHeading } from '@/components/admin/admin-ui';
import { useUserOptions } from '@/components/admin/queries';
import { UserPicker } from '@/components/admin/user-picker';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { apiFieldErrors, type FieldErrors, FormField, zodFieldErrors } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { adminApi } from '@/lib/api';
import { useMutationWithToast } from '@/lib/mutations';
import { type IdentityLinkCreateBody, identityLinkCreateSchema } from '@/lib/schemas';
import { fetchRows, pos } from '@/lib/supabase';
import type { Alert as AlertRow } from '@/lib/types';

type LinkRequest = Pick<AlertRow, 'id' | 'kind' | 'message' | 'detail' | 'dedupe_key' | 'created_at'>;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

export function issuerOf(a: LinkRequest): string | null {
  return str(a.detail.issuer_key);
}

/** The subject: from the detail when present, else from the dedupe key `link_request:<issuer>:<subject>`. */
export function subjectOf(a: LinkRequest): string {
  const fromDetail = str(a.detail.subject);
  if (fromDetail) return fromDetail;
  const issuer = issuerOf(a);
  const prefix = issuer ? `link_request:${issuer}:` : null;
  return prefix && a.dedupe_key?.startsWith(prefix) ? a.dedupe_key.slice(prefix.length) : '';
}

export function LinkRequests() {
  const [target, setTarget] = useState<LinkRequest | null>(null);
  const requests = useQuery({
    queryKey: ['alerts', 'link_request', 'open'],
    queryFn: () =>
      fetchRows<LinkRequest>(
        pos()
          .from('alerts')
          .select('id,kind,message,detail,dedupe_key,created_at')
          .eq('kind', 'link_request')
          .is('acknowledged_at', null)
          .order('created_at', { ascending: false })
          .limit(200),
      ),
  });

  const columns = useMemo<ColumnDef<LinkRequest>[]>(
    () => [
      { accessorKey: 'created_at', header: 'Raised', cell: ({ row }) => <DateTime value={row.original.created_at} showRelative /> },
      { id: 'issuer', header: 'Issuer', accessorFn: (a) => issuerOf(a) ?? '', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm">{issuerOf(row.original) ?? '—'}</span> },
      {
        id: 'employee_number',
        header: 'Verified employee no.',
        accessorFn: (a) => str(a.detail.employee_number) ?? '',
        cell: ({ row }) => {
          const n = str(row.original.detail.employee_number);
          return n ? <span className="whitespace-nowrap font-mono text-sm">{n}</span> : <span className="text-sm text-muted-foreground">Not provided by the issuer</span>;
        },
      },
      { id: 'subject', header: 'Subject', accessorFn: subjectOf, cell: ({ row }) => <MonoId value={subjectOf(row.original) || null} head={24} tail={6} /> },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { className: 'text-right', headerClassName: 'w-px' },
        cell: ({ row }) => (
          <Button size="sm" variant="outline" onClick={() => setTarget(row.original)}>
            <Link2 /> Link to user…
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Link requests"
        description="Sign-ins verified by a trusted issuer that matched no POS user. Link each to the right person, or provision them first under Users."
      />
      <DataTable
        columns={columns}
        data={requests.data}
        isLoading={requests.isPending}
        error={requests.error}
        onRetry={() => void requests.refetch()}
        getRowId={(a) => a.id}
        enableSearch={false}
        emptyTitle="No open link requests"
      />
      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <DialogContent>{target ? <LinkRequestForm key={target.id} request={target} onClose={() => setTarget(null)} /> : null}</DialogContent>
      </Dialog>
    </section>
  );
}

function LinkRequestForm({ request, onClose }: { request: LinkRequest; onClose: () => void }) {
  const uid = useId();
  const users = useUserOptions();
  const issuer = issuerOf(request) ?? '';
  const employeeNumber = str(request.detail.employee_number);
  const suggested = employeeNumber ? ((users.data ?? []).find((u) => u.employee_number === employeeNumber) ?? null) : null;
  const [userId, setUserId] = useState<string | null>(null);
  const [subject, setSubject] = useState(() => subjectOf(request));
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const chosen = userId ?? suggested?.id ?? null;
  const create = useMutationWithToast({
    mutationFn: (body: IdentityLinkCreateBody) => adminApi.identityLinks.create(body),
    invalidate: [['alerts'], ['identity_links'], ['users'], ['auth_events']],
    toastErrors: false,
    successMessage: 'Identity linked — the request is closed',
    onSuccess: () => onClose(),
  });
  const errors: FieldErrors = { ...apiFieldErrors(create.error), ...clientErrors };

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = identityLinkCreateSchema.safeParse({ user_id: chosen ?? '', issuer_key: issuer, subject });
    if (!parsed.success) {
      const errs = zodFieldErrors(parsed.error);
      if (!chosen) errs.user_id = 'Choose the user this identity belongs to';
      setClientErrors(errs);
      return;
    }
    setClientErrors({});
    create.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Link this identity to a user</DialogTitle>
        <DialogDescription>
          Issuer <span className="font-mono">{issuer || '—'}</span>
          {employeeNumber ? (
            <>
              {' '}
              · verified employee number <span className="font-mono">{employeeNumber}</span>
            </>
          ) : null}
        </DialogDescription>
      </DialogHeader>
      <FormField
        label="User"
        htmlFor={`${uid}-user`}
        required
        error={errors.user_id}
        hint={suggested && !userId ? 'Suggested: the user with the verified employee number.' : undefined}
      >
        <UserPicker id={`${uid}-user`} value={chosen} onChange={(id) => setUserId(id)} invalid={!!errors.user_id} />
      </FormField>
      <FormField label="Subject" htmlFor={`${uid}-subject`} required error={errors.subject} hint="The issuer’s identifier for this person, taken from the request.">
        <Input id={`${uid}-subject`} value={subject} onChange={(e) => setSubject(e.target.value)} className="font-mono" aria-invalid={!!errors.subject || undefined} />
      </FormField>
      {errors.issuer_key ? <p className="text-sm text-destructive">This request has no issuer — it can’t be linked here.</p> : null}
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
