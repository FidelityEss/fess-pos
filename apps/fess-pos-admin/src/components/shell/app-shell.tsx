'use client';

import { Layers, ShieldX } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { usePreferences } from '@/lib/preferences';
import { AppHeader } from './header';
import { findNavItem, useCanAccessPath } from './nav';

/** In Basic view, a technical screen opened by link says so and offers the switch (it is never blocked). */
function AdvancedScreenNotice() {
  const pathname = usePathname();
  const { viewMode, setViewMode } = usePreferences();
  if (viewMode === 'advanced' || !findNavItem(pathname)?.advanced) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-950">
      <Layers className="size-4 shrink-0" />
      <span className="flex-1">This is a technical screen, normally shown in Advanced view.</span>
      <Button size="sm" variant="outline" onClick={() => setViewMode('advanced')}>
        Switch to Advanced
      </Button>
    </div>
  );
}
import { SidebarNav } from './sidebar';

/** Shown when the current route isn't available to the staff member's role/permissions. */
export function Forbidden() {
  return (
    <Card>
      <EmptyState
        icon={ShieldX}
        title="You don't have access to this page"
        description="Your role or permissions don't include this screen. Ask a POS administrator if you need it."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/">Go to the dashboard</Link>
          </Button>
        }
      />
    </Card>
  );
}

/** Authenticated layout: sidebar (sheet on small screens), header, route-level access guard. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const canAccessPath = useCanAccessPath();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">
        <SidebarNav />
      </aside>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" size="sm" className="w-64 border-r-0 p-0 [&>button]:text-slate-300">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 px-4 py-5 lg:px-8 lg:py-6">
          {canAccessPath(pathname) ? (
            <>
              <AdvancedScreenNotice />
              {children}
            </>
          ) : (
            <Forbidden />
          )}
        </main>
      </div>
    </div>
  );
}
