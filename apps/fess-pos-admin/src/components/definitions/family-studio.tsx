'use client';

import { useQuery } from '@tanstack/react-query';
import { FileQuestion, Pencil } from 'lucide-react';
import { useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { EmptyState } from '@/components/empty-state';
import { apiFieldErrors, type FieldErrors, FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { humanize } from '@/lib/format';
import { isUuid, useBankLookup } from '@/lib/hooks';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import type { DefinitionFamily } from '@/lib/types';
import { ActivateDialog, type ActivatePreset } from './activate-dialog';
import { ActivationsTab } from './activations-tab';
import { defKeys, fetchActivations, fetchFamily, fetchVersions, KIND_SINGULAR } from './definitions-data';
import { DraftEditor } from './draft-editor';
import { TestCasesTab } from './test-cases-tab';
import { VersionsTab } from './versions-tab';

function EditFamilyDialog({ family, open, onOpenChange }: { family: DefinitionFamily; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = useState(family.title);
  const [description, setDescription] = useState(family.description ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useMutationWithToast({
    mutationFn: () => adminApi.definitions.updateFamily(family.id, { title: title.trim(), description: description.trim() || undefined }),
    successMessage: 'Family details saved',
    toastErrors: false,
    invalidate: [defKeys.all],
    onSuccess: () => onOpenChange(false),
    onError: (e) => setErrors(apiFieldErrors(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => (save.isPending ? undefined : onOpenChange(o))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit family details</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="Title" htmlFor="fam-edit-title" required error={errors.title}>
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
          <Button type="button" onClick={() => (title.trim() ? save.mutate() : setErrors({ title: 'Title is required' }))} loading={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** /definitions/[familyId] — draft editor, versions, activations and test cases for one family. */
export function FamilyStudio({ familyId }: { familyId: string }) {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const bankLookup = useBankLookup();
  const valid = isUuid(familyId);
  const family = useQuery({ queryKey: defKeys.family(familyId), queryFn: () => fetchFamily(familyId), enabled: valid });
  const versions = useQuery({ queryKey: defKeys.versions(familyId), queryFn: () => fetchVersions(familyId), enabled: valid });
  const activations = useQuery({ queryKey: defKeys.activations(familyId), queryFn: () => fetchActivations(familyId), enabled: valid, refetchInterval: 60_000 });
  const [tab, setTab] = useState('draft');
  const [editOpen, setEditOpen] = useState(false);
  const [activate, setActivate] = useState<{ key: number; preset?: ActivatePreset } | null>(null);

  const back = { href: '/definitions', label: 'Forms & screens' };

  if (!valid || (family.isSuccess && family.data === null)) {
    return (
      <>
        <PageHeader title="Definition family" back={back} />
        <Card>
          <EmptyState icon={FileQuestion} title="Family not found" description="It may not exist, or it belongs to a bank outside your scope." />
        </Card>
      </>
    );
  }
  if (family.error) {
    return (
      <>
        <PageHeader title="Definition family" back={back} />
        <ApiErrorAlert error={family.error} onRetry={() => void family.refetch()} />
      </>
    );
  }
  if (family.isPending || !family.data) {
    return (
      <>
        <PageHeader title={<Skeleton className="h-7 w-64" />} back={back} />
        <Skeleton className="h-96 w-full" />
      </>
    );
  }

  const f = family.data;
  const canEdit = staff.isAdmin && (f.bank_id ? staff.canAccessBank(f.bank_id) : staff.isGlobalAdmin);
  const versionList = versions.data ?? [];
  const bank = bankLookup(f.bank_id);

  return (
    <>
      <PageHeader
        back={back}
        title={f.title}
        description={f.description ?? undefined}
        actions={
          canEdit ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit details
            </Button>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="accent">{KIND_SINGULAR[f.kind] ?? humanize(f.kind)}</Badge>
          {advanced ? (
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {f.kind}/{f.key}
            </code>
          ) : null}
          {f.scope === 'global' ? <Badge tone="neutral">Global</Badge> : <Badge tone="info">{bank ? `${bank.code} · ${bank.name}` : 'Bank override'}</Badge>}
          {versionList[0] ? <span className="text-sm text-muted-foreground">Latest published: version {versionList[0].version}</span> : <span className="text-sm text-muted-foreground">Not published yet</span>}
        </div>
      </PageHeader>

      {!canEdit ? (
        <Alert variant="info" className="mb-4">
          <AlertDescription>
            {f.scope === 'global' ? 'Global families are managed by all-bank admins.' : 'This family belongs to a bank outside your scope.'} You can view it,
            but not change it.
          </AlertDescription>
        </Alert>
      ) : null}
      {versions.error || activations.error ? <ApiErrorAlert error={versions.error ?? activations.error} className="mb-4" /> : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="draft">Edit</TabsTrigger>
          <TabsTrigger value="versions">Published versions {versionList.length ? `(${versionList.length})` : ''}</TabsTrigger>
          <TabsTrigger value="activations">Who sees it (activation)</TabsTrigger>
          <TabsTrigger value="tests">Test cases</TabsTrigger>
        </TabsList>
        <TabsContent value="draft">
          {versions.isPending ? <Skeleton className="h-96 w-full" /> : <DraftEditor family={f} versions={versionList} canEdit={canEdit} />}
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
        />
      ) : null}
    </>
  );
}
