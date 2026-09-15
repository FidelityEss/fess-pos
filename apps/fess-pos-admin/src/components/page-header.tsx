'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { findNavItem } from '@/components/shell/nav';
import { cn } from '@/lib/utils';

/**
 * Page title row: optional back link, title, one plain sentence saying what the page is for, and an actions slot.
 * On a menu page, leaving `description` undefined uses the menu's own sentence (docs/17 §2 rule 2); pass `null` for none.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode | null;
  actions?: ReactNode;
  back?: { href: string; label?: string };
  children?: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const item = findNavItem(pathname);
  const sentence = description === undefined ? (item && item.href === pathname ? item.description : undefined) : description;
  return (
    <div className={cn('mb-6 flex flex-col gap-3', className)}>
      {back ? (
        <Link href={back.href} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" />
          {back.label ?? 'Back'}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {sentence ? <p className="mt-1.5 max-w-3xl text-base text-muted-foreground">{sentence}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
