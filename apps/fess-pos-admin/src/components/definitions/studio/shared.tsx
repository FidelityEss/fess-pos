'use client';

// Small building blocks shared by the structured editors: labelled inputs, reorder controls, rule sentences with the
// Advanced-only rule JSON editor, a JSON "edit this part" block, and template highlighting.
import { ArrowDown, ArrowUp, Braces, Check, GripVertical, Workflow, X } from 'lucide-react';
import { createContext, type DragEvent, type ReactNode, useContext, useId, useState } from 'react';
import { JsonEditor, parseJsonText, stringifyJson } from '@/components/json-editor';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useIsAdvanced } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import type { StudioRefs } from './bundle';

// ── Studio context ─────────────────────────────────────────────────────────────────────────────
export interface StudioContextValue {
  readOnly: boolean;
  refs: StudioRefs;
  /** Bank the family belongs to (null = global) — scopes reason-code previews. */
  bankId: string | null;
  /**
   * Keys (field keys, option values) created in this editing session. Only these follow their label as it is typed;
   * published keys never change silently, because answers, rules and exports depend on them.
   */
  fresh: Set<string>;
}

/** Functional update of the whole document, applied to the latest version (safe across fast edits and undo). */
export type Update = (fn: (doc: Record<string, unknown>) => Record<string, unknown>) => void;

export interface EditorProps {
  doc: Record<string, unknown>;
  update: Update;
  /** Selected element as a document path joined with '/', e.g. "sections/2/fields/0". */
  selected: string | null;
  onSelect: (path: string | null) => void;
}

const Ctx = createContext<StudioContextValue | null>(null);
export const StudioProvider = Ctx.Provider;

export function useStudio(): StudioContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStudio must be used inside <StudioProvider>');
  return v;
}

// ── Labelled rows ──────────────────────────────────────────────────────────────────────────────
export function Row({ label, hint, htmlFor, children, className }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 2,
  mono = false,
  invalid,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
  invalid?: string | null;
  className?: string;
}) {
  const id = useId();
  const { readOnly } = useStudio();
  return (
    <Row label={label} hint={invalid ? <span className="text-destructive">{invalid}</span> : hint} htmlFor={id} className={className}>
      {multiline ? (
        <Textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} readOnly={readOnly} aria-invalid={!!invalid} className={cn(mono && 'font-mono')} />
      ) : (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} readOnly={readOnly} aria-invalid={!!invalid} className={cn(mono && 'font-mono')} />
      )}
    </Row>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  const id = useId();
  const { readOnly } = useStudio();
  return (
    <Row label={label} hint={hint} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        min={min}
        max={max}
        step={step ?? 'any'}
        placeholder={placeholder ?? 'Not set'}
        readOnly={readOnly}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange(undefined);
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="max-w-48"
      />
    </Row>
  );
}

export function SwitchField({ label, hint, checked, onChange }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  const { readOnly } = useStudio();
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={readOnly} className="mt-0.5" />
      <div className="grid gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

const UNSET = '__unset__';

export function SelectField({
  label,
  hint,
  value,
  onChange,
  options,
  unsetLabel,
  placeholder = 'Choose…',
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: readonly { value: string; label: string; description?: string }[];
  /** When given, an extra first option that clears the value. */
  unsetLabel?: string;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const { readOnly } = useStudio();
  const known = value === undefined || options.some((o) => o.value === value);
  return (
    <Row label={label} hint={hint} htmlFor={id} className={className}>
      <Select value={value ?? (unsetLabel ? UNSET : undefined)} onValueChange={(v) => onChange(v === UNSET ? undefined : v)} disabled={readOnly}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {unsetLabel ? <SelectItem value={UNSET}>{unsetLabel}</SelectItem> : null}
          {!known && value ? <SelectItem value={value}>{value} (not found)</SelectItem> : null}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

export function CheckList({
  label,
  hint,
  values,
  onChange,
  options,
}: {
  label: ReactNode;
  hint?: ReactNode;
  values: readonly string[];
  onChange: (v: string[]) => void;
  options: readonly { value: string; label: string; note?: ReactNode }[];
}) {
  const { readOnly } = useStudio();
  const unknown = values.filter((v) => !options.some((o) => o.value === v));
  return (
    <Row label={label} hint={hint}>
      <div className="grid gap-1.5 rounded-md border bg-card p-2">
        {options.length === 0 && unknown.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to choose from.</p> : null}
        {[...options, ...unknown.map((u) => ({ value: u, label: u, note: <span className="text-destructive">not found</span> }))].map((o) => {
          const checked = values.includes(o.value);
          return (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={checked}
                disabled={readOnly}
                onCheckedChange={(c) => {
                  // keep the order of `options` so toggling never shuffles what was chosen
                  const next = c ? [...values, o.value] : values.filter((v) => v !== o.value);
                  const order = [...options.map((x) => x.value), ...unknown];
                  onChange(order.filter((v) => next.includes(v)));
                }}
              />
              <span>{o.label}</span>
              {o.note ? <span className="text-xs text-muted-foreground">{o.note}</span> : null}
            </label>
          );
        })}
      </div>
    </Row>
  );
}

/** A comma-separated list of short strings. */
export function ListField({ label, hint, values, onChange, placeholder }: { label: ReactNode; hint?: ReactNode; values: readonly string[]; onChange: (v: string[] | undefined) => void; placeholder?: string }) {
  const [text, setText] = useState(values.join(', '));
  const [prev, setPrev] = useState(values.join(', '));
  if (values.join(', ') !== prev) {
    setPrev(values.join(', '));
    setText(values.join(', '));
  }
  return (
    <TextField
      label={label}
      hint={hint ?? 'Separate with commas.'}
      value={text}
      placeholder={placeholder}
      onChange={(t) => {
        setText(t);
        const list = t
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        setPrev(list.join(', '));
        onChange(list.length ? list : undefined);
      }}
    />
  );
}

// ── Controls ───────────────────────────────────────────────────────────────────────────────────
export function IconAction({ label, onClick, children, disabled, destructive }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean; destructive?: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      disabled={disabled}
      className={cn(destructive && 'text-destructive hover:bg-red-50 hover:text-destructive')}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </Button>
  );
}

export function ReorderButtons({ index, count, onMove, noun = 'item' }: { index: number; count: number; onMove: (from: number, to: number) => void; noun?: string }) {
  const { readOnly } = useStudio();
  if (readOnly) return null;
  return (
    <span className="flex items-center">
      <IconAction label={`Move ${noun} up`} onClick={() => onMove(index, index - 1)} disabled={index === 0}>
        <ArrowUp />
      </IconAction>
      <IconAction label={`Move ${noun} down`} onClick={() => onMove(index, index + 1)} disabled={index >= count - 1}>
        <ArrowDown />
      </IconAction>
    </span>
  );
}

const DRAG_TYPE = 'application/x-fess-studio';

/**
 * Native drag-and-drop reordering: a grip handle drags, rows are drop targets. Within one list `onMove` reorders; a drop
 * from another list calls `onForeign` when given (e.g. a question dragged into another section). `target(list.length)`
 * on an element after the rows makes "drop at the end" (and dropping into an empty list) possible. The up / down
 * buttons beside each row do the same from the keyboard.
 */
export function useDragReorder(listId: string, onMove: (from: number, to: number) => void, onForeign?: (fromListId: string, from: number, to: number) => void) {
  const { readOnly } = useStudio();
  const [over, setOver] = useState<number | null>(null);
  const handle = (index: number) =>
    readOnly
      ? null
      : (
          <span
            draggable
            onDragStart={(e: DragEvent) => {
              e.stopPropagation();
              e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ listId, index }));
              e.dataTransfer.effectAllowed = 'move';
            }}
            className="flex cursor-grab items-center self-stretch px-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing"
            title="Drag to reorder"
            aria-hidden
          >
            <GripVertical className="size-4" />
          </span>
        );
  const target = (index: number) =>
    readOnly
      ? {}
      : {
          onDragOver: (e: DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            e.stopPropagation();
            if (over !== index) setOver(index);
          },
          onDragLeave: () => setOver((o) => (o === index ? null : o)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(null);
            try {
              const d = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as { listId: string; index: number };
              if (d.listId === listId) {
                if (d.index !== index) onMove(d.index, index);
              } else if (onForeign) onForeign(d.listId, d.index, index);
            } catch {
              // not ours
            }
          },
        };
  return { over, handle, target };
}

// ── Rules ──────────────────────────────────────────────────────────────────────────────────────
/** Edit a JSON value with an explicit Apply (so half-typed JSON never replaces the document). */
export function JsonPartEditor({ value, onApply, onCancel, label, rows = 8 }: { value: unknown; onApply: (v: unknown) => void; onCancel: () => void; label?: string; rows?: number }) {
  const [text, setText] = useState(() => stringifyJson(value ?? null));
  const parsed = parseJsonText(text);
  return (
    <div className="grid gap-2 rounded-md border bg-card p-2">
      <JsonEditor value={text} onChange={setText} rows={rows} label={label} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          <X /> Cancel
        </Button>
        <Button type="button" size="sm" disabled={!parsed.ok} onClick={() => parsed.ok && onApply(parsed.value)}>
          <Check /> Use this
        </Button>
      </div>
    </div>
  );
}

/**
 * A rule shown as a plain-English sentence, for rules that work out a value (a calculated answer, a minimum that
 * depends on an answer). In Advanced view "Edit condition" opens its JSON. Conditions (when it shows, required when,
 * checks, risk flags) use ConditionEditor in rule-builder.tsx instead. Existing rules are always kept intact.
 */
export function RuleLine({
  sentence,
  rule,
  onChange,
  onRemove,
  removeLabel = 'Remove condition',
  tone = 'neutral',
}: {
  sentence: ReactNode;
  rule?: unknown;
  onChange?: (rule: unknown) => void;
  onRemove?: () => void;
  removeLabel?: string;
  tone?: 'neutral' | 'warning' | 'info';
}) {
  const advanced = useIsAdvanced();
  const { readOnly } = useStudio();
  const [editing, setEditing] = useState(false);
  const canEdit = advanced && !readOnly && !!onChange;
  return (
    <div className="grid gap-1.5">
      <div
        className={cn(
          'flex flex-wrap items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm',
          tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-950' : tone === 'info' ? 'border-sky-200 bg-sky-50 text-sky-950' : 'border-violet-200 bg-violet-50/60 text-violet-950',
        )}
      >
        <span className="flex min-w-0 grow basis-64 items-start gap-2">
          <Workflow className="mt-0.5 size-4 shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0 flex-1">{sentence}</span>
        </span>
        {canEdit && !editing ? (
          <span className="ml-auto flex shrink-0 flex-wrap gap-1">
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setEditing(true)}>
              <Braces /> Edit condition
            </Button>
            {onRemove ? (
              <Button type="button" size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive" onClick={onRemove}>
                <X /> {removeLabel}
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      {editing && onChange ? (
        <JsonPartEditor
          value={rule}
          label="Condition (JSON logic)"
          rows={6}
          onCancel={() => setEditing(false)}
          onApply={(v) => {
            onChange(v);
            setEditing(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** "Edit as JSON" for one part of the document (Advanced view only). */
export function AdvancedJsonButton({ value, onApply, label = 'Edit as JSON' }: { value: unknown; onApply: (v: unknown) => void; label?: string }) {
  const advanced = useIsAdvanced();
  const { readOnly } = useStudio();
  const [open, setOpen] = useState(false);
  if (!advanced || readOnly) return null;
  return open ? (
    <JsonPartEditor
      value={value}
      label={label}
      rows={12}
      onCancel={() => setOpen(false)}
      onApply={(v) => {
        onApply(v);
        setOpen(false);
      }}
    />
  ) : (
    <div>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Braces /> {label}
      </Button>
    </div>
  );
}

// ── Display helpers ────────────────────────────────────────────────────────────────────────────
/** Text with {{placeholders}} highlighted. */
export function Highlighted({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\{\{[^}]*\}\})/g);
  return (
    <span className={cn('whitespace-pre-wrap break-words', className)}>
      {parts.map((p, i) =>
        /^\{\{[^}]*\}\}$/.test(p) ? (
          <span key={i} className="rounded bg-sky-100 px-1 font-mono text-[0.85em] text-sky-900">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>;
}

export function SubHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b pb-1">
      <h4 className="text-sm font-semibold text-foreground">{children}</h4>
      {action}
    </div>
  );
}
