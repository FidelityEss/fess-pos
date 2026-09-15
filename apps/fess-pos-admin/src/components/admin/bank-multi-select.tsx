'use client';

// Multi-bank picker (banks visible under RLS). `allowedBankIds` limits what can be ticked (null = any).
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useBanks } from '@/lib/hooks';

export function BankMultiSelect({
  value,
  onChange,
  allowedBankIds = null,
  id,
  invalid,
  disabled,
  placeholder = 'Choose banks',
}: {
  value: string[];
  onChange: (bankIds: string[]) => void;
  allowedBankIds?: readonly string[] | null;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { data, isLoading } = useBanks({ includeInactive: true });
  const banks = (data ?? []).filter((b) => allowedBankIds === null || allowedBankIds.includes(b.id) || value.includes(b.id));
  const selected = banks.filter((b) => value.includes(b.id));
  const unknownSelected = value.filter((v) => !banks.some((b) => b.id === v));

  function toggle(bankId: string, on: boolean) {
    onChange(on ? [...value.filter((v) => v !== bankId), bankId] : value.filter((v) => v !== bankId));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled || isLoading}
          data-invalid={invalid || undefined}
          className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-1 text-left text-sm focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-[invalid=true]:border-destructive"
        >
          <span className="flex min-w-0 flex-wrap gap-1">
            {selected.length === 0 && unknownSelected.length === 0 ? (
              <span className="text-muted-foreground">{isLoading ? 'Loading banks…' : placeholder}</span>
            ) : (
              <>
                {selected.map((b) => (
                  <Badge key={b.id} tone="neutral" className="font-mono" title={b.name}>
                    {b.code}
                  </Badge>
                ))}
                {unknownSelected.map((v) => (
                  <Badge key={v} tone="muted" className="font-mono" title={v}>
                    {v.slice(0, 8)}
                  </Badge>
                ))}
              </>
            )}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-1">
        <div className="max-h-64 overflow-y-auto">
          {banks.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No banks available</p>
          ) : (
            banks.map((b) => {
              const allowed = allowedBankIds === null || allowedBankIds.includes(b.id);
              return (
                <label key={b.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                  <Checkbox checked={value.includes(b.id)} disabled={!allowed} onCheckedChange={(v) => toggle(b.id, v === true)} />
                  <span className="font-mono text-muted-foreground">{b.code}</span>
                  <span className="min-w-0 break-words">{b.name}</span>
                  {!b.active ? <span className="text-sm text-muted-foreground">(inactive)</span> : null}
                </label>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
