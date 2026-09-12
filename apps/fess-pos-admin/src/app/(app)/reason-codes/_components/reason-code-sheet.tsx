'use client';

// Create or edit a reason code (docs/06 §3). Codes are never deleted — deactivate instead.
import { type FormEvent, useId, useState } from 'react';
import { canWriteScoped } from '@/components/admin/access';
import { BankScopeBadge, ReadOnlyNotice } from '@/components/admin/admin-ui';
import { blankToNull, parseIntText, patchAdmin } from '@/components/admin/form-helpers';
import { defaultScope, ScopeSelect } from '@/components/admin/scope-select';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { apiFieldErrors, type FieldErrors, FormField, FormGrid, zodFieldErrors } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import { type ReasonCodeCreateBody, reasonCodeCreateSchema, reasonCodeUpdateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import { REASON_CATEGORIES, type ReasonCategory, type ReasonCode } from '@/lib/types';

/** Where each catalogue is used (UI help text). */
export const CATEGORY_HINT: Record<ReasonCategory, string> = {
  assignment_reject: 'An agent declines an assigned job.',
  unable_to_complete: 'An agent can’t complete the visit on site.',
  cancel: 'An administrator cancels a job.',
  geofence_override: 'An agent starts an inspection outside the geofence.',
  review_return: 'A reviewer returns an inspection to the agent for fixes.',
  review_reject: 'A reviewer rejects an inspection.',
  appointment_not_secured: 'A scheduler couldn’t secure an appointment with the merchant.',
  reassign: 'An administrator revokes or reassigns a job.',
  unschedule: 'A scheduler removes a confirmed appointment.',
  envelope_resolution: 'An administrator resolves a problem upload in the envelope inbox.',
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

  const mutation = useMutationWithToast({
    mutationFn: (save: ReasonSave) =>
      save.kind === 'create'
        ? adminApi.reasonCodes.create(save.body)
        : // patchAdmin so a cleared description is sent as null.
          patchAdmin<ReasonCode>(`/reason-codes/${encodeURIComponent(save.id)}`, save.body),
    invalidate: [['reason_codes']],
    toastErrors: false,
    successMessage: (r, save) => (save.kind === 'create' ? `Reason code ${r.code} created` : `Reason code ${r.code} saved`),
    onSuccess: () => onDone(),
  });
  const errors: FieldErrors = { ...apiFieldErrors(mutation.error), ...clientErrors };

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    const sort = parseIntText(sortOrder);
    if (sort === null || (sort !== undefined && (sort < SORT_MIN || sort > SORT_MAX))) next.sort_order = `A whole number between ${SORT_MIN} and ${SORT_MAX}`;
    const flags = { requires_note: requiresNote, requires_photo: requiresPhoto, billable };
    if (!existing) {
      if (!canWriteScoped(staff, bankId)) next.bank_id = bankId === null ? 'Only an all-bank administrator can add global codes (D-44).' : 'That bank is outside your scope.';
      const parsed = reasonCodeCreateSchema.safeParse({
        category,
        code,
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
        <SheetTitle>{existing ? `Reason code ${existing.code}` : 'New reason code'}</SheetTitle>
        <SheetDescription>{CATEGORY_HINT[category]}</SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-5">
        {!canWrite ? (
          <ReadOnlyNotice>
            {existing?.bank_id === null ? 'Global reason codes are managed by all-bank administrators (D-44).' : 'This code belongs to a bank outside your scope.'}
          </ReadOnlyNotice>
        ) : null}
        <FormGrid>
          <FormField label="Category" htmlFor={`${uid}-category`} required error={errors.category}>
            {existing ? (
              <Input id={`${uid}-category`} value={humanize(existing.category)} readOnly />
            ) : (
              <Select value={category} onValueChange={(v) => setCategory(v as ReasonCategory)}>
                <SelectTrigger id={`${uid}-category`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASON_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {humanize(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Scope" htmlFor={`${uid}-scope`} required error={errors.bank_id} hint={existing ? 'The scope can’t be changed.' : 'A bank code with the same code replaces the global one for that bank.'}>
            {existing ? (
              <div className="flex h-10 items-center">
                <BankScopeBadge bankId={existing.bank_id} />
              </div>
            ) : (
              <ScopeSelect id={`${uid}-scope`} value={bankId} onChange={setBankId} invalid={!!errors.bank_id} />
            )}
          </FormField>
        </FormGrid>
        <FormField label="Code" htmlFor={`${uid}-code`} required={!existing} error={errors.code} hint={existing ? 'Codes can’t be renamed — past records keep the code they used.' : 'snake_case, e.g. business_closed. Stored on every record that uses it.'}>
          <Input
            id={`${uid}-code`}
            value={code}
            onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            readOnly={!!existing}
            maxLength={64}
            className="font-mono"
            aria-invalid={!!errors.code || undefined}
          />
        </FormField>
        <FormField label="Label" htmlFor={`${uid}-label`} required error={errors.label} hint="What agents and administrators see.">
          <Input id={`${uid}-label`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} disabled={!canWrite} aria-invalid={!!errors.label || undefined} />
        </FormField>
        <FormField label="Description" htmlFor={`${uid}-description`} error={errors.description}>
          <Textarea id={`${uid}-description`} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} disabled={!canWrite} />
        </FormField>
        <div className="grid gap-3">
          {(
            [
              ['note', 'Requires a note', 'The person must explain in their own words.', requiresNote, setRequiresNote],
              ['photo', 'Requires a photo', 'A camera photo must be captured with this reason.', requiresPhoto, setRequiresPhoto],
              ['billable', 'Billable', 'Chargeable by default. A bank’s billing settings can override this (D-43).', billable, setBillable],
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
        <FormField label="Sort order" htmlFor={`${uid}-sort`} error={errors.sort_order} hint="Lower numbers are listed first." className="max-w-40">
          <Input id={`${uid}-sort`} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} disabled={!canWrite} aria-invalid={!!errors.sort_order || undefined} />
        </FormField>
        {existing ? (
          <div className="flex items-start gap-2 rounded-md border p-3">
            <Switch id={`${uid}-active`} checked={active} onCheckedChange={setActive} disabled={!canWrite} />
            <div className="grid gap-0.5">
              <Label htmlFor={`${uid}-active`}>Active</Label>
              <p className="text-sm text-muted-foreground">
                Reason codes are never deleted. Deactivate one to stop offering it; records that already use it keep it.
              </p>
            </div>
          </div>
        ) : null}
        <ApiErrorAlert error={mutation.error} />
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={!canWrite}>
          {existing ? 'Save changes' : 'Create reason code'}
        </Button>
      </SheetFooter>
    </form>
  );
}
