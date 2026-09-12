'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { BankSelect } from '@/components/bank-select';
import { apiFieldErrors, type FieldErrors, FormField, zodFieldErrors } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import { familyCreateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import { DEFINITION_KINDS, type DefinitionKind } from '@/lib/types';
import { defKeys } from './definitions-data';

/** "New family" dialog (POST /definitions/families). Global families need an all-bank admin (D-44). */
export function NewFamilyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const staff = useStaff();
  const router = useRouter();
  const [kind, setKind] = useState<DefinitionKind>('form');
  const [key, setKey] = useState('');
  const [scope, setScope] = useState<'global' | 'bank'>(staff.isGlobalAdmin ? 'global' : 'bank');
  const [bankId, setBankId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const create = useMutationWithToast({
    mutationFn: adminApi.definitions.createFamily,
    successMessage: (f) => `Created ${f.kind}/${f.key}`,
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
    setTitle('');
    setDescription('');
    setBankId(null);
    setErrors({});
    create.reset();
  }

  function submit() {
    const parsed = familyCreateSchema.safeParse({
      kind,
      key: key.trim(),
      bank_id: scope === 'bank' ? bankId : null,
      title,
      description,
    });
    const errs = parsed.success ? {} : zodFieldErrors(parsed.error);
    if (scope === 'bank' && !bankId) errs.bank_id = 'Choose the bank this family overrides for';
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length > 0) return;
    create.mutate(parsed.data);
  }

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
          <DialogTitle>New definition family</DialogTitle>
          <DialogDescription>
            A family is one named purpose (e.g. form/site_inspection). A bank family overrides the global one for that bank.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Kind" htmlFor="fam-kind" required>
              <Select value={kind} onValueChange={(v) => setKind(v as DefinitionKind)}>
                <SelectTrigger id="fam-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEFINITION_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {humanize(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Key" htmlFor="fam-key" required error={errors.key} hint="snake_case, stable forever">
              <Input id="fam-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="site_inspection" className="font-mono" />
            </FormField>
          </div>
          <FormField label="Scope" htmlFor="fam-scope" required error={errors.bank_id}>
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
              <Select value={scope} onValueChange={(v) => setScope(v as 'global' | 'bank')} disabled={!staff.isGlobalAdmin}>
                <SelectTrigger id="fam-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="bank">Bank override</SelectItem>
                </SelectContent>
              </Select>
              {scope === 'bank' ? <BankSelect value={bankId} onChange={setBankId} invalid={!!errors.bank_id} /> : null}
            </div>
            {!staff.isGlobalAdmin ? <p className="text-xs text-muted-foreground">Global families need an all-bank admin.</p> : null}
          </FormField>
          <FormField label="Title" htmlFor="fam-title" required error={errors.title}>
            <Input id="fam-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Site inspection" />
          </FormField>
          <FormField label="Description" htmlFor="fam-desc" error={errors.description}>
            <Textarea id="fam-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <ApiErrorAlert error={create.error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} loading={create.isPending}>
            Create family
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
