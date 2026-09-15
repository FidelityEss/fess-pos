'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileDiff, FlaskConical, Loader2, RotateCcw, Send } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { JsonEditor, parseJsonText, stringifyJson } from '@/components/json-editor';
import { useNextStepToast } from '@/components/next-step';
import { LineDiffView } from '@/components/ops/diff';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { adminApi, errorMessage, isApiError, isApprovalRequired } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import { upsertDefinitionDraft, useBankLookup } from '@/lib/hooks';
import { useStaff } from '@/lib/staff';
import type { AnalyseResult, DefinitionFamily, JsonObject } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';
import { AnalysisResultView, asAnalyseResult } from './analysis-result';
import { defKeys, familyTabHref, fetchDraft, fetchVersion, templateFor, type VersionLite } from './definitions-data';
import { useStudioRefs } from './studio/bundle';
import type { Update } from './studio/shared';
import { DefinitionWorkspace } from './studio/workspace';

const AUTOSAVE_MS = 1500;

/** Key-order-insensitive serialisation of a JSON value. */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Content fingerprint of JSON text (the raw text when it doesn't parse, so edits to broken JSON still count). */
function contentKey(text: string | null): string | null {
  if (text === null) return null;
  try {
    return canonicalJson(JSON.parse(text));
  } catch {
    return `raw:${text}`;
  }
}

type Origin = 'draft' | 'latest' | 'template';

/** Publish confirmation: analysis summary (fresh), optional note, 201 / 202 / 422 handling. */
function PublishDialog({
  open,
  onOpenChange,
  family,
  definition,
  analysis,
  analysing,
  analyseError,
  onPublished,
  relatedForm,
  previousDoc,
  nextVersion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  family: DefinitionFamily;
  definition: JsonObject | null;
  analysis: Partial<AnalyseResult> | null;
  analysing: boolean;
  analyseError: unknown;
  onPublished: (versionId: string | null) => void;
  relatedForm?: unknown;
  /** The newest published version's document (names what's removed). */
  previousDoc?: unknown;
  /** The number the new version will get. */
  nextVersion: number;
}) {
  const advanced = useIsAdvanced();
  const queryClient = useQueryClient();
  const nextStep = useNextStepToast();
  const bankLookup = useBankLookup();
  const bankName = family.scope === 'global' ? null : (bankLookup(family.bank_id)?.name ?? null);
  const [note, setNote] = useState('');
  const [refusal, setRefusal] = useState<Partial<AnalyseResult> | null>(null);
  const [error, setError] = useState<unknown>(null);

  const publish = useMutation({
    mutationFn: () => adminApi.definitions.publish(family.id, { definition: definition ?? undefined, note: note.trim() || undefined }),
    onSuccess: async (res) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: defKeys.all }),
        queryClient.invalidateQueries({ queryKey: defKeys.approvals }),
      ]);
      if (isApprovalRequired(res.data)) {
        toast.success('Sent for a second approval', { description: 'Another admin must approve it before it’s published.' });
        onPublished(null);
      } else {
        nextStep(
          `Version ${res.data.version.version} published.`,
          { label: bankName ? `Make it live for ${bankName}` : 'Make it live', href: familyTabHref(family.id, 'activations') },
          'Agents only see it once you make it live.',
        );
        onPublished(res.data.version.id);
      }
      setNote('');
      onOpenChange(false);
    },
    onError: (e) => {
      const details = isApiError(e, 'VALIDATION_FAILED') ? asAnalyseResult(e.details) : null;
      setRefusal(details);
      setError(details ? null : e);
    },
  });

  const shown = refusal ?? analysis;
  const canPublish = !!definition && !analysing && !!analysis && analysis.ok === true && (analysis.tests?.passed ?? true) && !refusal;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (publish.isPending) return;
        if (!o) {
          setRefusal(null);
          setError(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Publish “{family.title}”</DialogTitle>
          <DialogDescription>
            {advanced
              ? `Publishing records a version that never changes, with its fingerprint (hash), for ${family.kind}/${family.key}. Agents only see it once you make it live.`
              : `Publishing saves this as version ${nextVersion}, which can never be changed. Nothing changes for agents until you make it live.`}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
          {analysing ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking the draft and the example answers…
            </p>
          ) : analyseError ? (
            <ApiErrorAlert error={analyseError} title="Couldn’t check the draft" />
          ) : shown ? (
            <>
              {refusal ? (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>It couldn’t be published</AlertTitle>
                  <AlertDescription>Fix the problems below, check again, then publish.</AlertDescription>
                </Alert>
              ) : null}
              <AnalysisResultView result={shown} doc={definition} relatedForm={relatedForm} previousDoc={previousDoc} />
            </>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="publish-note">
              Note <span className="text-muted-foreground">(optional: what changed and why)</span>
            </Label>
            <Textarea id="publish-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed and why" />
          </div>
          <ApiErrorAlert error={error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={publish.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => publish.mutate()} disabled={!canPublish} loading={publish.isPending}>
            <Send /> Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Draft editor: JSON bound to pos.definition_drafts with debounced autosave, analysis, diff vs latest, and publish. */
export function DraftEditor({
  family,
  versions,
  canEdit,
  openPublishSignal = 0,
}: {
  family: DefinitionFamily;
  versions: VersionLite[];
  canEdit: boolean;
  /** Bump to open the publish dialog from outside (the page's "Publish the changes…" next step). */
  openPublishSignal?: number;
}) {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const refs = useStudioRefs(family);
  const queryClient = useQueryClient();
  const latest = versions[0];
  const draftQ = useQuery({ queryKey: defKeys.draft(family.id), queryFn: () => fetchDraft(family.id) });
  const latestQ = useQuery({
    queryKey: defKeys.version(latest?.id ?? ''),
    queryFn: () => fetchVersion(latest?.id ?? ''),
    enabled: !!latest,
    staleTime: Infinity,
  });

  const [initialised, setInitialised] = useState(false);
  const [origin, setOrigin] = useState<Origin>('template');
  const [text, setText] = useState('');
  const [savedText, setSavedText] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [analysis, setAnalysis] = useState<Partial<AnalyseResult> | null>(null);
  const [analysedText, setAnalysedText] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const saveSeq = useRef(0);

  // Initialise once: the saved draft, else a copy of the latest version, else a minimal template for the kind.
  useEffect(() => {
    if (initialised || draftQ.isPending || draftQ.error) return;
    if (draftQ.data) {
      const t = stringifyJson(draftQ.data.definition);
      setText(t);
      setSavedText(t);
      setSavedAt(draftQ.data.updated_at);
      setBaseId(draftQ.data.base_version_id);
      setOrigin('draft');
      setInitialised(true);
      return;
    }
    // A starting copy counts as the clean baseline, so merely opening the studio never creates a draft row.
    if (latest) {
      if (latestQ.isPending) return;
      if (latestQ.data) {
        const t = stringifyJson(latestQ.data.definition);
        setText(t);
        setSavedText(t);
        setBaseId(latestQ.data.id);
        setOrigin('latest');
        setInitialised(true);
        return;
      }
    }
    const t = stringifyJson(templateFor(family.kind, family.key, family.title));
    setText(t);
    setSavedText(t);
    setBaseId(null);
    setOrigin('template');
    setInitialised(true);
  }, [initialised, draftQ.isPending, draftQ.error, draftQ.data, latest, latestQ.isPending, latestQ.data, family.kind, family.key, family.title]);

  const parsed = useMemo(() => parseJsonText(text, { requireObject: true }), [text]);
  const definition = parsed.ok && isPlainObject(parsed.value) ? (parsed.value as JsonObject) : null;
  // Dirty = the content differs, not the text: the structured editors re-serialise the document (key order can change),
  // and that alone must never count as an edit — otherwise just opening a family would autosave a draft row.
  const textKey = useMemo(() => contentKey(text), [text]);
  const savedKey = useMemo(() => contentKey(savedText), [savedText]);
  const dirty = initialised && textKey !== savedKey;
  const kindMismatch = definition && definition.kind !== family.kind;

  // The structured editors edit the same document the JSON text holds: each edit is applied to the latest document and
  // re-serialised, so autosave, analysis and publish work unchanged and unknown properties are carried through.
  const docRef = useRef<JsonObject | null>(null);
  docRef.current = definition;
  const lastValid = useRef<JsonObject | null>(null);
  if (definition) lastValid.current = definition;
  const update = useCallback<Update>((fn) => {
    const cur = docRef.current;
    if (!cur) return;
    const next = fn(cur) as JsonObject;
    docRef.current = next;
    setText(stringifyJson(next));
  }, []);
  const relatedForm = family.kind === 'flow' && definition && typeof definition.form_family === 'string' ? refs.bundle.forms?.[definition.form_family] : undefined;

  async function save(snapshot: string, doc: JsonObject, base: string | null) {
    const seq = ++saveSeq.current;
    setSaving(true);
    setSaveError(null);
    try {
      const row = await upsertDefinitionDraft({ family_id: family.id, definition: doc, base_version_id: base, updated_by: staff.me.id });
      if (seq !== saveSeq.current) return;
      setSavedText(snapshot);
      setSavedAt(row.updated_at);
      setOrigin('draft');
      queryClient.setQueryData(defKeys.draft(family.id), row);
      void queryClient.invalidateQueries({ queryKey: defKeys.draftsLite });
    } catch (e) {
      if (seq === saveSeq.current) setSaveError(e);
    } finally {
      if (seq === saveSeq.current) setSaving(false);
    }
  }

  // Debounced autosave ~1.5 s after the last edit, only when the JSON parses to an object.
  useEffect(() => {
    if (!initialised || !canEdit || !dirty || !definition) return;
    const t = setTimeout(() => void save(text, definition, baseId), AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save is stable enough; re-arming on text/base is the intent
  }, [text, baseId, initialised, canEdit, dirty]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const analyse = useMutation({
    mutationFn: (doc: JsonObject) => adminApi.definitions.analyse(family.id, { definition: doc }),
    onSuccess: (res, _doc) => {
      setAnalysis(res);
    },
  });

  function runAnalysis(): void {
    if (!definition) return;
    // Drop the previous result so a failed re-run can never be mistaken for a fresh pass.
    setAnalysis(null);
    setAnalysedText(text);
    analyse.mutate(definition);
  }

  function openPublish() {
    if (!definition) return;
    if (analysedText !== text || !analysis) runAnalysis();
    setPublishOpen(true);
  }

  // "Publish the changes…" from the page header opens the same dialog, once the draft has loaded.
  const lastSignal = useRef(openPublishSignal);
  useEffect(() => {
    if (!initialised || openPublishSignal === lastSignal.current) return;
    lastSignal.current = openPublishSignal;
    if (canEdit) openPublish();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per signal
  }, [openPublishSignal, initialised]);

  function onPublished(versionId: string | null) {
    if (versionId && definition) {
      setBaseId(versionId);
      void save(text, definition, versionId);
    }
  }

  const baseVersion = baseId ? versions.find((v) => v.id === baseId) : undefined;
  const staleBase = origin === 'draft' && latest && baseId !== latest.id;
  const analysisStale = analysis !== null && analysedText !== text;

  if (draftQ.error) return <ApiErrorAlert error={draftQ.error} onRetry={() => void draftQ.refetch()} />;
  if (!initialised) return <Skeleton className="h-96 w-full" />;

  let status: ReactNode;
  if (!canEdit) status = <span className="text-muted-foreground">View only. You can’t change this one.</span>;
  else if (!parsed.ok) status = <span className="text-destructive">{advanced ? 'Not saved. Fix the JSON to save.' : 'Not saved: something in the draft is broken.'}</span>;
  else if (saving)
    status = (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  else if (saveError)
    status = (
      <span className="inline-flex items-center gap-2 text-destructive">
        Not saved: {errorMessage(saveError)}
        <Button type="button" size="sm" variant="outline" onClick={() => definition && void save(text, definition, baseId)}>
          Try again
        </Button>
      </span>
    );
  else if (dirty) status = <span className="text-amber-700">Unsaved changes</span>;
  else if (!savedAt)
    status = (
      <span className="text-muted-foreground">
        No changes yet. You’re looking at {origin === 'latest' ? `published version ${latest?.version ?? '?'}` : 'a blank starting point'}. Your changes save by
        themselves as a draft.
      </span>
    );
  else
    status = (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <CheckCircle2 className="size-3.5" /> Draft saved · {formatTime(savedAt)}
      </span>
    );

  return (
    <div className="space-y-4">
      {staleBase ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>A newer version was published after this draft started</AlertTitle>
          <AlertDescription>
            This draft started from {baseVersion ? `version ${baseVersion.version}` : 'an older version'}, and version {latest?.version} has been published
            since. Check what’s different before you publish{advanced ? ' (Compare)' : ''}, or start again from version {latest?.version}.
          </AlertDescription>
        </Alert>
      ) : null}
      {kindMismatch ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>This draft is the wrong type</AlertTitle>
          <AlertDescription>
            It can’t be checked or published until its <code>kind</code> is <code>{family.kind}</code>.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">{status}</div>
        <div className="flex flex-wrap items-center gap-2">
          {latest && advanced ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowDiff((v) => !v)} disabled={!definition}>
              <FileDiff /> {showDiff ? 'Hide the comparison' : `Compare with version ${latest.version}`}
            </Button>
          ) : null}
          {canEdit ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setResetOpen(true)}>
              <RotateCcw /> {latest ? `Start again from version ${latest.version}` : 'Start again'}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={runAnalysis} disabled={!definition} loading={analyse.isPending}>
            {analyse.isPending ? null : <FlaskConical />} Check
          </Button>
          {canEdit ? (
            <Button type="button" size="sm" onClick={openPublish} disabled={!definition || saving}>
              <Send /> Publish…
            </Button>
          ) : null}
        </div>
      </div>

      {analysis || analyse.error ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              Check results
              <span className="flex items-center gap-2">
                {analysisStale ? <span className="text-sm font-normal text-amber-700">Out of date: the draft has changed since. Check again.</span> : null}
                <Button type="button" size="sm" variant="ghost" onClick={() => setAnalysis(null)} disabled={analyse.isPending}>
                  Close
                </Button>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analyse.error ? (
              <ApiErrorAlert error={analyse.error} title="Couldn’t check the draft" />
            ) : analysis ? (
              <AnalysisResultView result={analysis} doc={definition} relatedForm={relatedForm} previousDoc={latestQ.data?.definition} onLocate={(target) => setSelected(target)} />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {showDiff && latest && advanced ? (
        latestQ.data ? (
          <LineDiffView before={latestQ.data.definition} after={definition ?? undefined} beforeLabel={`Version ${latest.version} (published)`} afterLabel="Draft" />
        ) : latestQ.error ? (
          <ApiErrorAlert error={latestQ.error} />
        ) : (
          <Skeleton className="h-40 w-full" />
        )
      ) : null}

      <DefinitionWorkspace
        family={family}
        doc={definition}
        previewDoc={definition ?? lastValid.current}
        update={canEdit ? update : undefined}
        readOnly={!canEdit}
        selected={selected}
        onSelect={setSelected}
        invalidJsonMessage={parsed.ok ? undefined : parsed.error.message}
        jsonEditor={<JsonEditor value={text} onChange={setText} requireObject rows={30} readOnly={!canEdit} label="Draft (JSON)" id="draft-json" />}
      />

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={latest ? `Start again from version ${latest.version}?` : 'Start again from a blank draft?'}
        description="Your current draft is replaced and saved straight away. Published versions don’t change."
        confirmLabel="Start again"
        destructive
        onConfirm={() => {
          if (latest && latestQ.data) {
            setText(stringifyJson(latestQ.data.definition));
            setBaseId(latestQ.data.id);
          } else {
            setText(stringifyJson(templateFor(family.kind, family.key, family.title)));
            setBaseId(null);
          }
          setAnalysis(null);
          setSelected(null);
        }}
      />
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        family={family}
        definition={definition}
        analysis={analysisStale ? null : analysis}
        analysing={analyse.isPending}
        analyseError={analyse.error}
        onPublished={onPublished}
        relatedForm={relatedForm}
        previousDoc={latestQ.data?.definition}
        nextVersion={(latest?.version ?? 0) + 1}
      />
    </div>
  );
}
