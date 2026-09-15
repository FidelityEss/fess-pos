'use client';

// "Ask for an export" (T6-04, docs/17 §4.2): which data, which bank, which form, which dates. Formats the server can't
// make yet show as "Not available yet" (exports.formats_ready), so nothing is asked for that would wait for ever (A-07).
import { useQuery } from '@tanstack/react-query';
import { FileDown } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { RadioCards } from '@/components/admin/radio-cards';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { BankSelect } from '@/components/bank-select';
import { defKeys, fetchFamilies } from '@/components/definitions/definitions-data';
import { Details } from '@/components/details';
import { apiFieldErrors, type FieldErrors, FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { isUuid } from '@/lib/hooks';
import { useMutationWithToast } from '@/lib/mutations';
import { useStaff } from '@/lib/staff';
import { type ExportFormat, type ExportRequestBody, exportKeys, exportsApi, FORMAT_INFO } from './exports-data';

const ALL = '__all__';
/** The formats offered on this screen, in this order. The server says which of them can be made now. */
const OFFERED: ExportFormat[] = ['csv', 'xlsx', 'evidence_zip', 'pdf'];

export function ExportRequestCard() {
  const uid = useId();
  const staff = useStaff();
  const formats = useQuery({ queryKey: exportKeys.formats, queryFn: exportsApi.formats, staleTime: 5 * 60_000 });
  const ready = useMemo(() => new Set(formats.data?.ready ?? []), [formats.data]);
  const [type, setType] = useState<ExportFormat>('csv');
  const [bankId, setBankId] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [recipient, setRecipient] = useState('');
  const [jobIds, setJobIds] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const families = useQuery({ queryKey: defKeys.families, queryFn: fetchFamilies });
  const forms = (families.data ?? []).filter((f) => f.kind === 'form' && (!bankId || !f.bank_id || f.bank_id === bankId));

  const create = useMutationWithToast({
    mutationFn: exportsApi.create,
    successMessage: 'Export asked for. It’s being prepared in the list below; the Download button appears when it’s ready.',
    toastErrors: false,
    invalidate: [exportKeys.list],
    onSuccess: () => setErrors({}),
    onError: (e) => setErrors(apiFieldErrors(e)),
  });

  function submit() {
    const ids = jobIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const errs: FieldErrors = {};
    if (!ready.has(type)) errs.type = 'This kind of export can’t be made yet. Choose another.';
    if (!staff.isGlobalAdmin && !bankId) errs['scope.bank_id'] = 'Choose a bank. You can only export data for your own banks.';
    if (from && to && to < from) errs['scope.to'] = 'The end date must be on or after the start date.';
    if (ids.some((x) => !isUuid(x))) errs['scope.job_ids'] = 'One of these isn’t a job ID. Check the list and try again.';
    if (recipient.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim())) errs.recipient = 'That doesn’t look like an email address.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const body: ExportRequestBody = {
      type,
      scope: {
        ...(bankId ? { bank_id: bankId } : {}),
        ...(familyId ? { family_id: familyId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(ids.length ? { job_ids: ids } : {}),
      },
      ...(recipient.trim() ? { recipient: recipient.trim() } : {}),
    };
    create.mutate(body);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ask for an export</CardTitle>
        <CardDescription>Choose what you need, for which bank and which dates. It’s prepared in the background, usually within a minute or two.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <FormField label="What do you need?" error={errors.type}>
          <RadioCards
            label="What do you need?"
            value={type}
            onChange={setType}
            columns={2}
            options={OFFERED.map((f) => {
              const available = ready.has(f);
              return {
                value: f,
                title: FORMAT_INFO[f].title,
                description: formats.isPending ? FORMAT_INFO[f].description : available ? FORMAT_INFO[f].description : 'Not available yet.',
                disabled: !formats.isPending && !available,
              };
            })}
          />
        </FormField>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Bank" htmlFor={`${uid}-bank`} required={!staff.isGlobalAdmin} error={errors['scope.bank_id']}>
            <BankSelect
              id={`${uid}-bank`}
              value={bankId}
              onChange={(v) => {
                setBankId(v);
                setFamilyId(null);
              }}
              allowAll={staff.isGlobalAdmin}
              includeInactive
            />
          </FormField>
          <FormField label="Form" htmlFor={`${uid}-form`} error={errors['scope.family_id']} hint="Leave on All forms to include every visit.">
            <Select value={familyId ?? ALL} onValueChange={(v) => setFamilyId(v === ALL ? null : v)}>
              <SelectTrigger id={`${uid}-form`}>
                <SelectValue placeholder={families.isPending ? 'Loading…' : 'All forms'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All forms</SelectItem>
                {forms.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Visits that reached us from" htmlFor={`${uid}-from`} error={errors['scope.from']} hint="Leave both dates empty for every date.">
            <Input id={`${uid}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </FormField>
          <FormField label="To (including that day)" htmlFor={`${uid}-to`} error={errors['scope.to']}>
            <Input id={`${uid}-to`} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </FormField>
        </div>
        <Details summary="More options" defaultOpen={!!errors.recipient || !!errors['scope.job_ids']}>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Who it’s for (email)" htmlFor={`${uid}-for`} error={errors.recipient} hint="Kept with the request so others know. No email is sent.">
              <Input id={`${uid}-for`} type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} maxLength={320} />
            </FormField>
            <FormField label="Only these jobs (IDs)" htmlFor={`${uid}-jobs`} error={errors['scope.job_ids']} hint="One job ID per line, or separated by commas.">
              <Textarea id={`${uid}-jobs`} rows={2} value={jobIds} onChange={(e) => setJobIds(e.target.value)} className="font-mono text-sm" />
            </FormField>
          </div>
        </Details>
        <ApiErrorAlert error={create.error} />
        <div>
          <Button type="button" onClick={submit} loading={create.isPending} disabled={!formats.isPending && !ready.has(type)}>
            {create.isPending ? null : <FileDown />} Prepare the export
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
