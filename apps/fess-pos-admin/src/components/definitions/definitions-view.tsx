'use client';

import { useQuery } from '@tanstack/react-query';
import { FileCode, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { DateTime, useNow } from '@/components/date-time';
import { EmptyState } from '@/components/empty-state';
import { FilterSelect, SectionTitle } from '@/components/ops/ops-shared';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBankLookup, useBanks } from '@/lib/hooks';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import type { DefinitionActivation, DefinitionFamily } from '@/lib/types';
import { ApprovalsPanel, usePendingApprovals } from './approvals-panel';
import {
  audienceLabel,
  defKeys,
  fetchAllActivations,
  fetchAllDraftsLite,
  fetchAllVersionsLite,
  fetchFamilies,
  KIND_DESCRIPTION,
  KIND_LABEL,
  KIND_ORDER,
  liveActivations,
} from './definitions-data';
import { NewFamilyDialog } from './new-family-dialog';

const GLOBAL = 'global';

/** /definitions — "Inspection set-up": every piece grouped by what it is, plus the changes waiting for a second approval. */
export function DefinitionsView() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const now = useNow(60_000);
  const bankLookup = useBankLookup();
  const banks = useBanks({ includeInactive: true });
  const [newOpen, setNewOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<string | null>(null);

  const families = useQuery({ queryKey: defKeys.families, queryFn: fetchFamilies });
  const versions = useQuery({ queryKey: defKeys.versionsLite, queryFn: fetchAllVersionsLite });
  const activations = useQuery({ queryKey: defKeys.activationsAll, queryFn: fetchAllActivations, refetchInterval: 60_000 });
  const drafts = useQuery({ queryKey: defKeys.draftsLite, queryFn: fetchAllDraftsLite });
  const approvals = usePendingApprovals();

  const versionById = useMemo(() => new Map((versions.data ?? []).map((v) => [v.id, v])), [versions.data]);
  const latestByFamily = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of versions.data ?? []) m.set(v.family_id, Math.max(m.get(v.family_id) ?? 0, v.version));
    return m;
  }, [versions.data]);
  const activationsByFamily = useMemo(() => {
    const m = new Map<string, DefinitionActivation[]>();
    for (const a of activations.data ?? []) m.set(a.family_id, [...(m.get(a.family_id) ?? []), a]);
    return m;
  }, [activations.data]);
  const draftByFamily = useMemo(() => new Map((drafts.data ?? []).map((d) => [d.family_id, d])), [drafts.data]);
  const pendingByFamily = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of approvals.data ?? []) {
      const fid = a.family_id ?? (a.subject_type === 'definition_publish' ? a.subject_ref : null);
      if (fid) m.set(fid, (m.get(fid) ?? 0) + 1);
    }
    return m;
  }, [approvals.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (families.data ?? []).filter((f) => {
      if (scope === GLOBAL && f.scope !== 'global') return false;
      if (scope && scope !== GLOBAL && f.bank_id !== scope) return false;
      if (!q) return true;
      return [f.key, f.title, f.description ?? '', f.kind].some((s) => s.toLowerCase().includes(q));
    });
  }, [families.data, search, scope]);

  const pendingCount = approvals.data?.length ?? 0;

  function liveCell(f: DefinitionFamily) {
    const live = liveActivations(activationsByFamily.get(f.id) ?? [], now);
    if (live.length === 0) return <span className="text-sm text-muted-foreground">Not live yet</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {live.map((a) => {
          const v = versionById.get(a.version_id)?.version;
          const label = v ? `Version ${v}` : 'A version';
          return (
            <Badge key={a.id} tone={a.audience.type === 'all' ? 'success' : 'progress'} title={a.reason}>
              {a.audience.type === 'all' ? label : `${label} for ${audienceLabel(a.audience).replace(/^A/, 'a')}`}
            </Badge>
          );
        })}
      </div>
    );
  }

  const loading = families.isPending;
  const error = families.error ?? versions.error ?? activations.error ?? drafts.error;
  const addButton = staff.isAdmin ? (
    <Button onClick={() => setNewOpen(true)}>
      <Plus /> Add new
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Inspection set-up" actions={addButton} />

      <Tabs defaultValue="families">
        <TabsList>
          <TabsTrigger value="families">Set-up</TabsTrigger>
          <TabsTrigger value="approvals">
            Waiting for approval {pendingCount > 0 ? <Badge tone="warning">{pendingCount}</Badge> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="families" className="space-y-5">
          <p className="max-w-3xl text-sm text-muted-foreground">
            Change a draft, check it and publish it as a new version. Agents only see a version once you make it live. Published versions never change, so
            you can always go back to an older one.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" className="pl-8" aria-label="Search the set-up" />
            </div>
            <FilterSelect
              value={scope}
              onChange={setScope}
              allLabel="All banks and shared"
              aria-label="Which bank"
              options={[{ value: GLOBAL, label: 'Shared by all banks' }, ...(banks.data ?? []).map((b) => ({ value: b.id, label: `Only for ${b.name}` }))]}
            />
          </div>

          {error ? <ApiErrorAlert error={error} onRetry={() => void families.refetch()} /> : null}

          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon={FileCode}
                title={families.data?.length ? 'Nothing matches your search' : 'Nothing set up yet'}
                description={families.data?.length ? 'Try another word, or choose a different bank.' : 'Add the first piece, such as the questions agents answer on a visit.'}
                action={families.data?.length ? undefined : addButton}
              />
            </Card>
          ) : (
            KIND_ORDER.map((kind) => {
              const rows = filtered.filter((f) => f.kind === kind);
              if (rows.length === 0) return null;
              return (
                <section key={kind}>
                  <SectionTitle>
                    {KIND_LABEL[kind]} <span className="font-normal normal-case">({rows.length})</span>
                  </SectionTitle>
                  <p className="-mt-1 mb-2 text-sm text-muted-foreground">{KIND_DESCRIPTION[kind]}</p>
                  <Card className="overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Who it’s for</TableHead>
                          <TableHead>Live now</TableHead>
                          <TableHead className="text-right">Latest version</TableHead>
                          <TableHead>Draft</TableHead>
                          <TableHead className="text-right">Waiting for approval</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((f) => {
                          const latest = latestByFamily.get(f.id);
                          const draft = draftByFamily.get(f.id);
                          const pending = pendingByFamily.get(f.id) ?? 0;
                          const bank = bankLookup(f.bank_id);
                          return (
                            <TableRow key={f.id} className="hover:bg-slate-50">
                              <TableCell>
                                <Link href={`/definitions/${f.id}`} className="block hover:underline">
                                  <span className="block text-base font-medium">{f.title}</span>
                                  {advanced ? <span className="font-mono text-xs text-muted-foreground">{f.key}</span> : null}
                                </Link>
                              </TableCell>
                              <TableCell>
                                {f.scope === 'global' ? (
                                  <Badge tone="neutral">All banks</Badge>
                                ) : (
                                  <Badge tone="accent" title={bank?.name}>
                                    {bank?.name ?? 'One bank'}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>{liveCell(f)}</TableCell>
                              <TableCell className="text-right tabular-nums">{latest ? `Version ${latest}` : <span className="text-muted-foreground">None yet</span>}</TableCell>
                              <TableCell className="text-xs">
                                {draft ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Badge tone="info">Draft</Badge>
                                    <DateTime value={draft.updated_at} mode="relative" className="text-muted-foreground" />
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {pending > 0 ? <Badge tone="warning">{pending} waiting</Badge> : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Card>
                </section>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="approvals" className="space-y-3">
          <p className="max-w-3xl text-sm text-muted-foreground">
            Some changes need a second person to approve them before they take effect: publishing a new version, making a version live, and some app
            settings. Anyone allowed to approve can decide, but never on their own request.
          </p>
          <ApprovalsPanel />
        </TabsContent>
      </Tabs>

      <NewFamilyDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  );
}
