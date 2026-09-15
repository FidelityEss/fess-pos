'use client';

// "Add a person" (D-96, docs/17 §4.9). Administrators and bank viewers are added and sent a registration link in one
// step; agents are added as before (they sign in through the FESS app, so there is nothing to send).
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
import { EMAIL_PATTERN, invitationsApi, type LinkResult, useRefreshPeople } from './invitations';
import { LinkPanel } from './link-panel';
import { accessPayload, UserFormFields, type UserFormState, userFormStateFrom, validateAccess } from './user-form';

const EMPLOYEE_NUMBER = /^[A-Za-z0-9-]{1,32}$/;

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
  const refresh = useRefreshPeople();
  const freshState = (): UserFormState => {
    const s = userFormStateFrom(null);
    // An administrator for one bank gets it pre-selected.
    if (!staff.isGlobalAdmin && staff.me.bank_ids?.length === 1) s.bankIds = [...staff.me.bank_ids];
    return s;
  };
  const [state, setState] = useState<UserFormState>(freshState);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [inviteError, setInviteError] = useState<unknown>(null);
  const [inviting, setInviting] = useState(false);
  const [sent, setSent] = useState<{ result: LinkResult; firstName: string; name: string } | null>(null);
  const staffLogin = state.role !== 'pos_agent';

  const agentMutation = useMutationWithToast({
    mutationFn: (body: UserCreateBody) => adminApi.users.create(body),
    invalidate: [['users'], ['agents']],
    toastErrors: false,
    successMessage: (u) => `${fullName(u)} added. Agents sign in through the FESS app, so there’s nothing to send.`,
    onSuccess: (u) => {
      onClose();
      router.push(`/users/${u.id}`);
    },
  });
  const errors: FieldErrors = { ...apiFieldErrors(staffLogin ? inviteError : agentMutation.error), ...clientErrors };

  async function sendLink() {
    const next = validateAccess(state, staff);
    const email = state.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) next.email = 'We send the registration link here. Enter an email address, like name@company.co.za.';
    if (!state.first_name.trim()) next.first_name = 'Enter their first name.';
    if (!state.last_name.trim()) next.last_name = 'Enter their last name.';
    if (state.employee_number.trim() && !EMPLOYEE_NUMBER.test(state.employee_number.trim())) {
      next.employee_number = 'Use letters, numbers and dashes only, up to 32.';
    }
    setClientErrors(next);
    if (Object.keys(next).length > 0) return;
    const access = accessPayload(state);
    setInviting(true);
    setInviteError(null);
    try {
      // Called directly (not through useMutation) so the link never enters the query cache.
      const result = await invitationsApi.send({
        email,
        person: {
          employee_number: state.employee_number.trim() || undefined,
          first_name: state.first_name.trim(),
          last_name: state.last_name.trim(),
          phone: state.phone.trim() || null,
          role: access.role === 'pos_bank_reader' ? 'pos_bank_reader' : 'pos_admin',
          permissions: access.permissions,
          bank_ids: access.bank_ids,
        },
      });
      setSent({ result, firstName: state.first_name.trim(), name: `${state.first_name.trim()} ${state.last_name.trim()}` });
      refresh();
    } catch (err) {
      setInviteError(err);
    } finally {
      setInviting(false);
    }
  }

  function addAgent() {
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
    agentMutation.mutate(parsed.data);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (staffLogin) void sendLink();
    else addAgent();
  }

  if (sent) {
    const userId = sent.result.user?.id ?? sent.result.invitation.user_id;
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{sent.name} added</DialogTitle>
          <DialogDescription>
            Next, they open the link and choose a password. Until then you’ll see them under “Waiting to sign up”.
          </DialogDescription>
        </DialogHeader>
        <LinkPanel result={sent.result} name={sent.firstName} kind="sent" />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSent(null);
              setState(freshState());
              setClientErrors({});
            }}
          >
            Add another person
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onClose();
              router.push(`/users/${userId}`);
            }}
          >
            Open their page
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Add a person</DialogTitle>
        <DialogDescription>
          {staff.isGlobalAdmin
            ? 'Add an administrator or bank viewer, who uses this panel, or an agent, who does the visits. Administrators and bank viewers get a registration link to choose their password.'
            : 'Add a bank viewer or an agent for your own banks. Bank viewers get a registration link to choose their password.'}
        </DialogDescription>
      </DialogHeader>
      <UserFormFields
        state={state}
        onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
        errors={errors}
        mode="create"
        invite={staffLogin}
      />
      <ApiErrorAlert error={staffLogin ? inviteError : agentMutation.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={staffLogin ? inviting : agentMutation.isPending}>
          {staffLogin ? 'Send registration link' : 'Add agent'}
        </Button>
      </DialogFooter>
    </form>
  );
}
