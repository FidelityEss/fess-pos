'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { attributesStateToObject } from '@/components/admin/attributes-editor';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { apiFieldErrors, type FieldErrors, zodFieldErrors } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adminApi } from '@/lib/api';
import { fullName } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import { type UserCreateBody, userCreateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import { accessPayload, UserFormFields, type UserFormState, userFormStateFrom, validateAccess } from './user-form';

export function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">{open ? <CreateUserForm onClose={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function CreateUserForm({ onClose }: { onClose: () => void }) {
  const staff = useStaff();
  const router = useRouter();
  const [state, setState] = useState<UserFormState>(() => {
    const s = userFormStateFrom(null);
    // A bank-scoped admin with a single bank gets it pre-selected.
    if (!staff.isGlobalAdmin && staff.me.bank_ids?.length === 1) s.bankIds = [...staff.me.bank_ids];
    return s;
  });
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const mutation = useMutationWithToast({
    mutationFn: (body: UserCreateBody) => adminApi.users.create(body),
    invalidate: [['users'], ['agents']],
    toastErrors: false,
    successMessage: (u) => `Created ${fullName(u)}`,
    onSuccess: (u) => {
      onClose();
      router.push(`/users/${u.id}`);
    },
  });
  const errors: FieldErrors = { ...apiFieldErrors(mutation.error), ...clientErrors };

  function submit(e: FormEvent) {
    e.preventDefault();
    const next = validateAccess(state, staff);
    const attrs = attributesStateToObject(state.attributes);
    if (!attrs.ok) next.attributes = attrs.message;
    const parsed = userCreateSchema.safeParse({
      employee_number: state.employee_number,
      first_name: state.first_name,
      last_name: state.last_name,
      email: state.email,
      phone: state.phone,
      ...accessPayload(state),
      attributes: attrs.ok ? attrs.value : {},
    });
    const merged = parsed.success ? next : { ...zodFieldErrors(parsed.error), ...next };
    setClientErrors(merged);
    if (!parsed.success || Object.keys(merged).length > 0) return;
    mutation.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>New user</DialogTitle>
        <DialogDescription>
          {staff.isGlobalAdmin
            ? 'Add an agent, administrator or bank reader.'
            : 'You can add agents and bank readers for your own banks (D-44).'}
        </DialogDescription>
      </DialogHeader>
      <UserFormFields state={state} onChange={(patch) => setState((s) => ({ ...s, ...patch }))} errors={errors} mode="create" />
      <ApiErrorAlert error={mutation.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Create user
        </Button>
      </DialogFooter>
    </form>
  );
}
