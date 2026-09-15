'use client';

// "Global" or one bank, for rows that are either global reference data or owned by a bank (reason codes, lookup lists).
// Global needs an all-bank administrator; bank-scoped admins can only pick their own banks (D-44).
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBanks } from '@/lib/hooks';
import { useStaff } from '@/lib/staff';

const GLOBAL = '__global__';

export function ScopeSelect({
  value,
  onChange,
  id,
  invalid,
  disabled,
}: {
  value: string | null;
  onChange: (bankId: string | null) => void;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const staff = useStaff();
  const { data, isLoading } = useBanks();
  const banks = (data ?? []).filter((b) => staff.canAccessBank(b.id));
  return (
    <Select value={value ?? GLOBAL} onValueChange={(v) => onChange(v === GLOBAL ? null : v)} disabled={disabled || isLoading}>
      <SelectTrigger id={id} aria-invalid={invalid || undefined}>
        <SelectValue placeholder={isLoading ? 'Loading banks…' : 'Choose which banks'} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={GLOBAL} disabled={!staff.isGlobalAdmin}>
          All banks{staff.isGlobalAdmin ? '' : ' (only administrators who cover all banks)'}
        </SelectItem>
        {banks.length > 0 ? <SelectSeparator /> : null}
        {banks.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            <span className="font-mono text-muted-foreground">{b.code}</span> {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Default scope for a new row: global for all-bank admins, else the admin's first bank. */
export function defaultScope(staff: { isGlobalAdmin: boolean; me: { bank_ids: string[] | null } }): string | null {
  return staff.isGlobalAdmin ? null : (staff.me.bank_ids?.[0] ?? null);
}
