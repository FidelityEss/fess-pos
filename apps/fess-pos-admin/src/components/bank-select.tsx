'use client';

import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBanks } from '@/lib/hooks';

const ALL = '__all__';

/** Bank picker (banks visible under RLS). `allowAll` adds an "All banks" option that maps to null. */
export function BankSelect({
  value,
  onChange,
  includeInactive = false,
  allowAll = false,
  allLabel = 'All banks',
  placeholder = 'Choose a bank',
  disabled,
  id,
  invalid,
  className,
}: {
  value: string | null | undefined;
  onChange: (bankId: string | null) => void;
  includeInactive?: boolean;
  allowAll?: boolean;
  allLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  className?: string;
}) {
  const { data, isLoading } = useBanks({ includeInactive });
  const selectValue = value ?? (allowAll ? ALL : '');
  return (
    <Select value={selectValue} onValueChange={(v) => onChange(v === ALL || v === '' ? null : v)} disabled={disabled || isLoading}>
      <SelectTrigger id={id} aria-invalid={invalid || undefined} className={className}>
        <SelectValue placeholder={isLoading ? 'Loading banks…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowAll ? (
          <>
            <SelectItem value={ALL}>{allLabel}</SelectItem>
            <SelectSeparator />
          </>
        ) : null}
        {(data ?? []).map((b) => (
          <SelectItem key={b.id} value={b.id}>
            <span className="font-mono text-muted-foreground">{b.code}</span> {b.name}
            {!b.active ? ' (inactive)' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
