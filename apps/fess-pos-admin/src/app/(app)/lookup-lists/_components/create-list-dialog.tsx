'use client';

import { type FormEvent, useId, useState } from 'react';
import { canWriteScoped } from '@/components/admin/access';
import { defaultScope, ScopeSelect } from '@/components/admin/scope-select';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { apiFieldErrors, type FieldErrors, FormField, zodFieldErrors } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { adminApi } from '@/lib/api';
import { useMutationWithToast } from '@/lib/mutations';
import { type LookupListCreateBody, lookupListCreateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';

export function CreateListDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (listId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? <CreateListForm onClose={() => onOpenChange(false)} onCreated={onCreated} /> : null}</DialogContent>
    </Dialog>
  );
}

function CreateListForm({ onClose, onCreated }: { onClose: () => void; onCreated: (listId: string) => void }) {
  const staff = useStaff();
  const uid = useId();
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [bankId, setBankId] = useState<string | null>(() => defaultScope(staff));
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const create = useMutationWithToast({
    mutationFn: (body: LookupListCreateBody) => adminApi.lookupLists.create(body),
    invalidate: [['lookup_lists']],
    toastErrors: false,
    successMessage: (l) => `List ${l.key} created — publish its first version next`,
    onSuccess: (l) => {
      onClose();
      onCreated(l.id);
    },
  });
  const errors: FieldErrors = { ...apiFieldErrors(create.error), ...clientErrors };

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    if (!canWriteScoped(staff, bankId)) next.bank_id = bankId === null ? 'Only an all-bank administrator can create global lists (D-44).' : 'That bank is outside your scope.';
    const parsed = lookupListCreateSchema.safeParse({ key: key.trim(), bank_id: bankId, title });
    const merged = parsed.success ? next : { ...zodFieldErrors(parsed.error), ...next };
    setClientErrors(merged);
    if (!parsed.success || Object.keys(merged).length > 0) return;
    create.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>New lookup list</DialogTitle>
        <DialogDescription>A versioned list of options that forms can use. Items are added by publishing its first version.</DialogDescription>
      </DialogHeader>
      <FormField label="Key" htmlFor={`${uid}-key`} required error={errors.key} hint="snake_case, e.g. business_types. Forms refer to the list by this key.">
        <Input id={`${uid}-key`} value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} maxLength={64} className="font-mono" aria-invalid={!!errors.key || undefined} />
      </FormField>
      <FormField label="Title" htmlFor={`${uid}-title`} required error={errors.title}>
        <Input id={`${uid}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-invalid={!!errors.title || undefined} />
      </FormField>
      <FormField label="Scope" htmlFor={`${uid}-scope`} required error={errors.bank_id} hint="A bank list with the same key replaces the global one for that bank.">
        <ScopeSelect id={`${uid}-scope`} value={bankId} onChange={setBankId} invalid={!!errors.bank_id} />
      </FormField>
      <ApiErrorAlert error={create.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Create list
        </Button>
      </DialogFooter>
    </form>
  );
}
