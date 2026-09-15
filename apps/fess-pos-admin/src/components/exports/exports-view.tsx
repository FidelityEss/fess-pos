'use client';

// /exports (T6-04, B6.4, docs/17 §4.2): ask for an export, follow it, download it, try a failed one again. Every state
// shown comes from the export row (A-07): waiting, trying again, being prepared, ready, expired or failed with the reason.
// Downloads go through the POS API, which records each one and hands out a short-lived link.
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, RefreshCw, RotateCw } from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { DataTable } from '@/components/data-table';
import { DateTime, useNow } from '@/components/date-time';
import { defKeys, fetchFamilies } from '@/components/definitions/definitions-data';
import { Details } from '@/components/details';
import { UserName } from '@/components/ops/ops-shared';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBankLookup } from '@/lib/hooks';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { ExportRequestCard } from './export-request-card';
import { type ExportRecord, exportKeys, exportsApi, fetchExports, fetchKeyNames, FORMAT_INFO, isActive, progressOf, sizeText } from './exports-data';

function Covers({ e, bankCode, formTitle }: { e: ExportRecord; bankCode: string | null; formTitle: string | null }) {
  const s = e.scope ?? {};
  const parts = [
    e.bank_id || s.bank_id ? (bankCode ?? 'One bank') : 'All banks',
    formTitle ?? (e.family_id ? 'One form' : null),
    s.from && s.to ? `${s.from} to ${s.to}` : s.from ? `From ${s.from}` : s.to ? `Up to ${s.to}` : 'Any date',
    s.job_ids?.length ? `${s.job_ids.length} job${s.job_ids.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return <span className="text-sm text-muted-foreground">{parts.join(' · ')}</span>;
}

function Actions({ e, now }: { e: ExportRecord; now: number }) {
  const progress = progressOf(e, now);
  const download = useMutationWithToast({
    mutationFn: exportsApi.download,
    invalidate: [exportKeys.list],
    errorTitle: 'Couldn’t download',
    onSuccess: (d) => {
      toast.success(`Downloading ${d.file_name}`, { description: sizeText(d.bytes) ?? undefined });
      window.location.assign(d.url);
    },
  });
  const retry = useMutationWithToast({
    mutationFn: exportsApi.retry,
    invalidate: [exportKeys.list],
    errorTitle: 'Couldn’t try again',
    successMessage: 'Trying again. It shows as Waiting to start, then Being prepared.',
  });
  if (progress.canDownload) {
    return (
      <Button size="sm" onClick={() => download.mutate(e.id)} loading={download.isPending}>
        {download.isPending ? null : <Download />} Download
      </Button>
    );
  }
  if (progress.canRetry) {
    return (
      <Button size="sm" variant="outline" onClick={() => retry.mutate(e.id)} loading={retry.isPending}>
        {retry.isPending ? null : <RotateCw />} Try again
      </Button>
    );
  }
  return null;
}

function More({ e, advanced }: { e: ExportRecord; advanced: boolean }) {
  const notes = (e.problems ?? []).filter((p) => p.message);
  return (
    <Details summary="Details">
      <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        {e.file_name ? (
          <>
            <dt className="text-muted-foreground">File</dt>
            <dd className="break-all">{e.file_name}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Downloads</dt>
        <dd>
          {e.download_count ? (
            <>
              {e.download_count}, last <DateTime value={e.last_downloaded_at} mode="relative" />
            </>
          ) : (
            'None yet'
          )}
        </dd>
        {e.expires_at && e.status === 'done' ? (
          <>
            <dt className="text-muted-foreground">Can be downloaded until</dt>
            <dd>
              <DateTime value={e.expires_at} mode="date" />
            </dd>
          </>
        ) : null}
        {e.recipient ? (
          <>
            <dt className="text-muted-foreground">For</dt>
            <dd>{e.recipient}</dd>
          </>
        ) : null}
        {e.attempts > 1 ? (
          <>
            <dt className="text-muted-foreground">Tries</dt>
            <dd>{e.attempts}</dd>
          </>
        ) : null}
        {advanced ? (
          <>
            <dt className="text-muted-foreground">Export ID</dt>
            <dd className="break-all font-mono text-xs">{e.id}</dd>
            {e.sha256 ? (
              <>
                <dt className="text-muted-foreground">File fingerprint (SHA-256)</dt>
                <dd className="break-all font-mono text-xs">{e.sha256}</dd>
              </>
            ) : null}
            {e.statuses?.length ? (
              <>
                <dt className="text-muted-foreground">Visit statuses included</dt>
                <dd>{e.statuses.join(', ')}</dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>
      {notes.length ? (
        <ul className="list-disc pl-5 text-sm text-amber-800">
          {notes.map((p) => (
            <li key={p.kind}>{p.message}</li>
          ))}
        </ul>
      ) : null}
    </Details>
  );
}

/** /exports — ask for exports, follow them, download them. */
export function ExportsView() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const now = useNow(15_000);
  const bankLookup = useBankLookup();
  const exports = useQuery({
    queryKey: exportKeys.list,
    queryFn: fetchExports,
    enabled: staff.isAdmin,
    refetchInterval: (q) => (q.state.data?.some(isActive) ? 5_000 : false),
  });
  const keyIds = useMemo(() => [...new Set((exports.data ?? []).map((e) => e.api_key_id).filter((x): x is string => !!x))].sort(), [exports.data]);
  const keys = useQuery({ queryKey: exportKeys.keys(keyIds), queryFn: () => fetchKeyNames(keyIds), enabled: keyIds.length > 0 });
  const keyName = useMemo(() => new Map((keys.data ?? []).map((k) => [k.id, `${k.label} (…${k.last_four ?? '????'})`])), [keys.data]);
  const families = useQuery({ queryKey: defKeys.families, queryFn: fetchFamilies, enabled: staff.isAdmin });
  const formTitle = useMemo(() => new Map((families.data ?? []).map((f) => [f.id, f.title])), [families.data]);

  const columns = useMemo<ColumnDef<ExportRecord>[]>(
    () => [
      { accessorKey: 'created_at', header: 'Asked for', cell: ({ row }) => <DateTime value={row.original.created_at} showRelative /> },
      {
        accessorKey: 'type',
        header: 'What',
        cell: ({ row }) => {
          const e = row.original;
          const bank = bankLookup(e.bank_id ?? e.scope?.bank_id);
          return (
            <div className="grid gap-0.5">
              <span className="whitespace-nowrap font-medium">{FORMAT_INFO[e.type]?.short ?? e.type}</span>
              <Covers e={e} bankCode={bank?.code ?? null} formTitle={e.family_id ? (formTitle.get(e.family_id) ?? null) : null} />
            </div>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Progress',
        cell: ({ row }) => {
          const p = progressOf(row.original, now);
          const notes = (row.original.problems ?? []).length;
          return (
            <div className="grid max-w-md gap-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone={p.tone}>{p.label}</Badge>
                {p.canDownload && notes ? <Badge tone="warning">{notes === 1 ? '1 note' : `${notes} notes`}</Badge> : null}
              </span>
              {p.detail ? <span className="text-sm text-muted-foreground">{p.detail}</span> : null}
            </div>
          );
        },
      },
      {
        id: 'by',
        header: 'Asked by',
        accessorFn: (e) => e.requested_by ?? e.api_key_id ?? '',
        cell: ({ row }) => {
          const e = row.original;
          if (e.api_key_id) return <span className="text-sm">The bank’s system: {keyName.get(e.api_key_id) ?? 'an API key'}</span>;
          return <UserName id={e.requested_by} className="whitespace-nowrap text-sm" />;
        },
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="grid justify-items-start gap-2">
            <Actions e={row.original} now={now} />
            <More e={row.original} advanced={advanced} />
          </div>
        ),
      },
    ],
    [bankLookup, formTitle, keyName, now, advanced],
  );

  return (
    <>
      <PageHeader
        title="Exports"
        description="Download visit data: the answers as a spreadsheet, or the photos. Ask for what you need; it’s prepared in the background and appears below, ready to download."
        actions={
          staff.isAdmin ? (
            <Button variant="outline" size="sm" onClick={() => void exports.refetch()} loading={exports.isFetching}>
              {exports.isFetching ? null : <RefreshCw />} Refresh
            </Button>
          ) : null
        }
      />
      {!staff.isAdmin ? (
        <Alert variant="info">
          <AlertDescription>Only administrators can ask for exports. Ask one for the data you need.</AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-6">
          <ExportRequestCard />
          {keys.error ? <ApiErrorAlert error={keys.error} /> : null}
          <DataTable
            columns={columns}
            data={exports.data}
            isLoading={exports.isPending}
            error={exports.error}
            onRetry={() => void exports.refetch()}
            getRowId={(e) => e.id}
            searchPlaceholder="Search exports…"
            emptyTitle="No exports yet"
            emptyDescription="Ask for one above. It appears here while it’s prepared, with a Download button when it’s ready."
          />
          <p className="text-sm text-muted-foreground">
            Files can be downloaded for 30 days. Each download is recorded in the activity history, and every visit in a file can be traced back to where
            it came from.
          </p>
        </div>
      )}
    </>
  );
}
