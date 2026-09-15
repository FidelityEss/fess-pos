'use client';

import { useQuery } from '@tanstack/react-query';
import { FileQuestion, Pencil, Rocket, Send } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { useNow } from '@/components/date-time';
import { EmptyState } from '@/components/empty-state';
import { apiFieldErrors, type FieldErrors, FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { isUuid, useBankLookup } from '@/lib/hooks';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import type { DefinitionFamily } from '@/lib/types';
import { ActivateDialog, type ActivatePreset } from './activate-dialog';
import { ActivationsTab } from './activations-tab';
import { currentAllActivation, defKeys, fetchActivations, fetchDraft, fetchFamily, fetchVersion, fetchVersions, liveActivations } from './definitions-data';
import { DraftEditor } from './draft-editor';
import { PieceGuide } from './piece-guide';
import { canonicalJson, pieceStatuses } from './set-up-status';
import { TestCasesTab } from './test-cases-tab';
import { VersionsTab } from './versions-tab';

/** The family page's tabs; the selected one is kept in `?tab=` so other screens (and next-step prompts) can link to it. */
const TABS = ['draft', 'versions', 'activations', 'tests'] as const;
type TabKey = (typeof TABS)[number];
const isTab = (v: string | null): v is TabKey => v !== null && (TABS as readonly string[]).includes(v);

function EditFamilyDialog({ family, open, onOpenChange }: { family: DefinitionFamily; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = useState(family.title);
  const [description, setDescription] = useState(family.description ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useMutationWithToast({
    mutationFn: () => adminApi.definitions.updateFamily(family.id, { title: title.trim(), description: description.trim() || undefined }),
    successMessage: 'Name and description saved.',
    toastErrors: false,
    invalidate: [defKeys.all],
    onSuccess: () => onOpenChange(false),
    onError: (e) => setErrors(apiFieldErrors(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => (save.isPending ? undefined : onOpenChange(o))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change the name and description</DialogTitle>
          <DialogDescription>This is how it’s listed in the admin panel. It doesn’t change what agents see.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="Name" htmlFor="fam-edit-title" required error={errors.title}>
            <Input id="fam-edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          <FormField label="Description" htmlFor="fam-edit-desc" error={errors.description}>
            <Textarea id="fam-edit-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <ApiErrorAlert error={save.error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => (title.trim() ? save.mutate() : setErrors({ title: 'Enter a name.' }))} loading={save.isPending}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** /definitions/[familyId] — one piece of the set-up: its draft, published versions, where it's live and its example answers. */
export function FamilyStudio({ familyId }: { familyId: string }) {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const bankLookup = useBankLookup();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const now = useNow(60_000);
  const valid = isUuid(familyId);
  const family = useQuery({ queryKey: defKeys.family(familyId), queryFn: () => fetchFamily(familyId), enabled: valid });
  const versions = useQuery({ queryKey: defKeys.versions(familyId), queryFn: () => fetchVersions(familyId), enabled: valid });
  const activations = useQuery({ queryKey: defKeys.activations(familyId), queryFn: () => fetchActivations(familyId), enabled: valid, refetchInterval: 60_000 });
  // The same queries the draft editor uses (shared cache), to say exactly whether the draft differs from the newest version.
  const draft = useQuery({ queryKey: defKeys.draft(familyId), queryFn: () => fetchDraft(familyId), enabled: valid });
  const newestId = versions.data?.[0]?.id ?? '';
  const newest = useQuery({ queryKey: defKeys.version(newestId), queryFn: () => fetchVersion(newestId), enabled: !!newestId, staleTime: Infinity });
  const tabParam = searchParams.get('tab');
  const tab: TabKey = isTab(tabParam) ? tabParam : 'draft';
  const [editOpen, setEditOpen] = useState(false);
  const [activate, setActivate] = useState<{ key: number; preset?: ActivatePreset } | null>(null);
  const [publishSignal, setPublishSignal] = useState(0);
  const current = useMemo(() => currentAllActivation(activations.data ?? [], now), [activations.data, now]);

  const setTab = (t: string) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set('tab', t);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  const back = { href: '/definitions', label: 'Inspection set-up' };

  if (!valid || (family.isSuccess && family.data === null)) {
    return (
      <>
        <PageHeader title="Not found" back={back} description={null} />
        <Card>
          <EmptyState icon={FileQuestion} title="We couldn’t find this" description="It may have been removed, or it belongs to a bank you can’t see." />
        </Card>
      </>
    );
  }
  if (family.error) {
    return (
      <>
        <PageHeader title="Inspection set-up" back={back} description={null} />
        <ApiErrorAlert error={family.error} onRetry={() => void family.refetch()} />
      </>
    );
  }
  if (family.isPending || !family.data) {
    return (
      <>
        <PageHeader title={<Skeleton className="h-7 w-64" />} back={back} description={null} />
        <Skeleton className="h-96 w-full" />
      </>
    );
  }

  const f = family.data;
  const canEdit = staff.isAdmin && (f.bank_id ? staff.canAccessBank(f.bank_id) : staff.isGlobalAdmin);
  const versionList = versions.data ?? [];
  const bank = bankLookup(f.bank_id);
  const bankName = f.scope === 'global' ? null : (bank?.name ?? null);
  const currentVersion = current ? versionList.find((v) => v.id === current.version_id) : undefined;

  // Where it stands, exactly: the draft's content against the newest version, and whether the newest version is live.
  const draftChanged =
    draft.data === undefined || (versionList[0] && newest.data === undefined)
      ? undefined
      : draft.data === null
        ? false
        : !versionList[0] || !newest.data || canonicalJson(draft.data.definition) !== canonicalJson(newest.data.definition);
  const statuses = pieceStatuses({ versions: versionList, activations: activations.data ?? [], draftChanged: draftChanged ?? false, now, bankName });
  const liveIds = new Set(liveActivations(activations.data ?? [], now).map((a) => a.version_id));
  const newestLive = Math.max(0, ...versionList.filter((v) => liveIds.has(v.id)).map((v) => v.version));
  const waitingToGoLive = versionList[0] && versionList[0].version > newestLive ? versionList[0] : undefined;
  const nextStep = (
    <>
      {canEdit && draftChanged ? (
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setTab('draft');
            setPublishSignal((n) => n + 1);
          }}
        >
          <Send /> Publish the changes…
        </Button>
      ) : null}
      {canEdit && waitingToGoLive ? (
        <Button type="button" size="sm" variant={draftChanged ? 'outline' : 'default'} onClick={() => setActivate({ key: Date.now(), preset: { versionId: waitingToGoLive.id } })}>
          <Rocket /> {bankName ? `Make version ${waitingToGoLive.version} live for ${bankName}…` : `Make version ${waitingToGoLive.version} live…`}
        </Button>
      ) : null}
      {!draftChanged && !waitingToGoLive ? (
        <span className="text-muted-foreground">
          {versionList.length ? 'Nothing waiting: agents have the newest version.' : 'Fill in the draft below, then publish it.'}
        </span>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        back={back}
        title={f.title}
        description={f.description ?? null}
        actions={
          canEdit ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil /> Change name
            </Button>
          ) : null
        }
      >
        {advanced ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <code className="rounded border px-1.5 py-0.5 text-xs">
              {f.kind}/{f.key}
            </code>
            {currentVersion ? <span className="text-xs text-muted-foreground">Everyone gets version {currentVersion.version}</span> : null}
          </div>
        ) : null}
      </PageHeader>
      <PieceGuide family={f} statuses={statuses} forLabel={f.scope === 'global' ? 'Shared by all banks' : bank ? `Only for ${bank.name}` : 'One bank'} next={nextStep} />

      {!canEdit ? (
        <Alert variant="info" className="mb-4">
          <AlertDescription>
            {f.scope === 'global' ? 'Set-up shared by all banks is managed by admins who can see every bank.' : 'This belongs to a bank you can’t manage.'} You can
            look at it, but not change it.
          </AlertDescription>
        </Alert>
      ) : null}
      {versions.error || activations.error ? <ApiErrorAlert error={versions.error ?? activations.error} className="mb-4" /> : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="draft">{canEdit ? 'Edit' : 'Draft'}</TabsTrigger>
          <TabsTrigger value="versions">Versions {versionList.length ? `(${versionList.length})` : ''}</TabsTrigger>
          <TabsTrigger value="activations">Where it’s live</TabsTrigger>
          <TabsTrigger value="tests">Example answers</TabsTrigger>
        </TabsList>
        <TabsContent value="draft">
          {versions.isPending ? <Skeleton className="h-96 w-full" /> : <DraftEditor family={f} versions={versionList} canEdit={canEdit} openPublishSignal={publishSignal} />}
        </TabsContent>
        <TabsContent value="versions">
          {versions.isPending || activations.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <VersionsTab
              family={f}
              versions={versionList}
              activations={activations.data ?? []}
              canEdit={canEdit}
              onActivate={(versionId) => setActivate({ key: Date.now(), preset: { versionId } })}
            />
          )}
        </TabsContent>
        <TabsContent value="activations">
          {versions.isPending || activations.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ActivationsTab
              versions={versionList}
              activations={activations.data ?? []}
              canEdit={canEdit}
              bankName={bankName}
              onActivate={(preset) => setActivate({ key: Date.now(), preset })}
            />
          )}
        </TabsContent>
        <TabsContent value="tests">
          <TestCasesTab family={f} canEdit={canEdit} />
        </TabsContent>
      </Tabs>

      {editOpen ? <EditFamilyDialog family={f} open onOpenChange={setEditOpen} /> : null}
      {activate ? (
        <ActivateDialog
          key={activate.key}
          open
          onOpenChange={(o) => (!o ? setActivate(null) : undefined)}
          family={f}
          versions={versionList}
          preset={activate.preset}
          liveVersion={currentVersion?.version}
        />
      ) : null}
    </>
  );
}
