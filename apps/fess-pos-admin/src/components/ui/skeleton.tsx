import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Loading placeholder block. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} {...props} />;
}
