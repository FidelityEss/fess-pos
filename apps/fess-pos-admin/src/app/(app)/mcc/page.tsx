'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { ActiveBadge, ReadOnlyNotice } from '@/components/admin/admin-ui';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { DataTable } from '@/components/data-table';
import { apiFieldErrors, type FieldErrors, FormField, zodFieldErrors } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { ToneBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { adminApi } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import { type MccCreateBody, mccCreateSchema, type MccUpdateBody, mccUpdateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import type { StatusTone } from '@/lib/status';
import { fetchRows, pos } from '@/lib/supabase';
import { type MccCode, MCC_RISK_TIERS, type MccRiskTier } from '@/lib/types';

const RISK_TONE: Record<MccRiskTier, StatusTone> = { low: 'success', standard: 'neutral', elevated: 'warning', high: 'danger' };

type TierFilter = 'all' | MccRiskTier;
type StatusFilter = 'all' | 'active' | 'inactive';

export default function MccCodesPage() {
  const staff = useStaff();
  const canWrite = staff.isGlobalAdmin;
  const [tier, setTier] = useState<TierFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [dialog, setDialog] = useState<{ mcc: MccCode | null } | null>(null);
  const codes = useQuery({
    queryKey: ['mcc_codes', 'admin-all'],
    queryFn: () => fetchRows<MccCode>(pos().from('mcc_codes').select('*').order('code')),
  });
  const rows = useMemo(
    () => (codes.data ?? []).filter((c) => (tier === 'all' || c.risk_tier === tier) && (status === 'all' || c.active === (status === 'active'))),
    [codes.data, tier, status],
  );

  const columns = useMemo<ColumnDef<MccCode>[]>(
    () => [
      { accessorKey: 'code', header: 'Code', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm font-medium">{row.original.code}</span> },
      { accessorKey: 'description', header: 'Description' },
      { accessorKey: 'risk_tier', header: 'Risk tier', cell: ({ row }) => <ToneBadge value={row.original.risk_tier} tones={RISK_TONE} /> },
      { accessorKey: 'active', header: 'Status', cell: ({ row }) => <ActiveBadge active={row.original.active} /> },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="MCC codes"
        description="Merchant category codes and their risk tiers, used when creating jobs."
        actions={
          canWrite ? (
            <Button onClick={() => setDialog({ mcc: null })}>
              <Plus /> New MCC code
            </Button>
          ) : null
        }
      />
      {!canWrite ? <ReadOnlyNotice className="mb-4">MCC codes are global reference data, managed by all-bank administrators (D-44).</ReadOnlyNotice> : null}
      <DataTable
        columns={columns}
        data={codes.isPending ? undefined : rows}
        isLoading={codes.isPending}
        error={codes.error}
        onRetry={() => void codes.refetch()}
        getRowId={(c) => c.code}
        onRowClick={canWrite ? (c) => setDialog({ mcc: c }) : undefined}
        searchPlaceholder="Code or description"
        emptyTitle="No MCC codes"
        rowClassName={(c) => (c.active ? undefined : 'opacity-60')}
        toolbar={
          <>
            <Select value={tier} onValueChange={(v) => setTier(v as TierFilter)}>
              <SelectTrigger className="w-40" aria-label="Filter by risk tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any risk tier</SelectItem>
                {MCC_RISK_TIERS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {humanize(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent>{dialog ? <MccForm key={dialog.mcc?.code ?? 'new'} mcc={dialog.mcc} onClose={() => setDialog(null)} /> : null}</DialogContent>
      </Dialog>
    </>
  );
}

type MccSave = { kind: 'create'; body: MccCreateBody } | { kind: 'update'; code: string; body: MccUpdateBody };

function MccForm({ mcc, onClose }: { mcc: MccCode | null; onClose: () => void }) {
  const uid = useId();
  const [code, setCode] = useState(mcc?.code ?? '');
  const [description, setDescription] = useState(mcc?.description ?? '');
  const [riskTier, setRiskTier] = useState<MccRiskTier>(mcc?.risk_tier ?? 'standard');
  const [active, setActive] = useState(mcc?.active ?? true);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const save = useMutationWithToast({
    mutationFn: (s: MccSave) => (s.kind === 'create' ? adminApi.mcc.create(s.body) : adminApi.mcc.update(s.code, s.body)),
    invalidate: [['mcc_codes']],
    toastErrors: false,
    successMessage: (m, s) => (s.kind === 'create' ? `MCC ${m.code} created` : `MCC ${m.code} saved`),
    onSuccess: () => onClose(),
  });
  const errors: FieldErrors = { ...apiFieldErrors(save.error), ...clientErrors };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!mcc) {
      const parsed = mccCreateSchema.safeParse({ code: code.trim(), description, risk_tier: riskTier });
      if (!parsed.success) {
        setClientErrors(zodFieldErrors(parsed.error));
        return;
      }
      setClientErrors({});
      save.mutate({ kind: 'create', body: parsed.data });
      return;
    }
    const parsed = mccUpdateSchema.safeParse({ description, risk_tier: riskTier, active });
    if (!parsed.success) {
      setClientErrors(zodFieldErrors(parsed.error));
      return;
    }
    setClientErrors({});
    save.mutate({ kind: 'update', code: mcc.code, body: parsed.data });
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{mcc ? `MCC ${mcc.code}` : 'New MCC code'}</DialogTitle>
        <DialogDescription>{mcc ? 'Codes are never deleted — deactivate one to stop offering it for new jobs.' : 'A four-digit merchant category code.'}</DialogDescription>
      </DialogHeader>
      <FormField label="Code" htmlFor={`${uid}-code`} required={!mcc} error={errors.code} hint={mcc ? 'The code can’t be changed.' : undefined}>
        <Input
          id={`${uid}-code`}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          readOnly={!!mcc}
          inputMode="numeric"
          className="w-28 font-mono"
          aria-invalid={!!errors.code || undefined}
        />
      </FormField>
      <FormField label="Description" htmlFor={`${uid}-description`} required error={errors.description}>
        <Input id={`${uid}-description`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} aria-invalid={!!errors.description || undefined} />
      </FormField>
      <FormField label="Risk tier" htmlFor={`${uid}-tier`} error={errors.risk_tier}>
        <Select value={riskTier} onValueChange={(v) => setRiskTier(v as MccRiskTier)}>
          <SelectTrigger id={`${uid}-tier`} className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MCC_RISK_TIERS.map((t) => (
              <SelectItem key={t} value={t}>
                {humanize(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {mcc ? (
        <div className="flex items-center gap-2">
          <Switch id={`${uid}-active`} checked={active} onCheckedChange={setActive} />
          <Label htmlFor={`${uid}-active`}>Active</Label>
        </div>
      ) : null}
      <ApiErrorAlert error={save.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {mcc ? 'Save changes' : 'Create MCC code'}
        </Button>
      </DialogFooter>
    </form>
  );
}
