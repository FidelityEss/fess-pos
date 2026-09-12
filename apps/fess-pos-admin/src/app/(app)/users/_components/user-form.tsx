'use client';

// User fields shared by "New user" and the profile editor, constrained by D-44.
import { useId } from 'react';
import { assignableRoles } from '@/components/admin/access';
import { PERMISSION_HINT, PERMISSION_LABEL, ROLE_HINT, ROLE_LABEL } from '@/components/admin/admin-ui';
import { type AttributesState, AttributesEditor, attributesStateFrom } from '@/components/admin/attributes-editor';
import { BankMultiSelect } from '@/components/admin/bank-multi-select';
import { type FieldErrors, FormField, FormGrid, FormSection } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { type StaffContextValue, useStaff } from '@/lib/staff';
import { type Permission, PERMISSIONS, type PosRole, type PosUser } from '@/lib/types';

export interface UserFormState {
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: PosRole;
  permissions: Permission[];
  allBanks: boolean;
  bankIds: string[];
  attributes: AttributesState;
}

export function userFormStateFrom(user: PosUser | null): UserFormState {
  return {
    employee_number: user?.employee_number ?? '',
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    role: user?.role ?? 'pos_agent',
    permissions: user?.permissions ?? [],
    allBanks: user ? user.bank_ids === null : false,
    bankIds: user?.bank_ids ?? [],
    attributes: attributesStateFrom(user?.attributes ?? {}),
  };
}

type StaffLike = Pick<StaffContextValue, 'me' | 'isAdmin' | 'isGlobalAdmin' | 'canAccessBank'>;

/** Role / bank checks mirroring pos_rpc.admin_user_check_input and admin_can_manage_user (D-20, D-44). */
export function validateAccess(state: UserFormState, staff: StaffLike): FieldErrors {
  const errors: FieldErrors = {};
  if (!assignableRoles(staff).includes(state.role)) errors.role = 'You can only manage agents and bank readers (D-44).';
  if (state.allBanks) {
    if (!staff.isGlobalAdmin) errors.bank_ids = 'Only an all-bank administrator can give access to all banks.';
    else if (state.role === 'pos_bank_reader') errors.bank_ids = 'A bank reader needs specific banks.';
  } else if (state.bankIds.length === 0) {
    errors.bank_ids = state.role === 'pos_bank_reader' ? 'A bank reader needs at least one bank.' : 'Choose at least one bank, or all banks.';
  } else if (!staff.isGlobalAdmin && state.bankIds.some((b) => !staff.canAccessBank(b))) {
    errors.bank_ids = 'You can only choose banks in your own scope.';
  }
  return errors;
}

/** role / permissions / bank_ids as sent to the API (permissions only for administrators). */
export function accessPayload(state: UserFormState): { role: PosRole; permissions: Permission[]; bank_ids: string[] | null } {
  return {
    role: state.role,
    permissions: state.role === 'pos_admin' ? state.permissions : [],
    bank_ids: state.allBanks ? null : state.bankIds,
  };
}

export function UserFormFields({
  state,
  onChange,
  errors,
  mode,
  accessLockedReason,
  hasAdminLogin = false,
  disabled = false,
}: {
  state: UserFormState;
  onChange: (patch: Partial<UserFormState>) => void;
  errors: FieldErrors;
  mode: 'create' | 'edit';
  /** When set, role / permissions / banks are read-only and this explains why. */
  accessLockedReason?: string | null;
  hasAdminLogin?: boolean;
  disabled?: boolean;
}) {
  const staff = useStaff();
  const uid = useId();
  const roles = assignableRoles(staff);
  const roleOptions = roles.includes(state.role) ? roles : [state.role, ...roles];
  const accessLocked = disabled || !!accessLockedReason;
  const canAllBanks = staff.isGlobalAdmin && state.role !== 'pos_bank_reader';

  function setRole(role: PosRole) {
    onChange(role === 'pos_bank_reader' ? { role, allBanks: false } : { role });
  }
  function togglePermission(p: Permission, on: boolean) {
    onChange({ permissions: on ? [...state.permissions.filter((x) => x !== p), p] : state.permissions.filter((x) => x !== p) });
  }

  return (
    <div className="space-y-6">
      <FormSection title="Person">
        <FormGrid>
          <FormField
            label="Employee number"
            htmlFor={`${uid}-emp`}
            required={mode === 'create'}
            error={errors.employee_number}
            hint={mode === 'create' ? 'Letters, digits and -, up to 32. It binds the person to their verified host identity.' : 'Can’t be changed — it binds the person to their verified host identity.'}
          >
            <Input
              id={`${uid}-emp`}
              value={state.employee_number}
              onChange={(e) => onChange({ employee_number: e.target.value })}
              readOnly={mode === 'edit'}
              disabled={disabled && mode === 'create'}
              maxLength={32}
              className="font-mono"
              aria-invalid={!!errors.employee_number || undefined}
            />
          </FormField>
          <div className="hidden sm:block" />
          <FormField label="First name" htmlFor={`${uid}-first`} required error={errors.first_name}>
            <Input id={`${uid}-first`} value={state.first_name} onChange={(e) => onChange({ first_name: e.target.value })} disabled={disabled} maxLength={120} aria-invalid={!!errors.first_name || undefined} />
          </FormField>
          <FormField label="Last name" htmlFor={`${uid}-last`} required error={errors.last_name}>
            <Input id={`${uid}-last`} value={state.last_name} onChange={(e) => onChange({ last_name: e.target.value })} disabled={disabled} maxLength={120} aria-invalid={!!errors.last_name || undefined} />
          </FormField>
          <FormField label="Email" htmlFor={`${uid}-email`} error={errors.email}>
            <Input id={`${uid}-email`} type="email" value={state.email} onChange={(e) => onChange({ email: e.target.value })} disabled={disabled} maxLength={320} aria-invalid={!!errors.email || undefined} />
          </FormField>
          <FormField label="Phone" htmlFor={`${uid}-phone`} error={errors.phone}>
            <Input id={`${uid}-phone`} type="tel" value={state.phone} onChange={(e) => onChange({ phone: e.target.value })} disabled={disabled} maxLength={40} aria-invalid={!!errors.phone || undefined} />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection title="Access" description="Role, permissions and the banks this person works for.">
        {accessLockedReason ? (
          <Alert variant="info">
            <AlertDescription>{accessLockedReason}</AlertDescription>
          </Alert>
        ) : null}
        <FormGrid>
          <FormField label="Role" htmlFor={`${uid}-role`} required error={errors.role} hint={ROLE_HINT[state.role]}>
            <Select value={state.role} onValueChange={(v) => setRole(v as PosRole)} disabled={accessLocked}>
              <SelectTrigger id={`${uid}-role`} aria-invalid={!!errors.role || undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => (
                  <SelectItem key={r} value={r} disabled={!roles.includes(r) || (r === 'pos_agent' && hasAdminLogin)}>
                    {ROLE_LABEL[r]}
                    {r === 'pos_agent' && hasAdminLogin ? ' — not possible: this person has a panel login' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Banks" htmlFor={`${uid}-banks`} required error={errors.bank_ids}>
            <div className="grid gap-2">
              {canAllBanks ? (
                <div className="flex items-center gap-2">
                  <Switch id={`${uid}-all`} checked={state.allBanks} onCheckedChange={(v) => onChange({ allBanks: v })} disabled={accessLocked} />
                  <Label htmlFor={`${uid}-all`}>All banks</Label>
                </div>
              ) : null}
              {!state.allBanks ? (
                <BankMultiSelect
                  id={`${uid}-banks`}
                  value={state.bankIds}
                  onChange={(bankIds) => onChange({ bankIds })}
                  allowedBankIds={staff.me.bank_ids}
                  disabled={accessLocked}
                  invalid={!!errors.bank_ids}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {state.role === 'pos_admin' ? 'An all-bank administrator manages global reference data (D-44).' : 'Can be allocated jobs for any bank.'}
                </p>
              )}
            </div>
          </FormField>
        </FormGrid>
        {state.role === 'pos_admin' ? (
          <div className="grid gap-2">
            <Label>Permissions</Label>
            {PERMISSIONS.map((p) => (
              <label key={p} className="flex items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={state.permissions.includes(p)} onCheckedChange={(v) => togglePermission(p, v === true)} disabled={accessLocked} />
                <span className="grid gap-0.5">
                  <span className="font-medium">{PERMISSION_LABEL[p]}</span>
                  <span className="text-sm text-muted-foreground">{PERMISSION_HINT[p]}</span>
                </span>
              </label>
            ))}
            {errors.permissions ? <p className="text-sm text-destructive">{errors.permissions}</p> : null}
          </div>
        ) : null}
      </FormSection>

      <FormSection title="Attributes" description="Free-form facts about the person (e.g. region, skills), used for audience targeting.">
        <AttributesEditor state={state.attributes} onChange={(attributes) => onChange({ attributes })} disabled={disabled} error={errors.attributes} />
      </FormSection>
    </div>
  );
}
