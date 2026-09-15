'use client';

// One control per config leaf type: switch, number (+ slider when the range is small), segmented choice, text with
// format check, version, linked pair, colour. Values are passed through as typed so validation can flag them in place.
import { Eraser, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { durationHint, formatNumber, type Unit } from './config-meta';

export function OnOffControl({
  id,
  checked,
  onChange,
  labels = ['On', 'Off'],
  disabled,
}: {
  id?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  labels?: [string, string];
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <span className={cn('text-base font-medium', checked ? 'text-foreground' : 'text-muted-foreground')}>{checked ? labels[0] : labels[1]}</span>
    </div>
  );
}

function numberText(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

/** Number input with unit, bounds hint and — for small ranges — a slider. */
export function NumberControl({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  invalid,
  slider,
  compact,
}: {
  id?: string;
  value: unknown;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit: Unit | null;
  invalid?: boolean;
  /** Force the slider on/off; default: on when the range has at most 200 steps. */
  slider?: boolean;
  compact?: boolean;
}) {
  const [text, setText] = useState(numberText(value));
  const [prev, setPrev] = useState(value);
  if (!Object.is(prev, value)) {
    setPrev(value);
    if (Number(text) !== value || text.trim() === '') setText(numberText(value));
  }
  const typedBad = text.trim() === '' || !Number.isFinite(Number(text));
  const showSlider = slider ?? (min !== undefined && max !== undefined && (max - min) / step <= 200);
  const hint = typeof value === 'number' ? durationHint(value, unit) : null;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            value={text}
            min={min}
            max={max}
            step={step}
            aria-invalid={invalid || typedBad || undefined}
            onChange={(e) => {
              setText(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n);
            }}
            className={cn('h-10 text-base tabular-nums', compact ? 'w-24' : 'w-28')}
          />
          {unit ? <span className="text-sm text-muted-foreground">{unit.word}</span> : null}
        </div>
        {showSlider && min !== undefined && max !== undefined ? (
          <input
            type="range"
            aria-label="Slide to change the value"
            min={min}
            max={max}
            step={step}
            value={typeof value === 'number' ? value : min}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-2 min-w-32 flex-1 cursor-pointer accent-primary"
          />
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {typedBad ? <span className="text-destructive">Enter a number. </span> : null}
        {min !== undefined && max !== undefined ? `You can choose from ${formatNumber(min, unit)} to ${formatNumber(max, unit)}` : null}
        {hint ? ` · ${formatNumber(value as number, unit)} is ${hint}` : null}
      </p>
    </div>
  );
}

/** Segmented choice for enums. */
export function ChoiceControl({
  id,
  value,
  options,
  onChange,
}: {
  id?: string;
  value: unknown;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div id={id} role="radiogroup" className="inline-flex w-fit flex-wrap gap-1 rounded-lg border bg-muted p-1">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'bg-card text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function TextControl({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  mono,
  list,
  className,
}: {
  id?: string;
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  mono?: boolean;
  list?: string;
  className?: string;
}) {
  return (
    <Input
      id={id}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      list={list}
      spellCheck={false}
      className={cn('h-10 max-w-md text-base', mono && 'font-mono', className)}
    />
  );
}

/** Two linked whole numbers (from ≤ to). */
export function PairControl({
  id,
  value,
  onChange,
  min,
  max,
  invalid,
}: {
  id?: string;
  value: unknown;
  onChange: (v: [number, number]) => void;
  min?: number;
  max?: number;
  invalid?: boolean;
}) {
  const pair = Array.isArray(value) ? value : [];
  const a = typeof pair[0] === 'number' ? pair[0] : (min ?? 0);
  const b = typeof pair[1] === 'number' ? pair[1] : (max ?? 0);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">From</span>
      <Input
        id={id}
        type="number"
        value={a}
        min={min}
        max={max}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange([Number(e.target.value), b])}
        className="h-10 w-20 text-base tabular-nums"
      />
      <span className="text-muted-foreground">to</span>
      <Input
        type="number"
        aria-label="To"
        value={b}
        min={min}
        max={max}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange([a, Number(e.target.value)])}
        className="h-10 w-20 text-base tabular-nums"
      />
      {min !== undefined && max !== undefined ? (
        <span className="text-xs text-muted-foreground">
          You can choose from {min} to {max}
        </span>
      ) : null}
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Colour picker + hex text. */
export function ColorControl({ id, value, onChange, invalid }: { id?: string; value: unknown; onChange: (v: string) => void; invalid?: boolean }) {
  const text = typeof value === 'string' ? value : '';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="color"
        aria-label="Pick a colour"
        value={HEX.test(text) ? text.toLowerCase() : '#006b55'}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-10 w-14 cursor-pointer rounded-md border bg-card p-1"
      />
      <Input
        id={id}
        value={text}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="#1D4ED8"
        aria-invalid={invalid || undefined}
        spellCheck={false}
        className="h-10 w-36 font-mono text-base uppercase"
      />
    </div>
  );
}

/** Wraps a control for a nullable key: "Not set" or a value, with a way to switch between them. */
export function NullableControl({
  value,
  onChange,
  fallback,
  notSetText = 'Not set',
  children,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  /** Value to start from when choosing to set one. */
  fallback: unknown;
  notSetText?: string;
  children: ReactNode;
}) {
  if (value === null) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-md border border-dashed px-2.5 py-1.5 text-base text-muted-foreground">{notSetText}</span>
        <Button type="button" variant="outline" onClick={() => onChange(fallback)}>
          <Plus /> Set a value
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0">{children}</div>
      <Button type="button" variant="ghost" onClick={() => onChange(null)}>
        <Eraser /> Clear it
      </Button>
    </div>
  );
}
