'use client';

// One lookup list: title, version history, items of a selected version, and "Publish new version".
import { useQuery } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useId, useState } from 'react';
import { canWriteScoped } from '@/components/admin/access';
import { BankScopeBadge, MonoId, ReadOnlyNotice, SectionHeading } from '@/components/admin/admin-ui';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { DateTime } from '@/components/date-time';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi } from '@/lib/api';
import { employeeName } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { fetchMaybeRow, fetchRows, pos } from '@/lib/supabase';
import type { LookupItem, LookupListVersion } from '@/lib/types';
import { humanLabel } from '@/components/structured-view';
import { latestItems, latestVersion, type ListRow } from './types';
import { VersionEditorDialog } from './version-editor';

type VersionRow = Pick<LookupListVersion, 'id' | 'list_id' | 'version' | 'hash' | 'published_at' | 'published_by'> & {
  publisher: { first_name: string; last_name: string; employee_number: string } | null;
};

export function LookupListSheet({ list, onOpenChange }: { list: ListRow | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={list !== null} onOpenChange={onOpenChange}>
      <SheetContent size="xl">{list ? <ListDetail key={list.id} list={list} /> : null}</SheetContent>
    </Sheet>
  );
}

function ListDetail({ list }: { list: ListRow }) {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const uid = useId();
  const canWrite = canWriteScoped(staff, list.bank_id);
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState(list.title);
  const [editorOpen, setEditorOpen] = useState(false);

  const versions = useQuery({
    queryKey: ['lookup_lists', list.id, 'versions'],
    queryFn: () =>
      fetchRows<VersionRow>(
        pos()
          .from('lookup_list_versions')
          .select('id,list_id,version,hash,published_at,published_by,publisher:pos_users(first_name,last_name,employee_number)')
          .eq('list_id', list.id)
          .order('version', { ascending: false }),
      ),
  });
  const versionId = selected ?? versions.data?.[0]?.id ?? null;
  const items = useQuery({
    queryKey: ['lookup_lists', list.id, 'items', versionId],
    queryFn: () =>
      fetchMaybeRow<{ id: string; version: number; items: LookupItem[] }>(
        pos().from('lookup_list_versions').select('id,version,items').eq('id', versionId ?? '').maybeSingle(),
      ),
    enabled: versionId !== null,
  });
  const rename = useMutationWithToast({
    mutationFn: (t: string) => adminApi.lookupLists.update(list.id, { title: t }),
    invalidate: [['lookup_lists']],
    successMessage: 'Title saved',
  });

  const latest = latestVersion(list);
  const shownItems = Array.isArray(items.data?.items) ? items.data.items : [];

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {advanced ? <span className="font-mono">{list.key}</span> : <span>{list.title}</span>} <BankScopeBadge bankId={list.bank_id} />
        </SheetTitle>
        <SheetDescription>{latest ? `Latest version ${latest.version}, published` : 'Not published yet'} {latest ? <DateTime value={latest.published_at} /> : null}</SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-6">
        {!canWrite ? (
          <ReadOnlyNotice>
            {list.bank_id === null ? 'Global lists are managed by all-bank administrators (D-44).' : 'This list belongs to a bank outside your scope.'}
          </ReadOnlyNotice>
        ) : null}

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && title.trim() !== list.title) rename.mutate(title.trim());
          }}
        >
          <div className="grid min-w-64 flex-1 gap-1.5">
            <Label htmlFor={`${uid}-title`}>Title</Label>
            <Input id={`${uid}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} disabled={!canWrite} />
          </div>
          {canWrite ? (
            <Button type="submit" variant="outline" loading={rename.isPending} disabled={!title.trim() || title.trim() === list.title}>
              Save title
            </Button>
          ) : null}
        </form>

        <section>
          <SectionHeading
            title="Versions"
            description={advanced ? 'Each version is immutable and identified by its hash. Select one to see its items.' : 'Each version is kept exactly as it was published. Select one to see its items.'}
            actions={
              canWrite ? (
                <Button size="sm" onClick={() => setEditorOpen(true)}>
                  <Upload /> Publish new version
                </Button>
              ) : null
            }
          />
          <ApiErrorAlert error={versions.error} onRetry={() => void versions.refetch()} />
          {versions.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (versions.data ?? []).length === 0 ? (
            <EmptyState title="No versions yet" description={canWrite ? 'Publish the first version to make the list usable in forms.' : undefined} />
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead>By</TableHead>
                    {advanced ? <TableHead>Hash</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(versions.data ?? []).map((v) => (
                    <TableRow
                      key={v.id}
                      data-state={v.id === versionId ? 'selected' : undefined}
                      onClick={() => setSelected(v.id)}
                      className="cursor-pointer hover:bg-slate-50"
                    >
                      <TableCell className="whitespace-nowrap font-medium tabular-nums">Version {v.version}</TableCell>
                      <TableCell>
                        <DateTime value={v.published_at} />
                      </TableCell>
                      <TableCell>{v.publisher ? employeeName(v.publisher) : <span className="text-muted-foreground">System</span>}</TableCell>
                      {advanced ? (
                        <TableCell>
                          <MonoId value={v.hash} head={10} tail={6} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {versionId ? (
          <section>
            <SectionHeading title={items.data ? `Items in version ${items.data.version}` : 'Items'} description={items.data ? `${shownItems.length} item${shownItems.length === 1 ? '' : 's'}` : undefined} />
            <ApiErrorAlert error={items.error} onRetry={() => void items.refetch()} />
            {items.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="max-h-[50vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0">
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Value (saved)</TableHead>
                      <TableHead>Label (shown to agents)</TableHead>
                      <TableHead>Extra details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownItems.map((it, i) => (
                      <TableRow key={`${it.value}-${i}`}>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-sm">{it.value}</TableCell>
                        <TableCell>{it.label}</TableCell>
                        <TableCell className="text-sm">
                          {it.meta && Object.keys(it.meta).length > 0 ? (
                            advanced ? (
                              <code className="block max-w-sm break-all font-mono text-xs text-muted-foreground">{JSON.stringify(it.meta)}</code>
                            ) : (
                              <span className="text-muted-foreground">
                                {Object.entries(it.meta)
                                  .map(([k, v]) => `${humanLabel(k)}: ${typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                                  .join(' · ')}
                              </span>
                            )
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        ) : null}
      </SheetBody>
      <VersionEditorDialog
        listId={list.id}
        listTitle={list.title}
        nextVersion={(latest?.version ?? 0) + 1}
        initialItems={latestItems(list)}
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setSelected(null);
        }}
      />
    </>
  );
}
