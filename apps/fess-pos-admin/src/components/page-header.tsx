import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Page title row: optional back link, title, description, and an actions slot on the right. */
export function PageHeader({
  title,
  description,
  actions,
  back,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label?: string };
  children?: ReactNode;
  className?: string;
}) {
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
          {description ? <p className="mt-1.5 max-w-3xl text-base text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
