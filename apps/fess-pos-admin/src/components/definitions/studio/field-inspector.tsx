'use client';

// The settings of one question (form field or job attribute): label, help, key, required, visibility, the type's own
// props (generated from the engine catalogue with plain-language labels), answers, checks and risk flags. Rules are
// shown as sentences; their JSON is editable in Advanced view only (the visual rule builder is T3-10).
import { Plus } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { toast } from 'sonner';
import { Details } from '@/components/details';
import { StructuredView } from '@/components/structured-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COMPONENTS, type PropSpec } from '@/lib/engine';
import { useIsAdvanced } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { componentWording, displayLabel, enumLabel, propLabel } from './catalogue-ui';
import { asArr, asObj, asStr, getIn, isRule, KEY_PATTERN, type Obj, type Path, setProp, toKey, uniqueKey, updateIn } from './doc';
import { OptionsEditor } from './options-editor';
import { conditionText, type RuleVocabulary, slotSentence, valueText } from './rule-english';
import {
  AdvancedJsonButton,
  CheckList,
  Hint,
  JsonPartEditor,
  ListField,
  NumberField,
  Row,
  RuleLine,
  SelectField,
  SubHeading,
  SwitchField,
  TextField,
  type Update,
  useStudio,
} from './shared';

/** Props shown in Basic view per component type; everything else is Advanced. */
const BASIC_PROPS: Record<string, readonly string[]> = {
  text: ['max_length', 'placeholder', 'capitalise'],
  textarea: ['rows', 'min_length', 'max_length'],
  number: ['min', 'max', 'unit', 'integer'],
  percentage: ['min', 'max'],
  phone: ['default_region'],
  currency: ['min', 'max', 'currency'],
  slider: ['min', 'max', 'step', 'min_label', 'max_label'],
  rating: ['scale'],
  id_number: ['scheme'],
  registration_number: ['scheme'],
  boolean: ['true_label', 'false_label'],
  single_select: ['allow_other'],
  multi_select: ['min_select', 'max_select', 'allow_other'],
  lookup: ['list', 'search'],
  date: ['allow_unknown', 'min', 'max'],
  duration: ['units'],
  business_hours: ['groups', 'allow_24h'],
  address: ['map_pin'],
  location_pin: ['initial', 'max_distance_from_job_m'],
  photo: ['category', 'min_count', 'max_count', 'require_gps'],
  signature: ['signer_name_field', 'signer_designation_field'],
  declaration: ['declaration_key'],
  acknowledgement: ['text'],
  consent: ['declaration_key', 'by_name_field'],
  prefilled: ['source', 'allow_flag_differs', 'differs_note'],
  computed: ['format'],
  group: ['layout'],
  repeatable_group: ['min_items', 'max_items', 'item_label', 'add_label'],
  callout: ['tone', 'text'],
  info: ['text'],
  image: ['caption'],
};

const PREFILL_SOURCES = [
  'job.merchant_name',
  'job.reference',
  'job.address',
  'job.mcc.code',
  'job.mcc.description',
  'job.location_type',
  'job.onsite_contact.name',
  'job.onsite_contact.phone',
  'job.bank.name',
  'agent.first_name',
  'agent.last_name',
  'agent.employee_number',
];

const FIELD_REF_PROPS = new Set(['signer_name_field', 'signer_designation_field', 'by_name_field']);

type Mode = 'form' | 'job_schema';

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const { readOnly } = useStudio();
  return (
    <div className="inline-flex flex-wrap rounded-md border bg-card p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={readOnly}
          onClick={() => onChange(o.value)}
          className={cn('rounded px-3 py-1 text-sm disabled:opacity-60', value === o.value ? 'bg-card font-medium text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function starterRule(vocabKey: string | undefined): unknown {
  return vocabKey ? { '==': [{ var: `answers.${vocabKey}` }, true] } : { '==': [{ var: 'job.attributes.risk_tier' }, 'high'] };
}

/** Optional / Required / Only sometimes. */
function RuleOrFlag({
  slot,
  title,
  value,
  onChange,
  vocab,
  previousKey,
  offLabel,
  onLabel,
}: {
  slot: 'required' | 'read_only';
  title: string;
  value: unknown;
  onChange: (v: unknown) => void;
  vocab: RuleVocabulary;
  previousKey?: string;
  offLabel: string;
  onLabel: string;
}) {
  const advanced = useIsAdvanced();
  const [writing, setWriting] = useState(false);
  const mode = value === true ? 'on' : isRule(value) ? 'rule' : 'off';
  function choose(next: 'on' | 'off' | 'rule') {
    if (next === 'rule') {
      if (mode !== 'rule') setWriting(true);
      return;
    }
    setWriting(false);
    if (mode === 'rule') {
      const old = value;
      toast(`${title}: condition removed`, { action: { label: 'Undo', onClick: () => onChange(old) } });
    }
    onChange(next === 'on' ? true : undefined);
  }
  return (
    <Row label={title}>
      <Segmented
        label={title}
        value={writing ? 'rule' : mode}
        onChange={choose}
        options={[
          { value: 'off', label: offLabel },
          { value: 'on', label: onLabel },
          { value: 'rule', label: 'Only sometimes' },
        ]}
      />
      {mode === 'rule' ? <RuleLine sentence={slotSentence(slot, value, vocab)} rule={value} onChange={onChange} /> : null}
      {writing && mode !== 'rule' ? (
        advanced ? (
          <JsonPartEditor
            value={starterRule(previousKey)}
            label="Condition (JSON logic)"
            rows={5}
            onCancel={() => setWriting(false)}
            onApply={(v) => {
              onChange(v);
              setWriting(false);
            }}
          />
        ) : (
          <Hint>Setting conditions here is coming soon. For now, switch to Advanced view to add one.</Hint>
        )
      ) : null}
    </Row>
  );
}

function PathField({ label, hint, value, onChange, suggestions, vocab }: { label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; suggestions: string[]; vocab: RuleVocabulary }) {
  const id = useId();
  const { readOnly } = useStudio();
  return (
    <Row label={label} htmlFor={id} hint={value ? <>Shows {valueText({ var: value }, vocab)}.</> : hint}>
      <Input id={id} list={`${id}-list`} value={value} onChange={(e) => onChange(e.target.value)} readOnly={readOnly} className="font-mono" placeholder="job.merchant_name" />
      <datalist id={`${id}-list`}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </Row>
  );
}

function PropEditor({
  name,
  spec,
  value,
  onChange,
  vocab,
  fieldChoices,
  suggestions,
}: {
  name: string;
  spec: PropSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  vocab: RuleVocabulary;
  fieldChoices: { value: string; label: string }[];
  suggestions: string[];
}) {
  const { refs } = useStudio();
  const advanced = useIsAdvanced();
  const { label, hint } = propLabel(name);
  const missing = spec.required && (value === undefined || value === '') ? 'Required' : null;
  if (spec.ruleable && isRule(value)) {
    return (
      <Row label={label}>
        <RuleLine sentence={`${label}: ${valueText(value, vocab)}`} rule={value} onChange={onChange} onRemove={() => onChange(undefined)} />
      </Row>
    );
  }
  const k = spec.kind;
  switch (k.t) {
    case 'bool':
      return <SwitchField label={label} hint={hint} checked={value === true} onChange={(v) => onChange(v)} />;
    case 'int':
    case 'number':
      return <NumberField label={label} hint={hint} value={typeof value === 'number' ? value : undefined} onChange={onChange} min={k.min} max={k.max} step={k.t === 'int' ? 1 : undefined} />;
    case 'enum':
      return <SelectField label={label} hint={hint} value={typeof value === 'string' ? value : undefined} onChange={onChange} unsetLabel="Default" options={k.values.map((v) => ({ value: v, label: enumLabel(v) }))} />;
    case 'enum_list':
      return (
        <CheckList
          label={label}
          hint={hint ?? 'None ticked means all of them.'}
          values={asArr(value).map(String)}
          onChange={(v) => onChange(v.length ? v : undefined)}
          options={k.values.map((v) => ({ value: v, label: enumLabel(v) }))}
        />
      );
    case 'string_list':
    case 'key_list':
      return <ListField label={label} hint={hint} values={asArr(value).map(String)} onChange={onChange} />;
    case 'key':
      if (name === 'declaration_key')
        return (
          <SelectField
            label={label}
            hint={missing ?? 'The statement the person agrees to. Set up on the Declarations page.'}
            value={asStr(value) || undefined}
            onChange={onChange}
            options={refs.declarations.map((d) => ({ value: d.key, label: d.title }))}
          />
        );
      if (name === 'list')
        return <SelectField label={label} hint={missing ?? hint} value={asStr(value) || undefined} onChange={onChange} options={refs.lookupLists.map((l) => ({ value: l.key, label: l.title }))} />;
      if (FIELD_REF_PROPS.has(name)) return <SelectField label={label} hint={hint} value={asStr(value) || undefined} onChange={onChange} unsetLabel="Not linked" options={fieldChoices} />;
      return <TextField label={label} hint={hint} invalid={missing} value={asStr(value)} onChange={(v) => onChange(v || undefined)} mono />;
    case 'path':
      return <PathField label={label} hint={hint} value={asStr(value)} onChange={(v) => onChange(v || undefined)} suggestions={suggestions} vocab={vocab} />;
    case 'regex':
      return <TextField label={label} hint={hint} value={asStr(value)} onChange={(v) => onChange(v || undefined)} mono placeholder="^[0-9]{6}$" />;
    case 'string':
    case 'template':
      return (
        <TextField
          label={label}
          hint={hint}
          invalid={missing}
          value={asStr(value)}
          onChange={(v) => onChange(v || undefined)}
          multiline={name === 'text' || name === 'differs_note'}
          rows={name === 'text' ? 3 : 2}
        />
      );
    case 'date':
    case 'time':
    case 'datetime':
      return <TextField label={label} hint={hint ?? (k.t === 'date' ? 'YYYY-MM-DD' : k.t === 'time' ? 'HH:mm' : 'ISO date and time')} value={asStr(value)} onChange={(v) => onChange(v || undefined)} mono />;
    default:
      // asset / target / structured definitions (guidance, matrix rows…): readable here, editable as JSON in Advanced.
      return (
        <Row label={label}>
          {value === undefined ? <Hint>Not set</Hint> : <StructuredView value={value} className="rounded-md border bg-card p-2" />}
          {advanced ? <AdvancedJsonButton value={value} onApply={onChange} label={`Edit ${label.toLowerCase()} as JSON`} /> : null}
        </Row>
      );
  }
}

export function FieldInspector({
  path,
  field,
  update,
  vocab,
  mode,
  takenKeys,
  fieldChoices,
  previousKey,
}: {
  path: Path;
  field: Obj;
  update: Update;
  vocab: RuleVocabulary;
  mode: Mode;
  takenKeys: readonly string[];
  fieldChoices: { value: string; label: string }[];
  /** Key of the question before this one (a sensible first condition to start from). */
  previousKey?: string;
}) {
  const advanced = useIsAdvanced();
  const { readOnly, fresh, refs } = useStudio();
  const type = asStr(field.type);
  const spec = COMPONENTS[type];
  const wording = componentWording(type);
  const key = asStr(field.key);
  const isDisplay = spec?.shape === 'display';
  const isGroup = spec?.shape === 'group';
  const hasValue = spec ? spec.valueType !== 'none' : true;
  const props = asObj(field.props);

  const set = (k: string, v: unknown) => update((d) => setProp(d, path, k, v) as Obj);
  const setP = (k: string, v: unknown) =>
    update(
      (d) =>
        updateIn(d, path, (cur) => {
          const o: Obj = { ...asObj(cur) };
          if (isDisplay) {
            if (v === undefined || v === '') delete o[k];
            else o[k] = v;
            return o;
          }
          const p: Obj = { ...asObj(o.props) };
          if (v === undefined || v === '') delete p[k];
          else p[k] = v;
          if (Object.keys(p).length) o.props = p;
          else delete o.props;
          return o;
        }) as Obj,
    );
  const removeWithUndo = (k: string, what: string) => {
    const old = field[k];
    set(k, undefined);
    toast(`${what} removed`, { action: { label: 'Undo', onClick: () => set(k, old) } });
  };

  function onLabel(v: string) {
    update((d) => {
      let next = setProp(d, path, 'label', v);
      const cur = asStr(asObj(getIn(d, path)).key);
      if (fresh.has(cur)) {
        const nk = uniqueKey(toKey(v || wording.name, 'field'), takenKeys.filter((t) => t !== cur));
        if (nk !== cur) {
          fresh.delete(cur);
          fresh.add(nk);
          next = setProp(next, path, 'key', nk);
        }
      }
      return next as Obj;
    });
  }

  const keyProblem = !KEY_PATTERN.test(key)
    ? 'Use lower-case letters, numbers and _, starting with a letter.'
    : takenKeys.filter((k) => k === key).length > 1
      ? 'Another question already uses this technical name.'
      : null;

  const propNames = spec ? Object.keys(spec.props) : [];
  const basicList = [...(BASIC_PROPS[type] ?? []), ...(mode === 'job_schema' ? ['pattern'] : [])];
  const shownProps = propNames.filter((n) => advanced || basicList.includes(n) || (spec?.props[n]?.required ?? false));
  const hiddenCount = propNames.length - shownProps.length;
  const validate = asArr(field.validate).map(asObj);
  const risk = asObj(field.risk_indicator);
  const hasRisk = isRule(field.risk_indicator);
  const choice = spec?.options === 'static_or_source';
  const suggestions = [...PREFILL_SOURCES, ...asArr(asObj(refs.bundle.jobSchema).attributes).map((a) => `job.attributes.${asStr(asObj(a).key)}`)];

  if (!spec) {
    return (
      <div className="grid gap-3">
        <Hint>
          The admin panel doesn’t know this kind of question yet, so it’s kept as it is.
          {advanced ? (
            <>
              {' '}
              Type: <code>{type || '(none)'}</code>.
            </>
          ) : null}
        </Hint>
        <AdvancedJsonButton value={field} onApply={(v) => update((d) => updateIn(d, path, () => asObj(v)) as Obj)} label="Edit this question as JSON" />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {/* Basics */}
      <div className="grid gap-4">
        {isDisplay ? null : (
          <TextField label={isGroup ? 'Group heading' : 'Question'} value={asStr(field.label)} onChange={onLabel} placeholder={wording.name} hint={isRule(field.label) ? 'This label is computed by a rule.' : undefined} />
        )}
        {!isDisplay ? <TextField label="Help text" value={asStr(field.help_text)} onChange={(v) => set('help_text', v)} placeholder="Optional guidance shown under the question" multiline rows={2} /> : null}
        {advanced ? (
          <TextField
            label="Technical name"
            value={key}
            onChange={(v) => {
              fresh.delete(key);
              set('key', v);
            }}
            mono
            invalid={keyProblem}
            hint="Used in answers, conditions and exports. Changing it after publishing affects answers already collected."
          />
        ) : (
          <>
            {keyProblem ? <p className="text-sm text-destructive">{keyProblem} Switch to Advanced view to change the technical name.</p> : null}
            <Details summary="Technical name">
              <p className="text-sm text-muted-foreground">
                Saved as <code className="rounded border px-1 py-0.5">{key}</code>. It’s used in answers, conditions and exports, and doesn’t change when you
                rename the question.
              </p>
            </Details>
          </>
        )}
        {spec.displays.length > 0 ? (
          <SelectField
            label="How it looks"
            value={asStr(field.display) || undefined}
            onChange={(v) => set('display', v)}
            unsetLabel={`Default (${displayLabel(spec.displays[0] as string)})`}
            options={spec.displays.map((d) => ({ value: d, label: displayLabel(d) }))}
          />
        ) : null}
      </div>

      {/* Required / read-only / visibility */}
      {hasValue || isGroup ? (
        <div className="grid gap-4">
          <SubHeading>When it applies</SubHeading>
          {hasValue && type !== 'computed' && type !== 'prefilled' ? (
            <RuleOrFlag slot="required" title="Answer" value={field.required} onChange={(v) => set('required', v)} vocab={vocab} previousKey={previousKey} offLabel="Optional" onLabel="Required" />
          ) : null}
          {mode === 'form' ? <Visibility field={field} vocab={vocab} previousKey={previousKey} onChange={(v) => set('visible', v)} onRemove={() => removeWithUndo('visible', 'Condition')} /> : null}
          {advanced && hasValue ? (
            <RuleOrFlag slot="read_only" title="Can the agent change it?" value={field.read_only} onChange={(v) => set('read_only', v)} vocab={vocab} previousKey={previousKey} offLabel="Editable" onLabel="Read-only" />
          ) : field.read_only === true ? (
            <p className="text-sm text-muted-foreground">The agent can’t change this answer.</p>
          ) : null}
        </div>
      ) : mode === 'form' ? (
        <div className="grid gap-4">
          <SubHeading>When it shows</SubHeading>
          <Visibility field={field} vocab={vocab} previousKey={previousKey} onChange={(v) => set('visible', v)} onRemove={() => removeWithUndo('visible', 'Condition')} />
        </div>
      ) : null}

      {/* Type settings */}
      {shownProps.length > 0 ? (
        <div className="grid gap-4">
          <SubHeading>{wording.name} settings</SubHeading>
          <div className="grid gap-4 sm:grid-cols-2">
            {shownProps.map((n) => (
              <div key={n} className={cn((['text', 'differs_note', 'source'].includes(n) || isRule(isDisplay ? field[n] : props[n])) && 'sm:col-span-2')}>
                <PropEditor
                  name={n}
                  spec={spec.props[n] as PropSpec}
                  value={isDisplay ? field[n] : props[n]}
                  onChange={(v) => setP(n, v)}
                  vocab={vocab}
                  fieldChoices={fieldChoices}
                  suggestions={suggestions}
                />
              </div>
            ))}
          </div>
          {!advanced && hiddenCount > 0 ? <Hint>{hiddenCount} more setting{hiddenCount === 1 ? '' : 's'} in Advanced view.</Hint> : null}
        </div>
      ) : null}

      {/* Answers */}
      {choice ? <OptionsEditor path={path} field={field} update={update} /> : null}
      {isRule(field.options_filter) ? (
        <RuleLine sentence={slotSentence('options_filter', field.options_filter, vocab)} rule={field.options_filter} onChange={(v) => set('options_filter', v)} onRemove={() => removeWithUndo('options_filter', 'Filter')} />
      ) : null}

      {/* Automatic values, checks, risk */}
      {field.value !== undefined || field.default !== undefined || validate.length > 0 || hasRisk || (advanced && hasValue && !readOnly) ? (
        <div className="grid gap-3">
          <SubHeading>Checks and flags</SubHeading>
          {field.value !== undefined ? (
            <RuleLine sentence={`Filled in automatically with ${valueText(field.value, vocab)}.`} rule={field.value} onChange={(v) => set('value', v)} onRemove={type === 'computed' ? undefined : () => removeWithUndo('value', 'Automatic value')} tone="info" />
          ) : null}
          {field.default !== undefined ? (
            <RuleLine sentence={`Starts with ${valueText(field.default, vocab)}; the agent can change it.`} rule={field.default} onChange={(v) => set('default', v)} onRemove={() => removeWithUndo('default', 'Starting value')} tone="info" />
          ) : null}
          {validate.map((rule, i) => (
            <div key={i} className="grid gap-2 rounded-md border bg-card p-2.5">
              <RuleLine
                sentence={<>Checks that {conditionText(rule.rule, vocab).replace(/^./, (c) => c.toLowerCase())}.</>}
                rule={rule.rule}
                onChange={(v) => update((d) => setProp(d, [...path, 'validate', i], 'rule', v) as Obj)}
                onRemove={() => {
                  const old = field.validate;
                  update((d) => updateIn(d, path, (cur) => {
                    const o = { ...asObj(cur) };
                    const list = asArr(o.validate).filter((_, j) => j !== i);
                    if (list.length) o.validate = list;
                    else delete o.validate;
                    return o;
                  }) as Obj);
                  toast('Check removed', { action: { label: 'Undo', onClick: () => set('validate', old) } });
                }}
                removeLabel="Remove check"
              />
              <TextField label="Message when it fails" value={asStr(rule.message)} onChange={(v) => update((d) => setProp(d, [...path, 'validate', i], 'message', v, false) as Obj)} />
            </div>
          ))}
          {hasRisk ? (
            <div className="grid gap-2 rounded-md border border-amber-200 bg-amber-50/40 p-2.5">
              <RuleLine
                tone="warning"
                sentence={<>Flags {enumLabel(asStr(risk.level)).toLowerCase()} risk when {conditionText(risk.when, vocab).replace(/^./, (c) => c.toLowerCase())}.</>}
                rule={risk.when}
                onChange={(v) => update((d) => setProp(d, [...path, 'risk_indicator'], 'when', v) as Obj)}
                onRemove={() => removeWithUndo('risk_indicator', 'Risk flag')}
                removeLabel="Remove flag"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label="Risk level"
                  value={asStr(risk.level) || undefined}
                  onChange={(v) => update((d) => setProp(d, [...path, 'risk_indicator'], 'level', v ?? 'info') as Obj)}
                  options={[
                    { value: 'info', label: 'For information' },
                    { value: 'elevated', label: 'Elevated' },
                    { value: 'high', label: 'High' },
                  ]}
                />
                <TextField label="What the reviewer sees" value={asStr(risk.label)} onChange={(v) => update((d) => setProp(d, [...path, 'risk_indicator'], 'label', v) as Obj)} />
              </div>
            </div>
          ) : null}
          {advanced && !readOnly && hasValue ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => set('validate', [...validate, { rule: { '!=': [{ var: `answers.${key}` }, null] }, message: 'Please check this answer.' }])}
              >
                <Plus /> Add a check
              </Button>
              {!hasRisk ? (
                <Button type="button" size="sm" variant="outline" onClick={() => set('risk_indicator', { when: { '==': [{ var: `answers.${key}` }, false] }, level: 'elevated', label: '' })}>
                  <Plus /> Add a risk flag
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Advanced extras */}
      {advanced ? (
        <div className="grid gap-4">
          <SubHeading>Reviewer, export and PDF</SubHeading>
          {hasValue ? <TextField label="Note for the reviewer" value={asStr(field.reviewer_note)} onChange={(v) => set('reviewer_note', v)} multiline rows={2} /> : null}
          {hasValue ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Export column name"
                value={asStr(asObj(field.export).column_label)}
                onChange={(v) => update((d) => updateIn(d, path, (cur) => withSub(asObj(cur), 'export', 'column_label', v || undefined)) as Obj)}
                placeholder={asStr(field.label) || key}
              />
              <SwitchField
                label="Include in exports"
                checked={asObj(field.export).include !== false}
                onChange={(v) => update((d) => updateIn(d, path, (cur) => withSub(asObj(cur), 'export', 'include', v ? undefined : false)) as Obj)}
              />
            </div>
          ) : null}
          <SwitchField
            label="Include in the PDF report"
            checked={asObj(field.pdf).include !== false}
            onChange={(v) => update((d) => updateIn(d, path, (cur) => withSub(asObj(cur), 'pdf', 'include', v ? undefined : false)) as Obj)}
          />
          {field.fallback !== undefined ? (
            <Row label="Fallback for older phones">
              <StructuredView value={field.fallback} className="rounded-md border bg-card p-2" />
            </Row>
          ) : null}
          <AdvancedJsonButton value={field} onApply={(v) => update((d) => updateIn(d, path, () => asObj(v)) as Obj)} label="Edit this question as JSON" />
        </div>
      ) : null}
    </div>
  );
}

function Visibility({ field, vocab, previousKey, onChange, onRemove }: { field: Obj; vocab: RuleVocabulary; previousKey?: string; onChange: (v: unknown) => void; onRemove: () => void }) {
  const advanced = useIsAdvanced();
  const { readOnly } = useStudio();
  const [writing, setWriting] = useState(false);
  const v = field.visible;
  return (
    <Row label="When it shows">
      {isRule(v) ? (
        <RuleLine sentence={slotSentence('visible', v, vocab)} rule={v} onChange={onChange} onRemove={onRemove} removeLabel="Always show" />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{v === false ? 'Never (hidden)' : 'Always'}</span>
          {advanced && !readOnly && !writing ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setWriting(true)}>
              <Plus /> Show only when…
            </Button>
          ) : null}
        </div>
      )}
      {writing ? (
        <JsonPartEditor
          value={starterRule(previousKey)}
          label="Show when (JSON logic)"
          rows={5}
          onCancel={() => setWriting(false)}
          onApply={(nv) => {
            onChange(nv);
            setWriting(false);
          }}
        />
      ) : null}
    </Row>
  );
}

/** Set (or with undefined, remove) `obj[group][key]`, dropping the group when it becomes empty. */
function withSub(obj: Obj, group: string, key: string, value: unknown): Obj {
  const out: Obj = { ...obj };
  const g: Obj = { ...asObj(obj[group]) };
  if (value === undefined) delete g[key];
  else g[key] = value;
  if (Object.keys(g).length) out[group] = g;
  else delete out[group];
  return out;
}

