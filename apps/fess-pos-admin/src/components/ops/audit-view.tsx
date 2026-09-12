'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Link2, Link2Off, ShieldCheck } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { CopyButton } from '@/components/copy-button';
import { DateTime } from '@/components/date-time';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { JsonView } from '@/components/json-view';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { employeeName, fromDateTimeLocalValue, shortId } from '@/lib/format';
import { fetchRows, pos } from '@/lib/supabase';
import type { AuditLogEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FieldDiffTable, fieldDiff } from './diff';
import { DetailList, FilterSelect, SectionTitle, usePosUsers, UserName } from './ops-shared';

const PAGE = 100;
const ACTION_TONE = { INSERT: 'success', UPDATE: 'warning', DELETE: 'danger' } as const;

interface AuditFilters {
  table: string;
  action: string | null;
  actor: string | null;
  requestId: string;
  rowId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: AuditFilters = { table: '', action: null, actor: null, requestId: '', rowId: '', from: '', to: '' };

function fetchAuditPage(f: AuditFilters, beforeSeq: number | null): Promise<AuditLogEntry[]> {
  let q = pos().from('audit_log').select('*');
  if (f.table.trim()) q = q.eq('table_name', f.table.trim());
  if (f.action) q = q.eq('action', f.action);
  if (f.actor) q = q.eq('actor_id', f.actor);
  if (f.requestId.trim()) q = q.eq('request_id', f.requestId.trim());
  if (f.rowId.trim()) q = q.eq('row_id', f.rowId.trim());
  const from = fromDateTimeLocalValue(f.from);
  const to = fromDateTimeLocalValue(f.to);
  if (from) q = q.gte('at', from);
  if (to) q = q.lte('at', to);
  if (beforeSeq !== null) q = q.lt('seq', beforeSeq);
  return fetchRows<AuditLogEntry>(q.order('seq', { ascending: false }).limit(PAGE));
}

type LinkState = 'ok' | 'broken' | null;

function AuditDetail({ entry, onClose }: { entry: AuditLogEntry | null; onClose: () => void }) {
  const changes = useMemo(() => (entry?.before && entry.after ? fieldDiff(entry.before, entry.after) : []), [entry]);
  return (
    <Sheet open={entry !== null} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent size="xl">
        {entry ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Badge tone={ACTION_TONE[entry.action]}>{entry.action}</Badge> <code className="text-sm font-normal">{entry.table_name}</code>
                <span className="text-sm font-normal text-muted-foreground">#{entry.seq}</span>
              </SheetTitle>
              <SheetDescription>
                <DateTime value={entry.at} seconds /> SAST
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-5">
              <DetailList
                items={[
                  ['Row', entry.row_id ? <code key="r" className="break-all text-xs">{entry.row_id}</code> : '—'],
                  ['Actor', entry.actor_id ? <UserName key="a" id={entry.actor_id} /> : <span key="a" className="text-muted-foreground">System / database</span>],
                  ['Actor role', entry.actor_role ?? '—'],
                  [
                    'Request id',
                    entry.request_id ? (
                      <span key="q" className="inline-flex items-center gap-1">
                        <code className="break-all text-xs">{entry.request_id}</code>
                        <CopyButton value={entry.request_id} title="Copy request id" />
                      </span>
                    ) : (
                      '—'
                    ),
                  ],
                  [
                    'Hash',
                    <span key="h" className="inline-flex items-center gap-1">
                      <code className="break-all text-xs">{entry.hash}</code>
                      <CopyButton value={entry.hash} title="Copy hash" />
                    </span>,
                  ],
                  ['Previous hash', entry.prev_hash ? <code key="p" className="break-all text-xs">{entry.prev_hash}</code> : '— (first entry)'],
                ]}
              />
              <Alert variant="info">
                <ShieldCheck />
                <AlertDescription>
                  The audit log is append-only and hash-chained: each entry&apos;s hash covers the previous entry&apos;s hash, so changing or deleting any
                  row breaks the chain from that point on. Tampering is detectable, not silent.
                </AlertDescription>
              </Alert>
              {entry.action === 'UPDATE' ? (
                <section className="space-y-2">
                  <SectionTitle>Field changes</SectionTitle>
                  {entry.before && entry.after ? (
                    <FieldDiffTable changes={changes} emptyText="No field values differ." />
                  ) : (
                    <p className="text-sm text-muted-foreground">Before/after values were not captured for this entry, so no field diff is available.</p>
                  )}
                </section>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="space-y-1">
                  <SectionTitle>Before</SectionTitle>
                  {entry.before ? (
                    <JsonView value={entry.before} defaultExpandDepth={1} maxHeight={420} />
                  ) : (
                    <p className="text-sm text-muted-foreground">{entry.action === 'INSERT' ? 'None (new row).' : 'Not captured.'}</p>
                  )}
                </section>
                <section className="space-y-1">
                  <SectionTitle>After</SectionTitle>
                  {entry.after ? (
                    <JsonView value={entry.after} defaultExpandDepth={1} maxHeight={420} />
                  ) : (
                    <p className="text-sm text-muted-foreground">{entry.action === 'DELETE' ? 'None (row deleted).' : 'Not captured.'}</p>
                  )}
                </section>
              </div>
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** /audit — hash-chained audit log viewer (B6.6), newest first with "load more" by seq. */
export function AuditView() {
  const users = usePosUsers();
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [detail, setDetail] = useState<AuditLogEntry | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => fetchAuditPage(filters, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.length === PAGE ? (last[last.length - 1]?.seq ?? null) : null),
  });

  const rows = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);

  /** Chain check between adjacent loaded entries (only where seq is consecutive). */
  const links = useMemo(() => {
    const m = new Map<number, LinkState>();
    rows.forEach((r, i) => {
      const older = rows[i + 1];
      if (older && older.seq === r.seq - 1) m.set(r.seq, r.prev_hash === older.hash ? 'ok' : 'broken');
    });
    return m;
  }, [rows]);

  function apply(e: FormEvent) {
    e.preventDefault();
    setFilters(draft);
  }

  const set = <K extends keyof AuditFilters>(k: K, v: AuditFilters[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const brokenCount = [...links.values()].filter((l) => l === 'broken').length;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every insert, update and delete on audited tables, with actor, request id and a hash chain. Newest first."
      />

      <Card className="mb-4 p-4">
        <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Table" htmlFor="audit-table">
            <Input id="audit-table" value={draft.table} onChange={(e) => set('table', e.target.value)} placeholder="e.g. jobs" className="font-mono" />
          </FormField>
          <FormField label="Action" htmlFor="audit-action">
            <FilterSelect
              id="audit-action"
              value={draft.action}
              onChange={(v) => set('action', v)}
              options={[
                { value: 'INSERT', label: 'Insert' },
                { value: 'UPDATE', label: 'Update' },
                { value: 'DELETE', label: 'Delete' },
              ]}
              allLabel="Any action"
              className="w-full"
            />
          </FormField>
          <FormField label="Actor" htmlFor="audit-actor">
            <FilterSelect
              id="audit-actor"
              value={draft.actor}
              onChange={(v) => set('actor', v)}
              options={(users.data ?? []).map((u) => ({ value: u.id, label: employeeName(u) }))}
              allLabel="Anyone"
              className="w-full"
            />
          </FormField>
          <FormField label="Request id" htmlFor="audit-req">
            <Input id="audit-req" value={draft.requestId} onChange={(e) => set('requestId', e.target.value)} className="font-mono" />
          </FormField>
          <FormField label="Row id" htmlFor="audit-row">
            <Input id="audit-row" value={draft.rowId} onChange={(e) => set('rowId', e.target.value)} className="font-mono" />
          </FormField>
          <FormField label="From (SAST)" htmlFor="audit-from">
            <Input id="audit-from" type="datetime-local" value={draft.from} onChange={(e) => set('from', e.target.value)} />
          </FormField>
          <FormField label="To (SAST)" htmlFor="audit-to">
            <Input id="audit-to" type="datetime-local" value={draft.to} onChange={(e) => set('to', e.target.value)} />
          </FormField>
          <div className="flex items-end gap-2">
            <Button type="submit">Apply filters</Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                setFilters(EMPTY_FILTERS);
              }}
            >
              Clear
            </Button>
          </div>
        </form>
      </Card>

      {query.error ? <ApiErrorAlert error={query.error} onRetry={() => void query.refetch()} className="mb-4" /> : null}
      {brokenCount > 0 ? (
        <Alert variant="destructive" className="mb-4">
          <Link2Off />
          <AlertDescription>
            {brokenCount} adjacent entr{brokenCount === 1 ? 'y does' : 'ies do'} not chain to the previous hash. Investigate before relying on these rows.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        {query.isPending ? (
          <Skeleton className="m-4 h-40" />
        ) : rows.length === 0 ? (
          <EmptyState title="No audit entries" description="Nothing matches these filters." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">Seq</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Row</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>Hash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const link = links.get(r.seq) ?? null;
                return (
                  <TableRow key={r.seq} onClick={() => setDetail(r)} className={cn('cursor-pointer hover:bg-slate-50', link === 'broken' && 'bg-red-50/60')}>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{r.seq}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <DateTime value={r.at} seconds />
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{r.table_name}</code>
                    </TableCell>
                    <TableCell>
                      <Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs" title={r.row_id ?? undefined}>
                        {shortId(r.row_id)}
                      </code>
                    </TableCell>
                    <TableCell>
                      {r.actor_id ? <UserName id={r.actor_id} /> : <span className="text-muted-foreground">{r.actor_role ?? 'system'}</span>}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs text-muted-foreground" title={r.request_id ?? undefined}>
                        {shortId(r.request_id)}
                      </code>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        <code className="text-xs" title={`hash ${r.hash}\nprev ${r.prev_hash ?? '—'}`}>
                          {shortId(r.hash, 6, 4)}
                        </code>
                        {link === 'ok' ? (
                          <Link2 className="size-4 text-emerald-600" aria-label="Chains to the previous entry" />
                        ) : link === 'broken' ? (
                          <Link2Off className="size-4 text-red-600" aria-label="Does not chain to the previous entry" />
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="mt-3 flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} loaded
        </span>
        {query.hasNextPage ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
            Load more
          </Button>
        ) : rows.length > 0 ? (
          <span>End of log</span>
        ) : null}
      </div>

      <AuditDetail entry={detail} onClose={() => setDetail(null)} />
    </>
  );
}
