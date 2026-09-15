'use client';

// Small building blocks shared by the jobs and review screens.
import { Check, ChevronsUpDown } from 'lucide-react';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { humanize } from '@/lib/format';
import { useMccCodes } from '@/lib/hooks';
import { useIsAdvanced } from '@/lib/preferences';
import type { StatusTone } from '@/lib/status';
import type { MccRiskTier } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';
import { type AttributeDef, flagInfo, toNumber } from './job-data';

/**
 * Job / visit warnings as badges. Basic view shows a plain-language summary ("A photo failed a security check"),
 * merged when several flags mean the same thing; Advanced shows the technical label (tooltip = description + code).
 * `max` limits the badges shown (the rest collapse into "+N more").
 */
export function FlagBadges({ flags, className, empty, max }: { flags: readonly string[] | null | undefined; className?: string; empty?: ReactNode; max?: number }) {
  const advanced = useIsAdvanced();
  if (!flags?.length) return empty ? <>{empty}</> : null;
  const items: { key: string; label: string; tone: StatusTone; title: string }[] = [];
  for (const f of flags) {
    const info = flagInfo(f);
    const label = advanced ? info.label : info.plain;
    const existing = items.find((i) => i.label === label);
    if (existing) {
      existing.title += `\n${info.description}`;
      continue;
    }
    items.push({ key: f, label, tone: info.tone, title: advanced ? `${info.description} (${f})` : info.description });
  }
  const shown = max !== undefined && items.length > max ? items.slice(0, max) : items;
  const hidden = items.slice(shown.length);
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {shown.map((i) => (
        <Badge key={i.key} tone={i.tone} title={i.title} className="whitespace-normal text-left">
          {i.label}
        </Badge>
      ))}
      {hidden.length ? (
        <Badge tone="outline" title={hidden.map((i) => i.label).join('\n')}>
          +{hidden.length} more
        </Badge>
      ) : null}
    </span>
  );
}

/** Titled card section. */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

/** Label/value grid. */
export function KeyValues({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map(([label, value], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 break-words text-base">{value === null || value === undefined || value === '' ? <span className="text-muted-foreground">—</span> : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const RISK_TIER_TONE: Record<MccRiskTier, StatusTone> = { low: 'success', standard: 'neutral', elevated: 'warning', high: 'danger' };

/** Dialog with a form body, inline error and Cancel / submit buttons. */
export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  submitLabel = 'Save',
  destructive = false,
  canSubmit = true,
  pending = false,
  error,
  onSubmit,
  size = 'sm',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  submitLabel?: string;
  destructive?: boolean;
  canSubmit?: boolean;
  pending?: boolean;
  error?: unknown;
  onSubmit: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent size={size}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit && !pending) onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
          <ApiErrorAlert error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={!canSubmit} loading={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Searchable MCC picker (active codes); shows description and risk tier. Value '' = none. */
export function MccPicker({
  value,
  onChange,
  disabled,
  id,
  invalid,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
}) {
  const { data, isLoading, error } = useMccCodes();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = data?.find((m) => m.code === value);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = data ?? [];
    return (t ? list.filter((m) => m.code.includes(t) || m.description.toLowerCase().includes(t)) : list).slice(0, 100);
  }, [data, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" id={id} aria-invalid={invalid || undefined} disabled={disabled} className="w-full justify-between font-normal">
          {selected ? (
            <span className="truncate">
              <span className="font-mono">{selected.code}</span> {selected.description}
            </span>
          ) : value ? (
            <span className="font-mono">{value}</span>
          ) : (
            <span className="text-muted-foreground">{isLoading ? 'Loading business types…' : error ? 'Couldn’t load business types' : 'Choose a business type'}</span>
          )}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0">
        <div className="border-b p-2">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or code" aria-label="Search business types" />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {value ? (
            <button
              type="button"
              className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              Clear selection
            </button>
          ) : null}
          {filtered.map((m) => (
            <button
              key={m.code}
              type="button"
              onClick={() => {
                onChange(m.code);
                setOpen(false);
                setQ('');
              }}
              className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span className="mt-0.5 font-mono text-xs">{m.code}</span>
              <span className="flex-1">{m.description}</span>
              <Badge tone={RISK_TIER_TONE[m.risk_tier]}>{m.risk_tier} risk</Badge>
              {m.code === value ? <Check className="mt-0.5 size-4" /> : null}
            </button>
          ))}
          {data && filtered.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">No business types match.</p> : null}
          {data && filtered.length === 100 ? <p className="px-2 py-1 text-sm text-muted-foreground">Showing the first 100. Type more to narrow it down.</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Job-schema attributes (rendered generically from definition.attributes[]) ─────────────────
const NUMBER_TYPES = ['number', 'integer', 'percentage', 'currency', 'decimal'];
const TEXT_TYPES = ['text', 'email', 'phone'];
const KNOWN_TYPES = [...NUMBER_TYPES, ...TEXT_TYPES, 'textarea', 'single_select', 'multi_select', 'boolean', 'date'];
const NONE = '__none__';

export function isNumberAttribute(def: AttributeDef): boolean {
  return NUMBER_TYPES.includes(def.type);
}

export function isKnownAttributeType(type: string): boolean {
  return KNOWN_TYPES.includes(type);
}

function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

/**
 * Convert a form value to the value sent to the API. `empty` values are omitted. Literal props (pattern, min, max,
 * integer) are pre-checked for a friendly message; the server validates against the job schema regardless.
 */
export function coerceAttributeValue(def: AttributeDef, raw: unknown): { value: unknown; empty: boolean; error: string | null } {
  if (isEmptyValue(raw)) return { value: undefined, empty: true, error: def.required ? `${def.label} is required` : null };
  if (isNumberAttribute(def)) {
    const n = toNumber(raw);
    if (n === null) return { value: raw, empty: false, error: 'Enter a number' };
    if ((def.type === 'integer' || def.props.integer === true) && !Number.isInteger(n)) return { value: n, empty: false, error: 'Enter a whole number' };
    const min = toNumber(def.props.min);
    const max = toNumber(def.props.max);
    if (min !== null && n < min) return { value: n, empty: false, error: `Must be at least ${min}` };
    if (max !== null && n > max) return { value: n, empty: false, error: `Must be at most ${max}` };
    return { value: n, empty: false, error: null };
  }
  if (typeof raw === 'string') {
    const v = raw.trim();
    if (typeof def.props.pattern === 'string') {
      try {
        if (!new RegExp(def.props.pattern).test(v)) return { value: v, empty: false, error: def.help_text ? `This isn’t in the right format. ${def.help_text}` : 'This isn’t in the right format' };
      } catch {
        // an invalid pattern is the definition's problem; the server reports it
      }
    }
    return { value: v, empty: false, error: null };
  }
  return { value: raw, empty: false, error: null };
}

/** Display an attribute value (labels for options, Yes/No for booleans). */
export function formatAttributeValue(def: AttributeDef | undefined, v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const label = (x: unknown) => def?.options.find((o) => o.value === String(x))?.label ?? String(x);
  if (Array.isArray(v)) return v.map(label).join(', ') || '—';
  if (def?.type === 'percentage' && typeof v === 'number') return `${v}%`;
  if (typeof v === 'string' || typeof v === 'number') return def?.options.length ? label(v) : String(v);
  return isPlainObject(v) ? JSON.stringify(v) : String(v);
}

/** Editor for one job-schema attribute. Number inputs keep the raw string; convert with coerceAttributeValue. */
export function AttributeInput({
  def,
  value,
  onChange,
  disabled,
  id,
  invalid,
}: {
  def: AttributeDef;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
}) {
  const groupId = useId();
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);

  if (isNumberAttribute(def)) {
    const integer = def.type === 'integer' || def.props.integer === true;
    return (
      <Input
        id={id}
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        step={integer ? 1 : 'any'}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
      />
    );
  }
  switch (def.type) {
    case 'textarea':
      return <Textarea id={id} rows={3} value={text} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-invalid={invalid || undefined} />;
    case 'date':
      return <Input id={id} type="date" value={text} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-invalid={invalid || undefined} />;
    case 'single_select':
      return (
        <Select value={text || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)} disabled={disabled}>
          <SelectTrigger id={id} aria-invalid={invalid || undefined}>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              <span className="text-muted-foreground">— Not set —</span>
            </SelectItem>
            {def.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'multi_select': {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <div id={id} role="group" aria-labelledby={groupId} className={cn('flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-2.5', invalid && 'border-destructive')}>
          {def.options.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(v) => onChange(v === true ? [...selected, o.value] : selected.filter((s) => s !== o.value))}
                />
                {o.label}
              </label>
            );
          })}
          {def.options.length === 0 ? <span className="text-sm text-muted-foreground">No choices set up yet</span> : null}
        </div>
      );
    }
    case 'boolean':
      return (
        <Select value={value === true ? 'yes' : value === false ? 'no' : NONE} onValueChange={(v) => onChange(v === 'yes' ? true : v === 'no' ? false : undefined)} disabled={disabled}>
          <SelectTrigger id={id} aria-invalid={invalid || undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              <span className="text-muted-foreground">— Not set —</span>
            </SelectItem>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No</SelectItem>
          </SelectContent>
        </Select>
      );
    default:
      return (
        <Input
          id={id}
          type={def.type === 'email' ? 'email' : def.type === 'phone' ? 'tel' : 'text'}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
        />
      );
  }
}

/**
 * Hint under an attribute input: its help text. In Advanced view also the raw format pattern and a note for types the
 * panel enters as plain text; Basic view never shows a raw pattern (T2-30) — the help text should describe the format.
 */
export function attributeHint(def: AttributeDef, advanced = false): ReactNode {
  const note = advanced && !isKnownAttributeType(def.type) ? `No special input for “${def.type}” here, so it’s entered as text.` : null;
  const pattern = advanced && typeof def.props.pattern === 'string' ? `Format (pattern): ${def.props.pattern}` : null;
  const parts = [def.help_text, pattern, note].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/** "unable_to_complete" → "Unable to complete" (re-export for convenience in this folder). */
export const labelOf = humanize;
