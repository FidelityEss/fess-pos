import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * "Details" disclosure for technical detail (IDs, hashes, JSON, raw patterns, version internals). Closed by default so
 * the machinery stays out of the way but is one click away (docs/17 §2 rule 5). Pair with <Advanced> when the detail
 * should also be hidden entirely in Basic view.
 */
export function Details({
  summary = 'Details',
  children,
  className,
  defaultOpen = false,
}: {
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details className={cn('group text-sm', className)} open={defaultOpen || undefined}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
        {summary}
      </summary>
      <div className="mt-2 space-y-2 border-l border-divider pl-4">{children}</div>
    </details>
  );
}
