'use client';

// Flow preview (T3-23): walks the steps of a flow (docs/11 §6) with a step indicator and Back / Next — job briefing,
// location check (mock map, fence, check-in, override), form steps, summary review with risk indicators, declaration,
// submit (confirm) and receipt. Step `visible` and `next` rules are evaluated by the engine against the answers.
import { CircleCheck, MapPin, Pencil } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { evaluate, type FlowDefinition, type FormDefinition, type ResolvedField, type StepDef } from '@/lib/engine';
import { cn, isPlainObject } from '@/lib/utils';
import { DeclarationText, FormSections } from './form-renderer';
import { ErrorBanner, sectionTitle, validateAndReveal } from './form-screen';
import { type AnswerMeta, type FormPreviewState, useFormPreviewState } from './form-state';
import { lenientParse } from './lenient-parse';
import { PhoneSection } from './phone-frame';
import { Callout, CheckRow, MockMap, PhoneActionButton, PhoneDialog, PreviewNotice, RiskChip, StepIndicator, StickyFooter } from './phone-widgets';
import { contentText, type RenderFrame, ruleBool, templateText, usePreviewEnv, useResolveContext } from './preview-context';
import { formatDate, formatValue, humanise } from './preview-format';
import { ViewByKey } from './view-renderer';

const STEP_LABEL: Record<string, string> = {
  job_briefing: 'Job briefing',
  location_check: 'Location check',
  form: 'Questions',
  summary_review: 'Review your answers',
  declaration: 'Declaration',
  submit: 'Submit',
  receipt: 'Receipt',
};

export const stepId = (step: StepDef, i: number) => step.id ?? `step_${i + 1}`;

export function stepLabel(step: StepDef, form: FormDefinition | null): string {
  if (step.label) return step.label;
  if (step.type === 'form' && form && step.sections?.length) return step.sections.map((k) => sectionTitle(form, k)).join(' · ');
  return STEP_LABEL[step.type] ?? humanise(step.type);
}

/** Steps for the toolbar picker. */
export function flowStepList(flow: FlowDefinition, form: FormDefinition | null): { id: string; label: string }[] {
  return flow.steps.map((s, i) => ({ id: stepId(s, i), label: `${i + 1}. ${stepLabel(s, form)}` }));
}

export function formForFlow(flow: FlowDefinition, forms: Record<string, unknown> | undefined, familyKey?: string): FormDefinition | null {
  const key = familyKey ?? flow.form_family;
  const doc = key ? forms?.[key] : undefined;
  return doc ? (lenientParse('form', doc).definition as unknown as FormDefinition | null) : null;
}

/** An answer as the review screen prints it; null when unanswered. */
function answerText(rf: ResolvedField, meta: AnswerMeta | undefined): string | null {
  if (meta?.unknown) return 'Unknown';
  const v = rf.value;
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return null;
  const label = (x: unknown) => rf.options?.find((o) => o.value === x)?.label ?? (x === 'other' && meta?.other_text ? `Other: ${meta.other_text}` : String(x));
  switch (rf.type) {
    case 'photo':
      return `${(v as unknown[]).length} photo${(v as unknown[]).length === 1 ? '' : 's'}`;
    case 'signature':
      return 'Signed';
    case 'declaration':
      return 'Accepted';
    case 'consent':
      return isPlainObject(v) ? (v.given ? `Agreed · ${String(v.by_name)}` : 'Did not agree') : '—';
    case 'single_select':
    case 'lookup':
    case 'tri_state':
      return label(v);
    case 'multi_select':
      return Array.isArray(v) ? v.map(label).join(', ') : String(v);
    case 'business_hours':
      return isPlainObject(v)
        ? Object.entries(v)
            .map(([g, h]) => `${humanise(g)}: ${h === 'closed' ? 'closed' : h === '24h' ? '24h' : isPlainObject(h) ? `${String(h.open)}–${String(h.close)}` : '—'}`)
            .join('; ')
        : '—';
    case 'date':
      return typeof v === 'string' ? formatDate(v) : '—';
    case 'percentage':
      return formatValue(v, 'percentage');
    default:
      return formatValue(v);
  }
}

function SummaryReview({ state, form, sections, step, onJump }: { state: FormPreviewState; form: FormDefinition; sections: readonly string[]; step: StepDef; onJump: (section: string) => void }) {
  const risks = step.show_risk_indicators === false ? [] : state.risks(sections);
  const resolved = state.resolved;
  if (!resolved) return <PreviewNotice>Answers can’t be summarised: {state.resolveError}</PreviewNotice>;
  return (
    <div className="space-y-4 py-3">
      {risks.length > 0 ? (
        <PhoneSection title="Risk indicators">
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
            {risks.map((r) => (
              <RiskChip key={r.key} level={r.level} label={r.label ?? r.fieldLabel} />
            ))}
          </div>
        </PhoneSection>
      ) : null}
      {sections.map((key) => {
        if (resolved.sections[key]?.visible === false) return null;
        const def = form.sections.find((s) => s.key === key);
        if (!def) return null;
        const rows = resolved.order
          .map((k) => resolved.fields[k])
          .filter((rf): rf is ResolvedField => Boolean(rf && rf.section === key && rf.visible && !['info', 'callout', 'divider', 'image', 'group'].includes(rf.type) && !(rf.type === 'computed' && rf.props.hidden === true)));
        return (
          <PhoneSection key={key} title={sectionTitle(form, key)}>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {rows.map((rf) => {
                const text = answerText(rf, state.meta[rf.key]);
                return (
                  <div key={rf.key} className="px-3 py-2">
                    <div className="text-[13px] text-slate-500">{rf.label ?? humanise(rf.key)}</div>
                    <div className={cn('text-[15px]', text === null ? (rf.required ? 'text-amber-700' : 'text-slate-400') : 'text-slate-900')}>
                      {text ?? (rf.required ? 'Not answered' : '—')}
                    </div>
                  </div>
                );
              })}
            </div>
            {step.allow_jump_back !== false ? (
              <button type="button" onClick={() => onJump(key)} className="mt-1 inline-flex items-center gap-1 px-1 py-1 text-[14px] font-medium text-[var(--pp)]">
                <Pencil className="size-3.5" /> Edit
              </button>
            ) : null}
          </PhoneSection>
        );
      })}
    </div>
  );
}

export function FlowScreen({
  flow,
  renderFrame,
  current,
  onCurrentChange,
  title,
  onFinish,
  onExit,
}: {
  flow: FlowDefinition;
  renderFrame: RenderFrame;
  current: string | null;
  onCurrentChange: (stepId: string) => void;
  title?: string;
  /** "Done" on the last step (app: back to home). Default: start again. */
  onFinish?: () => void;
  /** Back on the first step (app: leave the flow). */
  onExit?: () => void;
}) {
  const env = usePreviewEnv();
  const rctx = useResolveContext();
  const form = useMemo(() => formForFlow(flow, env.bundle.forms), [flow, env.bundle.forms]);
  const state = useFormPreviewState(form, rctx, env.lists);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<{ step: string; index: number }>({ step: '', index: 0 });
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [needAck, setNeedAck] = useState<string | null>(null);
  const [checkedIn, setCheckedIn] = useState(false);
  const [override, setOverride] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[] | null>(null);

  const geofence = env.context.inspection.geofence;
  const locationStep = flow.steps.find((s) => s.type === 'location_check');
  const overrideForm = useMemo(
    () => (locationStep?.override_form ? formForFlow(flow, env.bundle.forms, locationStep.override_form) : null),
    [flow, env.bundle.forms, locationStep?.override_form],
  );
  const overrideState = useFormPreviewState(overrideForm, rctx, env.lists);
  const { clearErrors } = state;
  // Messages belong to the step that raised them: clear them when another step is shown (e.g. from the picker).
  useEffect(() => {
    clearErrors();
    setSubmitErrors(null);
    setNeedAck(null);
  }, [current, clearErrors]);

  const data = state.resolved?.data ?? env.data;
  const today = typeof env.data.today === 'string' ? env.data.today : null;
  const steps = flow.steps.map((s, i) => ({ step: s, id: stepId(s, i) })).filter(({ step }) => ruleBool(step.visible, data, true, today));
  if (steps.length === 0) return renderFrame({ title: title ?? flow.title, body: <div className="p-3"><PreviewNotice>This flow has no steps yet.</PreviewNotice></div> });

  const index = Math.max(0, steps.findIndex((s) => s.id === current));
  const { step, id } = steps[index] ?? steps[0]!;
  const formSections = (s: StepDef) => (s.sections ?? []).filter((k) => state.resolved?.sections[k]?.visible !== false);
  const pages = step.type === 'form' ? (step.paging === 'single_page' ? [formSections(step)] : formSections(step).map((k) => [k])) : [];
  const subIndex = sub.step === id ? Math.min(sub.index, Math.max(0, pages.length - 1)) : 0;
  const allFlowSections = flow.steps.filter((s) => s.type === 'form').flatMap((s) => s.sections ?? []);

  const go = (target: string, subPage = 0) => {
    state.clearErrors();
    setSubmitErrors(null);
    setNeedAck(null);
    setSub({ step: target, index: subPage });
    onCurrentChange(target);
    bodyRef.current?.parentElement?.scrollTo({ top: 0 });
  };
  const advance = () => {
    let target = steps[index + 1]?.id;
    if (step.next !== undefined) {
      try {
        const v = typeof step.next === 'string' ? step.next : evaluate(step.next, data as Parameters<typeof evaluate>[1], { today });
        if (typeof v === 'string' && steps.some((s) => s.id === v)) target = v;
      } catch {
        /* the analyser reports broken next rules; fall through to the next step */
      }
    }
    if (target) go(target);
  };
  const back = () => {
    if (step.type === 'form' && subIndex > 0) return setSub({ step: id, index: subIndex - 1 });
    const prev = steps[index - 1];
    if (prev) {
      const prevPages = prev.step.type === 'form' && prev.step.paging !== 'single_page' ? formSections(prev.step).length : 1;
      go(prev.id, Math.max(0, prevPages - 1));
    } else onExit?.();
  };
  const jumpToSection = (section: string) => {
    const target = steps.find(({ step: s }) => s.type === 'form' && s.sections?.includes(section));
    if (!target) return;
    const secs = formSections(target.step);
    go(target.id, target.step.paging === 'single_page' ? 0 : Math.max(0, secs.indexOf(section)));
  };

  const next = () => {
    if (step.type === 'form') {
      const page = pages[subIndex] ?? [];
      if (!validateAndReveal(state, page, bodyRef.current)) return;
      state.clearErrors();
      if (subIndex < pages.length - 1) {
        setSub({ step: id, index: subIndex + 1 });
        bodyRef.current?.parentElement?.scrollTo({ top: 0 });
        return;
      }
    } else if ((step.type === 'job_briefing' && step.acknowledgement_text) || step.type === 'declaration') {
      if (!acks[id]) return setNeedAck(id);
    } else if (step.type === 'location_check') {
      if (!geofence.inside) {
        if (!override) return setOverride(true);
        if (overrideForm && !validateAndReveal(overrideState, undefined, bodyRef.current)) return;
      } else if ((step.checkin_prompt === 'always' || geofence.relaxed) && !checkedIn) return setNeedAck(id);
    } else if (step.type === 'submit') return setConfirm(true);
    advance();
  };

  const confirmSubmit = () => {
    setConfirm(false);
    const errors = state.validate(allFlowSections.length ? allFlowSections : undefined);
    const keys = Object.keys(errors);
    if (keys.length > 0) {
      setSubmitErrors(keys);
      return;
    }
    state.clearErrors();
    advance();
  };

  let body: ReactNode;
  let primary: string = 'Next';
  const ackText = step.type === 'declaration' ? 'I have read and accept this declaration' : (step.acknowledgement_text ?? '');
  const ackRow =
    (step.type === 'job_briefing' && step.acknowledgement_text) || step.type === 'declaration' ? (
      <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-1">
        <CheckRow checked={acks[id] === true} onChange={(c) => { setAcks((a) => ({ ...a, [id]: c })); setNeedAck(null); }}>{templateText(ackText, data)}</CheckRow>
        {needAck === id ? <p className="pb-2 text-[13px] text-red-700">Tick the box to continue.</p> : null}
      </div>
    ) : null;

  switch (step.type) {
    case 'job_briefing':
      body = (
        <div className="px-3 py-3">
          <ViewByKey viewKey={step.view} />
          {ackRow}
        </div>
      );
      break;
    case 'location_check': {
      const prompt = step.checkin_prompt === 'always' || geofence.relaxed;
      body = (
        <div className="space-y-3 px-3 py-3">
          <MockMap height={200} fence agent={geofence.inside ? 'inside' : 'outside'} />
          {geofence.inside ? (
            <Callout tone="info">
              <span className="font-medium">You’re at the merchant’s location.</span> Fence profile: {humanise(geofence.profile)}.
            </Callout>
          ) : (
            <Callout tone="warning">{contentText(env.strings, step.messages?.outside_fence ?? 'location.outside_fence')}</Callout>
          )}
          {geofence.inside && prompt ? (
            <div className="space-y-2">
              <Callout tone="info">{contentText(env.strings, step.messages?.checkin_prompt ?? 'location.checkin_prompt')}</Callout>
              <PhoneActionButton variant={checkedIn ? 'outline' : 'primary'} onClick={() => { setCheckedIn(true); setNeedAck(null); }}>
                {checkedIn ? <><CircleCheck className="size-4" /> Location recorded</> : <><MapPin className="size-4" /> Record my location</>}
              </PhoneActionButton>
              {needAck === id ? <p className="text-[13px] text-red-700">Record your location to continue.</p> : null}
            </div>
          ) : null}
          {!geofence.inside && override ? (
            overrideForm ? (
              <div className="-mx-3">
                <FormSections state={overrideState} />
              </div>
            ) : (
              <PreviewNotice>Override form “{step.override_form ?? '—'}” is not loaded in this preview.</PreviewNotice>
            )
          ) : null}
        </div>
      );
      if (!geofence.inside && !override) primary = 'Continue with an override';
      break;
    }
    case 'form':
      body = !form ? (
        <div className="p-3">
          <PreviewNotice>Form “{step.form ?? flow.form_family ?? '—'}” is not loaded in this preview.</PreviewNotice>
        </div>
      ) : pages.length === 0 ? (
        <div className="p-3">
          <PreviewNotice>This step’s sections are hidden for this sample or not in the form.</PreviewNotice>
        </div>
      ) : (
        <FormSections state={state} sectionKeys={pages[subIndex] ?? []} />
      );
      break;
    case 'summary_review':
      body = form ? (
        <div className="px-3">
          <SummaryReview state={state} form={form} sections={allFlowSections} step={step} onJump={jumpToSection} />
        </div>
      ) : (
        <div className="p-3">
          <PreviewNotice>The form is not loaded in this preview.</PreviewNotice>
        </div>
      );
      break;
    case 'declaration':
      body = (
        <div className="px-3 py-3">
          <DeclarationText declarationKey={step.declaration_key ?? form?.declaration_key} />
          {ackRow}
        </div>
      );
      break;
    case 'submit':
      primary = step.label ?? 'Submit';
      body = (
        <div className="space-y-3 px-3 py-3">
          <Callout tone="info">Your answers and photos will be sealed and sent. If you’re offline, they are saved on this phone and sent automatically.</Callout>
          {submitErrors ? (
            <Callout tone="danger">
              <div className="font-medium">{submitErrors.length === 1 ? '1 answer needs attention' : `${submitErrors.length} answers need attention`}</div>
              <ul className="mt-1 space-y-0.5">
                {submitErrors.slice(0, 6).map((k) => (
                  <li key={k}>
                    <button type="button" className="text-left underline" onClick={() => jumpToSection(state.resolved?.fields[k]?.section ?? '')}>
                      {state.resolved?.fields[k]?.label ?? k}
                    </button>
                  </li>
                ))}
              </ul>
            </Callout>
          ) : null}
        </div>
      );
      break;
    case 'receipt':
      primary = 'Done';
      body = (
        <div className="px-3 py-3">
          <ViewByKey viewKey={step.view} />
        </div>
      );
      break;
    default:
      body = (
        <div className="p-3">
          <PreviewNotice>
            <span className="font-mono">{step.type}</span> — preview not available yet
          </PreviewNotice>
        </div>
      );
  }

  const errorCount = step.type === 'form' ? Object.keys(state.errors).length : step.type === 'location_check' ? Object.keys(overrideState.errors).length : 0;
  const isLast = index === steps.length - 1;
  const sublabel = step.type === 'form' && form && pages.length > 1 ? ` (${subIndex + 1}/${pages.length})` : '';
  return renderFrame({
    title: title ?? flow.title ?? 'Flow',
    showBack: index > 0 || subIndex > 0 || Boolean(onExit),
    onBack: back,
    banner: (
      <>
        <StepIndicator index={index} total={steps.length} label={`${stepLabel(step, form)}${sublabel}`} />
        <ErrorBanner count={errorCount} />
      </>
    ),
    body: (
      <div ref={bodyRef} data-preview-anchor={id} className={cn(env.focus === id && 'ring-2 ring-inset ring-[var(--pp)]')}>
        {body}
      </div>
    ),
    footer: (
      <StickyFooter>
        {index > 0 || subIndex > 0 ? (
          <PhoneActionButton variant="outline" className="w-auto flex-none px-4" onClick={back}>
            Back
          </PhoneActionButton>
        ) : null}
        <PhoneActionButton onClick={isLast ? () => (onFinish ? onFinish() : go(steps[0]?.id ?? id)) : next}>{primary}</PhoneActionButton>
      </StickyFooter>
    ),
    overlay: confirm ? (
      <PhoneDialog
        title={step.label ?? 'Submit'}
        actions={
          <>
            <PhoneActionButton variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </PhoneActionButton>
            <PhoneActionButton onClick={confirmSubmit}>Submit</PhoneActionButton>
          </>
        }
      >
        {templateText(step.confirm_text ?? 'Submit now? You can’t change it afterwards.', data)}
      </PhoneDialog>
    ) : undefined,
  });
}
