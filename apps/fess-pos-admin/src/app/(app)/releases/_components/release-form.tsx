'use client';

// Module release registry entry (docs/13 §3), shown as an "app version". Status never gates uploads (docs/13 §4).
import { Info } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { blankToNull, type Parsed, patchAdmin } from '@/components/admin/form-helpers';
import { ObjectEditor, type ObjectEditorState, objectEditorStateFrom, objectEditorStateToObject } from '@/components/admin/object-editor';
import { ReadOnlyNotice } from '@/components/admin/admin-ui';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { Details } from '@/components/details';
import { apiFieldErrors, type FieldErrors, FormField, FormGrid, FormSection, zodFieldErrors } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import { type ReleaseCreateBody, releaseCreateSchema, releaseUpdateSchema } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import { RELEASE_STATUS_LABEL } from '@/lib/status';
import { type ModuleRelease, RELEASE_STATUSES, type ReleaseStatus } from '@/lib/types';

export const RELEASE_STATUS_HINT: Record<ReleaseStatus, string> = {
  supported: 'Agents can use this version.',
  deprecated: 'Agents can still use it, but should update soon.',
  unsupported_for_new_work:
    'Agents must update before starting new visits, but only when App settings require a newer version. Data from this version is always accepted.',
};

function parseApiVersions(text: string): Parsed<string[]> {
  const parts = text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ok: false, message: 'Enter at least one version, such as 1.' };
  const bad = parts.find((p) => !/^[0-9]+$/.test(p));
  if (bad) return { ok: false, message: `“${bad}” isn’t a valid version. Use whole numbers, such as 1 or 2.` };
  return { ok: true, value: [...new Set(parts)] };
}

const wholeVersion = (key: string, v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? null : `“${key}” needs a whole number of 1 or more.`);

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
    successMessage: (r, save) => (save.kind === 'create' ? `Version ${r.version} added.` : `Version ${r.version} saved.`),
    onSuccess: () => onDone(),
  });
  const errors: FieldErrors = { ...apiFieldErrors(mutation.error), ...clientErrors };
  const technicalErrors = !!(errors.api_versions || errors.spec_range || errors.components || errors.page_types);

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    const api = parseApiVersions(apiVersions);
    if (!api.ok) next.api_versions = api.message;
    const componentMap = parseVersionMap(components, 'Question and screen types');
    if (!componentMap.ok) next.components = componentMap.message;
    const pageTypeMap = parseVersionMap(pageTypes, 'Kinds of page');
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
        <SheetTitle>{isNew ? 'Add an app version' : `Version ${release.version}`}</SheetTitle>
        <SheetDescription>A build of the phone app, and whether agents may use it.</SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-5">
        {!canWrite ? <ReadOnlyNotice>Only administrators for all banks can change app versions.</ReadOnlyNotice> : null}
        <Alert variant="info">
          <Info />
          <AlertDescription>
            Whatever the status, data sent from any version of the app is always accepted. Only new visits can be held back, and only when App settings
            require a newer version.
          </AlertDescription>
        </Alert>
        <FormGrid>
          <FormField label="Version number" htmlFor={`${uid}-version`} required={isNew} error={errors.version} hint={isNew ? 'Such as 1.4.0.' : 'The version number can’t be changed.'}>
            <Input id={`${uid}-version`} value={version} onChange={(e) => setVersion(e.target.value)} readOnly={!isNew} className="font-mono" aria-invalid={!!errors.version || undefined} />
          </FormField>
          <FormField label="Released on" htmlFor={`${uid}-released`} error={errors.released_at} hint={isNew ? 'Leave empty to use the current time.' : 'Can’t be changed.'}>
            <Input id={`${uid}-released`} type="datetime-local" value={releasedAt} onChange={(e) => setReleasedAt(e.target.value)} readOnly={!isNew} />
          </FormField>
          <FormField label="Can agents use it?" htmlFor={`${uid}-status`} required error={errors.status} hint={RELEASE_STATUS_HINT[status]}>
            <Select value={status} onValueChange={(v) => setStatus(v as ReleaseStatus)} disabled={!canWrite}>
              <SelectTrigger id={`${uid}-status`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELEASE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {RELEASE_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </FormGrid>
        <FormField label="Notes" htmlFor={`${uid}-notes`} error={errors.notes}>
          <Textarea id={`${uid}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={5000} disabled={!canWrite} />
        </FormField>
        <Details summary="Technical details: what this version understands" defaultOpen={isNew || technicalErrors}>
          <div className="space-y-5">
            <FormGrid>
              <FormField
                label="Server connection versions"
                htmlFor={`${uid}-api`}
                required
                error={errors.api_versions}
                hint="The API versions this build uses, separated by commas, such as 1, 2."
              >
                <Input id={`${uid}-api`} value={apiVersions} onChange={(e) => setApiVersions(e.target.value)} disabled={!canWrite} className="font-mono" aria-invalid={!!errors.api_versions || undefined} />
              </FormField>
              <FormField
                label="Set-up versions it can show"
                htmlFor={`${uid}-spec`}
                required
                error={errors.spec_range}
                hint="The set-up format versions this build understands, such as >=1.0 <2.0."
              >
                <Input id={`${uid}-spec`} value={specRange} onChange={(e) => setSpecRange(e.target.value)} disabled={!canWrite} maxLength={64} className="font-mono" aria-invalid={!!errors.spec_range || undefined} />
              </FormField>
            </FormGrid>
            <FormSection title="Question and screen types" description="Each type of question or screen part this build can show, with the version it supports (photo, version 2, for example).">
              <ObjectEditor
                id={`${uid}-components`}
                state={components}
                onChange={setComponents}
                label="Question and screen types"
                fixedType="number"
                disabled={!canWrite}
                error={errors.components}
                keyLabel="Type"
                valueLabel="Version"
                keyPlaceholder="photo"
                valuePlaceholder="2"
                addLabel="Add a type"
                emptyText="None listed."
              />
            </FormSection>
            <FormSection title="Kinds of page" description="Each kind of page this build can show, with its version.">
              <ObjectEditor
                id={`${uid}-pages`}
                state={pageTypes}
                onChange={setPageTypes}
                label="Kinds of page"
                fixedType="number"
                disabled={!canWrite}
                error={errors.page_types}
                keyLabel="Kind of page"
                valueLabel="Version"
                keyPlaceholder="form"
                valuePlaceholder="1"
                addLabel="Add a kind of page"
                emptyText="None listed."
              />
            </FormSection>
          </div>
        </Details>
        <ApiErrorAlert error={mutation.error} />
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={!canWrite}>
          {isNew ? 'Add version' : 'Save changes'}
        </Button>
      </SheetFooter>
    </form>
  );
}
