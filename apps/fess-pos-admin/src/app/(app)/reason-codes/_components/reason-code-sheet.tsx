'use client';

// Add or change a reason (a reason code, docs/06 §3). Reasons are never deleted — they are turned off instead.
import { type FormEvent, useId, useState } from 'react';
import { canWriteScoped } from '@/components/admin/access';
import { BankScopeBadge, ReadOnlyNotice } from '@/components/admin/admin-ui';
import { blankToNull, keyFromText, parseIntText, patchAdmin } from '@/components/admin/form-helpers';
import { defaultScope, ScopeSelect } from '@/components/admin/scope-select';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { Details } from '@/components/details';
import { apiFieldErrors, type FieldErrors, FormField, FormGrid, zodFieldErrors } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { labelFrom, REASON_CATEGORY_LABEL } from '@/lib/labels';
import { useMutationWithToast } from '@/lib/mutations';
import { type ReasonCodeCreateBody, reasonCodeCreateSchema, reasonCodeUpdateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import { REASON_CATEGORIES, type ReasonCategory, type ReasonCode } from '@/lib/types';

/** Where each list of reasons is used, as one plain sentence (UI help text). */
export const CATEGORY_HINT: Record<ReasonCategory, string> = {
  assignment_reject: 'The reasons an agent can give for turning down a job.',
  unable_to_complete: 'The reasons an agent can give when they can’t finish a visit on site.',
  cancel: 'The reasons an administrator can give for cancelling a job.',
  geofence_override: 'The reasons an agent can give for starting a visit away from the merchant’s site.',
  review_return: 'The reasons a reviewer can give for sending a visit back to the agent to fix.',
  review_reject: 'The reasons a reviewer can give for rejecting a visit.',
  appointment_not_secured: 'The reasons someone can give when they couldn’t book a visit with the merchant.',
  reassign: 'The reasons an administrator can give for taking a job off an agent.',
  unschedule: 'The reasons someone can give for cancelling a booked visit.',
  envelope_resolution: 'The reasons an administrator can give when sorting out data from a phone that couldn’t be saved.',
};

export type ReasonSheetState = { mode: 'create'; category: ReasonCategory } | { mode: 'edit'; code: ReasonCode };

export function ReasonCodeSheet({ state, onOpenChange }: { state: ReasonSheetState | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={state !== null} onOpenChange={onOpenChange}>
      <SheetContent size="md">
        {state ? (
          <ReasonCodeForm key={state.mode === 'edit' ? state.code.id : `new-${state.category}`} state={state} onDone={() => onOpenChange(false)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

type ReasonSave = { kind: 'create'; body: ReasonCodeCreateBody } | { kind: 'update'; id: string; body: Record<string, unknown> };

const SORT_MIN = -10000;
const SORT_MAX = 10000;

function ReasonCodeForm({ state, onDone }: { state: ReasonSheetState; onDone: () => void }) {
  const staff = useStaff();
  const uid = useId();
  const existing = state.mode === 'edit' ? state.code : null;
  const [category, setCategory] = useState<ReasonCategory>(state.mode === 'create' ? state.category : state.code.category);
  const [code, setCode] = useState(existing?.code ?? '');
  // A new reason's code follows the reason's wording until someone types their own.
  const [codeTouched, setCodeTouched] = useState(false);
  const [label, setLabel] = useState(existing?.label ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [requiresNote, setRequiresNote] = useState(existing?.requires_note ?? false);
  const [requiresPhoto, setRequiresPhoto] = useState(existing?.requires_photo ?? false);
  const [billable, setBillable] = useState(existing?.billable ?? false);
  const [active, setActive] = useState(existing?.active ?? true);
  const [bankId, setBankId] = useState<string | null>(existing ? existing.bank_id : defaultScope(staff));
  const [sortOrder, setSortOrder] = useState(String(existing?.sort_order ?? 0));
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const canWrite = existing ? canWriteScoped(staff, existing.bank_id) : staff.isAdmin;
  const shownCode = existing ? existing.code : codeTouched ? code : keyFromText(label);

  const mutation = useMutationWithToast({
    mutationFn: (save: ReasonSave) =>
      save.kind === 'create'
        ? adminApi.reasonCodes.create(save.body)
        : // patchAdmin so a cleared description is sent as null.
          patchAdmin<ReasonCode>(`/reason-codes/${encodeURIComponent(save.id)}`, save.body),
    invalidate: [['reason_codes']],
    toastErrors: false,
    successMessage: (r, save) => (save.kind === 'create' ? `Reason “${r.label}” added.` : 'Changes saved.'),
    onSuccess: () => onDone(),
  });
  const errors: FieldErrors = { ...apiFieldErrors(mutation.error), ...clientErrors };

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    const sort = parseIntText(sortOrder);
    if (sort === null || (sort !== undefined && (sort < SORT_MIN || sort > SORT_MAX))) next.sort_order = `Enter a whole number between ${SORT_MIN} and ${SORT_MAX}.`;
    const flags = { requires_note: requiresNote, requires_photo: requiresPhoto, billable };
    if (!existing) {
      if (!canWriteScoped(staff, bankId)) {
        next.bank_id = bankId === null ? 'Only an administrator who covers all banks can add a reason for all banks.' : 'You don’t have access to that bank.';
      }
      const parsed = reasonCodeCreateSchema.safeParse({
        category,
        code: shownCode,
        label,
        description,
        ...flags,
        bank_id: bankId,
        sort_order: sort ?? undefined,
      });
      const merged = parsed.success ? next : { ...zodFieldErrors(parsed.error), ...next };
      setClientErrors(merged);
      if (!parsed.success || Object.keys(merged).length > 0) return;
      mutation.mutate({ kind: 'create', body: parsed.data });
      return;
    }
    const parsed = reasonCodeUpdateSchema.safeParse({ label, description, ...flags, sort_order: sort ?? undefined, active });
    const merged = parsed.success ? next : { ...zodFieldErrors(parsed.error), ...next };
    setClientErrors(merged);
    if (!parsed.success || Object.keys(merged).length > 0) return;
    mutation.mutate({
      kind: 'update',
      id: existing.id,
      body: { label: label.trim(), description: blankToNull(description), ...flags, sort_order: sort ?? 0, active },
    });
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader>
        <SheetTitle>{existing ? existing.label : 'Add a reason'}</SheetTitle>
        <SheetDescription>{CATEGORY_HINT[category]}</SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-5">
        {!canWrite ? (
          <ReadOnlyNotice>
            {existing?.bank_id === null ? 'Reasons for all banks can only be changed by an administrator who covers all banks.' : 'This reason belongs to a bank you don’t have access to.'}
          </ReadOnlyNotice>
        ) : null}
        <FormGrid>
          <FormField label="Used when" htmlFor={`${uid}-category`} required error={errors.category}>
            {existing ? (
              <Input id={`${uid}-category`} value={labelFrom(REASON_CATEGORY_LABEL, existing.category)} readOnly />
            ) : (
              <Select value={category} onValueChange={(v) => setCategory(v as ReasonCategory)}>
                <SelectTrigger id={`${uid}-category`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASON_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {REASON_CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField
            label="Which banks"
            htmlFor={`${uid}-scope`}
            required
            error={errors.bank_id}
            hint={existing ? 'This can’t be changed.' : 'Choose one bank if only that bank should see this reason.'}
          >
            {existing ? (
              <div className="flex h-10 items-center">
                <BankScopeBadge bankId={existing.bank_id} />
              </div>
            ) : (
              <ScopeSelect id={`${uid}-scope`} value={bankId} onChange={setBankId} invalid={!!errors.bank_id} />
            )}
          </FormField>
        </FormGrid>
        <FormField label="Reason" htmlFor={`${uid}-label`} required error={errors.label} hint="What people see and pick.">
          <Input id={`${uid}-label`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} disabled={!canWrite} aria-invalid={!!errors.label || undefined} />
        </FormField>
        <FormField label="Explanation" htmlFor={`${uid}-description`} error={errors.description} hint="Optional. Helps people pick the right reason.">
          <Textarea id={`${uid}-description`} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} disabled={!canWrite} />
        </FormField>
        <div className="grid gap-3">
          {(
            [
              ['note', 'Needs a note', 'The person must explain in their own words.', requiresNote, setRequiresNote],
              ['photo', 'Needs a photo', 'The person must take a photo with the camera.', requiresPhoto, setRequiresPhoto],
              ['billable', 'Billable', 'The bank is charged when this reason is used. Each bank’s billing settings can change this.', billable, setBillable],
            ] as const
          ).map(([key, title, hint, checked, set]) => (
            <div key={key} className="flex items-start gap-2">
              <Switch id={`${uid}-${key}`} checked={checked} onCheckedChange={set} disabled={!canWrite} />
              <div className="grid gap-0.5">
                <Label htmlFor={`${uid}-${key}`}>{title}</Label>
                <p className="text-sm text-muted-foreground">{hint}</p>
              </div>
            </div>
          ))}
        </div>
        {existing ? (
          <div className="flex items-start gap-2 rounded-md border p-3">
            <Switch id={`${uid}-active`} checked={active} onCheckedChange={setActive} disabled={!canWrite} />
            <div className="grid gap-0.5">
              <Label htmlFor={`${uid}-active`}>Active</Label>
              <p className="text-sm text-muted-foreground">
                Reasons are never deleted. Turn one off to stop offering it; records that already use it keep it.
              </p>
            </div>
          </div>
        ) : null}
        <Details summary="Code and position in the list" defaultOpen={!!errors.code || !!errors.sort_order}>
          <FormField
            label="Code"
            htmlFor={`${uid}-code`}
            required={!existing}
            error={errors.code}
            hint={
              existing
                ? 'The code can’t be changed. Past records keep the code they used.'
                : 'A short name stored with every record that uses this reason. It’s filled in from the reason and can’t be changed later.'
            }
          >
            <Input
              id={`${uid}-code`}
              value={shownCode}
              onChange={(e) => {
                setCodeTouched(true);
                setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
              }}
              readOnly={!!existing}
              maxLength={64}
              className="font-mono"
              aria-invalid={!!errors.code || undefined}
            />
          </FormField>
          <FormField label="Position in the list" htmlFor={`${uid}-sort`} error={errors.sort_order} hint="Lower numbers are listed first." className="max-w-48">
            <Input id={`${uid}-sort`} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} disabled={!canWrite} aria-invalid={!!errors.sort_order || undefined} />
          </FormField>
        </Details>
        <ApiErrorAlert error={mutation.error} />
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={!canWrite}>
          {existing ? 'Save changes' : 'Add reason'}
        </Button>
      </SheetFooter>
    </form>
  );
}
