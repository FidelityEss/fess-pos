import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Badge colours; the tone names match `StatusTone` in lib/status.ts. */
export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[0.8125rem] font-medium leading-5 [&_svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: 'border-slate-200 bg-slate-100 text-slate-700',
        info: 'border-sky-200 bg-sky-50 text-sky-800',
        accent: 'border-primary/25 bg-primary/10 text-primary-hover',
        progress: 'border-violet-200 bg-violet-50 text-violet-800',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        warning: 'border-amber-200 bg-amber-50 text-amber-800',
        danger: 'border-red-200 bg-red-50 text-red-700',
        muted: 'border-slate-200 bg-white text-slate-500',
        outline: 'border-border bg-transparent text-foreground',
        solid: 'border-transparent bg-primary text-primary-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

/** Small label. tone: neutral | info | accent | progress | success | warning | danger | muted | outline | solid. */
export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
