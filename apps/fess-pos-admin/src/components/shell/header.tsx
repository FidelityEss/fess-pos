'use client';

import { Check, ChevronDown, LogOut, Menu, Type } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSignOut } from '@/lib/auth';
import { humanize, shortId } from '@/lib/format';
import { useBankLookup } from '@/lib/hooks';
import { TEXT_SIZES, usePreferences, type ViewMode } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { cn } from '@/lib/utils';
import { EnvBadge } from './env-banner';
import { findNavItem } from './nav';

const MODES: readonly { value: ViewMode; label: string; hint: string }[] = [
  { value: 'basic', label: 'Basic', hint: 'Everyday screens and plain-language detail' },
  { value: 'advanced', label: 'Advanced', hint: 'Adds technical screens, identifiers and raw data' },
];

/** Basic / Advanced switch (T2-24). */
export function ViewModeSwitch({ className }: { className?: string }) {
  const { viewMode, setViewMode } = usePreferences();
  return (
    <div role="radiogroup" aria-label="View mode" className={cn('inline-flex rounded-lg border bg-muted p-0.5 text-sm', className)}>
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={viewMode === m.value}
          title={m.hint}
          onClick={() => setViewMode(m.value)}
          className={cn(
            'rounded-md px-3 py-1 font-medium transition-colors',
            viewMode === m.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Text-size picker (T2-23): scales the whole panel. */
function TextSizeMenu() {
  const { textSize, setTextSize } = usePreferences();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-10 gap-1.5 px-2.5" aria-label="Text size">
          <Type className="size-5" />
          <span className="hidden text-sm md:inline">Text size</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Text size</DropdownMenuLabel>
        {TEXT_SIZES.map((s) => (
          <DropdownMenuItem key={s.value} onSelect={() => setTextSize(s.value)}>
            <Check className={cn('size-4', textSize === s.value ? 'opacity-100' : 'opacity-0')} />
            <span style={{ fontSize: `${s.px}px` }}>{s.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Top bar: mobile menu button, current section, view mode, text size, env badge, user menu with sign-out. */
export function AppHeader({ onMenuClick }: { onMenuClick: () => void }) {
  const staff = useStaff();
  const pathname = usePathname();
  const signOut = useSignOut();
  const bankLookup = useBankLookup();
  const { viewMode, setViewMode } = usePreferences();
  const { me } = staff;

  const roleLabel = staff.isReader ? 'Bank reader' : staff.isGlobalAdmin ? 'Administrator · all banks' : 'Administrator';
  const bankScope =
    me.bank_ids === null ? 'All banks' : me.bank_ids.map((id) => bankLookup(id)?.code ?? shortId(id)).join(', ') || 'No banks';
  const initials = `${me.first_name.charAt(0)}${me.last_name.charAt(0)}`.toUpperCase() || '?';

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur lg:px-6">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onMenuClick} aria-label="Open navigation">
        <Menu />
      </Button>
      <div className="min-w-0 flex-1 truncate text-base font-semibold">{findNavItem(pathname)?.label}</div>
      <ViewModeSwitch className="hidden sm:inline-flex" />
      <TextSizeMenu />
      <EnvBadge />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-11 gap-2 px-2" aria-label="User menu">
            <span className="flex size-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">{initials}</span>
            <span className="hidden flex-col items-start leading-tight sm:flex">
              <span className="text-sm font-medium">{staff.displayName}</span>
              <span className="text-xs font-normal text-muted-foreground">{roleLabel}</span>
            </span>
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="space-y-1 font-normal">
            <p className="text-sm font-semibold text-foreground">{staff.displayName}</p>
            {me.email ? <p className="text-xs text-muted-foreground">{me.email}</p> : null}
            <p className="text-xs text-muted-foreground">
              {roleLabel} · banks: {bankScope}
            </p>
            {me.permissions.length ? (
              <p className="text-xs text-muted-foreground">Permissions: {me.permissions.map(humanize).join(', ')}</p>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">View</DropdownMenuLabel>
          {MODES.map((m) => (
            <DropdownMenuItem key={m.value} onSelect={() => setViewMode(m.value)}>
              <Check className={cn('size-4', viewMode === m.value ? 'opacity-100' : 'opacity-0')} />
              <span className="flex flex-col">
                <span>{m.label}</span>
                <span className="text-xs text-muted-foreground">{m.hint}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
