'use client';

import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { attributesStateToObject } from '@/components/admin/attributes-editor';
import { blankToNull, patchAdmin, sameBankIds, sameJson, sameMembers } from '@/components/admin/form-helpers';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { apiFieldErrors, type FieldErrors, FormActions, zodFieldErrors } from '@/components/form-field';
import { JsonView } from '@/components/json-view';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useMutationWithToast } from '@/lib/mutations';
import { Advanced } from '@/lib/preferences';
import { userUpdateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import type { PosUser } from '@/lib/types';
import { accessPayload, UserFormFields, type UserFormState, userFormStateFrom, validateAccess } from '../../_components/user-form';

/** Profile editor. Keyed by user.updated_at by the page, so a saved change resets the form. */
export function ProfileCard({ user, canManage, isSelf }: { user: PosUser; canManage: boolean; isSelf: boolean }) {
  const staff = useStaff();
  const [state, setState] = useState<UserFormState>(() => userFormStateFrom(user));
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const mutation = useMutationWithToast({
    // patchAdmin so a cleared email / phone is sent as null (the shared body type can't express that).
    mutationFn: (body: Record<string, unknown>) => patchAdmin<PosUser>(`/users/${encodeURIComponent(user.id)}`, body),
    invalidate: [['users'], ['agents']],
    toastErrors: false,
    successMessage: 'Profile saved',
  });
  const errors: FieldErrors = { ...apiFieldErrors(mutation.error), ...clientErrors };
  const lockReason = !canManage
    ? 'You can’t change this user’s access.'
    : isSelf
      ? 'You can’t change your own role, permissions or banks (D-44). Another administrator has to.'
      : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: FieldErrors = isSelf ? {} : validateAccess(state, staff);
    const attrs = attributesStateToObject(state.attributes);
    if (!attrs.ok) next.attributes = attrs.message;
    const access = accessPayload(state);
    const parsed = userUpdateSchema.safeParse({
      first_name: state.first_name,
      last_name: state.last_name,
      email: state.email,
      phone: state.phone,
      ...(isSelf ? {} : access),
      attributes: attrs.ok ? attrs.value : {},
    });
    const merged = parsed.success ? next : { ...zodFieldErrors(parsed.error), ...next };
    setClientErrors(merged);
    if (!parsed.success || !attrs.ok || Object.keys(merged).length > 0) return;

    const body: Record<string, unknown> = {};
    const first = state.first_name.trim();
    if (first !== user.first_name) body.first_name = first;
    const last = state.last_name.trim();
    if (last !== user.last_name) body.last_name = last;
    const email = blankToNull(state.email)?.toLowerCase() ?? null;
    if (email !== (user.email ?? null)) body.email = email;
    const phone = blankToNull(state.phone);
    if (phone !== (user.phone ?? null)) body.phone = phone;
    if (!isSelf) {
      if (access.role !== user.role) body.role = access.role;
      if (access.role !== user.role || !sameMembers(access.permissions, user.permissions)) body.permissions = access.permissions;
      if (!sameBankIds(access.bank_ids, user.bank_ids)) body.bank_ids = access.bank_ids;
    }
    if (!sameJson(attrs.value, user.attributes)) body.attributes = attrs.value;
    if (Object.keys(body).length === 0) {
      toast.info('No changes to save');
      return;
    }
    mutation.mutate(body);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Name, contact details, access and attributes.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5" noValidate>
          <UserFormFields
            state={state}
            onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
            errors={errors}
            mode="edit"
            accessLockedReason={lockReason}
            hasAdminLogin={user.admin_auth_uid !== null}
            disabled={!canManage}
          />
          <ApiErrorAlert error={mutation.error} />
          {canManage ? (
            <FormActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setState(userFormStateFrom(user));
                  setClientErrors({});
                  mutation.reset();
                }}
              >
                Reset
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                Save profile
              </Button>
            </FormActions>
          ) : null}
        </form>
        {user.profile_snapshot ? (
          <Advanced>
            <div className="mt-6 space-y-1.5">
              <h3 className="text-base font-semibold">Last profile from the host app</h3>
              <p className="text-sm text-muted-foreground">Display only — it is written by the host and never used to authorise anything.</p>
              <JsonView value={user.profile_snapshot} defaultExpandDepth={1} maxHeight={240} />
            </div>
          </Advanced>
        ) : null}
      </CardContent>
    </Card>
  );
}
