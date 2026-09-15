'use client';

// Live phone preview of a definition (T3-23): forms, flows, views, content, job schemas and app definitions drawn inside
// a phone frame from the component catalogue, driven by the shared TS engine (rules, visibility, validation) so the
// preview behaves like the phone. Drafts render what is valid; the rest is listed as a gentle notice, never a crash.
// Interim until the embedded module web build (T3-12). The props below are the contract the definitions studio codes
// against — keep them backwards compatible (add optional props only).
import { RotateCcw, Search } from 'lucide-react';
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Details } from '@/components/details';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AppDefinition, FieldDef, FlowDefinition, FormDefinition, OptionDef, ViewItemDef } from '@/lib/engine';
import { useIsAdvanced } from '@/lib/preferences';
import { cn, isPlainObject } from '@/lib/utils';
import { AppScreen, appPageList } from './app-renderer';
import { ContentSnippets } from './content-preview';
import { FALLBACK_CORE_STRINGS } from './fallback-strings';
import { flowStepList, formForFlow, FlowScreen, stepId } from './flow-renderer';
import { type FormMode, FormScreen, sectionTitle } from './form-screen';
import { JobSchemaScreen } from './job-schema-preview';
import { lenientParse, type PreviewIssue } from './lenient-parse';
import { PhoneFrame, type PhoneTheme } from './phone-frame';
import { PAGE_X } from './phone-style';
import { PreviewNotice } from './phone-widgets';
import { type PreviewEnv, PreviewEnvProvider, type RenderFrame, scrollToAnchor } from './preview-context';
import { applySampleVariant, type PreviewContext, SAMPLE_JOB_VARIANTS, type SampleJobVariant, sampleJobList, samplePreviewContext, sampleReceipt } from './sample-context';
import { ViewItems } from './view-renderer';

export type PreviewKind = 'form' | 'flow' | 'view' | 'content' | 'job_schema' | 'app';

/** Option lists that `options_source` fields read (reason codes by category, lookup lists by key). */
export interface PreviewLists {
  lookup_lists?: Record<string, OptionDef[]>;
  reason_codes?: Record<string, OptionDef[]>;
}

/** Other definitions the previewed one refers to (views a page shows, the form a flow walks, content strings, …). */
export interface PreviewBundle {
  forms?: Record<string, unknown>;
  flows?: Record<string, unknown>;
  views?: Record<string, unknown>;
  jobSchema?: unknown;
  /** Merged content strings (global, then bank overrides). */
  strings?: Record<string, string>;
  /** Declarations by key (the text shown for declaration / consent components). */
  declarations?: Record<string, { title: string; text: string }>;
  /** Reason codes and lookup lists for `options_source` (optional; sample options are shown without them). */
  lists?: PreviewLists;
}

export interface DefinitionPreviewProps {
  kind: PreviewKind;
  /** The definition document (may be an in-progress draft; render what is valid, flag what is not). */
  definition: unknown;
  bundle?: PreviewBundle;
  /** Sample job/agent/stats; defaults to samplePreviewContext(). */
  context?: PreviewContext;
  theme?: PhoneTheme;
  /** Highlight / scroll to this element: a section key, field key, step id or page id. */
  focus?: string | null;
  className?: string;
  /** Hide the toolbar above the phone (page/step picker, sample job, reset). Default: shown. */
  showToolbar?: boolean;
  /** Phone screen height in px (default 640). */
  height?: number;
  /** Caption under the phone; false hides it. */
  caption?: ReactNode | false;
}

// ── Error boundary ───────────────────────────────────────────────────────────────────────────────

class PreviewErrorBoundary extends Component<{ resetKey: unknown; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidUpdate(prev: { resetKey: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">The preview couldn’t show this. Your draft is still saved.</p>
        <Details className="mt-1 text-xs">
          <p>{this.state.error.message}</p>
        </Details>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}

export function DefinitionPreview(props: DefinitionPreviewProps) {
  return (
    <PreviewErrorBoundary resetKey={props.definition}>
      <PreviewInner {...props} />
    </PreviewErrorBoundary>
  );
}

// ── Focus → which page / step / section to show ─────────────────────────────────────────────────

function fieldHas(fields: readonly FieldDef[] | undefined, key: string): boolean {
  return (fields ?? []).some((f) => f.key === key || fieldHas(f.fields, key));
}

function sectionFor(form: FormDefinition | null, key: string): string | null {
  if (!form) return null;
  return form.sections.find((s) => s.key === key || fieldHas(s.fields, key))?.key ?? null;
}

function focusTarget(kind: PreviewKind, def: Record<string, unknown> | null, focus: string, bundle: PreviewBundle | undefined): string | null {
  if (!def) return null;
  if (kind === 'form') return sectionFor(def as unknown as FormDefinition, focus);
  if (kind === 'app') return isPlainObject(def.pages) && focus in def.pages ? focus : null;
  if (kind === 'flow') {
    const flow = def as unknown as FlowDefinition;
    const byId = flow.steps.findIndex((s, i) => stepId(s, i) === focus);
    if (byId >= 0) return focus;
    const section = sectionFor(formForFlow(flow, bundle?.forms), focus);
    const i = section ? flow.steps.findIndex((s) => s.type === 'form' && s.sections?.includes(section)) : -1;
    return i >= 0 && flow.steps[i] ? stepId(flow.steps[i], i) : null;
  }
  return null;
}

// ── Toolbar (admin scale) ────────────────────────────────────────────────────────────────────────

function ToolbarSelect({ label, value, options, onChange, className }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (v: string) => void; className?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={cn('h-8 min-w-0 max-w-full text-xs', className)}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function IssuesNotice({ issues }: { issues: PreviewIssue[] }) {
  const advanced = useIsAdvanced();
  const [open, setOpen] = useState(false);
  if (issues.length === 0) return null;
  const shown = open ? issues : issues.slice(0, 3);
  return (
    <div className="w-full max-w-md rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
      <p className="font-medium">
        {issues.length === 1 ? '1 part of this draft isn’t complete yet' : `${issues.length} parts of this draft aren’t complete yet`} — the phone shows the rest.
      </p>
      <ul className="mt-1 space-y-0.5">
        {shown.map((i, n) => (
          <li key={n}>
            <span className="font-medium">{i.where}</span>: {i.message}
            {advanced && i.path ? <span className="ml-1 font-mono text-amber-700">{i.path}</span> : null}
          </li>
        ))}
      </ul>
      {issues.length > 3 ? (
        <button type="button" className="mt-1 font-medium underline" onClick={() => setOpen((o) => !o)}>
          {open ? 'Show fewer' : `Show all ${issues.length}`}
        </button>
      ) : null}
    </div>
  );
}

// ── The preview ──────────────────────────────────────────────────────────────────────────────────

function PreviewInner({ kind, definition, bundle, context, theme, focus = null, className, showToolbar = true, height, caption }: DefinitionPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState<SampleJobVariant>('standard_home');
  const [current, setCurrent] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [formMode, setFormMode] = useState<FormMode>('screens');
  const [query, setQuery] = useState('');

  const parsed = useMemo(() => lenientParse(kind, definition), [kind, definition]);
  const def = parsed.definition;

  // Show the page / step / section that holds the focused element (adjusting state while rendering, not in an effect).
  const [seenFocus, setSeenFocus] = useState<string | null | undefined>(undefined);
  if (focus !== seenFocus) {
    setSeenFocus(focus);
    const target = focus ? focusTarget(kind, def, focus, bundle) : null;
    if (target) setCurrent(target);
  }
  useEffect(() => {
    if (!focus) return;
    const id = requestAnimationFrame(() => scrollToAnchor(rootRef.current, focus));
    return () => cancelAnimationFrame(id);
  }, [focus, current, def]);

  const ctx = useMemo(() => applySampleVariant(context ?? samplePreviewContext(), variant), [context, variant]);
  const env = useMemo<PreviewEnv>(() => {
    const ownStrings = kind === 'content' && def && isPlainObject(def.strings) ? (def.strings as Record<string, string>) : {};
    return {
      data: { today: ctx.today, job: ctx.job, agent: ctx.agent, inspection: { ...ctx.inspection, receipt: sampleReceipt(ctx) }, stats: ctx.stats, previous: ctx.previous },
      context: ctx,
      jobs: sampleJobList(ctx),
      strings: { ...FALLBACK_CORE_STRINGS, ...(bundle?.strings ?? {}), ...ownStrings },
      declarations: bundle?.declarations ?? {},
      bundle: bundle ?? {},
      lists: bundle?.lists ?? {},
      focus,
    };
  }, [ctx, bundle, focus, kind, def]);

  const frame = { theme, height, caption };
  const renderFrame: RenderFrame = (parts) => (
    <PhoneFrame {...frame} title={parts.title} showBack={parts.showBack} onBack={parts.onBack} banner={parts.banner} footer={parts.footer} overlay={parts.overlay}>
      {parts.body}
    </PhoneFrame>
  );
  const title = def && typeof def.title === 'string' ? def.title : undefined;

  // Page / step / section options for the toolbar.
  let picker: { label: string; options: { id: string; label: string }[] } | null = null;
  let flowForm: FormDefinition | null = null;
  if (def && kind === 'form' && formMode === 'screens') {
    const form = def as unknown as FormDefinition;
    picker = { label: 'Section', options: form.sections.map((s, i) => ({ id: s.key, label: `${i + 1}. ${sectionTitle(form, s.key)}` })) };
  } else if (def && kind === 'flow') {
    flowForm = formForFlow(def as unknown as FlowDefinition, bundle?.forms);
    picker = { label: 'Step', options: flowStepList(def as unknown as FlowDefinition, flowForm) };
  } else if (def && kind === 'app') {
    picker = { label: 'Page', options: appPageList(def as unknown as AppDefinition) };
  }
  const interactive = kind === 'form' || kind === 'flow' || kind === 'app';
  const usesJob = kind !== 'content';

  let phone: ReactNode;
  if (!def) {
    phone = renderFrame({ title: title ?? 'Preview', body: <div className={cn(PAGE_X, 'py-4')}><PreviewNotice>Nothing to preview yet.</PreviewNotice></div> });
  } else if (kind === 'form') {
    phone = <FormScreen key={resetToken} form={def as unknown as FormDefinition} renderFrame={renderFrame} mode={formMode} current={current} onCurrentChange={setCurrent} />;
  } else if (kind === 'flow') {
    phone = <FlowScreen key={resetToken} flow={def as unknown as FlowDefinition} renderFrame={renderFrame} current={current} onCurrentChange={setCurrent} />;
  } else if (kind === 'app') {
    phone = <AppScreen key={resetToken} app={def as unknown as AppDefinition} frame={frame} current={current} onCurrentChange={setCurrent} />;
  } else if (kind === 'view') {
    const items = Array.isArray(def.items) ? (def.items as ViewItemDef[]) : [];
    phone = renderFrame({
      title: title ?? 'Screen',
      body: <div className={cn(PAGE_X, 'py-4')}>{items.length ? <ViewItems items={items} data={env.data} /> : <PreviewNotice>This screen layout is empty so far.</PreviewNotice>}</div>,
    });
  } else if (kind === 'content') {
    phone = renderFrame({ title: title ?? 'Wording', body: <ContentSnippets strings={isPlainObject(def.strings) ? (def.strings as Record<string, string>) : {}} query={query} /> });
  } else {
    phone = renderFrame({ title: 'Job details', showBack: true, body: <JobSchemaScreen attributes={Array.isArray(def.attributes) ? (def.attributes as FieldDef[]) : []} /> });
  }

  return (
    <div ref={rootRef} className={cn('flex flex-col items-center gap-3', className)}>
      {showToolbar ? (
        <div className="flex w-full max-w-md flex-wrap items-center justify-center gap-2" aria-label="Preview controls">
          {kind === 'form' ? (
            <div className="inline-flex rounded-md border bg-card p-0.5 text-xs" role="group" aria-label="Layout">
              {(['screens', 'scroll'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={formMode === m}
                  onClick={() => setFormMode(m)}
                  className={cn('rounded px-2 py-1', formMode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  {m === 'screens' ? 'Section per screen' : 'One page'}
                </button>
              ))}
            </div>
          ) : null}
          {picker && picker.options.length > 0 ? (
            <ToolbarSelect
              label={picker.label}
              value={current && picker.options.some((o) => o.id === current) ? current : kind === 'app' && def && typeof def.home === 'string' ? def.home : (picker.options[0]?.id ?? '')}
              options={picker.options}
              onChange={setCurrent}
              className="w-56"
            />
          ) : null}
          {kind === 'content' ? (
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the wording" className="h-8 pl-7 text-xs" aria-label="Search the wording" />
            </div>
          ) : null}
          {usesJob ? (
            <ToolbarSelect label="Sample job" value={variant} options={SAMPLE_JOB_VARIANTS.map((v) => ({ id: v.value, label: v.label }))} onChange={(v) => setVariant(v as SampleJobVariant)} className="w-56" />
          ) : null}
          {interactive ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => {
                setResetToken((t) => t + 1);
                setCurrent(null);
              }}
            >
              <RotateCcw /> Clear answers
            </Button>
          ) : null}
        </div>
      ) : null}
      <IssuesNotice issues={parsed.issues} />
      {flowForm === null && kind === 'flow' && def ? (
        <p className="max-w-md text-center text-xs text-muted-foreground">
          The questions for these steps aren’t chosen or published yet, so Questions steps show a note instead.
        </p>
      ) : null}
      <PreviewEnvProvider value={env}>{phone}</PreviewEnvProvider>
    </div>
  );
}
