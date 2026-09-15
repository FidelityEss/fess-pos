'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Eye, Plus, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MonoId, ReadOnlyNotice } from '@/components/admin/admin-ui';
import { ErrorState } from '@/components/api-error-alert';
import { DateTime } from '@/components/date-time';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { employeeName } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { fetchRows, pos } from '@/lib/supabase';
import type { Declaration } from '@/lib/types';
import { type DeclarationBase, PublishDeclarationDialog } from './_components/publish-dialog';

type DeclRow = Declaration & { publisher: { first_name: string; last_name: string; employee_number: string } | null };

function publisherName(d: DeclRow): string {
  return d.publisher ? employeeName(d.publisher) : 'System';
}

function DeclarationText({ text, className }: { text: string; className?: string }) {
  return <div className={`max-h-64 overflow-auto whitespace-pre-wrap rounded-md border p-3 font-serif text-sm leading-relaxed ${className ?? ''}`}>{text}</div>;
}

export default function DeclarationsPage() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const canWrite = staff.isGlobalAdmin;
  const [publish, setPublish] = useState<{ base: DeclarationBase | null } | null>(null);
  const [viewing, setViewing] = useState<DeclRow | null>(null);
  const declarations = useQuery({
    queryKey: ['declarations'],
    queryFn: () =>
      fetchRows<DeclRow>(
        pos()
          .from('declarations')
          .select('*,publisher:pos_users(first_name,last_name,employee_number)')
          .order('key')
          .order('version', { ascending: false }),
      ),
  });

  const groups = useMemo(() => {
    const byKey = new Map<string, DeclRow[]>();
    for (const d of declarations.data ?? []) {
      const list = byKey.get(d.key) ?? [];
      list.push(d);
      byKey.set(d.key, list);
    }
    return [...byKey.entries()]
      .map(([key, versions]) => ({ key, versions: [...versions].sort((a, b) => b.version - a.version) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [declarations.data]);

  const addButton = canWrite ? (
    <Button onClick={() => setPublish({ base: null })}>
      <Plus /> Add a declaration
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Declarations" actions={addButton} />
      {!canWrite ? <ReadOnlyNotice className="mb-4">Declarations can only be published by an administrator who covers all banks.</ReadOnlyNotice> : null}
      {declarations.error ? (
        <ErrorState error={declarations.error} onRetry={() => void declarations.refetch()} />
      ) : declarations.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState title="No declarations yet" description={canWrite ? 'Add the first one.' : undefined} action={addButton} />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <DeclarationCard
              key={g.key}
              versions={g.versions}
              canWrite={canWrite}
              onPublish={(base) => setPublish({ base })}
              onView={setViewing}
            />
          ))}
        </div>
      )}

      <PublishDeclarationDialog
        base={publish?.base ?? null}
        open={publish !== null}
        onOpenChange={(open) => {
          if (!open) setPublish(null);
        }}
      />
      <Dialog
        open={viewing !== null}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      >
        <DialogContent size="lg">
          {viewing ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {viewing.title} <span className="text-sm font-normal text-muted-foreground">— version {viewing.version}</span>
                </DialogTitle>
                <DialogDescription>
                  Published <DateTime value={viewing.published_at} /> by {publisherName(viewing)}
                  {advanced ? (
                    <>
                      {' '}
                      · <span className="font-mono">{viewing.key}</span> · hash <MonoId value={viewing.hash} head={12} tail={6} />
                    </>
                  ) : null}
                </DialogDescription>
              </DialogHeader>
              <DeclarationText text={viewing.text} className="max-h-[60vh]" />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeclarationCard({
  versions,
  canWrite,
  onPublish,
  onView,
}: {
  versions: DeclRow[];
  canWrite: boolean;
  onPublish: (base: DeclarationBase) => void;
  onView: (d: DeclRow) => void;
}) {
  const advanced = useIsAdvanced();
  const [showHistory, setShowHistory] = useState(false);
  const latest = versions[0];
  if (!latest) return null;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{latest.title}</h2>
            <Badge tone="accent">Version {latest.version}</Badge>
          </div>
          {advanced ? <p className="font-mono text-xs text-muted-foreground">{latest.key}</p> : null}
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            Published <DateTime value={latest.published_at} /> by {publisherName(latest)}
            {advanced ? (
              <>
                {' '}
                · hash <MonoId value={latest.hash} head={12} tail={6} />
              </>
            ) : null}
          </p>
        </div>
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={() => onPublish({ key: latest.key, title: latest.title, text: latest.text, version: latest.version })}>
            <Upload /> Publish a new version
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <DeclarationText text={latest.text} />
        <Button type="button" size="sm" variant="ghost" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
          {showHistory ? <ChevronDown /> : <ChevronRight />} Earlier versions ({versions.length})
        </Button>
        {showHistory ? (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead>By</TableHead>
                  {advanced ? <TableHead>Hash</TableHead> : null}
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="whitespace-nowrap font-medium tabular-nums">Version {v.version}</TableCell>
                    <TableCell>{v.title}</TableCell>
                    <TableCell>
                      <DateTime value={v.published_at} />
                    </TableCell>
                    <TableCell>{publisherName(v)}</TableCell>
                    {advanced ? (
                      <TableCell>
                        <MonoId value={v.hash} head={10} tail={6} />
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => onView(v)}>
                        <Eye /> Read
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
