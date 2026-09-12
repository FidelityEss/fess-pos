'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { env } from '@/lib/env';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { cn } from '@/lib/utils';
import { Brand } from './brand';
import { ViewModeSwitch } from './header';
import { canAccess, isNavItemActive, NAV_GROUPS } from './nav';

/** Grouped navigation, filtered by the staff member's role/permissions and the view mode (Basic hides technical screens). */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => canAccess(i.access, staff) && (advanced || !i.advanced || isNavItemActive(i, pathname))),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center border-b border-white/10 px-4">
        <Link href="/" onClick={onNavigate} aria-label="FESS POS Admin — dashboard">
          <Brand inverted />
        </Link>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label="Main">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-sidebar-muted">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const active = isNavItemActive(item, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.9375rem] transition-colors',
                        active
                          ? 'bg-sidebar-accent font-semibold text-white shadow-[inset_3px_0_0_var(--color-brand-gold)]'
                          : 'hover:bg-sidebar-accent/60 hover:text-white',
                      )}
                    >
                      <item.icon className={cn('size-4 shrink-0', active ? 'text-brand-gold' : 'text-sidebar-muted')} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 space-y-2 border-t border-white/10 px-3 py-3 text-xs text-sidebar-muted">
        <ViewModeSwitch className="w-full justify-stretch border-white/10 bg-sidebar-accent sm:hidden [&>button]:flex-1" />
        <p className="px-1">
          Environment: <span className="font-semibold uppercase text-sidebar-foreground">{env.envName}</span>
        </p>
      </div>
    </div>
  );
}
