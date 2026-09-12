'use client';

import { Camera, StickyNote } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useReasonCodes } from '@/lib/hooks';
import type { ReasonCategory, ReasonCode } from '@/lib/types';

/**
 * Select bound to active reason codes for a category (global + the bank's own). Value is the reason `code`.
 * onChange also passes the ReasonCode so forms can enforce `requires_note`.
 */
export function ReasonCodeSelect({
  category,
  bankId,
  value,
  onChange,
  placeholder = 'Choose a reason',
  disabled,
  id,
  invalid,
  showHint = true,
}: {
  category: ReasonCategory;
  bankId?: string | null;
  value: string | null | undefined;
  onChange: (code: string | null, reason: ReasonCode | null) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  showHint?: boolean;
}) {
  const { data, isLoading, error } = useReasonCodes(category, bankId);
  const selected = data?.find((r) => r.code === value) ?? null;
  return (
    <div className="grid gap-1">
      <Select
        value={value ?? ''}
        onValueChange={(code) => onChange(code || null, data?.find((r) => r.code === code) ?? null)}
        disabled={disabled || isLoading}
      >
        <SelectTrigger id={id} aria-invalid={invalid || undefined}>
          <SelectValue placeholder={isLoading ? 'Loading reasons…' : error ? 'Could not load reasons' : placeholder} />
        </SelectTrigger>
        <SelectContent>
          {(data ?? []).map((r) => (
            <SelectItem key={r.id} value={r.code}>
              {r.label}
            </SelectItem>
          ))}
          {data && data.length === 0 ? <div className="px-2 py-1.5 text-sm text-muted-foreground">No reason codes configured</div> : null}
        </SelectContent>
      </Select>
      {showHint && selected ? (
        <div className="space-y-0.5 text-sm text-muted-foreground">
          {selected.description ? <p>{selected.description}</p> : null}
          {selected.requires_note ? (
            <p className="flex items-center gap-1 text-amber-700">
              <StickyNote className="size-4" /> A note is required for this reason.
            </p>
          ) : null}
          {selected.requires_photo ? (
            <p className="flex items-center gap-1 text-amber-700">
              <Camera className="size-4" /> A photo is required for this reason.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
