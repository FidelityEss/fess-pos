'use client';

// Searchable picker over POS users (any role). Value = pos_users.id.
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { employeeName } from '@/lib/format';
import type { PosRole } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ROLE_LABEL } from './admin-ui';
import { type UserOption, useUserOptions } from './queries';

export function UserPicker({
  value,
  onChange,
  roles,
  includeInactive = true,
  placeholder = 'Choose a person',
  allowClear = false,
  id,
  invalid,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (userId: string | null, user: UserOption | null) => void;
  roles?: readonly PosRole[];
  includeInactive?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { data, isLoading, error } = useUserOptions();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const options = useMemo(
    () => (data ?? []).filter((u) => (!roles || roles.includes(u.role)) && (includeInactive || u.active)),
    [data, roles, includeInactive],
  );
  const selected = (data ?? []).find((u) => u.id === value) ?? null;
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = s
      ? options.filter((u) => `${u.employee_number} ${u.first_name} ${u.last_name} ${u.email ?? ''}`.toLowerCase().includes(s))
      : options;
    return list.slice(0, 100);
  }, [options, search]);

  function pick(u: UserOption | null) {
    onChange(u?.id ?? null, u);
    setOpen(false);
    setSearch('');
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('relative', className)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled || isLoading}
            data-invalid={invalid || undefined}
            className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-1 text-left text-sm focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-[invalid=true]:border-destructive"
          >
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>
              {selected ? employeeName(selected) : isLoading ? 'Loading people…' : error ? 'Couldn’t load the list of people' : placeholder}
            </span>
            <ChevronDown className={cn('size-4 shrink-0 opacity-50', allowClear && selected && 'invisible')} />
          </button>
        </PopoverTrigger>
        {allowClear && selected && !disabled ? (
          <button
            type="button"
            onClick={() => pick(null)}
            aria-label="Clear the choice"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-72 p-1">
        <div className="relative p-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Employee number, name or email"
            className="pl-8"
            aria-label="Search people"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No one matches</p>
          ) : (
            filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => pick(u)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
              >
                <Check className={cn('size-4 shrink-0', u.id === value ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0 flex-1 break-words">{employeeName(u)}</span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {ROLE_LABEL[u.role]}
                  {!u.active ? ' · inactive' : ''}
                </span>
              </button>
            ))
          )}
          {options.length > filtered.length && filtered.length === 100 ? (
            <p className="px-2 py-1 text-sm text-muted-foreground">Showing the first 100 — type to narrow down.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
