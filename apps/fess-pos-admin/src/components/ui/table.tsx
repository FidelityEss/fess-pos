import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Table primitives. Wrap in a bordered container; the wrapper scrolls horizontally instead of squashing columns. */
export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('bg-slate-50 [&_tr]:border-b', className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return <tfoot className={cn('border-t bg-slate-50 font-medium', className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr className={cn('border-b transition-colors data-[state=selected]:bg-primary/5', className)} {...props} />;
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn('h-10 whitespace-nowrap px-3 text-left align-middle text-sm font-semibold text-slate-600', className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />;
}

export function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return <caption className={cn('mt-3 text-sm text-muted-foreground', className)} {...props} />;
}
