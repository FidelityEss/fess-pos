'use client';

import { useQuery } from '@tanstack/react-query';
import { Rocket } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { CopyButton } from '@/components/copy-button';
import { DateTime, useNow } from '@/components/date-time';
import { Details } from '@/components/details';
import { EmptyState } from '@/components/empty-state';
import { JsonView } from '@/components/json-view';
import { LineDiffView } from '@/components/ops/diff';
import { SectionTitle, UserName } from '@/components/ops/ops-shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { shortId } from '@/lib/format';
import { useBankLookup } from '@/lib/hooks';
import { Advanced, useIsAdvanced } from '@/lib/preferences';
import type { StatusTone } from '@/lib/status';
import type { DefinitionActivation, DefinitionFamily } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AnalysisResultView } from './analysis-result';
import { DefinitionWorkspace } from './studio/workspace';
import { changelogCounts, defKeys, fetchTestRuns, fetchVersion, liveActivations, liveForLabel, type VersionLite } from './definitions-data';

function useVersionFull(id: string | null) {
  return useQuery({ queryKey: defKeys.version(id ?? ''), queryFn: () => fetchVersion(id ?? ''), enabled: !!id, staleTime: Infinity });
}

function VersionDetail({ family, versionId, onActivate, canEdit }: { family: DefinitionFamily; versionId: string; onActivate: (id: string) => void; canEdit: boolean }) {
  const advanced = useIsAdvanced();
  const [selected, setSelected] = useState<string | null>(null);
  const v = useVersionFull(versionId);
  const runs = useQuery({ queryKey: defKeys.testRuns(versionId), queryFn: () => fetchTestRuns(versionId) });
  if (v.error) return <ApiErrorAlert error={v.error} onRetry={() => void v.refetch()} />;
  if (v.isPending) return <Skeleton className="h-64 w-full" />;
  if (!v.data) return <p className="text-sm text-muted-foreground">We couldn’t find this version.</p>;
  const ver = v.data;
  const analysis = ver.analysis as { ok?: boolean; errors?: unknown[]; warnings?: unknown[] };
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">
          Version {ver.version} {advanced ? <span className="font-normal text-muted-foreground">· spec {ver.spec_version}</span> : null}
        </CardTitle>
        <div className="flex items-center gap-2">
          {advanced ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <code title={ver.definition_hash}>{shortId(ver.definition_hash, 12, 6)}</code>
              <CopyButton value={ver.definition_hash} title="Copy the fingerprint (hash)" />
            </span>
          ) : null}
          {canEdit ? (
            <Button type="button" size="sm" onClick={() => onActivate(ver.id)}>
              <Rocket /> Make live…
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="outline">
          <TabsList>
            <TabsTrigger value="outline">What it contains</TabsTrigger>
            <TabsTrigger value="analysis">Checks and changes</TabsTrigger>
            <TabsTrigger value="tests">Example answers {runs.data ? `(${runs.data.length})` : ''}</TabsTrigger>
            {advanced ? <TabsTrigger value="definition">Technical view (JSON)</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="outline">
            <DefinitionWorkspace family={family} doc={ver.definition} previewDoc={ver.definition} readOnly selected={selected} onSelect={setSelected} />
          </TabsContent>
          <TabsContent value="definition">
            <JsonView value={ver.definition} defaultExpandDepth={2} maxHeight={520} />
          </TabsContent>
          <TabsContent value="analysis" className="space-y-3">
            <AnalysisResultView
              result={{
                ok: analysis.ok ?? true,
                errors: (analysis.errors ?? []) as never[],
                warnings: (analysis.warnings ?? []) as never[],
                breaking: ver.breaking,
                definition_hash: ver.definition_hash,
                requires: ver.requires,
                previous_version: undefined,
                changelog: {
                  added: (ver.changelog.added as unknown[] | undefined) ?? [],
                  removed: (ver.changelog.removed as unknown[] | undefined) ?? [],
                  changed: (ver.changelog.changed as unknown[] | undefined) ?? [],
                },
              }}
            />
            {typeof ver.changelog.note === 'string' ? <p className="text-sm italic text-muted-foreground">Note: “{ver.changelog.note}”</p> : null}
          </TabsContent>
          <TabsContent value="tests" className="space-y-2">
            <p className="text-sm text-muted-foreground">The example answers checked when this version was published.</p>
            {runs.error ? <ApiErrorAlert error={runs.error} /> : null}
            {runs.isPending ? <Skeleton className="h-20 w-full" /> : null}
            {runs.data?.length === 0 ? <p className="text-sm text-muted-foreground">No example answers were checked for this version.</p> : null}
            {runs.data?.map((r) => (
              <div key={r.id} className="space-y-1 rounded-md border p-2">
                <div className="flex items-center gap-2 text-xs">
                  <Badge tone={r.passed ? 'success' : 'danger'}>{r.passed ? 'All gave the expected result' : 'Some didn’t give the expected result'}</Badge>
                  <DateTime value={r.run_at} />
                </div>
                <Details summary="Details">
                  <JsonView value={r.results} defaultExpandDepth={2} maxHeight={240} />
                </Details>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function CompareVersions({ versions }: { versions: VersionLite[] }) {
  const [fromId, setFromId] = useState<string>(versions[1]?.id ?? versions[0]?.id ?? '');
  const [toId, setToId] = useState<string>(versions[0]?.id ?? '');
  const a = useVersionFull(fromId || null);
  const b = useVersionFull(toId || null);
  const label = (id: string) => `Version ${versions.find((v) => v.id === id)?.version ?? '?'}`;
  const pick = (value: string, onChange: (v: string) => void, aria: string) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-36" aria-label={aria}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {versions.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            Version {v.version}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <section className="space-y-2">
      <SectionTitle>Compare two versions</SectionTitle>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {pick(fromId, setFromId, 'Older version')}
        <span className="text-muted-foreground">with</span>
        {pick(toId, setToId, 'Newer version')}
      </div>
      {a.error || b.error ? <ApiErrorAlert error={a.error ?? b.error} /> : null}
      {a.data && b.data ? (
        <LineDiffView before={a.data.definition} after={b.data.definition} beforeLabel={label(fromId)} afterLabel={label(toId)} />
      ) : a.isFetching || b.isFetching ? (
        <Skeleton className="h-40 w-full" />
      ) : null}
    </section>
  );
}

/** Published versions: status of each ("Live for Bank X", "Published, not live yet", "Old version"), detail, comparison and "Make live…". */
export function VersionsTab({
  family,
  versions,
  activations,
  onActivate,
  canEdit,
}: {
  family: DefinitionFamily;
  versions: VersionLite[];
  activations: DefinitionActivation[];
  onActivate: (versionId: string) => void;
  canEdit: boolean;
}) {
  const advanced = useIsAdvanced();
  const now = useNow(60_000);
  const bankLookup = useBankLookup();
  const bankName = family.scope === 'global' ? null : (bankLookup(family.bank_id)?.name ?? null);
  const [selected, setSelected] = useState<string | null>(versions[0]?.id ?? null);
  const live = useMemo(() => liveActivations(activations, now), [activations, now]);
  const newestLive = useMemo(() => {
    const ids = new Set(live.map((a) => a.version_id));
    return Math.max(0, ...versions.filter((v) => ids.has(v.id)).map((v) => v.version));
  }, [live, versions]);

  function statusOf(v: VersionLite): { label: string; tone: StatusTone }[] {
    const liveFor = live.filter((a) => a.version_id === v.id);
    if (liveFor.length) return liveFor.map((a) => ({ label: liveForLabel(a.audience, bankName), tone: a.audience.type === 'all' ? 'success' : 'progress' }));
    if (v.version > newestLive) return [{ label: 'Published, not live yet', tone: 'info' }];
    return [{ label: 'Old version', tone: 'muted' }];
  }

  if (versions.length === 0) {
    return (
      <Card>
        <EmptyState title="Nothing published yet" description="Publish the draft on the Edit draft tab to create version 1." />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Published</TableHead>
              <TableHead>Published by</TableHead>
              <TableHead>Second approval</TableHead>
              {advanced ? <TableHead>Fingerprint</TableHead> : null}
              <TableHead>Changes</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => {
              const c = changelogCounts(v.changelog);
              return (
                <TableRow
                  key={v.id}
                  onClick={() => setSelected(v.id)}
                  className={cn('cursor-pointer hover:bg-slate-50', selected === v.id && 'bg-sky-50/60 hover:bg-sky-50')}
                >
                  <TableCell className="font-medium tabular-nums">
                    Version {v.version}
                    {v.breaking ? (
                      <Badge tone="warning" className="ml-2" title="Removes or changes questions in a way that affects answers already collected or exports">
                        Changes earlier answers
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {statusOf(v).map((s, i) => (
                        <Badge key={`${s.label}-${i}`} tone={s.tone}>
                          {s.label}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <DateTime value={v.published_at} />
                  </TableCell>
                  <TableCell className="text-xs">
                    <UserName id={v.published_by} />
                  </TableCell>
                  <TableCell className="text-xs">
                    <UserName id={v.approved_by} fallback="Not needed" />
                  </TableCell>
                  {advanced ? (
                    <TableCell>
                      <code className="text-xs" title={v.definition_hash}>
                        {shortId(v.definition_hash, 8, 4)}
                      </code>
                    </TableCell>
                  ) : null}
                  <TableCell className="text-sm tabular-nums">
                    {advanced ? (
                      <>
                        <span className="text-emerald-700">+{c.added}</span> <span className="text-red-700">−{c.removed}</span>{' '}
                        <span className="text-amber-700">~{c.changed}</span>
                      </>
                    ) : c.added + c.removed + c.changed === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span>
                        {[c.added ? `${c.added} added` : '', c.changed ? `${c.changed} changed` : '', c.removed ? `${c.removed} removed` : ''].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          onActivate(v.id);
                        }}
                      >
                        Make live…
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {selected ? <VersionDetail key={selected} family={family} versionId={selected} onActivate={onActivate} canEdit={canEdit} /> : null}
      {versions.length > 1 ? (
        <Advanced>
          <CompareVersions versions={versions} />
        </Advanced>
      ) : null}
    </div>
  );
}
