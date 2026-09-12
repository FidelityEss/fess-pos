import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const alertVariants = cva(
  'relative grid w-full grid-cols-[auto_1fr] items-start gap-x-2.5 gap-y-0.5 rounded-md border px-3.5 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>:not(svg)]:col-start-2',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-foreground',
        info: 'border-sky-200 bg-sky-50 text-sky-900',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
        warning: 'border-amber-200 bg-amber-50 text-amber-900',
        destructive: 'border-red-200 bg-red-50 text-red-900',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** Inline message box. variant: default | info | success | warning | destructive. Put an icon first. */
export function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('font-medium leading-5', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-sm opacity-90 [&_p]:leading-relaxed', className)} {...props} />;
}
