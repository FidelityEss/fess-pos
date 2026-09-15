'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { FileDown, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { BankSelect } from '@/components/bank-select';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { defKeys, fetchFamilies, fetchVersions } from '@/components/definitions/definitions-data';
import { apiFieldErrors, type FieldErrors, FormField, zodFieldErrors } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { ToneBadge } from '@/components/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { formatNumber, shortId } from '@/lib/format';
import { isUuid, useBankLookup } from '@/lib/hooks';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import { exportCreateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import { EXPORT_STATUS_LABEL, EXPORT_STATUS_TONE } from '@/lib/status';
import { fetchRows, pos } from '@/lib/supabase';
import { EXPORT_TYPES, type ExportRow, type ExportType } from '@/lib/types';
import { UserName } from './ops-shared';

const TYPE_LABEL: Record<ExportType, string> = {
  pdf: 'Visit reports (PDF)',
  csv: 'Answers as a spreadsheet (CSV)',
  xlsx: 'Answers as an Excel workbook',
  evidence_zip: 'Photos and files (ZIP)',
  spec_pdf: 'Set-up description (PDF)',
  billing_csv: 'Billing list (CSV)',
};

const NONE = '__none__';

function RequestExportCard() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const [type, setType] = useState<ExportType>('csv');
  const [bankId, setBankId] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [jobIds, setJobIds] = useState('');
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [recipient, setRecipient] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const families = useQuery({ queryKey: defKeys.families, queryFn: fetchFamilies, enabled: type === 'spec_pdf' });
  const versions = useQuery({
    queryKey: defKeys.versions(familyId ?? ''),
    queryFn: () => fetchVersions(familyId ?? ''),
    enabled: type === 'spec_pdf' && !!familyId,
  });

  const create = useMutationWithToast({
    mutationFn: adminApi.exports.create,
    successMessage: 'Export requested. It appears in the list below.',
    toastErrors: false,
    invalidate: [['exports']],
    onSuccess: () => {
      setJobIds('');
      setErrors({});
    },
    onError: (e) => setErrors(apiFieldErrors(e)),
  });

  function submit() {
    const ids = jobIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const errs: FieldErrors = {};
    if (ids.some((x) => !isUuid(x))) errs['scope.job_ids'] = 'One of these isn’t a valid job ID. Check the list and try again.';
    if (!staff.isGlobalAdmin && !bankId) errs['scope.bank_id'] = 'Choose a bank. You can only export data for your own banks.';
    if (from && to && to < from) errs['scope.to'] = 'The end date must be on or after the start date.';
    const parsed = exportCreateSchema.safeParse({
      type,
      scope: {
        ...(bankId ? { bank_id: bankId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(ids.length && type !== 'spec_pdf' ? { job_ids: ids } : {}),
        ...(type === 'spec_pdf' && familyId ? { family_id: familyId } : {}),
        ...(type === 'spec_pdf' && versionId ? { version_id: versionId } : {}),
      },
      recipient,
    });
    const all = { ...(parsed.success ? {} : zodFieldErrors(parsed.error)), ...errs };
    setErrors(all);
    if (!parsed.success || Object.keys(all).length > 0) return;
    create.mutate(parsed.data);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request an export</CardTitle>
        <CardDescription>
          Choose what you need, for which bank and which dates. Your request is added to the list below, where you can see how far it has got.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          <FormField label="What to export" htmlFor="exp-type" required error={errors.type}>
            <Select value={type} onValueChange={(v) => setType(v as ExportType)}>
              <SelectTrigger id="exp-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPORT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Bank" htmlFor="exp-bank" required={!staff.isGlobalAdmin} error={errors['scope.bank_id']}>
            <BankSelect id="exp-bank" value={bankId} onChange={setBankId} allowAll={staff.isGlobalAdmin} includeInactive />
          </FormField>
          <FormField label="Who it’s for (email)" htmlFor="exp-recipient" error={errors.recipient} hint="Optional. Recorded with the request.">
            <Input id="exp-recipient" type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          </FormField>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <FormField label="From" htmlFor="exp-from" error={errors['scope.from']}>
            <Input id="exp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </FormField>
          <FormField label="To" htmlFor="exp-to" error={errors['scope.to']}>
            <Input id="exp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </FormField>
        </div>
        {type === 'spec_pdf' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Set-up piece" htmlFor="exp-family" error={errors['scope.family_id']} hint="The document describes a published version.">
              <Select
                value={familyId ?? NONE}
                onValueChange={(v) => {
                  setFamilyId(v === NONE ? null : v);
                  setVersionId(null);
                }}
              >
                <SelectTrigger id="exp-family">
                  <SelectValue placeholder={families.isPending ? 'Loading…' : 'Choose one'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None chosen</SelectItem>
                  {(families.data ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {advanced ? `${f.title} (${f.kind}/${f.key})` : f.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Version" htmlFor="exp-version" error={errors['scope.version_id']} hint="Leave on Latest to use the newest published version.">
              <Select value={versionId ?? NONE} onValueChange={(v) => setVersionId(v === NONE ? null : v)} disabled={!familyId}>
                <SelectTrigger id="exp-version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Latest</SelectItem>
                  {(versions.data ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      Version {v.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
        ) : advanced ? (
          <FormField
            label="Only these jobs (IDs)"
            htmlFor="exp-jobs"
            error={errors['scope.job_ids']}
            hint="Optional. One job ID per line, or separated by commas. Leave empty for every job the other choices cover."
          >
            <Textarea id="exp-jobs" rows={2} value={jobIds} onChange={(e) => setJobIds(e.target.value)} className="font-mono text-sm" />
          </FormField>
        ) : null}
        <ApiErrorAlert error={create.error} />
        <div>
          <Button type="button" onClick={submit} loading={create.isPending}>
            {create.isPending ? null : <FileDown />} Request the export
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** /exports — request exports and follow their status (the export worker lands with T6-02/T6-03). */
export function ExportsView() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const bankLookup = useBankLookup();
  const query = useQuery({
    queryKey: ['exports', 'list'],
    queryFn: () => fetchRows<ExportRow>(pos().from('exports').select('*').order('created_at', { ascending: false }).limit(300)),
    enabled: staff.isAdmin,
    refetchInterval: (q) => (q.state.data?.some((e) => e.status === 'queued' || e.status === 'running') ? 15_000 : false),
  });

  const columns = useMemo<ColumnDef<ExportRow>[]>(
    () => [
      { accessorKey: 'created_at', header: 'Requested', cell: ({ row }) => <DateTime value={row.original.created_at} showRelative /> },
      { accessorKey: 'type', header: 'What', cell: ({ row }) => <span className="whitespace-nowrap">{TYPE_LABEL[row.original.type] ?? row.original.type}</span> },
      {
        accessorKey: 'status',
        header: 'Progress',
        cell: ({ row }) => <ToneBadge value={row.original.status} tones={EXPORT_STATUS_TONE} labels={EXPORT_STATUS_LABEL} />,
      },
      { accessorKey: 'requested_by', header: 'Requested by', cell: ({ row }) => <UserName id={row.original.requested_by} className="whitespace-nowrap" /> },
      {
        id: 'scope',
        accessorFn: (r) => JSON.stringify(r.scope),
        header: 'Covers',
        enableSorting: false,
        cell: ({ row }) => {
          const s = row.original.scope ?? {};
          const parts = [
            s.bank_id ? (bankLookup(s.bank_id)?.code ?? (advanced ? shortId(s.bank_id) : 'One bank')) : 'All banks',
            s.from && s.to ? `${s.from} to ${s.to}` : s.from ? `From ${s.from}` : s.to ? `Up to ${s.to}` : null,
            s.job_ids?.length ? `${s.job_ids.length} job${s.job_ids.length === 1 ? '' : 's'}` : null,
            s.family_id ? (advanced ? `set-up ${shortId(s.family_id)}` : 'one set-up piece') : null,
            s.version_id ? (advanced ? `version ${shortId(s.version_id)}` : 'a chosen version') : null,
          ].filter(Boolean);
          return <span className="text-sm">{parts.join(' · ')}</span>;
        },
      },
      {
        accessorKey: 'row_count',
        header: 'Rows',
        meta: { className: 'text-right tabular-nums', headerClassName: 'text-right' },
        cell: ({ row }) => formatNumber(row.original.row_count),
      },
      { accessorKey: 'recipient', header: 'For', cell: ({ row }) => <span className="text-sm">{row.original.recipient ?? '—'}</span> },
      {
        id: 'result',
        accessorFn: (r) => r.error ?? '',
        header: 'Problem',
        cell: ({ row }) => {
          const e = row.original;
          if (e.error) return <span className="line-clamp-2 max-w-xs text-sm text-red-800">{e.error}</span>;
          if (advanced && e.storage_path) return <code className="break-all text-xs text-muted-foreground">{e.storage_path}</code>;
          return <span className="text-sm text-muted-foreground">—</span>;
        },
      },
    ],
    [bankLookup, advanced],
  );

  return (
    <>
      <PageHeader
        title="Exports"
        description="Ask for visit data, such as the answers or the photos, for a bank or a period. Each request appears in the list below with its progress."
        actions={
          staff.isAdmin ? (
            <Button variant="outline" size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
              {query.isFetching ? null : <RefreshCw />} Refresh
            </Button>
          ) : null
        }
      />
      {!staff.isAdmin ? (
        <Alert variant="info">
          <AlertDescription>Only administrators can request exports. Ask one for the data you need.</AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-6">
          <RequestExportCard />
          <DataTable
            columns={columns}
            data={query.data}
            isLoading={query.isPending}
            error={query.error}
            onRetry={() => void query.refetch()}
            getRowId={(r) => r.id}
            searchPlaceholder="Search exports…"
            emptyTitle="No exports yet"
            emptyDescription="Request one above. It appears here with its progress."
          />
        </div>
      )}
    </>
  );
}
