'use client';

// Module release registry entry (docs/13 §3). Status never gates uploads (docs/13 §4).
import { Info } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { blankToNull, type Parsed, patchAdmin } from '@/components/admin/form-helpers';
import { ObjectEditor, type ObjectEditorState, objectEditorStateFrom, objectEditorStateToObject } from '@/components/admin/object-editor';
import { ReadOnlyNotice } from '@/components/admin/admin-ui';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { apiFieldErrors, type FieldErrors, FormField, FormGrid, FormSection, zodFieldErrors } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { fromDateTimeLocalValue, humanize, toDateTimeLocalValue } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import { type ReleaseCreateBody, releaseCreateSchema, releaseUpdateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import { type ModuleRelease, RELEASE_STATUSES, type ReleaseStatus } from '@/lib/types';

export const RELEASE_STATUS_HINT: Record<ReleaseStatus, string> = {
  supported: 'Fully supported by the API.',
  deprecated: 'Still works; agents should update soon.',
  unsupported_for_new_work: 'Only matters when remote config sets min_module_version.new_work — uploads always land.',
};

function parseApiVersions(text: string): Parsed<string[]> {
  const parts = text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ok: false, message: 'Give at least one API version, e.g. 1' };
  const bad = parts.find((p) => !/^[0-9]+$/.test(p));
  if (bad) return { ok: false, message: `"${bad}" isn’t an API version — use whole numbers like 1 or 2` };
  return { ok: true, value: [...new Set(parts)] };
}

const wholeVersion = (key: string, v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? null : `"${key}" needs a whole-number version of 1 or more`);

/** Name → positive whole-number version rows, e.g. photo → 2. */
function parseVersionMap(state: ObjectEditorState, label: string): Parsed<Record<string, number>> {
  const r = objectEditorStateToObject(state, { label, validate: wholeVersion });
  return r.ok ? { ok: true, value: r.value as Record<string, number> } : r;
}

export function ReleaseSheet({ open, release, onOpenChange }: { open: boolean; release: ModuleRelease | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg">{open ? <ReleaseForm key={release?.id ?? 'new'} release={release} onDone={() => onOpenChange(false)} /> : null}</SheetContent>
    </Sheet>
  );
}

type ReleaseSave = { kind: 'create'; body: ReleaseCreateBody } | { kind: 'update'; id: string; body: Record<string, unknown> };

function ReleaseForm({ release, onDone }: { release: ModuleRelease | null; onDone: () => void }) {
  const staff = useStaff();
  const uid = useId();
  const isNew = release === null;
  const canWrite = staff.isGlobalAdmin;
  const [version, setVersion] = useState(release?.version ?? '');
  const [releasedAt, setReleasedAt] = useState(release ? toDateTimeLocalValue(release.released_at) : '');
  const [status, setStatus] = useState<ReleaseStatus>(release?.status ?? 'supported');
  const [apiVersions, setApiVersions] = useState((release?.api_versions ?? ['1']).join(', '));
  const [specRange, setSpecRange] = useState(release?.spec_range ?? '');
  const [components, setComponents] = useState<ObjectEditorState>(() => objectEditorStateFrom(release?.components ?? {}));
  const [pageTypes, setPageTypes] = useState<ObjectEditorState>(() => objectEditorStateFrom(release?.page_types ?? {}));
  const [notes, setNotes] = useState(release?.notes ?? '');
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});

  const mutation = useMutationWithToast({
    mutationFn: (save: ReleaseSave) =>
      save.kind === 'create'
        ? adminApi.releases.create(save.body)
        : // patchAdmin so cleared notes are sent as null.
          patchAdmin<ModuleRelease>(`/releases/${encodeURIComponent(save.id)}`, save.body),
    invalidate: [['module_releases']],
    toastErrors: false,
    successMessage: (r, save) => (save.kind === 'create' ? `Release ${r.version} registered` : `Release ${r.version} saved`),
    onSuccess: () => onDone(),
  });
  const errors: FieldErrors = { ...apiFieldErrors(mutation.error), ...clientErrors };

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    const api = parseApiVersions(apiVersions);
    if (!api.ok) next.api_versions = api.message;
    const componentMap = parseVersionMap(components, 'Components');
    if (!componentMap.ok) next.components = componentMap.message;
    const pageTypeMap = parseVersionMap(pageTypes, 'Page types');
    if (!pageTypeMap.ok) next.page_types = pageTypeMap.message;
    const common = {
      status,
      api_versions: api.ok ? api.value : [],
      spec_range: specRange,
      components: componentMap.ok ? componentMap.value : {},
      page_types: pageTypeMap.ok ? pageTypeMap.value : {},
      notes,
    };
    if (isNew) {
      const parsed = releaseCreateSchema.safeParse({ version: version.trim(), released_at: fromDateTimeLocalValue(releasedAt), ...common });
      const merged = parsed.success ? next : { ...zodFieldErrors(parsed.error), ...next };
      setClientErrors(merged);
      if (!parsed.success || Object.keys(merged).length > 0) return;
      mutation.mutate({ kind: 'create', body: parsed.data });
      return;
    }
    const parsed = releaseUpdateSchema.safeParse(common);
    const merged = parsed.success ? next : { ...zodFieldErrors(parsed.error), ...next };
    setClientErrors(merged);
    if (!parsed.success || Object.keys(merged).length > 0) return;
    mutation.mutate({
      kind: 'update',
      id: release.id,
      body: { ...common, spec_range: specRange.trim(), notes: blankToNull(notes) },
    });
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader>
        <SheetTitle>{isNew ? 'Register a module release' : `Release ${release.version}`}</SheetTitle>
        <SheetDescription>Version, compatibility and support status of a POS module build.</SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-5">
        {!canWrite ? <ReadOnlyNotice>The release registry is managed by all-bank administrators (D-44).</ReadOnlyNotice> : null}
        <Alert variant="info">
          <Info />
          <AlertDescription>
            Status never blocks uploads: data from any module version always lands (docs/13 §3–4). Starting new work is gated only
            by the remote config key min_module_version.new_work.
          </AlertDescription>
        </Alert>
        <FormGrid>
          <FormField label="Version" htmlFor={`${uid}-version`} required={isNew} error={errors.version} hint={isNew ? 'Semantic version, e.g. 1.4.0' : 'The version can’t be changed.'}>
            <Input id={`${uid}-version`} value={version} onChange={(e) => setVersion(e.target.value)} readOnly={!isNew} className="font-mono" aria-invalid={!!errors.version || undefined} />
          </FormField>
          <FormField label="Released at (SAST)" htmlFor={`${uid}-released`} error={errors.released_at} hint={isNew ? 'Leave empty for now.' : 'Can’t be changed.'}>
            <Input id={`${uid}-released`} type="datetime-local" value={releasedAt} onChange={(e) => setReleasedAt(e.target.value)} readOnly={!isNew} />
          </FormField>
          <FormField label="Status" htmlFor={`${uid}-status`} required error={errors.status} hint={RELEASE_STATUS_HINT[status]}>
            <Select value={status} onValueChange={(v) => setStatus(v as ReleaseStatus)} disabled={!canWrite}>
              <SelectTrigger id={`${uid}-status`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELEASE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {humanize(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="API versions" htmlFor={`${uid}-api`} required error={errors.api_versions} hint="Comma-separated, e.g. 1, 2">
            <Input id={`${uid}-api`} value={apiVersions} onChange={(e) => setApiVersions(e.target.value)} disabled={!canWrite} className="font-mono" aria-invalid={!!errors.api_versions || undefined} />
          </FormField>
          <FormField label="Definition spec range" htmlFor={`${uid}-spec`} required error={errors.spec_range} hint="Definition spec versions this build can render, e.g. >=1.0 <2.0">
            <Input id={`${uid}-spec`} value={specRange} onChange={(e) => setSpecRange(e.target.value)} disabled={!canWrite} maxLength={64} className="font-mono" aria-invalid={!!errors.spec_range || undefined} />
          </FormField>
        </FormGrid>
        <FormSection title="Components" description="Each component type this build can show, with the version it supports (e.g. photo → 2).">
          <ObjectEditor
            id={`${uid}-components`}
            state={components}
            onChange={setComponents}
            label="Components"
            fixedType="number"
            disabled={!canWrite}
            error={errors.components}
            keyLabel="Component type"
            valueLabel="Version"
            keyPlaceholder="e.g. photo"
            valuePlaceholder="e.g. 2"
            addLabel="Add component"
            emptyText="No components listed."
          />
        </FormSection>
        <FormSection title="Page types" description="Each page type this build can show, with its version.">
          <ObjectEditor
            id={`${uid}-pages`}
            state={pageTypes}
            onChange={setPageTypes}
            label="Page types"
            fixedType="number"
            disabled={!canWrite}
            error={errors.page_types}
            keyLabel="Page type"
            valueLabel="Version"
            keyPlaceholder="e.g. form"
            valuePlaceholder="e.g. 1"
            addLabel="Add page type"
            emptyText="No page types listed."
          />
        </FormSection>
        <FormField label="Notes" htmlFor={`${uid}-notes`} error={errors.notes}>
          <Textarea id={`${uid}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={5000} disabled={!canWrite} />
        </FormField>
        <ApiErrorAlert error={mutation.error} />
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={!canWrite}>
          {isNew ? 'Register release' : 'Save changes'}
        </Button>
      </SheetFooter>
    </form>
  );
}
