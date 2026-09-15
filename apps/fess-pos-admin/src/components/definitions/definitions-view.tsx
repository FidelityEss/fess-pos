'use client';

import { useQuery } from '@tanstack/react-query';
import { FileCode, Plus, Search, UserRound } from 'lucide-react';
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
import type { DefinitionActivation, DefinitionFamily, DefinitionKind } from '@/lib/types';
import { ApprovalsPanel, usePendingApprovals } from './approvals-panel';
import {
  defKeys,
  fetchAllActivations,
  fetchAllDraftsLite,
  fetchAllVersionsLite,
  fetchFamilies,
  KIND_DESCRIPTION,
  KIND_ICON,
  KIND_LABEL,
  KIND_ORDER,
  KIND_WHO,
} from './definitions-data';
import { NewFamilyDialog } from './new-family-dialog';
import { type MapEntry, SetUpMap } from './set-up-map';
import { pieceStatuses } from './set-up-status';

const GLOBAL = 'global';

/** /definitions — "Inspection set-up": a picture of how the pieces fit, every piece grouped by what it is, and the changes waiting for a second approval. */
export function DefinitionsView() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const now = useNow(60_000);
  const bankLookup = useBankLookup();
  const banks = useBanks({ includeInactive: true });
  const [newKind, setNewKind] = useState<{ key: number; kind: DefinitionKind } | null>(null);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<string | null>(null);

  const families = useQuery({ queryKey: defKeys.families, queryFn: fetchFamilies });
  const versions = useQuery({ queryKey: defKeys.versionsLite, queryFn: fetchAllVersionsLite });
  const activations = useQuery({ queryKey: defKeys.activationsAll, queryFn: fetchAllActivations, refetchInterval: 60_000 });
  const drafts = useQuery({ queryKey: defKeys.draftsLite, queryFn: fetchAllDraftsLite });
  const approvals = usePendingApprovals();

  const versionsByFamily = useMemo(() => {
    const m = new Map<string, { id: string; version: number; published_at: string }[]>();
    for (const v of versions.data ?? []) m.set(v.family_id, [...(m.get(v.family_id) ?? []), v]);
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

  const forLabel = (f: DefinitionFamily) => (f.scope === 'global' ? 'All banks' : `Only ${bankLookup(f.bank_id)?.name ?? 'one bank'}`);
  const statusesOf = (f: DefinitionFamily) =>
    pieceStatuses({
      versions: versionsByFamily.get(f.id) ?? [],
      activations: activationsByFamily.get(f.id) ?? [],
      draftUpdatedAt: draftByFamily.get(f.id)?.updated_at ?? null,
      now,
      bankName: f.scope === 'global' ? null : (bankLookup(f.bank_id)?.name ?? null),
    });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (families.data ?? []).filter((f) => {
      if (scope === GLOBAL && f.scope !== 'global') return false;
      if (scope && scope !== GLOBAL && f.bank_id !== scope) return false;
      if (!q) return true;
      return [f.key, f.title, f.description ?? '', KIND_LABEL[f.kind]].some((s) => s.toLowerCase().includes(q));
    });
  }, [families.data, search, scope]);

  const mapEntries = useMemo(() => {
    const out = Object.fromEntries(KIND_ORDER.map((k) => [k, [] as MapEntry[]])) as Record<DefinitionKind, MapEntry[]>;
    for (const f of families.data ?? []) out[f.kind]?.push({ family: f, forLabel: forLabel(f), statuses: statusesOf(f) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statusesOf/forLabel read the same maps listed here
  }, [families.data, versionsByFamily, activationsByFamily, draftByFamily, now, bankLookup]);

  const pendingCount = approvals.data?.length ?? 0;
  const loading = families.isPending;
  const error = families.error ?? versions.error ?? activations.error ?? drafts.error;
  const openNew = (kind: DefinitionKind = 'form') => setNewKind({ key: Date.now(), kind });
  const addButton = staff.isAdmin ? (
    <Button onClick={() => openNew()}>
      <Plus /> Add new
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Inspection set-up"
        description="Everything agents see and fill in on a visit, and what the office fills in when it creates a job. Change a part, check it, publish it, then make it live."
        actions={addButton}
      />

      <Tabs defaultValue="families">
        <TabsList>
          <TabsTrigger value="families">Set-up</TabsTrigger>
          <TabsTrigger value="approvals">
            Waiting for approval {pendingCount > 0 ? <Badge tone="warning">{pendingCount}</Badge> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="families" className="space-y-6">
          {error ? <ApiErrorAlert error={error} onRetry={() => void families.refetch()} /> : null}
          {loading ? <Skeleton className="h-96 w-full" /> : <SetUpMap entries={mapEntries} canAdd={staff.isAdmin} onAdd={openNew} />}

          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Every part, one by one</h2>
                <p className="max-w-3xl text-sm text-muted-foreground">
                  A change starts as a draft. Publishing saves it as a version that never changes, and agents only get a version once you make it live, so
                  you can always go back.
                </p>
              </div>
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
            </div>

            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : filtered.length === 0 ? (
              <Card>
                <EmptyState
                  icon={FileCode}
                  title={families.data?.length ? 'Nothing matches your search' : 'Nothing set up yet'}
                  description={families.data?.length ? 'Try another word, or choose a different bank.' : 'Start with the questions agents answer on a visit.'}
                  action={families.data?.length ? undefined : addButton}
                />
              </Card>
            ) : (
              KIND_ORDER.map((kind) => {
                const rows = filtered.filter((f) => f.kind === kind);
                if (rows.length === 0) return null;
                const Icon = KIND_ICON[kind];
                return (
                  <section key={kind} id={`kind-${kind}`} className="scroll-mt-20">
                    <SectionTitle>
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className="size-4" aria-hidden /> {KIND_LABEL[kind]} <span className="font-normal normal-case">({rows.length})</span>
                      </span>
                    </SectionTitle>
                    <p className="-mt-1 text-sm text-muted-foreground">{KIND_DESCRIPTION[kind]}</p>
                    <p className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <UserRound className="size-3.5" aria-hidden /> {KIND_WHO[kind]}
                    </p>
                    <Card className="overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Who it’s for</TableHead>
                            <TableHead>Where it stands</TableHead>
                            <TableHead>Last change</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((f) => {
                            const draft = draftByFamily.get(f.id);
                            const pending = pendingByFamily.get(f.id) ?? 0;
                            const latest = (versionsByFamily.get(f.id) ?? []).reduce<string | null>((m, v) => (!m || v.published_at > m ? v.published_at : m), null);
                            const last = [draft?.updated_at, latest].filter((x): x is string => !!x).sort().pop();
                            return (
                              <TableRow key={f.id} className="hover:bg-slate-50">
                                <TableCell>
                                  <Link href={`/definitions/${f.id}`} className="block hover:underline">
                                    <span className="block text-base font-medium">{f.title}</span>
                                    {f.description ? <span className="block text-sm text-muted-foreground">{f.description}</span> : null}
                                    {advanced ? <span className="font-mono text-xs text-muted-foreground">{f.key}</span> : null}
                                  </Link>
                                </TableCell>
                                <TableCell>
                                  <Badge tone={f.scope === 'global' ? 'neutral' : 'accent'}>{forLabel(f)}</Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {statusesOf(f).map((s) => (
                                      <Badge key={s.label} tone={s.tone} title={s.hint}>
                                        {s.label}
                                        {advanced && s.hint?.startsWith('Version') ? ` · ${s.hint.toLowerCase()}` : ''}
                                      </Badge>
                                    ))}
                                    {pending > 0 ? <Badge tone="warning">{pending === 1 ? 'Waiting for a second approval' : `${pending} waiting for approval`}</Badge> : null}
                                  </div>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{last ? <DateTime value={last} mode="relative" /> : '—'}</TableCell>
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
          </section>
        </TabsContent>

        <TabsContent value="approvals" className="space-y-3">
          <p className="max-w-3xl text-sm text-muted-foreground">
            Some changes need a second person to approve them before they take effect: publishing a new version, making a version live, and some app
            settings. Anyone allowed to approve can decide, but never on their own request.
          </p>
          <ApprovalsPanel />
        </TabsContent>
      </Tabs>

      {newKind ? (
        <NewFamilyDialog key={newKind.key} open initialKind={newKind.kind} onOpenChange={(o) => (!o ? setNewKind(null) : undefined)} />
      ) : null}
    </>
  );
}
