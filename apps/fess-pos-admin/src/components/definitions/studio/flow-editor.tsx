'use client';

// Flow editor: the ordered steps of a journey (docs/04 §3.2, docs/11 §6) — which sections of the linked form each
// Questions step shows, the declaration, the submit confirmation. Integrity steps (location check, declaration,
// submit) can be moved and configured but not removed.
import { AlertTriangle, Lock, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { StructuredView } from '@/components/structured-view';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FLOW_ACTIONS, STEPS } from '@/lib/engine';
import { useIsAdvanced } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { formSections } from './bundle';
import { ACTION_LABEL, enumLabel, stepWording } from './catalogue-ui';
import { DocumentHeader } from './document-header';
import { asArr, asObj, asStr, insertAt, isRule, moveItem, type Obj, remapSelection, removeAt, setProp, uniqueKey, updateIn } from './doc';
import { ChoiceDialog } from './pickers';
import { slotSentence } from './rule-english';
import {
  AdvancedJsonButton,
  CheckList,
  type EditorProps,
  Hint,
  IconAction,
  ReorderButtons,
  Row,
  RuleLine,
  SelectField,
  SubHeading,
  SwitchField,
  TextField,
  useDragReorder,
  useStudio,
} from './shared';
import { buildVocab } from './vocab';

const ORDERED_BEFORE_SUBMIT = new Set(['form', 'summary_review', 'declaration', 'location_check', 'job_briefing']);

function newStep(type: string, id: string): Obj {
  switch (type) {
    case 'form':
      return { id, type, sections: [], paging: 'section_per_page' };
    case 'job_briefing':
      return { id, type, view: 'job_detail' };
    case 'receipt':
      return { id, type, view: 'receipt' };
    case 'summary_review':
      return { id, type, show_risk_indicators: true, allow_jump_back: true };
    case 'location_check':
      return { id, type, checkin_prompt: 'profile' };
    default:
      return { id, type };
  }
}

function stepSummary(step: Obj, sectionTitle: (k: string) => string, titleOf: (kind: 'view' | 'form', k: string) => string): string {
  const t = asStr(step.type);
  if (t === 'form') {
    const secs = asArr(step.sections).map((s) => sectionTitle(String(s)));
    const paging = asStr(step.paging);
    return `${secs.length ? `Shows ${secs.join(', ')}` : 'No sections chosen yet'}${paging ? ` · ${enumLabel(paging).toLowerCase()}` : ''}`;
  }
  if (t === 'job_briefing' || t === 'receipt') return step.view ? `Shows the screen “${titleOf('view', asStr(step.view))}”` : '';
  if (t === 'submit') return asStr(step.confirm_text);
  if (t === 'declaration') return step.declaration_key ? `Declaration: ${asStr(step.declaration_key)}` : "Uses the form's declaration";
  if (t === 'location_check') return step.override_form ? `If the agent is elsewhere: “${titleOf('form', asStr(step.override_form))}” form` : '';
  if (t === 'summary_review') return [step.show_risk_indicators ? 'shows risk flags' : '', step.allow_jump_back ? 'agent can go back to fix answers' : ''].filter(Boolean).join(' · ');
  return '';
}

export function FlowEditor(props: EditorProps) {
  const { doc, update, selected, onSelect } = props;
  const advanced = useIsAdvanced();
  const { readOnly, refs } = useStudio();
  const [adding, setAdding] = useState(false);
  const steps = asArr(doc.steps).map(asObj);
  const formKey = asStr(doc.form_family);
  const form = formKey ? refs.bundle.forms?.[formKey] : undefined;
  const sections = useMemo(() => formSections(form), [form]);
  const vocab = useMemo(() => buildVocab(form, refs.bundle.jobSchema), [form, refs.bundle.jobSchema]);
  const titleOf = (k: string) => sections.find((s) => s.key === k)?.title ?? k;
  const familyTitle = (kind: 'view' | 'form', k: string) => refs.families[kind].find((f) => f.key === k)?.title ?? k;
  const drag = useDragReorder('steps', move);

  const usage = useMemo(() => {
    const m = new Map<string, number[]>();
    steps.forEach((s, i) => {
      if (s.type !== 'form' || (s.form && s.form !== formKey)) return;
      for (const k of asArr(s.sections)) m.set(String(k), [...(m.get(String(k)) ?? []), i]);
    });
    return m;
  }, [steps, formKey]);
  const uncovered = sections.filter((s) => !usage.has(s.key));

  function move(from: number, to: number) {
    update((d) => moveItem(d, ['steps'], from, to) as Obj);
    onSelect(remapSelection(selected, ['steps'], from, to));
  }

  function add(type: string) {
    const ids = steps.map((s) => asStr(s.id));
    const id = uniqueKey(type === 'form' ? 'questions' : type, ids);
    const submitAt = steps.findIndex((s) => s.type === 'submit');
    const declAt = steps.findIndex((s) => s.type === 'declaration');
    let at = steps.length;
    if (ORDERED_BEFORE_SUBMIT.has(type) && submitAt >= 0) at = type === 'declaration' ? submitAt : declAt >= 0 ? declAt : submitAt;
    update((d) => insertAt(d, ['steps'], at, newStep(type, id)) as Obj);
    onSelect(`steps/${at}`);
  }

  function remove(i: number) {
    const removed = steps[i];
    update((d) => removeAt(d, ['steps'], i) as Obj);
    onSelect(null);
    toast(`Removed step “${asStr(removed?.label) || stepWording(asStr(removed?.type)).name}”`, {
      action: { label: 'Undo', onClick: () => update((d) => insertAt(d, ['steps'], i, removed) as Obj) },
    });
  }

  return (
    <div className="grid gap-4">
      <DocumentHeader doc={doc} update={update}>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="Form the agent fills in"
            value={formKey || undefined}
            onChange={(v) => update((d) => setProp(d, [], 'form_family', v) as Obj)}
            options={refs.families.form.map((f) => ({ value: f.key, label: f.title }))}
            unsetLabel="None"
          />
          <SelectField
            label="What submitting does"
            value={asStr(doc.action) || undefined}
            onChange={(v) => update((d) => setProp(d, [], 'action', v) as Obj)}
            options={FLOW_ACTIONS.map((a) => ({ value: a, label: ACTION_LABEL[a] ?? a }))}
            unsetLabel="Submit the inspection (default)"
          />
        </div>
      </DocumentHeader>

      {form && uncovered.length > 0 ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Some sections of the form are never shown</AlertTitle>
          <AlertDescription>
            {uncovered.map((s) => `“${s.title}”`).join(', ')} {uncovered.length === 1 ? "isn't" : "aren't"} in any Questions step. Add{' '}
            {uncovered.length === 1 ? 'it' : 'them'} to a step, or the flow can&apos;t be published.
          </AlertDescription>
        </Alert>
      ) : null}
      {formKey && !form && !refs.loading ? (
        <Alert variant="info">
          <AlertDescription>The form “{formKey}” has no published version yet, so its sections can&apos;t be listed.</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="grid gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold">Steps, in order</h3>
            <span className="text-sm text-muted-foreground">
              <Lock className="mr-1 inline size-3.5" /> Locked steps protect the evidence and can&apos;t be removed.
            </span>
          </div>
          <ol className="grid gap-2">
            {steps.map((s, i) => {
              const type = asStr(s.type);
              const w = stepWording(type);
              const spec = STEPS[type];
              const pk = `steps/${i}`;
              const isSel = selected === pk;
              const locked = spec?.integrity ?? false;
              return (
                <li key={i} {...drag.target(i)} className={cn('rounded-lg border bg-card', isSel && 'border-primary ring-2 ring-primary/25', drag.over === i && 'border-primary ring-2 ring-primary/30')}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isSel}
                    onClick={() => onSelect(isSel ? null : pk)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onSelect(isSel ? null : pk);
                      }
                    }}
                    className="flex cursor-pointer items-start gap-2 rounded-lg p-2.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {drag.handle(i)}
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold tabular-nums text-primary">{i + 1}</span>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                      <w.icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-medium">{asStr(s.label) || w.name}</span>
                        {asStr(s.label) ? <span className="text-sm text-muted-foreground">{w.name}</span> : null}
                        {locked ? (
                          <Badge tone="muted">
                            <Lock /> Locked
                          </Badge>
                        ) : null}
                        {isRule(s.visible) ? <Badge tone="progress">Conditional</Badge> : null}
                        {s.next !== undefined ? <Badge tone="progress">Branches</Badge> : null}
                        {advanced ? <code className="text-xs text-muted-foreground">{asStr(s.id)}</code> : null}
                      </div>
                      <p className="text-sm text-muted-foreground">{stepSummary(s, titleOf, familyTitle) || w.description}</p>
                    </div>
                    {!readOnly ? (
                      <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                        <ReorderButtons index={i} count={steps.length} onMove={move} noun="step" />
                        <IconAction label={locked ? 'Locked steps cannot be removed' : 'Remove step'} destructive disabled={locked} onClick={() => remove(i)}>
                          <Trash2 />
                        </IconAction>
                      </div>
                    ) : null}
                  </div>
                  {isSel ? (
                    <div className="border-t bg-slate-50/70 p-4">
                      <StepInspector index={i} step={s} flowForm={formKey} sections={sections} usage={usage} props={props} vocab={vocab} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {steps.length === 0 ? <Hint>No steps yet — add the steps the agent goes through.</Hint> : null}
          {!readOnly ? (
            <div>
              <Button type="button" variant="outline" onClick={() => setAdding(true)}>
                <Plus /> Add a step
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <ChoiceDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add a step"
        description="Steps run in order. Questions steps show sections of the linked form."
        choices={Object.keys(STEPS).map((t) => ({ value: t, ...stepWording(t) }))}
        onPick={add}
      />
    </div>
  );
}

function StepInspector({
  index,
  step,
  flowForm,
  sections,
  usage,
  props,
  vocab,
}: {
  index: number;
  step: Obj;
  flowForm: string;
  sections: { key: string; title: string }[];
  usage: Map<string, number[]>;
  props: EditorProps;
  vocab: ReturnType<typeof buildVocab>;
}) {
  const { update, onSelect } = props;
  const advanced = useIsAdvanced();
  const { refs } = useStudio();
  const path = ['steps', index];
  const type = asStr(step.type);
  const spec = STEPS[type];
  const set = (k: string, v: unknown) => update((d) => setProp(d, path, k, v) as Obj);
  const stepForm = asStr(step.form);
  const ownSections = stepForm && stepForm !== flowForm ? formSections(refs.bundle.forms?.[stepForm]) : sections;
  const viewOptions = refs.families.view.map((v) => ({ value: v.key, label: v.title }));
  const formOptions = refs.families.form.map((f) => ({ value: f.key, label: f.title }));

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Heading shown to the agent" value={asStr(step.label)} onChange={(v) => set('label', v)} placeholder={stepWording(type).name} />
        {advanced ? (
          <TextField
            label="Step id"
            value={asStr(step.id)}
            onChange={(v) => {
              set('id', v);
            }}
            mono
            hint="Used by branching (next) rules."
          />
        ) : null}
      </div>

      {type === 'form' ? (
        <div className="grid gap-4">
          <SubHeading>Questions</SubHeading>
          {advanced ? (
            <SelectField label="Form" value={stepForm || undefined} onChange={(v) => set('form', v)} options={formOptions} unsetLabel={`The flow's form${flowForm ? ` (${flowForm})` : ''}`} />
          ) : null}
          <CheckList
            label="Sections shown in this step"
            hint="Each section of the form should be shown in exactly one step."
            values={asArr(step.sections).map(String)}
            onChange={(v) => set('sections', v)}
            options={ownSections.map((s) => {
              const elsewhere = (usage.get(s.key) ?? []).filter((i) => i !== index);
              return { value: s.key, label: s.title, note: elsewhere.length ? `also in step ${elsewhere.map((i) => i + 1).join(', ')}` : undefined };
            })}
          />
          <SelectField
            label="Pages"
            value={asStr(step.paging) || undefined}
            onChange={(v) => set('paging', v)}
            unsetLabel="Default"
            options={['section_per_page', 'single_page'].map((p) => ({ value: p, label: enumLabel(p) }))}
          />
        </div>
      ) : null}

      {type === 'job_briefing' || type === 'receipt' ? (
        <SelectField label="Screen shown" value={asStr(step.view) || undefined} onChange={(v) => set('view', v)} options={viewOptions} />
      ) : null}
      {type === 'job_briefing' ? (
        <TextField label="Tick-box text before starting" value={asStr(step.acknowledgement_text)} onChange={(v) => set('acknowledgement_text', v)} placeholder="I have read the job details" />
      ) : null}
      {type === 'location_check' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="Ask the agent to check in on arrival"
            value={asStr(step.checkin_prompt) || undefined}
            onChange={(v) => set('checkin_prompt', v)}
            unsetLabel="Default"
            options={['profile', 'always'].map((p) => ({ value: p, label: enumLabel(p) }))}
          />
          <SelectField label="Form used to override the location check" value={asStr(step.override_form) || undefined} onChange={(v) => set('override_form', v)} options={formOptions} unsetLabel="None" />
          {step.messages !== undefined ? (
            <Row label="Messages" className="md:col-span-2">
              <StructuredView value={step.messages} className="rounded-md border bg-card p-2" />
            </Row>
          ) : null}
          <Hint className="md:col-span-2">Distances and accuracy come from the remote configuration (Settings), within safe bounds.</Hint>
        </div>
      ) : null}
      {type === 'summary_review' ? (
        <div className="grid gap-3">
          <SwitchField label="Show risk flags on the review" checked={step.show_risk_indicators === true} onChange={(v) => set('show_risk_indicators', v)} />
          <SwitchField label="Let the agent go back to fix an answer" checked={step.allow_jump_back === true} onChange={(v) => set('allow_jump_back', v)} />
        </div>
      ) : null}
      {type === 'declaration' ? (
        <SelectField
          label="Declaration text"
          value={asStr(step.declaration_key) || undefined}
          onChange={(v) => set('declaration_key', v)}
          unsetLabel="The form's declaration"
          options={refs.declarations.map((d) => ({ value: d.key, label: d.title }))}
        />
      ) : null}
      {type === 'submit' ? (
        <TextField label="Confirmation question" value={asStr(step.confirm_text)} onChange={(v) => set('confirm_text', v)} multiline rows={2} placeholder="Submit this inspection? You can't change it afterwards." />
      ) : null}

      {spec?.removable || isRule(step.visible) ? (
        <Row label="Shown">
          {isRule(step.visible) ? (
            <RuleLine sentence={slotSentence('step_visible', step.visible, vocab)} rule={step.visible} onChange={(v) => set('visible', v)} onRemove={() => set('visible', undefined)} removeLabel="Always show" />
          ) : (
            <span className="text-sm">Always</span>
          )}
        </Row>
      ) : null}
      {step.next !== undefined ? (
        <Row label="After this step">
          <RuleLine sentence={slotSentence('next', step.next, vocab)} rule={step.next} onChange={(v) => set('next', v)} onRemove={() => set('next', undefined)} removeLabel="Go to the next step" />
        </Row>
      ) : null}
      <AdvancedJsonButton
        value={step}
        onApply={(v) => {
          update((d) => updateIn(d, path, () => asObj(v)) as Obj);
          onSelect(`steps/${index}`);
        }}
        label="Edit this step as JSON"
      />
    </div>
  );
}
