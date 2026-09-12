'use client';

// A radio group rendered as selectable cards (title + explanation per option).
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface RadioCardOption<T extends string> {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** 'danger' highlights a destructive choice in red when selected. */
  tone?: 'default' | 'danger';
}

export function RadioCards<T extends string>({
  value,
  onChange,
  options,
  label,
  columns = 1,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: RadioCardOption<T>[];
  label: string;
  columns?: 1 | 2;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2', className)}>
      {options.map((o) => {
        const checked = o.value === value;
        const danger = o.tone === 'danger';
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex items-start gap-3 rounded-md border bg-card p-3 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              checked && (danger ? 'border-red-400 bg-red-50/60 ring-1 ring-red-300' : 'border-primary bg-primary/5 ring-1 ring-primary/30'),
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                checked ? (danger ? 'border-red-600' : 'border-primary') : 'border-input',
              )}
            >
              {checked ? <span className={cn('size-2 rounded-full', danger ? 'bg-red-600' : 'bg-primary')} /> : null}
            </span>
            <span className="grid gap-0.5">
              <span className="font-medium">{o.title}</span>
              {o.description ? <span className="text-sm text-muted-foreground">{o.description}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
