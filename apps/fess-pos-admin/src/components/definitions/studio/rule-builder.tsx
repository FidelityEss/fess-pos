'use client';

// Conditions as sentences (T3-10, docs/04 §4.5, B4.3): "Show it when [all] of these are true: [Is the business trading?]
// [is] [No]". Pick what to check, how and the value from dropdowns, group conditions with all / any / none, and read
// the result back in the same sentence the rest of the studio uses (rule-english.ts). Only complete conditions are
// written to the draft, and a rule opened here and left alone is never changed (rule-model.ts round-trips exactly). A
// rule the builder can't show exactly stays as it is; its JSON can be edited in Advanced view.
import { Braces, Check, Pencil, Plus, Trash2, Workflow, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIsAdvanced } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { canonicalJson } from '../set-up-status';
import { type RuleSlot, type RuleVocabulary, slotSentence, valueText } from './rule-english';
import { buildRule, type Condition, type Group, isComplete, type Literal, OP_LABEL, type OpId, parseRule, type RuleNode, valueShape } from './rule-model';
import type { Subject, SubjectKind } from './rule-subjects';
import { JsonPartEditor, useStudio } from './shared';

const OPS_FOR: Record<SubjectKind, OpId[]> = {
  choice: ['eq', 'ne', 'in', 'not_in', 'answered', 'unanswered'],
  boolean: ['eq', 'answered', 'unanswered'],
  number: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'between', 'answered', 'unanswered'],
  date: ['eq', 'ne', 'answered', 'unanswered'],
  text: ['eq', 'ne', 'starts_with', 'not_empty', 'empty', 'answered', 'unanswered'],
  multi: ['contains', 'not_empty', 'empty'],
};

type Mode = 'all' | 'any' | 'none' | 'not_all';

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** A subject for a path the list doesn't offer (a rule written elsewhere), so it still shows. */
function otherSubject(c: Condition, vocab: RuleVocabulary): Subject {
  const v = c.value ?? c.values?.[0];
  const kind: SubjectKind = typeof v === 'number' || c.op === 'between' || ['lt', 'lte', 'gt', 'gte'].includes(c.op) ? 'number' : typeof v === 'boolean' ? 'boolean' : c.op === 'contains' ? 'multi' : 'text';
  return { path: c.path, label: capitalise(valueText({ var: c.path }, vocab)), group: 'Other', kind };
}

function newCondition(subjects: readonly Subject[], startPath?: string): Condition {
  const s = subjects.find((x) => x.path === startPath) ?? subjects.find((x) => x.group === 'Questions' && !x.note) ?? subjects[0];
  return { t: 'cond', path: s?.path ?? '', op: s ? (OPS_FOR[s.kind][0] as OpId) : 'eq' };
}

/** The condition with a new way of comparing, keeping the value where it still fits. */
function withOp(c: Condition, op: OpId): Condition {
  if (op === c.op) return c;
  const shape = valueShape(op);
  const first = c.value ?? c.values?.[0];
  const next: Condition = { t: 'cond', path: c.path, op };
  if (shape === 'one' && first !== undefined) next.value = first;
  if (shape === 'two' && typeof c.value === 'number') next.value = c.value;
  if (shape === 'list') next.values = first !== undefined && first !== null ? [first] : [];
  return next;
}

function modeOf(g: Group): Mode {
  if (g.not) return g.join === 'or' ? 'none' : 'not_all';
  return g.join === 'and' ? 'all' : 'any';
}

function withMode(g: Group, mode: Mode): Group {
  const { not: _drop, ...rest } = g;
  switch (mode) {
    case 'all':
      return { ...rest, join: 'and' };
    case 'any':
      return { ...rest, join: 'or' };
    case 'none':
      return { ...rest, join: 'or', not: g.not ?? 'object' };
    case 'not_all':
      return { ...rest, join: 'and', not: g.not ?? 'object' };
  }
}

// ── Inputs ────────────────────────────────────────────────────────────────────────────────────
function SubjectSelect({ value, subjects, onChange, disabled }: { value: string; subjects: readonly Subject[]; onChange: (path: string) => void; disabled?: boolean }) {
  const groups = [...new Set(subjects.map((s) => s.group))];
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 w-auto min-w-44 max-w-80" aria-label="What to check">
        <SelectValue placeholder="Choose what to check" />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {groups.map((g) => (
          <SelectGroup key={g}>
            <SelectLabel>{g}</SelectLabel>
            {subjects
              .filter((s) => s.group === g)
              .map((s) => (
                <SelectItem key={s.path} value={s.path}>
                  {s.label}
                  {s.note ? <span className="text-muted-foreground"> ({s.note})</span> : null}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

const asOptionValue = (v: Literal | undefined): string => (v === undefined || v === null ? '' : String(v));

function fromOptionValue(raw: string, kind: SubjectKind): Literal {
  if (kind === 'boolean') return raw === 'true';
  if (kind === 'number') return Number(raw);
  return raw;
}

function OneValue({ cond, subject, onChange, disabled }: { cond: Condition; subject: Subject; onChange: (v: Literal | undefined) => void; disabled?: boolean }) {
  const current = asOptionValue(cond.value);
  if (subject.options?.length) {
    const known = current === '' || subject.options.some((o) => o.value === current);
    return (
      <Select value={current || undefined} onValueChange={(v) => onChange(fromOptionValue(v, subject.kind))} disabled={disabled}>
        <SelectTrigger className="h-9 w-auto min-w-36 max-w-72" aria-label="Value">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {!known ? <SelectItem value={current}>{current} (no longer an answer)</SelectItem> : null}
          {subject.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (subject.kind === 'number') {
    return (
      <Input
        type="number"
        inputMode="decimal"
        aria-label="Value"
        className="h-9 w-32"
        value={typeof cond.value === 'number' ? cond.value : ''}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(e.target.value === '' || !Number.isFinite(n) ? undefined : n);
        }}
      />
    );
  }
  return (
    <Input
      type={subject.kind === 'date' ? 'date' : 'text'}
      aria-label="Value"
      className={cn('h-9', subject.kind === 'date' ? 'w-44' : 'w-56')}
      value={typeof cond.value === 'string' ? cond.value : current}
      placeholder={cond.op === 'matches' ? '^[0-9]{6}$' : 'Type the value'}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ListValue({ cond, subject, onChange, disabled }: { cond: Condition; subject: Subject; onChange: (v: Literal[]) => void; disabled?: boolean }) {
  const values = cond.values ?? [];
  if (subject.options?.length) {
    const unknown = values.filter((v) => !subject.options?.some((o) => o.value === String(v)));
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border px-2.5 py-1.5" role="group" aria-label="Values">
        {[...subject.options.map((o) => ({ value: o.value, label: o.label })), ...unknown.map((u) => ({ value: String(u), label: `${String(u)} (no longer an answer)` }))].map((o) => {
          const checked = values.some((v) => String(v) === o.value);
          return (
            <label key={o.value} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={(c) => {
                  const lit = fromOptionValue(o.value, subject.kind);
                  // Keep the order of the answers, so ticking never shuffles what was chosen.
                  const next = c === true ? [...values, lit] : values.filter((v) => String(v) !== o.value);
                  const order = [...(subject.options ?? []).map((x) => x.value), ...unknown.map(String)];
                  onChange(order.filter((ov) => next.some((v) => String(v) === ov)).map((ov) => next.find((v) => String(v) === ov) as Literal));
                }}
              />
              {o.label}
            </label>
          );
        })}
      </div>
    );
  }
  return (
    <Input
      aria-label="Values, separated by commas"
      className="h-9 w-64"
      placeholder="Separate values with commas"
      value={values.map(String).join(', ')}
      disabled={disabled}
      onChange={(e) =>
        onChange(
          e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
      }
    />
  );
}

function ConditionRow({
  cond,
  lead,
  subjects,
  vocab,
  onChange,
  onRemove,
}: {
  cond: Condition;
  lead: string;
  subjects: readonly Subject[];
  vocab: RuleVocabulary;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const advanced = useIsAdvanced();
  const { readOnly } = useStudio();
  const known = subjects.find((s) => s.path === cond.path);
  const subject = known ?? otherSubject(cond, vocab);
  const list = known || !cond.path ? subjects : [...subjects, subject];
  const ops = [...OPS_FOR[subject.kind], ...(advanced && subject.kind === 'text' ? (['matches'] as OpId[]) : [])];
  if (!ops.includes(cond.op)) ops.push(cond.op);
  const shape = valueShape(cond.op);
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="w-12 shrink-0 text-sm text-muted-foreground">{lead}</span>
      <SubjectSelect
        value={cond.path}
        subjects={list}
        disabled={readOnly}
        onChange={(path) => {
          const s = subjects.find((x) => x.path === path);
          onChange({ t: 'cond', path, op: s ? (OPS_FOR[s.kind][0] as OpId) : 'eq' });
        }}
      />
      <Select value={cond.op} onValueChange={(op) => onChange(withOp(cond, op as OpId))} disabled={readOnly}>
        <SelectTrigger className="h-9 w-auto min-w-32" aria-label="How to compare">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ops.map((op) => (
            <SelectItem key={op} value={op}>
              {OP_LABEL[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {shape === 'one' ? <OneValue cond={cond} subject={subject} disabled={readOnly} onChange={(v) => onChange(v === undefined ? { ...cond, value: undefined } : { ...cond, value: v })} /> : null}
      {shape === 'two' ? (
        <span className="flex items-center gap-2 text-sm">
          <OneValue cond={cond} subject={{ ...subject, kind: 'number', options: undefined }} disabled={readOnly} onChange={(v) => onChange({ ...cond, value: v })} />
          and
          <OneValue cond={{ ...cond, value: cond.to }} subject={{ ...subject, kind: 'number', options: undefined }} disabled={readOnly} onChange={(v) => onChange({ ...cond, to: v })} />
        </span>
      ) : null}
      {shape === 'list' ? <ListValue cond={cond} subject={subject} disabled={readOnly} onChange={(values) => onChange({ ...cond, values })} /> : null}
      {!readOnly ? (
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove this condition" title="Remove this condition" onClick={onRemove}>
          <X />
        </Button>
      ) : null}
    </li>
  );
}

function GroupEditor({
  group,
  depth,
  lead,
  subjects,
  vocab,
  startPath,
  onChange,
  onRemove,
}: {
  group: Group;
  depth: number;
  lead: string;
  subjects: readonly Subject[];
  vocab: RuleVocabulary;
  startPath?: string;
  onChange: (g: Group) => void;
  onRemove?: () => void;
}) {
  const { readOnly } = useStudio();
  const mode = modeOf(group);
  const joinWord = mode === 'all' || mode === 'not_all' ? 'and' : 'or';
  const setItem = (i: number, n: RuleNode) => onChange({ ...group, items: group.items.map((x, j) => (j === i ? n : x)) });
  const removeItem = (i: number) => onChange({ ...group, items: group.items.filter((_, j) => j !== i) });
  return (
    <div className={cn('grid gap-2', depth > 0 && 'rounded-md border border-dashed bg-slate-50/50 p-2.5')}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{lead}</span>
        <Select value={mode} onValueChange={(m) => onChange(withMode(group, m as Mode))} disabled={readOnly}>
          <SelectTrigger className="h-8 w-auto" aria-label="All, any or none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all</SelectItem>
            <SelectItem value="any">any</SelectItem>
            <SelectItem value="none">none</SelectItem>
            {mode === 'not_all' ? <SelectItem value="not_all">not all</SelectItem> : null}
          </SelectContent>
        </Select>
        <span>of these are true:</span>
        {onRemove && !readOnly ? (
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-destructive hover:text-destructive" onClick={onRemove}>
            <Trash2 /> Remove this group
          </Button>
        ) : null}
      </div>
      {group.items.length === 0 ? <p className="text-sm text-amber-800">No conditions yet. Add one.</p> : null}
      <ol className="grid gap-2">
        {group.items.map((item, i) =>
          item.t === 'cond' ? (
            <ConditionRow key={i} cond={item} lead={i === 0 ? '' : joinWord} subjects={subjects} vocab={vocab} onChange={(c) => setItem(i, c)} onRemove={() => removeItem(i)} />
          ) : (
            <li key={i} className="flex gap-2">
              <span className="w-12 shrink-0 pt-1.5 text-sm text-muted-foreground">{i === 0 ? '' : joinWord}</span>
              <div className="min-w-0 flex-1">
                <GroupEditor group={item} depth={depth + 1} lead="Where" subjects={subjects} vocab={vocab} startPath={startPath} onChange={(g) => setItem(i, g)} onRemove={() => removeItem(i)} />
              </div>
            </li>
          ),
        )}
      </ol>
      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...group, items: [...group.items, newCondition(subjects, startPath)] })}>
            <Plus /> Add a condition
          </Button>
          {depth < 2 ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...group, items: [...group.items, { t: 'group', join: 'or', items: [newCondition(subjects, startPath)] }] })}>
              <Plus /> Add a group
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── The builder ────────────────────────────────────────────────────────────────────────────────
/** The top of the builder is always a group; `single` means the rule is one condition and is written back as just that. */
interface Root {
  group: Group;
  single: boolean;
}

function rootOf(node: RuleNode | null, fresh: () => Condition): Root {
  if (!node) return { group: { t: 'group', join: 'and', items: [fresh()] }, single: true };
  return node.t === 'group' ? { group: node, single: false } : { group: { t: 'group', join: 'and', items: [node] }, single: true };
}

function ruleOf(root: Root): RuleNode {
  const g = root.group;
  const only = g.items[0];
  return root.single && g.items.length === 1 && !g.not && only ? only : g;
}

export interface RuleBuilderProps {
  /** The rule being changed, or undefined to start a new one. */
  value: unknown;
  /** Called with the rules JSON each time the conditions are complete. */
  onChange: (rule: unknown) => void;
  subjects: readonly Subject[];
  vocab: RuleVocabulary;
  slot: RuleSlot;
  /** The words before "all / any / none of these are true", e.g. "Show it when". */
  lead: string;
  /** What a new condition checks first (usually the question before this one). */
  startPath?: string;
  /** The sentence for a rule, when the slot's own sentence doesn't fit (checks, risk flags). */
  describe?: (rule: unknown) => ReactNode;
}

export function RuleBuilder({ value, onChange, subjects, vocab, slot, lead, startPath, describe }: RuleBuilderProps) {
  const fresh = () => newCondition(subjects, startPath);
  const [root, setRoot] = useState<Root>(() => rootOf(value === undefined ? null : parseRule(value), fresh));
  // A change from outside (Undo, the JSON editor) replaces what the builder shows; its own writes don't.
  const incoming = canonicalJson(value ?? null);
  const [seen, setSeen] = useState(incoming);
  if (incoming !== seen) {
    setSeen(incoming);
    const parsed = value === undefined ? null : parseRule(value);
    if (parsed) setRoot(rootOf(parsed, fresh));
  }

  function change(group: Group) {
    const next = { ...root, group };
    setRoot(next);
    const node = ruleOf(next);
    if (isComplete(node)) {
      const json = buildRule(node);
      setSeen(canonicalJson(json));
      onChange(json);
    }
  }

  const node = ruleOf(root);
  const complete = isComplete(node);
  const json = complete ? buildRule(node) : null;
  return (
    <div className="grid gap-3 rounded-md border bg-card p-3">
      <GroupEditor group={root.group} depth={0} lead={lead} subjects={subjects} vocab={vocab} startPath={startPath} onChange={change} />
      <p className={cn('flex items-start gap-1.5 border-t pt-2 text-sm', complete ? 'text-violet-900' : 'text-amber-800')} aria-live="polite">
        <Workflow className="mt-0.5 size-4 shrink-0 opacity-70" aria-hidden />
        {complete ? (
          <span>
            <span className="font-medium">Reads: </span>
            {describe ? describe(json) : slotSentence(slot, json, vocab)}
          </span>
        ) : (
          <span>Finish each condition (what to check, how, and the value). It’s saved as soon as it’s complete.</span>
        )}
      </p>
    </div>
  );
}

// ── "When it shows": Always / Only when… / Never ───────────────────────────────────────────────
/** When a question, section or step shows: always, only when a condition holds (built as a sentence), or never. */
export function VisibilityControl({
  value,
  onChange,
  subjects,
  vocab,
  slot = 'visible',
  lead = 'Show it when',
  startPath,
  label = 'When it shows',
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  subjects: readonly Subject[];
  vocab: RuleVocabulary;
  slot?: RuleSlot;
  lead?: string;
  startPath?: string;
  label?: string;
}) {
  const advanced = useIsAdvanced();
  const { readOnly } = useStudio();
  const [writing, setWriting] = useState(false);
  const ruled = value !== null && typeof value === 'object' && !Array.isArray(value);
  const mode = ruled || writing ? 'rule' : value === false ? 'never' : 'always';
  const options = [
    { value: 'always', label: 'Always' },
    { value: 'rule', label: 'Only when…' },
    ...(advanced || value === false ? [{ value: 'never', label: 'Never (hidden)' }] : []),
  ];
  function choose(m: string) {
    if (m === 'rule') {
      if (!ruled) setWriting(true);
      return;
    }
    setWriting(false);
    if (ruled) {
      const old = value;
      toast('Condition removed', { action: { label: 'Undo', onClick: () => onChange(old) } });
    }
    onChange(m === 'never' ? false : undefined);
  }
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="inline-flex w-fit flex-wrap rounded-md border bg-card p-0.5" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={mode === o.value}
            disabled={readOnly}
            onClick={() => choose(o.value)}
            className={cn('rounded px-3 py-1 text-sm disabled:opacity-60', mode === o.value ? 'bg-card font-medium text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}
          >
            {o.label}
          </button>
        ))}
      </div>
      {mode === 'rule' ? (
        <ConditionEditor
          key="visibility"
          rule={ruled ? value : undefined}
          onChange={(v) => {
            onChange(v);
            setWriting(false);
          }}
          onCancel={() => setWriting(false)}
          subjects={subjects}
          vocab={vocab}
          slot={slot}
          lead={lead}
          startPath={startPath}
        />
      ) : null}
    </div>
  );
}

// ── A condition in an editor: the sentence, with Change / Remove / JSON ───────────────────────────
export interface ConditionEditorProps {
  /** The rule, or undefined while a new one is being written. */
  rule: unknown;
  onChange: (rule: unknown) => void;
  onRemove?: () => void;
  /** While a new condition is being written: go back without one. */
  onCancel?: () => void;
  subjects: readonly Subject[];
  vocab: RuleVocabulary;
  slot: RuleSlot;
  lead: string;
  startPath?: string;
  describe?: (rule: unknown) => ReactNode;
  removeLabel?: string;
  tone?: 'neutral' | 'warning';
}

export function ConditionEditor({ rule, onChange, onRemove, onCancel, subjects, vocab, slot, lead, startPath, describe, removeLabel = 'Remove condition', tone = 'neutral' }: ConditionEditorProps) {
  const advanced = useIsAdvanced();
  const { readOnly } = useStudio();
  const isNew = rule === undefined;
  const [open, setOpen] = useState(isNew);
  const [json, setJson] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const buildable = isNew || parseRule(rule) !== null;
  const sentence = isNew ? null : describe ? describe(rule) : slotSentence(slot, rule, vocab);

  return (
    <div className="grid gap-2">
      {!isNew ? (
        <div
          className={cn(
            'flex flex-wrap items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm',
            tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-violet-200 bg-violet-50/60 text-violet-950',
          )}
        >
          <span className="flex min-w-0 grow basis-64 items-start gap-2">
            <Workflow className="mt-0.5 size-4 shrink-0 opacity-70" aria-hidden />
            <span className="min-w-0 flex-1">{sentence}</span>
          </span>
          {!readOnly ? (
            <span className="ml-auto flex shrink-0 flex-wrap gap-1">
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {open ? <Check /> : <Pencil />} {open ? 'Done' : 'Change'}
              </Button>
              {advanced ? (
                <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setJson((j) => !j)} aria-expanded={json}>
                  <Braces /> JSON
                </Button>
              ) : null}
              {onRemove ? (
                <Button type="button" size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive" onClick={onRemove}>
                  <X /> {removeLabel}
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {open && !readOnly ? (
        buildable || replacing ? (
          <>
            <RuleBuilder
              key={replacing ? 'replace' : 'edit'}
              value={replacing ? undefined : rule}
              onChange={(r) => {
                setReplacing(false);
                onChange(r);
              }}
              subjects={subjects}
              vocab={vocab}
              slot={slot}
              lead={lead}
              startPath={startPath}
              describe={describe}
            />
            {isNew && onCancel ? (
              <div>
                <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="grid gap-2 rounded-md border bg-card p-3 text-sm">
            <p>This condition is more detailed than the dropdowns can show, so it’s kept exactly as it is.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setReplacing(true)}>
                Start a new condition instead
              </Button>
              {advanced ? null : <span className="self-center text-muted-foreground">Or switch to Advanced view to change it as JSON.</span>}
            </div>
          </div>
        )
      ) : null}

      {json && advanced && !readOnly && !isNew ? (
        <JsonPartEditor
          value={rule}
          label="Condition (JSON)"
          rows={6}
          onCancel={() => setJson(false)}
          onApply={(v) => {
            onChange(v);
            setJson(false);
          }}
        />
      ) : null}
    </div>
  );
}
