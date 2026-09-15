'use client';

import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useId, useState } from 'react';
import { ReadOnlyNotice } from '@/components/admin/admin-ui';
import { newRowId } from '@/components/admin/form-helpers';
import { ObjectEditor, type ObjectEditorState, objectEditorStateFrom, objectEditorStateToObject } from '@/components/admin/object-editor';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { Details } from '@/components/details';
import { apiFieldErrors, type FieldErrors, FormField, FormGrid, FormSection, zodFieldErrors } from '@/components/form-field';
import { useNextStepToast } from '@/components/next-step';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Sheet } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { adminApi, isApiError } from '@/lib/api';
import { useMutationWithToast } from '@/lib/mutations';
import { type BankCreateBody, bankCreateSchema, type BankUpdateBody, bankUpdateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import type { Bank, BillingSettings } from '@/lib/types';
import { BillingSettingsEditor, cleanBillingSettings } from './billing-settings-editor';

interface ContactRow {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
}

type BankSave = { kind: 'create'; body: BankCreateBody } | { kind: 'update'; id: string; body: BankUpdateBody };

/** Create (bank = null) or edit a bank in a side sheet. */
export function BankSheet({ open, bank, onOpenChange }: { open: boolean; bank: Bank | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg">{open ? <BankForm key={bank?.id ?? 'new'} bank={bank} onDone={() => onOpenChange(false)} /> : null}</SheetContent>
    </Sheet>
  );
}

function contactRowsFrom(bank: Bank | null): ContactRow[] {
  const list = bank && Array.isArray(bank.contacts) ? bank.contacts : [];
  return list.map((c) => ({ id: newRowId('contact'), name: c.name ?? '', role: c.role ?? '', email: c.email ?? '', phone: c.phone ?? '' }));
}

function BankForm({ bank, onDone }: { bank: Bank | null; onDone: () => void }) {
  const staff = useStaff();
  const uid = useId();
  const nextStep = useNextStepToast();
  const isNew = bank === null;
  const canFourEyes = staff.isGlobalAdmin && staff.hasPermission('approve_definitions');
  const canEdit = isNew ? staff.isGlobalAdmin : staff.isAdmin && staff.canAccessBank(bank.id);

  const [code, setCode] = useState(bank?.code ?? '');
  const [name, setName] = useState(bank?.name ?? '');
  const [active, setActive] = useState(bank?.active ?? true);
  const [fourEyes, setFourEyes] = useState(bank?.four_eyes_enabled ?? false);
  const [contacts, setContacts] = useState<ContactRow[]>(() => contactRowsFrom(bank));
  const [exportState, setExportState] = useState<ObjectEditorState>(() => objectEditorStateFrom(bank?.export_settings ?? {}));
  const [billing, setBilling] = useState<BillingSettings>(() => bank?.billing_settings ?? {});
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  // Contact row ids in the order they were sent, to map "contacts.<i>.<field>" errors back to rows.
  const [sentContactIds, setSentContactIds] = useState<string[]>([]);
  const exportCount = Object.keys(bank?.export_settings ?? {}).length;

  const mutation = useMutationWithToast({
    mutationFn: (save: BankSave) => (save.kind === 'create' ? adminApi.banks.create(save.body) : adminApi.banks.update(save.id, save.body)),
    invalidate: [['banks']],
    toastErrors: false,
    // A new bank gets the next-step toast below instead (docs/17 §4.5).
    successMessage: (b, save) => (save.kind === 'create' ? null : `Changes to ${b.name} saved.`),
    onSuccess: (b, save) => {
      if (save.kind === 'create') {
        nextStep('Bank added.', b.active ? { label: 'Add its first job', href: `/jobs/new?bank=${encodeURIComponent(b.id)}` } : null);
      }
      onDone();
    },
  });

  // A duplicate code comes back as ALREADY_EXISTS without a field path; show it on the Code field, which is at the top
  // of the sheet — the error alert sits below the fold.
  const duplicateCode = isNew && isApiError(mutation.error) && mutation.error.code === 'ALREADY_EXISTS';
  const errors: FieldErrors = {
    ...(duplicateCode ? { code: 'Another bank already uses this code. Choose a different one.' } : {}),
    ...apiFieldErrors(mutation.error),
    ...clientErrors,
  };
  function contactError(rowId: string, field: keyof Omit<ContactRow, 'id'>): string | undefined {
    const index = sentContactIds.indexOf(rowId);
    return index >= 0 ? errors[`contacts.${index}.${field}`] : undefined;
  }
  function setContact(rowId: string, patch: Partial<ContactRow>) {
    setContacts((rows) => rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    const exp = objectEditorStateToObject(exportState, { label: 'Export settings' });
    if (!exp.ok) next.export_settings = exp.message;
    const kept = contacts.filter((c) => [c.name, c.role, c.email, c.phone].some((v) => v.trim()));
    setSentContactIds(kept.map((c) => c.id));
    const common = {
      name,
      active,
      contacts: kept.map(({ name: n, role, email, phone }) => ({ name: n, role, email, phone })),
      export_settings: exp.ok ? exp.value : {},
      billing_settings: cleanBillingSettings(billing),
    };
    if (isNew) {
      const parsed = bankCreateSchema.safeParse({ code: code.trim().toUpperCase(), ...common, ...(canFourEyes ? { four_eyes_enabled: fourEyes } : {}) });
      if (!parsed.success) Object.assign(next, zodFieldErrors(parsed.error), next);
      setClientErrors(next);
      if (!parsed.success || Object.keys(next).length > 0) return;
      mutation.mutate({ kind: 'create', body: parsed.data });
    } else {
      const fourEyesChanged = fourEyes !== bank.four_eyes_enabled;
      const parsed = bankUpdateSchema.safeParse({ ...common, ...(fourEyesChanged ? { four_eyes_enabled: fourEyes } : {}) });
      if (!parsed.success) Object.assign(next, zodFieldErrors(parsed.error), next);
      setClientErrors(next);
      if (!parsed.success || Object.keys(next).length > 0) return;
      mutation.mutate({ kind: 'update', id: bank.id, body: parsed.data });
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader>
        <SheetTitle>{isNew ? 'Add a bank' : `${bank.code} — ${bank.name}`}</SheetTitle>
        <SheetDescription>
          {isNew
            ? 'A bank you do visits for. Only an administrator who covers all banks can add one.'
            : 'This bank’s contacts, what it’s billed for, and whether changes need a second approval.'}
        </SheetDescription>
        {!isNew ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/jobs?bank=${encodeURIComponent(bank.id)}`}>See this bank’s jobs</Link>
            </Button>
            {canEdit && bank.active ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/jobs/new?bank=${encodeURIComponent(bank.id)}`}>
                  <Plus /> Add a job for this bank
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </SheetHeader>
      <SheetBody className="space-y-6">
        {!canEdit ? <ReadOnlyNotice>You can see this bank but not change it.</ReadOnlyNotice> : null}
        <FormSection title="Bank">
          <FormGrid>
            <FormField
              label="Code"
              htmlFor={`${uid}-code`}
              required={isNew}
              error={errors.code}
              hint={isNew ? 'A short code people know the bank by, such as ABC. 2 to 16 letters, numbers or _. It can’t be changed later.' : 'The code can’t be changed.'}
            >
              <Input
                id={`${uid}-code`}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                readOnly={!isNew}
                disabled={!canEdit && isNew}
                maxLength={16}
                className="font-mono"
                aria-invalid={!!errors.code || undefined}
              />
            </FormField>
            <FormField label="Name" htmlFor={`${uid}-name`} required error={errors.name}>
              <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} maxLength={200} aria-invalid={!!errors.name || undefined} />
            </FormField>
          </FormGrid>
          <div className="flex items-center gap-2">
            <Switch id={`${uid}-active`} checked={active} onCheckedChange={setActive} disabled={!canEdit} />
            <Label htmlFor={`${uid}-active`}>Active</Label>
            <span className="text-sm text-muted-foreground">Turn a bank off to stop new jobs for it. Its jobs and history are kept.</span>
          </div>
        </FormSection>

        <Separator />
        <FormSection title="Contacts" description="People at the bank you can get in touch with.">
          {errors.contacts ? <p className="text-sm text-destructive">{errors.contacts}</p> : null}
          {contacts.length === 0 ? <p className="text-sm text-muted-foreground">No contacts yet. Add one below.</p> : null}
          <div className="grid gap-3">
            {contacts.map((c, i) => (
              <div key={c.id} className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{c.name.trim() || `Contact ${i + 1}`}</span>
                  <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${c.name.trim() || `contact ${i + 1}`}`} disabled={!canEdit} onClick={() => setContacts((rows) => rows.filter((r) => r.id !== c.id))}>
                    <Trash2 /> Remove
                  </Button>
                </div>
                <FormGrid>
                  <FormField label="Name" htmlFor={`${uid}-${c.id}-name`} required error={contactError(c.id, 'name')}>
                    <Input id={`${uid}-${c.id}-name`} value={c.name} onChange={(e) => setContact(c.id, { name: e.target.value })} disabled={!canEdit} aria-invalid={!!contactError(c.id, 'name') || undefined} />
                  </FormField>
                  <FormField label="Role" htmlFor={`${uid}-${c.id}-role`}>
                    <Input id={`${uid}-${c.id}-role`} value={c.role} onChange={(e) => setContact(c.id, { role: e.target.value })} placeholder="For example, merchant onboarding" disabled={!canEdit} />
                  </FormField>
                  <FormField label="Email" htmlFor={`${uid}-${c.id}-email`} error={contactError(c.id, 'email')}>
                    <Input id={`${uid}-${c.id}-email`} type="email" value={c.email} onChange={(e) => setContact(c.id, { email: e.target.value })} disabled={!canEdit} aria-invalid={!!contactError(c.id, 'email') || undefined} />
                  </FormField>
                  <FormField label="Phone" htmlFor={`${uid}-${c.id}-phone`}>
                    <Input id={`${uid}-${c.id}-phone`} type="tel" value={c.phone} onChange={(e) => setContact(c.id, { phone: e.target.value })} disabled={!canEdit} />
                  </FormField>
                </FormGrid>
              </div>
            ))}
          </div>
          <div>
            <Button type="button" size="sm" variant="outline" disabled={!canEdit} onClick={() => setContacts((rows) => [...rows, { id: newRowId('contact'), name: '', role: '', email: '', phone: '' }])}>
              <Plus /> Add a contact
            </Button>
          </div>
        </FormSection>

        <Separator />
        <FormSection title="Billing" description="Which outcomes this bank is charged for under its contract. The panel records them; it doesn’t send invoices.">
          <BillingSettingsEditor value={billing} onChange={setBilling} bankId={bank?.id ?? null} disabled={!canEdit} />
          {errors.billing_settings ? <p className="text-sm text-destructive">{errors.billing_settings}</p> : null}
        </FormSection>

        <Separator />
        <FormSection title="Second approval">
          <div className="flex items-start gap-2">
            <Switch id={`${uid}-four-eyes`} checked={fourEyes} onCheckedChange={setFourEyes} disabled={!canEdit || !canFourEyes} />
            <div className="grid gap-0.5">
              <Label htmlFor={`${uid}-four-eyes`}>A second administrator must approve changes</Label>
              <p className="text-sm text-muted-foreground">
                When this is on, changes to this bank’s inspection set-up and its important app settings only take effect after a
                second administrator who can approve changes says yes.
              </p>
              {!canFourEyes ? (
                <p className="text-sm text-amber-700">Only an administrator who covers all banks and can approve changes can switch this.</p>
              ) : null}
            </div>
          </div>
        </FormSection>

        <Separator />
        <FormSection title="Export settings" description="Most banks don’t need these. Leave them empty to use the standard exports.">
          <Details summary={exportCount ? `Show export settings (${exportCount})` : 'Show export settings'} defaultOpen={!!errors.export_settings}>
            <ObjectEditor
              state={exportState}
              onChange={setExportState}
              label="Export settings"
              disabled={!canEdit}
              error={errors.export_settings}
              keyLabel="Setting"
              keyPlaceholder="For example, file_prefix"
              addLabel="Add a setting"
              emptyText="No export settings. Exports use the standard options."
            />
          </Details>
        </FormSection>

        <ApiErrorAlert error={mutation.error} />
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={!canEdit}>
          {isNew ? 'Add bank' : 'Save changes'}
        </Button>
      </SheetFooter>
    </form>
  );
}
