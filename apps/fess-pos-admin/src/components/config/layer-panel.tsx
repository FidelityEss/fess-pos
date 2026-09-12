'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, FileDiff, Pencil, Plus, RotateCcw, Send, ShieldAlert, ShieldCheck, Smartphone, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { DateTime } from '@/components/date-time';
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
import { adminApi, isApiError, isApprovalRequired } from '@/lib/api';
import { fromDateTimeLocalValue } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import { configPublishSchema } from '@/lib/schemas';
import type { ConfigLayer, ConfigValidateResult, JsonObject } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';
import { type ChangeLine, describeChanges } from './config-changes';
import { configKeys, fetchLayerVersions, useContentStrings, useLayerInheritance } from './config-data';
import { cloneJson, deepMerge, jsonEqual, leafPaths } from './config-doc';
import { changedIntegrityKeys } from './config-keys';
import { isUnknownPath, keyForPath, PROFILE_FIELDS, profileLabel, type SectionId } from './config-meta';
import { ConfigPhonePreview } from './config-phone-preview';
import { type FieldIssue, serverIssues, validateLayer } from './config-validation';
import { type EditorState, SensitiveBadge, SettingsEditor } from './settings-editor';

export { configKeys };

const LAYER_NAME: Record<ConfigLayer, string> = { global: 'everyone (global)', bank: 'this bank', agent: 'this agent', device: 'this device' };

/** Where an issue sits, in words ("Location type "Shopping centre" · Fence radius"). */
function issueLabel(path: string): string {
  const m = /^geofence\.profiles\.([^.]+)(?:\.(\w+))?$/.exec(path);
  if (m) {
    const f = PROFILE_FIELDS.find((x) => x.name === m[2]);
    const field = f ? ` · ${f.label}` : m[2] === 'prompt_checkin_on_arrival' ? ' · Check-in prompt' : '';
    return `Location type "${profileLabel(m[1] ?? '')}"${field}`;
  }
  const fm = /^features\.([^.]+)$/.exec(path);
  if (fm) return `Feature "${humanLabel(fm[1] ?? '')}"`;
  const k = keyForPath(path);
  return k ? k.label : `Unrecognised setting "${path}"`;
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
        toast.success("Sent for a second admin's approval", { description: `${keys.length || 'Some'} sensitive setting${keys.length === 1 ? '' : 's'} changed. It applies once another admin approves.` });
        onApprovalRequired({ approvalId: res.data.approval_id, keys });
      } else {
        toast.success(`Published version ${res.data.version.version}`, { description: 'Phones receive the new settings at their next sync.' });
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
          <DialogTitle>Publish settings for {LAYER_NAME[layer]}</DialogTitle>
          <DialogDescription>This saves a new version of this layer. Every change needs a reason and is recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="max-h-64 overflow-y-auto rounded-md border p-2">
          {changes.length ? <ChangeList changes={changes} advanced={advanced} /> : <p className="p-2 text-sm text-muted-foreground">No changes.</p>}
        </div>
        {integrityCount > 0 ? (
          <Alert variant="warning">
            <ShieldAlert />
            <AlertTitle>
              {integrityCount} security-sensitive change{integrityCount === 1 ? '' : 's'}
            </AlertTitle>
            <AlertDescription>
              {fourEyes === true
                ? "Four-eyes is on for this layer: the change waits for a second admin's approval before it applies."
                : fourEyes === false
                  ? 'Four-eyes is off for this layer: the change applies without a second approval.'
                  : "If four-eyes is on for this layer, the change waits for a second admin's approval."}
            </AlertDescription>
          </Alert>
        ) : null}
        <FormField label="Reason" htmlFor="cfg-reason" required error={fieldError}>
          <Textarea id="cfg-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this changing?" className="text-base" />
        </FormField>
        <FormField label="Starts from (SAST)" htmlFor="cfg-from" hint="Leave empty to apply straight away.">
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
              if (!reason.trim()) return setFieldError('A reason is required');
              setFieldError(null);
              publish.mutate();
            }}
          >
            <Send /> Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One layer/subject: typed settings editor with inheritance, live phone preview, plain-language changes, publish, history. */
export function LayerPanel({ layer, subjectId, canPublish, subjectLabel }: { layer: ConfigLayer; subjectId: string | null; canPublish: boolean; subjectLabel: string }) {
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
        {/* Where this layer stands */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{subjectLabel}</span>
            {current ? (
              <Badge tone={scheduled ? 'info' : 'success'} className="px-2 text-sm">
                {scheduled ? `Version ${current.version} starts later` : `Version ${current.version} is live`}
              </Badge>
            ) : (
              <Badge tone="muted" className="px-2 text-sm">
                No settings of its own yet: everything is inherited
              </Badge>
            )}
            {inheritance.fourEyes !== null ? (
              <Badge tone={inheritance.fourEyes ? 'warning' : 'neutral'} className="px-2 text-sm font-normal">
                <ShieldCheck /> Four-eyes {inheritance.fourEyes ? 'on' : 'off'}
              </Badge>
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
              Inherits from:
              <Badge tone="outline">Defaults</Badge>
              {inheritance.above.map((l) => (
                <span key={l.layer} className="inline-flex items-center gap-1.5">
                  <ArrowRight className="size-3.5" />
                  <Badge tone="outline">
                    {l.label} (v{l.version})
                  </Badge>
                </span>
              ))}
            </p>
          ) : null}
          {inheritance.bankChoice ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">This agent works for several banks. Show values inherited from</span>
              <Select value={inheritance.bankChoice.value ?? undefined} onValueChange={inheritance.bankChoice.onChange}>
                <SelectTrigger className="h-9 w-56" aria-label="Bank to inherit from">
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
          <ApiErrorAlert error={inheritance.error} title="Couldn't load the inherited values; defaults are shown instead" onRetry={inheritance.refetch} />
        ) : null}

        {pendingNotice ? (
          <Alert variant="info">
            <ShieldCheck />
            <AlertTitle>Waiting for a second admin</AlertTitle>
            <AlertDescription>
              The change{pendingNotice.keys.length ? ` to ${pendingNotice.keys.map(issueLabel).join(', ')}` : ''} applies once another admin approves it (see
              &ldquo;Waiting for approval&rdquo; below).
              {advanced ? (
                <>
                  {' '}
                  Request <code>{pendingNotice.approvalId}</code>.
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Action bar */}
        <Card className="sticky top-16 z-20 shadow-sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {dirty ? (
                <Badge tone="warning" className="px-2 text-sm">
                  {changes.length} unpublished change{changes.length === 1 ? '' : 's'}
                </Badge>
              ) : (
                <span className="text-muted-foreground">No unpublished changes</span>
              )}
              {issues.length > 0 ? (
                <Badge tone="danger" className="px-2 text-sm">
                  {issues.length} problem{issues.length === 1 ? '' : 's'} to fix
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
                {validate.isPending ? null : <CheckCircle2 />} Check with server
              </Button>
              {canPublish ? (
                <Button type="button" disabled={!dirty || issues.length > 0 || jsonBroken} onClick={() => setPublishOpen(true)}>
                  <Send /> Publish…
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
        {!canPublish ? (
          <p className="text-sm text-muted-foreground">
            {layer === 'global' ? 'Only admins for all banks can change the settings for everyone.' : 'This is outside your scope.'} You can try changes and check them,
            but not publish.
          </p>
        ) : null}

        {validate.error ? <ApiErrorAlert error={validate.error} title="The check could not be run" /> : null}
        {serverResult ? (
          serverResult.ok ? (
            <Alert variant="success">
              <CheckCircle2 />
              <AlertTitle>The server accepts these settings</AlertTitle>
              {serverResult.integrity_relevant_keys.length > 0 ? (
                <AlertDescription>
                  Security-sensitive settings on this layer: {[...new Set(serverResult.integrity_relevant_keys.map((p) => issueLabel(p.replace(/^\//, '').replace(/\//g, '.'))))].join(', ')}.
                </AlertDescription>
              ) : null}
            </Alert>
          ) : null
        ) : validation ? (
          <p className="text-sm text-muted-foreground">Changed since the last server check.</p>
        ) : null}
        {issues.length > 0 ? (
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertTitle>
              {issues.length} problem{issues.length === 1 ? '' : 's'} to fix before publishing
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
                Only the keys set on this layer. Stays in step with the Settings tab: a valid edit here updates the settings, and changes there rewrite this text.
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
                <AlertTitle>The JSON text has an error</AlertTitle>
                <AlertDescription>
                  The settings below show the last valid version.{' '}
                  <Button type="button" variant="link" className="h-auto p-0" onClick={() => setJsonDraft(null)}>
                    Discard the JSON edits
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {unknownPaths.length > 0 ? (
              <Alert variant="warning">
                <ShieldAlert />
                <AlertTitle>
                  This layer has {unknownPaths.length} setting{unknownPaths.length === 1 ? '' : 's'} the app doesn&apos;t recognise
                </AlertTitle>
                <AlertDescription>
                  {advanced ? (
                    <>
                      They are kept as they are, but the server will refuse them: <code>{unknownPaths.join(', ')}</code>. Remove them in &ldquo;Edit as JSON&rdquo;.
                    </>
                  ) : (
                    'They are kept as they are, but the server will refuse them. Switch to Advanced view to remove them.'
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
                  <ShieldAlert /> {integrityChanges.length} security-sensitive
                </Badge>
              ) : null
            }
          >
            Changes to publish {current ? `(compared with version ${current.version})` : '(this layer has no version yet)'}
          </SectionTitle>
          <Card>
            <CardContent className="space-y-3 pt-4">
              {changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No changes yet. What you change above is listed here in plain words before you publish.</p>
              ) : (
                <ChangeList changes={changes} advanced={advanced} />
              )}
              {advanced ? (
                <div className="space-y-2 border-t pt-3">
                  <Button type="button" variant="ghost" onClick={() => setShowLineDiff((v) => !v)}>
                    <FileDiff /> {showLineDiff ? 'Hide line diff' : 'Show line diff'}
                  </Button>
                  {showLineDiff ? (
                    <LineDiffView before={baseline} after={doc} beforeLabel={current ? `v${current.version} (current)` : 'Empty layer'} afterLabel="Editor" />
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        {/* History */}
        <section className="space-y-2">
          <SectionTitle>History</SectionTitle>
          <Card className="overflow-hidden">
            {versions.data.length === 0 ? (
              <EmptyState title="No versions yet" description="Publishing creates version 1 of this layer." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Starts</TableHead>
                    <TableHead>Changed by</TableHead>
                    <TableHead>Approved by</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.data.map((v) => (
                    <TableRow
                      key={v.id}
                      onClick={() => setSelected(selected === v.id ? null : v.id)}
                      className={cn('cursor-pointer hover:bg-slate-50', selected === v.id && 'bg-sky-50/60')}
                    >
                      <TableCell className="font-medium tabular-nums">v{v.version}</TableCell>
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
                <CardTitle className="text-base">Version {selectedVersion.version}: settings on this layer</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    update(cloneJson(selectedVersion.values));
                    setValidation(null);
                    setPublishIssues(null);
                    toast.success(`Version ${selectedVersion.version} loaded into the editor`, { description: 'Publish to make it live again.' });
                  }}
                >
                  Load into editor
                </Button>
              </CardHeader>
              <CardContent>
                <JsonView value={selectedVersion.values} defaultExpandDepth={1} maxHeight={360} />
              </CardContent>
            </Card>
          ) : null}
        </section>

        <PublishConfigDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          layer={layer}
          subjectId={subjectId}
          values={doc}
          changes={changes}
          integrityCount={integrityChanges.length}
          fourEyes={inheritance.fourEyes}
          advanced={advanced}
          onValidationErrors={(list) => {
            setPublishIssues({ forDoc: docKey, issues: list });
            toast.error('The server refused the settings', { description: 'The problems are shown next to the settings.' });
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
            <SheetDescription>How the settings being edited look on an agent&apos;s phone.</SheetDescription>
          </SheetHeader>
          <SheetBody>{preview}</SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
