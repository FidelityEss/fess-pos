'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Link2, Link2Off, ShieldCheck } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { CopyButton } from '@/components/copy-button';
import { DateTime } from '@/components/date-time';
import { Details } from '@/components/details';
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
import { employeeName, fromDateTimeLocalValue, humanize } from '@/lib/format';
import { labelFrom, ROLE_LABEL } from '@/lib/labels';
import { fetchRows, pos } from '@/lib/supabase';
import type { AuditLogEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FieldDiffTable, fieldDiff } from './diff';
import { AUDIT_ACTION_LABEL, AUDIT_TABLE_LABEL } from './ops-labels';
import { DetailList, FilterSelect, SectionTitle, usePosUsers, UserName } from './ops-shared';

const PAGE = 100;
const ACTION_TONE = { INSERT: 'success', UPDATE: 'warning', DELETE: 'danger' } as const;

/** Who made a change, by database role (people's roles plus the system's own). */
const ACTOR_ROLE_LABEL: Record<string, string> = {
  ...ROLE_LABEL,
  service_role: 'The system',
  postgres: 'The system',
  supabase_admin: 'The system',
  authenticated: 'Signed-in user',
  anon: 'Not signed in',
};

const TABLE_OPTIONS = Object.entries(AUDIT_TABLE_LABEL)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** "merchant_name" → "Merchant name"; "answers.0.value" → "Answers › item 1 › Value". */
function fieldLabel(path: string): string {
  return path
    .split('.')
    .map((seg) => (/^\d+$/.test(seg) ? `item ${Number(seg) + 1}` : humanize(seg)))
    .join(' › ');
}

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

function CopyableCode({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <code className="break-all text-xs">{value}</code>
      <CopyButton value={value} title="Copy" />
    </span>
  );
}

function AuditDetail({ entry, onClose }: { entry: AuditLogEntry | null; onClose: () => void }) {
  const changes = useMemo(() => (entry?.before && entry.after ? fieldDiff(entry.before, entry.after) : []), [entry]);
  return (
    <Sheet open={entry !== null} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent size="xl">
        {entry ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Badge tone={ACTION_TONE[entry.action]}>{AUDIT_ACTION_LABEL[entry.action]}</Badge> {labelFrom(AUDIT_TABLE_LABEL, entry.table_name)}
              </SheetTitle>
              <SheetDescription>
                <DateTime value={entry.at} seconds /> SAST
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-5">
              <DetailList
                items={[
                  ['Who', entry.actor_id ? <UserName key="a" id={entry.actor_id} /> : <span key="a" className="text-muted-foreground">The system (automatic)</span>],
                  ['Their role', entry.actor_role ? labelFrom(ACTOR_ROLE_LABEL, entry.actor_role) : '—'],
                ]}
              />
              {entry.action === 'UPDATE' ? (
                <section className="space-y-2">
                  <SectionTitle>What changed</SectionTitle>
                  {entry.before && entry.after ? (
                    <FieldDiffTable changes={changes} formatPath={fieldLabel} emptyText="Nothing visible changed." />
                  ) : (
                    <p className="text-sm text-muted-foreground">The old and new values weren’t recorded for this change.</p>
                  )}
                </section>
              ) : null}
              <Details summary={entry.action === 'UPDATE' ? 'The full record, before and after' : 'The full record'}>
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="space-y-1">
                    <h3 className="text-sm font-medium">Before</h3>
                    {entry.before ? (
                      <JsonView value={entry.before} defaultExpandDepth={1} maxHeight={420} />
                    ) : (
                      <p className="text-sm text-muted-foreground">{entry.action === 'INSERT' ? 'Nothing: this was added.' : 'Not recorded.'}</p>
                    )}
                  </section>
                  <section className="space-y-1">
                    <h3 className="text-sm font-medium">After</h3>
                    {entry.after ? (
                      <JsonView value={entry.after} defaultExpandDepth={1} maxHeight={420} />
                    ) : (
                      <p className="text-sm text-muted-foreground">{entry.action === 'DELETE' ? 'Nothing: this was removed.' : 'Not recorded.'}</p>
                    )}
                  </section>
                </div>
              </Details>
              <Details summary="Technical details">
                <DetailList
                  items={[
                    ['Entry number', entry.seq],
                    ['Table', <code key="t" className="text-xs">{entry.table_name}</code>],
                    ['Record ID', <CopyableCode key="r" value={entry.row_id} />],
                    ['Request ID', <CopyableCode key="q" value={entry.request_id} />],
                    ['Security code', <CopyableCode key="h" value={entry.hash} />],
                    ['Previous security code', entry.prev_hash ? <code key="p" className="break-all text-xs">{entry.prev_hash}</code> : 'None (the first entry)'],
                  ]}
                />
                <Alert variant="info">
                  <ShieldCheck />
                  <AlertDescription>
                    The history can’t be edited. Each entry is sealed together with the one before it, so if anyone changed or removed an entry, the check
                    on this page would show it.
                  </AlertDescription>
                </Alert>
              </Details>
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** /audit — activity history (the hash-chained audit log, B6.6), newest first with "show older" by seq. */
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
  const filtering = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <>
      <PageHeader title="Activity history" />

      <Card className="mb-4 p-4">
        <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="What changed" htmlFor="audit-table">
            <FilterSelect
              id="audit-table"
              value={draft.table || null}
              onChange={(v) => set('table', v ?? '')}
              options={TABLE_OPTIONS}
              allLabel="Anything"
              className="w-full"
            />
          </FormField>
          <FormField label="Change" htmlFor="audit-action">
            <FilterSelect
              id="audit-action"
              value={draft.action}
              onChange={(v) => set('action', v)}
              options={[
                { value: 'INSERT', label: AUDIT_ACTION_LABEL.INSERT },
                { value: 'UPDATE', label: AUDIT_ACTION_LABEL.UPDATE },
                { value: 'DELETE', label: AUDIT_ACTION_LABEL.DELETE },
              ]}
              allLabel="Any change"
              className="w-full"
            />
          </FormField>
          <FormField label="Who" htmlFor="audit-actor">
            <FilterSelect
              id="audit-actor"
              value={draft.actor}
              onChange={(v) => set('actor', v)}
              options={(users.data ?? []).map((u) => ({ value: u.id, label: employeeName(u) }))}
              allLabel="Anyone"
              className="w-full"
            />
          </FormField>
          <div className="hidden lg:block" />
          <FormField label="From" htmlFor="audit-from">
            <Input id="audit-from" type="datetime-local" value={draft.from} onChange={(e) => set('from', e.target.value)} />
          </FormField>
          <FormField label="To" htmlFor="audit-to">
            <Input id="audit-to" type="datetime-local" value={draft.to} onChange={(e) => set('to', e.target.value)} />
          </FormField>
          <div className="flex items-end gap-2">
            <Button type="submit">Search</Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                setFilters(EMPTY_FILTERS);
              }}
            >
              Clear filters
            </Button>
          </div>
          <Details summary="Technical filters" className="col-span-full" defaultOpen={!!(draft.requestId || draft.rowId)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Request ID" htmlFor="audit-req">
                <Input id="audit-req" value={draft.requestId} onChange={(e) => set('requestId', e.target.value)} className="font-mono" />
              </FormField>
              <FormField label="Record ID" htmlFor="audit-row">
                <Input id="audit-row" value={draft.rowId} onChange={(e) => set('rowId', e.target.value)} className="font-mono" />
              </FormField>
            </div>
          </Details>
        </form>
      </Card>

      {query.error ? <ApiErrorAlert error={query.error} onRetry={() => void query.refetch()} className="mb-4" /> : null}
      {brokenCount > 0 ? (
        <Alert variant="destructive" className="mb-4">
          <Link2Off />
          <AlertDescription>
            {brokenCount} entr{brokenCount === 1 ? 'y fails' : 'ies fail'} the security check: the history may have been changed after it was recorded.
            Tell a developer before relying on {brokenCount === 1 ? 'it' : 'them'}.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        {query.isPending ? (
          <Skeleton className="m-4 h-40" />
        ) : rows.length === 0 ? (
          filtering ? (
            <EmptyState title="Nothing found" description="No changes match these filters. Try clearing some." />
          ) : (
            <EmptyState title="No changes recorded yet" description="Changes appear here as soon as anyone makes one." />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Check</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const link = links.get(r.seq) ?? null;
                return (
                  <TableRow key={r.seq} onClick={() => setDetail(r)} className={cn('cursor-pointer hover:bg-slate-50', link === 'broken' && 'bg-red-50/60')}>
                    <TableCell className="whitespace-nowrap">
                      <DateTime value={r.at} seconds />
                    </TableCell>
                    <TableCell title={r.table_name}>{labelFrom(AUDIT_TABLE_LABEL, r.table_name)}</TableCell>
                    <TableCell>
                      <Badge tone={ACTION_TONE[r.action]}>{AUDIT_ACTION_LABEL[r.action]}</Badge>
                    </TableCell>
                    <TableCell>
                      {r.actor_id ? (
                        <UserName id={r.actor_id} />
                      ) : (
                        <span className="text-muted-foreground">{r.actor_role ? labelFrom(ACTOR_ROLE_LABEL, r.actor_role) : 'The system'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {link === 'ok' ? (
                        <Link2 className="size-4 text-emerald-600" aria-label="Passed the security check" />
                      ) : link === 'broken' ? (
                        <Link2Off className="size-4 text-red-600" aria-label="Failed the security check" />
                      ) : (
                        <span className="text-muted-foreground" title="Can’t check: the entry before it isn’t shown">
                          —
                        </span>
                      )}
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
          {rows.length} change{rows.length === 1 ? '' : 's'} shown
        </span>
        {query.hasNextPage ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
            Show older changes
          </Button>
        ) : rows.length > 0 ? (
          <span>No older changes.</span>
        ) : null}
      </div>

      <AuditDetail entry={detail} onClose={() => setDetail(null)} />
    </>
  );
}
