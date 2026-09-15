'use client';

import { type FormEvent, useId, useState } from 'react';
import { canWriteScoped } from '@/components/admin/access';
import { keyFromText } from '@/components/admin/form-helpers';
import { defaultScope, ScopeSelect } from '@/components/admin/scope-select';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { Details } from '@/components/details';
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
  // The key follows the list's name until someone types their own.
  const [keyTouched, setKeyTouched] = useState(false);
  const [title, setTitle] = useState('');
  const [bankId, setBankId] = useState<string | null>(() => defaultScope(staff));
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const shownKey = keyTouched ? key : keyFromText(title);
  const create = useMutationWithToast({
    mutationFn: (body: LookupListCreateBody) => adminApi.lookupLists.create(body),
    invalidate: [['lookup_lists']],
    toastErrors: false,
    successMessage: (l) => `“${l.title}” added. Now add its choices and publish them.`,
    onSuccess: (l) => {
      onClose();
      onCreated(l.id);
    },
  });
  const errors: FieldErrors = { ...apiFieldErrors(create.error), ...clientErrors };

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    if (!canWriteScoped(staff, bankId)) {
      next.bank_id = bankId === null ? 'Only an administrator who covers all banks can add a list for all banks.' : 'You don’t have access to that bank.';
    }
    const parsed = lookupListCreateSchema.safeParse({ key: shownKey.trim(), bank_id: bankId, title });
    const merged = parsed.success ? next : { ...zodFieldErrors(parsed.error), ...next };
    setClientErrors(merged);
    if (!parsed.success || Object.keys(merged).length > 0) return;
    create.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Add a drop-down list</DialogTitle>
        <DialogDescription>A list of choices the questions can use, such as provinces. After adding it, you add its choices and publish them.</DialogDescription>
      </DialogHeader>
      <FormField label="Name" htmlFor={`${uid}-title`} required error={errors.title}>
        <Input id={`${uid}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-invalid={!!errors.title || undefined} />
      </FormField>
      <FormField label="Which banks" htmlFor={`${uid}-scope`} required error={errors.bank_id} hint="Choose one bank if only that bank should use this list.">
        <ScopeSelect id={`${uid}-scope`} value={bankId} onChange={setBankId} invalid={!!errors.bank_id} />
      </FormField>
      <Details defaultOpen={!!errors.key}>
        <FormField
          label="Key"
          htmlFor={`${uid}-key`}
          required
          error={errors.key}
          hint="The name the questions use to find this list. It’s filled in from the list’s name and can’t be changed later."
        >
          <Input
            id={`${uid}-key`}
            value={shownKey}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
            }}
            maxLength={64}
            className="font-mono"
            aria-invalid={!!errors.key || undefined}
          />
        </FormField>
      </Details>
      <ApiErrorAlert error={create.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Add list
        </Button>
      </DialogFooter>
    </form>
  );
}
