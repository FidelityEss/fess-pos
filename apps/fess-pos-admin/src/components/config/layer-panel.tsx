'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, FileDiff, Pencil, Plus, RotateCcw, Save, ShieldAlert, ShieldCheck, Smartphone, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { DateTime } from '@/components/date-time';
import { Details } from '@/components/details';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { JsonEditor, parseJsonText, stringifyJson } from '@/components/json-editor';
import { JsonView } from '@/components/json-view';
import { LineDiffView } from '@/components/ops/diff';
import { SectionTitle, UserName } from '@/components/ops/ops-shared';
import { humanLabel } from '@/components/structured-view';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { adminApi, isApiError, isApprovalRequired } from '@/lib/api';
import { formatDateTime, fromDateTimeLocalValue } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import { configPublishSchema } from '@/lib/schemas';
import type { ConfigLayer, ConfigValidateResult, JsonObject } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';
import { type ChangeLine, describeChanges } from './config-changes';
import { configKeys, fetchLayerVersions, useContentStrings, useLayerInheritance } from './config-data';
import { cloneJson, deepMerge, getPath, jsonEqual, leafPaths } from './config-doc';
import { changedIntegrityKeys } from './config-keys';
import { formatNumber, formatSettingValue, isUnknownPath, keyForPath, PROFILE_FIELDS, profileLabel, type SectionId } from './config-meta';
import { ConfigPhonePreview } from './config-phone-preview';
import { type FieldIssue, serverIssues, validateLayer } from './config-validation';
import { type EditorState, SensitiveBadge, SettingsEditor } from './settings-editor';

export { configKeys };

/** Where an issue sits, in words ("Location type “Shopping centre” · Size of the site area"). */
function issueLabel(path: string): string {
  const m = /^geofence\.profiles\.([^.]+)(?:\.(\w+))?$/.exec(path);
  if (m) {
    const f = PROFILE_FIELDS.find((x) => x.name === m[2]);
    const field = f ? ` · ${f.label}` : m[2] === 'prompt_checkin_on_arrival' ? ' · Check in outside first' : '';
    return `Location type “${profileLabel(m[1] ?? '')}”${field}`;
  }
  const fm = /^features\.([^.]+)$/.exec(path);
  if (fm) return `Feature “${humanLabel(fm[1] ?? '')}”`;
  const k = keyForPath(path);
  return k ? k.label : 'A setting the app doesn’t recognise';
}

/** Every value set in a saved version, in words ("Photo quality: 85%"). */
function valueLines(values: JsonObject): { path: string; label: string; value: string }[] {
  return leafPaths(values).map((path) => {
    const v = getPath(values, path);
    const pf = /^geofence\.profiles\.[^.]+\.(\w+)$/.exec(path);
    const field = pf ? PROFILE_FIELDS.find((f) => f.name === pf[1]) : undefined;
    const value = field && typeof v === 'number' ? formatNumber(v, field.unit) : formatSettingValue(keyForPath(path), v);
    return { path, label: issueLabel(path), value };
  });
}

/** One sentence on who must approve security changes here. */
function fourEyesSentence(layer: ConfigLayer): string {
  if (layer === 'bank') return 'This bank needs a second person to approve changes that affect security.';
  if (layer === 'global') return 'Changes for everyone that affect security need a second person to approve them.';
  return 'A second person must approve changes here that affect security.';
}

function ChangeIcon({ kind }: { kind: ChangeLine['kind'] }) {
  const cls = 'mt-1 size-4 shrink-0 text-muted-foreground';
  if (kind === 'added') return <Plus className={cls} />;
  if (kind === 'removed') return <Undo2 className={cls} />;
  if (kind === 'set') return <Pencil className={cls} />;
  return <ArrowRight className={cls} />;
}

export function ChangeList({ changes, advanced }: { changes: ChangeLine[]; advanced: boolean }) {
  return (
    <ul className="space-y-1">
      {changes.map((c) => (
        <li key={c.id} className={cn('flex items-start gap-2 rounded-md px-2 py-1.5', c.integrity && 'bg-amber-50')}>
          <ChangeIcon kind={c.kind} />
          <span className="min-w-0 flex-1">
            <span className="text-base">{c.text}</span>
            {advanced ? <span className="block break-all font-mono text-xs text-muted-foreground">{c.path}</span> : null}
          </span>
          {c.integrity ? <SensitiveBadge /> : null}
        </li>
      ))}
    </ul>
  );
}

function PublishConfigDialog({
  open,
  onOpenChange,
  layer,
  subjectId,
  subjectName,
  values,
  changes,
  integrityCount,
  fourEyes,
  advanced,
  onValidationErrors,
  onApprovalRequired,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layer: ConfigLayer;
  subjectId: string | null;
  subjectName: string;
  values: JsonObject;
  changes: ChangeLine[];
  integrityCount: number;
  fourEyes: boolean | null;
  advanced: boolean;
  onValidationErrors: (issues: FieldIssue[]) => void;
  onApprovalRequired: (info: { approvalId: string; keys: string[] }) => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const needsApproval = fourEyes === true && integrityCount > 0;

  const publish = useMutation({
    mutationFn: () => {
      const parsed = configPublishSchema.safeParse({
        layer,
        ...(subjectId ? { subject_id: subjectId } : {}),
        values,
        reason,
        ...(fromDateTimeLocalValue(from) ? { effective_from: fromDateTimeLocalValue(from) } : {}),
      });
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
      return adminApi.config.publish(parsed.data);
    },
    onSuccess: async (res) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['config'] }), queryClient.invalidateQueries({ queryKey: ['approvals'] })]);
      if (isApprovalRequired(res.data)) {
        const keys = res.data.changed_integrity_keys ?? [];
        toast.success('Sent for approval.', { description: 'A second person must approve it before it takes effect.' });
        onApprovalRequired({ approvalId: res.data.approval_id, keys });
      } else {
        const startsAt = res.data.version.effective_from;
        const starts = Date.parse(startsAt);
        if (Number.isFinite(starts) && starts > Date.now()) {
          toast.success('Changes saved.', { description: `They start on ${formatDateTime(startsAt)}. Phones get them the first time they sync after that.` });
        } else {
          toast.success('Changes saved. They’re live now.', { description: 'Phones get the new settings the next time they sync.' });
        }
      }
      setReason('');
      setFrom('');
      onOpenChange(false);
    },
    onError: (e) => {
      if (isApiError(e, 'VALIDATION_FAILED')) {
        onValidationErrors(serverIssues(e.issues));
        onOpenChange(false);
        return;
      }
      setError(e);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (publish.isPending) return;
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Save these changes for {subjectName}?</DialogTitle>
          <DialogDescription>Phones get the new settings the next time they sync. Say why you’re making the change; it’s kept in the activity history.</DialogDescription>
        </DialogHeader>
        <div className="max-h-64 overflow-y-auto rounded-md border p-2">
          {changes.length ? <ChangeList changes={changes} advanced={advanced} /> : <p className="p-2 text-sm text-muted-foreground">No changes.</p>}
        </div>
        {integrityCount > 0 ? (
          <Alert variant="warning">
            <ShieldAlert />
            <AlertTitle>{integrityCount === 1 ? 'This change affects security' : `${integrityCount} of these changes affect security`}</AlertTitle>
            <AlertDescription>
              {fourEyes === true
                ? layer === 'bank'
                  ? 'This bank needs a second person to approve this change. It takes effect once they approve it.'
                  : 'A second person must approve this change before it takes effect.'
                : fourEyes === false
                  ? 'No second approval is needed here, so it takes effect straight away.'
                  : 'If a second approval is needed here, the change waits until a second person approves it.'}
            </AlertDescription>
          </Alert>
        ) : null}
        <FormField label="Reason" htmlFor="cfg-reason" required error={fieldError}>
          <Textarea id="cfg-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this changing?" className="text-base" />
        </FormField>
        <FormField label="Start time (South African time)" htmlFor="cfg-from" hint="Leave it empty to start straight away.">
          <Input id="cfg-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 text-base" />
        </FormField>
        <ApiErrorAlert error={error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={publish.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={publish.isPending}
            onClick={() => {
              if (!reason.trim()) return setFieldError('Say why you’re making this change.');
              setFieldError(null);
              publish.mutate();
            }}
          >
            <Save /> {needsApproval ? 'Send for approval' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One layer/subject: typed settings editor with inheritance, live phone preview, plain-language changes, publish, history. */
export function LayerPanel({
  layer,
  subjectId,
  canPublish,
  subjectLabel,
  subjectName,
}: {
  layer: ConfigLayer;
  subjectId: string | null;
  canPublish: boolean;
  /** Heading: "Settings for everyone", "Settings for Bank ABC". */
  subjectLabel: string;
  /** Who the settings are for, in words: "everyone", "Bank ABC", the agent's name, "this phone". */
  subjectName: string;
}) {
  const advanced = useIsAdvanced();
  const versions = useQuery({ queryKey: configKeys.versions(layer, subjectId), queryFn: () => fetchLayerVersions(layer, subjectId) });
  const current = versions.data?.[0];
  const baseline = useMemo<JsonObject>(() => current?.values ?? {}, [current]);
  const inheritance = useLayerInheritance(layer, subjectId);
  const strings = useContentStrings();

  const [doc, setDoc] = useState<JsonObject>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [jsonDraft, setJsonDraft] = useState<string | null>(null);
  const [tab, setTab] = useState<'settings' | 'json'>('settings');
  const [validation, setValidation] = useState<{ forDoc: string; result: ConfigValidateResult } | null>(null);
  const [publishIssues, setPublishIssues] = useState<{ forDoc: string; issues: FieldIssue[] } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [showLineDiff, setShowLineDiff] = useState(false);
  const [pendingNotice, setPendingNotice] = useState<{ approvalId: string; keys: string[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('availability');
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Load the current values into the editor on first load and whenever a new version becomes current.
  useEffect(() => {
    if (versions.isPending || versions.error) return;
    const marker = current?.id ?? 'none';
    if (loadedFor === marker) return;
    setDoc(cloneJson(current?.values ?? {}));
    setJsonDraft(null);
    setLoadedFor(marker);
    setValidation(null);
    setPublishIssues(null);
  }, [versions.isPending, versions.error, current, loadedFor]);

  const update = useCallback((next: JsonObject) => {
    setDoc(next);
    setJsonDraft(null);
  }, []);

  const docKey = useMemo(() => JSON.stringify(doc), [doc]);
  const effective = useMemo(() => deepMerge(inheritance.inherited, doc), [inheritance.inherited, doc]);
  const clientIssues = useMemo(() => validateLayer(doc, effective), [doc, effective]);
  const issues = useMemo(() => {
    const all = [
      ...clientIssues,
      ...(validation?.forDoc === docKey ? serverIssues(validation.result.errors) : []),
      ...(publishIssues?.forDoc === docKey ? publishIssues.issues : []),
    ];
    const seen = new Set<string>();
    return all.filter((i) => {
      const id = `${i.path}|${i.message}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [clientIssues, validation, publishIssues, docKey]);
  const changes = useMemo(() => describeChanges(baseline, doc, inheritance.inherited, layer), [baseline, doc, inheritance.inherited, layer]);
  const integrityChanges = useMemo(() => changedIntegrityKeys(baseline, doc), [baseline, doc]);
  const unknownPaths = useMemo(() => leafPaths(doc).filter(isUnknownPath), [doc]);

  const validate = useMutation({
    mutationFn: (v: JsonObject) => adminApi.config.validate({ values: v }),
    onSuccess: (res, v) => setValidation({ forDoc: JSON.stringify(v), result: res }),
  });

  const ctx: EditorState = {
    layer,
    subjectName,
    doc,
    baseline,
    inherited: inheritance.inherited,
    effective,
    sourceOf: inheritance.sourceOf,
    issues,
    advanced,
    update,
    selectedProfile,
    onSelectProfile: setSelectedProfile,
  };

  if (versions.error) return <ApiErrorAlert error={versions.error} onRetry={() => void versions.refetch()} />;
  if (versions.isPending || loadedFor === null || inheritance.isPending) return <Skeleton className="h-96 w-full" />;

  const dirty = !jsonEqual(doc, baseline);
  const activeTab = advanced ? tab : 'settings';
  const jsonText = jsonDraft ?? stringifyJson(doc);
  const jsonParse = jsonDraft === null ? null : parseJsonText(jsonDraft, { requireObject: true });
  const jsonBroken = jsonParse !== null && !jsonParse.ok;
  const serverResult = validation?.forDoc === docKey ? validation.result : null;
  const selectedVersion = versions.data.find((v) => v.id === selected);
  const scheduled = current && Date.parse(current.effective_from) > Date.now();
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  const preview = (
    <ConfigPhonePreview
      values={effective}
      section={activeSection}
      strings={strings}
      selectedProfile={selectedProfile}
      onSelectProfile={setSelectedProfile}
      bankName={inheritance.bankName}
    />
  );

  // Container query (not a media query): at the larger text sizes the editor needs more room, so the preview moves into a
  // drawer sooner. The phone itself is fixed-size, hence the fixed-width column.
  return (
    <div className="@container">
    <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_344px]">
      <div className="min-w-0 space-y-5">
        {/* Where these settings stand */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{subjectLabel}</span>
            {current ? (
              <Badge tone={scheduled ? 'info' : 'success'} className="px-2 text-sm">
                {scheduled ? 'Latest changes start later' : 'Live'}
                {advanced ? ` · version ${current.version}` : ''}
              </Badge>
            ) : (
              <Badge tone="muted" className="px-2 text-sm">
                {layer === 'global' ? 'Nothing changed yet, so the default settings apply' : `Nothing set for ${subjectName} yet, so the general settings apply`}
              </Badge>
            )}
            {inheritance.fourEyes !== null ? (
              <SimpleTooltip content={inheritance.fourEyes ? fourEyesSentence(layer) : 'Changes here take effect without a second approval.'}>
                <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Badge tone={inheritance.fourEyes ? 'warning' : 'neutral'} className="px-2 text-sm font-normal">
                    <ShieldCheck /> {inheritance.fourEyes ? 'Second approval needed' : 'No second approval needed'}
                  </Badge>
                </span>
              </SimpleTooltip>
            ) : null}
          </div>
          {current ? (
            <p className="text-sm text-muted-foreground">
              {scheduled ? 'Starts' : 'Live since'} <DateTime value={current.effective_from} /> · changed by <UserName id={current.set_by} fallback="System" />
              {current.approved_by ? (
                <>
                  {' '}
                  · approved by <UserName id={current.approved_by} />
                </>
              ) : null}
            </p>
          ) : null}
          {layer !== 'global' ? (
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              Anything not set here comes from:
              <Badge tone="outline">Default settings</Badge>
              {inheritance.above.map((l) => (
                <span key={l.layer} className="inline-flex items-center gap-1.5">
                  <ArrowRight className="size-3.5" />
                  <Badge tone="outline">
                    Settings for {l.label}
                    {advanced ? ` (version ${l.version})` : ''}
                  </Badge>
                </span>
              ))}
            </p>
          ) : null}
          {inheritance.bankChoice ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">This agent works for more than one bank. Show the settings of</span>
              <Select value={inheritance.bankChoice.value ?? undefined} onValueChange={inheritance.bankChoice.onChange}>
                <SelectTrigger className="h-9 w-56" aria-label="Bank whose settings are shown">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {inheritance.bankChoice.options.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        {inheritance.error ? (
          <ApiErrorAlert error={inheritance.error} title="Couldn’t load the other settings that apply here, so the defaults are shown instead." onRetry={inheritance.refetch} />
        ) : null}

        {pendingNotice ? (
          <Alert variant="info">
            <ShieldCheck />
            <AlertTitle>Sent for approval</AlertTitle>
            <AlertDescription>
              A second person must approve {pendingNotice.keys.length ? `the change to ${pendingNotice.keys.map(issueLabel).join(', ')}` : 'this change'} before it takes
              effect. You can follow it under &ldquo;Waiting for approval&rdquo; below.
              {advanced ? (
                <>
                  {' '}
                  Approval request ID: <code>{pendingNotice.approvalId}</code>.
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Action bar */}
        <Card className="sticky top-16 z-20">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {dirty ? (
                <Badge tone="warning" className="px-2 text-sm">
                  {changes.length} unsaved {plural(changes.length, 'change', 'changes')}
                </Badge>
              ) : (
                <span className="text-muted-foreground">No unsaved changes</span>
              )}
              {issues.length > 0 ? (
                <Badge tone="danger" className="px-2 text-sm">
                  {issues.length} {plural(issues.length, 'problem', 'problems')} to fix
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" className="@4xl:hidden" onClick={() => setPreviewOpen(true)}>
                <Smartphone /> Phone preview
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={!dirty}
                onClick={() => {
                  update(cloneJson(baseline));
                  setValidation(null);
                  setPublishIssues(null);
                }}
              >
                <RotateCcw /> Discard changes
              </Button>
              <Button type="button" variant="outline" disabled={jsonBroken} loading={validate.isPending} onClick={() => validate.mutate(doc)}>
                {validate.isPending ? null : <CheckCircle2 />} Check my changes
              </Button>
              {canPublish ? (
                <Button type="button" disabled={!dirty || issues.length > 0 || jsonBroken} onClick={() => setPublishOpen(true)}>
                  <Save /> Save changes…
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
        {!canPublish ? (
          <p className="text-sm text-muted-foreground">
            {layer === 'global' ? 'Only admins who look after all banks can change the settings for everyone.' : 'You don’t have permission to change these settings.'} You can
            try out changes and check them, but you can’t save them.
          </p>
        ) : null}

        {validate.error ? <ApiErrorAlert error={validate.error} title="Couldn’t check your changes. Try again." /> : null}
        {serverResult ? (
          serverResult.ok ? (
            <Alert variant="success">
              <CheckCircle2 />
              <AlertTitle>Your changes look good</AlertTitle>
              {serverResult.integrity_relevant_keys.length > 0 ? (
                <AlertDescription>
                  Settings here that affect security: {[...new Set(serverResult.integrity_relevant_keys.map((p) => issueLabel(p.replace(/^\//, '').replace(/\//g, '.'))))].join(', ')}.
                </AlertDescription>
              ) : null}
            </Alert>
          ) : null
        ) : validation ? (
          <p className="text-sm text-muted-foreground">You’ve made more changes since the last check.</p>
        ) : null}
        {issues.length > 0 ? (
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertTitle>
              Fix {issues.length} {plural(issues.length, 'problem', 'problems')} before saving
            </AlertTitle>
            <AlertDescription>
              <ul className="mt-1 space-y-0.5 text-sm">
                {issues.slice(0, 8).map((i) => (
                  <li key={`${i.path}|${i.message}`}>
                    <span className="font-medium">{issueLabel(i.path)}:</span> {i.message}
                    {advanced ? <code className="ml-1 text-xs">({i.path})</code> : null}
                  </li>
                ))}
                {issues.length > 8 ? <li>…and {issues.length - 8} more</li> : null}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {advanced ? (
          <Tabs value={activeTab} onValueChange={(v) => setTab(v as 'settings' | 'json')}>
            <TabsList>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="json">Edit as JSON</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        {activeTab === 'json' ? (
          <Card>
            <CardContent className="space-y-2 pt-4">
              <p className="text-sm text-muted-foreground">
                Only the settings for {subjectName}, as JSON. This stays in step with the Settings tab: a valid edit here updates the settings, and changes there
                rewrite this text.
              </p>
              <JsonEditor value={jsonText} onChange={(text) => {
                setJsonDraft(text);
                const r = parseJsonText(text, { requireObject: true });
                if (r.ok && isPlainObject(r.value)) setDoc(r.value as JsonObject);
              }} requireObject rows={24} id="config-json" />
            </CardContent>
          </Card>
        ) : (
          <>
            {jsonBroken ? (
              <Alert variant="warning">
                <ShieldAlert />
                <AlertTitle>The JSON text has a mistake</AlertTitle>
                <AlertDescription>
                  The settings below show the last version that worked.{' '}
                  <Button type="button" variant="link" className="h-auto p-0" onClick={() => setJsonDraft(null)}>
                    Throw away the JSON edits
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {unknownPaths.length > 0 ? (
              <Alert variant="warning">
                <ShieldAlert />
                <AlertTitle>
                  {unknownPaths.length === 1 ? 'There’s 1 setting here the app doesn’t recognise' : `There are ${unknownPaths.length} settings here the app doesn’t recognise`}
                </AlertTitle>
                <AlertDescription>
                  {advanced ? (
                    <>
                      They’re kept as they are, but saving will fail until they’re removed: <code>{unknownPaths.join(', ')}</code>. Remove them in &ldquo;Edit as
                      JSON&rdquo;.
                    </>
                  ) : (
                    'They’re kept as they are, but saving will fail until they’re removed. Switch to Advanced view to remove them.'
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            <SettingsEditor ctx={ctx} activeSection={activeSection} onActiveSection={setActiveSection} />
          </>
        )}

        {/* Changes in plain words */}
        <section className="space-y-2">
          <SectionTitle
            action={
              integrityChanges.length > 0 ? (
                <Badge tone="warning">
                  <ShieldAlert /> {integrityChanges.length} {plural(integrityChanges.length, 'affects', 'affect')} security
                </Badge>
              ) : null
            }
          >
            Changes to save
            {advanced ? (current ? ` (compared with version ${current.version})` : ' (nothing saved here yet)') : ''}
          </SectionTitle>
          <Card>
            <CardContent className="space-y-3 pt-4">
              {changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No changes yet. Anything you change above is listed here before you save it.</p>
              ) : (
                <ChangeList changes={changes} advanced={advanced} />
              )}
              {advanced ? (
                <div className="space-y-2 border-t pt-3">
                  <Button type="button" variant="ghost" onClick={() => setShowLineDiff((v) => !v)}>
                    <FileDiff /> {showLineDiff ? 'Hide the line-by-line comparison' : 'Show a line-by-line comparison'}
                  </Button>
                  {showLineDiff ? (
                    <LineDiffView before={baseline} after={doc} beforeLabel={current ? `Version ${current.version} (live)` : 'Nothing saved yet'} afterLabel="Your changes" />
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        {/* History */}
        <section className="space-y-2">
          <SectionTitle>Earlier changes</SectionTitle>
          {versions.data.length > 0 ? <p className="-mt-1 text-sm text-muted-foreground">Click a row to see what was set, or to start again from it.</p> : null}
          <Card className="overflow-hidden">
            {versions.data.length === 0 ? (
              <EmptyState title="Nothing saved yet" description="Each time someone saves changes here, they’re listed with who made them and why." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {advanced ? <TableHead>Version</TableHead> : null}
                    <TableHead>Starts</TableHead>
                    <TableHead>Changed by</TableHead>
                    <TableHead>Approved by</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.data.map((v) => (
                    <TableRow key={v.id} onClick={() => setSelected(selected === v.id ? null : v.id)} className={cn('cursor-pointer', selected === v.id && 'bg-primary/5')}>
                      {advanced ? <TableCell className="font-medium tabular-nums">v{v.version}</TableCell> : null}
                      <TableCell className="text-sm">
                        <DateTime value={v.effective_from} />
                      </TableCell>
                      <TableCell className="text-sm">
                        <UserName id={v.set_by} fallback="System" />
                      </TableCell>
                      <TableCell className="text-sm">
                        <UserName id={v.approved_by} fallback="—" />
                      </TableCell>
                      <TableCell className="max-w-md text-sm">{v.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
          {selectedVersion ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base">
                  What was set from <DateTime value={selectedVersion.effective_from} />
                  {advanced ? ` (version ${selectedVersion.version})` : ''}
                </CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    update(cloneJson(selectedVersion.values));
                    setValidation(null);
                    setPublishIssues(null);
                    toast.success('Loaded into the editor.', { description: 'Check the settings, then save to use them again.' });
                  }}
                >
                  Start from this version
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.keys(selectedVersion.values).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing was set in this version.</p>
                ) : (
                  <ul className="divide-y divide-divider text-sm">
                    {valueLines(selectedVersion.values).map((l) => (
                      <li key={l.path} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5">
                        <span className="text-muted-foreground">{l.label}</span>
                        <span className="font-medium">{l.value}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Details>
                  <JsonView value={selectedVersion.values} defaultExpandDepth={1} maxHeight={360} />
                </Details>
              </CardContent>
            </Card>
          ) : null}
        </section>

        <PublishConfigDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          layer={layer}
          subjectId={subjectId}
          subjectName={subjectName}
          values={doc}
          changes={changes}
          integrityCount={integrityChanges.length}
          fourEyes={inheritance.fourEyes}
          advanced={advanced}
          onValidationErrors={(list) => {
            setPublishIssues({ forDoc: docKey, issues: list });
            toast.error('Couldn’t save the settings.', { description: 'Some values aren’t allowed. Fix the problems shown next to each setting and try again.' });
          }}
          onApprovalRequired={setPendingNotice}
        />
      </div>

      <aside className="hidden @4xl:block" aria-label="Phone preview">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-4">{preview}</div>
      </aside>
    </div>
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent size="sm" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Phone preview</SheetTitle>
            <SheetDescription>How your changes look on an agent&apos;s phone.</SheetDescription>
          </SheetHeader>
          <SheetBody>{preview}</SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
