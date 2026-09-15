'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { BankSelect } from '@/components/bank-select';
import { Details } from '@/components/details';
import { apiFieldErrors, type FieldErrors, FormField, zodFieldErrors } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import { familyCreateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import type { DefinitionKind } from '@/lib/types';
import { defKeys, KIND_DESCRIPTION, KIND_ORDER, KIND_SINGULAR } from './definitions-data';
import { toKey } from './studio/doc';

/** "Add new" dialog (POST /definitions/families). Set-up shared by all banks needs an all-bank admin (D-44). */
export function NewFamilyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const router = useRouter();
  const [kind, setKind] = useState<DefinitionKind>('form');
  const [key, setKey] = useState('');
  // Until someone types a technical name, it follows the name (lower-case words joined by _).
  const [keyTouched, setKeyTouched] = useState(false);
  const [scope, setScope] = useState<'global' | 'bank'>(staff.isGlobalAdmin ? 'global' : 'bank');
  const [bankId, setBankId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const effectiveKey = keyTouched ? key.trim() : title.trim() ? toKey(title, 'item') : '';

  const create = useMutationWithToast({
    mutationFn: adminApi.definitions.createFamily,
    successMessage: (f) => `“${f.title}” created. Fill in the draft, then publish it.`,
    toastErrors: false,
    invalidate: [defKeys.all],
    onSuccess: (f) => {
      onOpenChange(false);
      router.push(`/definitions/${f.id}`);
    },
    onError: (e) => setErrors(apiFieldErrors(e)),
  });

  function reset() {
    setKey('');
    setKeyTouched(false);
    setTitle('');
    setDescription('');
    setBankId(null);
    setErrors({});
    create.reset();
  }

  function submit() {
    const parsed = familyCreateSchema.safeParse({
      kind,
      key: effectiveKey,
      bank_id: scope === 'bank' ? bankId : null,
      title,
      description,
    });
    const errs = parsed.success ? {} : zodFieldErrors(parsed.error);
    if (scope === 'bank' && !bankId) errs.bank_id = 'Choose the bank.';
    if (errs.title) errs.title = 'Enter a name.';
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length > 0) return;
    create.mutate(parsed.data);
  }

  const keyField = (
    <FormField label="Technical name" htmlFor="fam-key" required error={errors.key} hint="Lower-case letters, numbers and _. It can’t be changed later.">
      <Input
        id="fam-key"
        value={effectiveKey}
        onChange={(e) => {
          setKeyTouched(true);
          setKey(e.target.value);
        }}
        placeholder="site_visit"
        className="font-mono"
      />
    </FormField>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (create.isPending) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to the inspection set-up</DialogTitle>
          <DialogDescription>Choose what you want to set up and give it a name. You fill it in on the next page.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="What is it?" htmlFor="fam-kind" required hint={KIND_DESCRIPTION[kind]}>
            <Select value={kind} onValueChange={(v) => setKind(v as DefinitionKind)}>
              <SelectTrigger id="fam-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_ORDER.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_SINGULAR[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Who it’s for" htmlFor="fam-scope" required error={errors.bank_id}>
            <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
              <Select value={scope} onValueChange={(v) => setScope(v as 'global' | 'bank')} disabled={!staff.isGlobalAdmin}>
                <SelectTrigger id="fam-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">All banks</SelectItem>
                  <SelectItem value="bank">One bank only</SelectItem>
                </SelectContent>
              </Select>
              {scope === 'bank' ? <BankSelect value={bankId} onChange={setBankId} invalid={!!errors.bank_id} /> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {staff.isGlobalAdmin
                ? 'Set-up for one bank replaces the shared set-up for that bank’s agents.'
                : 'Only admins who can see every bank can add set-up shared by all banks.'}
            </p>
          </FormField>
          <FormField label="Name" htmlFor="fam-title" required error={errors.title}>
            <Input id="fam-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Site visit" />
          </FormField>
          <FormField label="Description" htmlFor="fam-desc" error={errors.description}>
            <Textarea id="fam-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </FormField>
          {advanced ? keyField : <Details summary="Technical name" defaultOpen={!!errors.key}>{keyField}</Details>}
          <ApiErrorAlert error={create.error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} loading={create.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
