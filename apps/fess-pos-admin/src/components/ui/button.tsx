import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Button styles (also usable on links via `buttonVariants()`). */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive-hover',
        outline: 'border border-input bg-card shadow-sm hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-slate-200',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      // Sized for easy clicking (T2-23): default 40 px, small 36 px at the standard text size.
      size: {
        default: 'h-10 px-4',
        sm: 'h-9 px-3',
        lg: 'h-11 px-5 text-base',
        icon: 'size-10',
        'icon-sm': 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a Next <Link>) with button styles. */
  asChild?: boolean;
  /** Show a spinner and disable. */
  loading?: boolean;
}

/** Button with variants: default | destructive | outline | secondary | ghost | link; sizes default | sm | lg | icon | icon-sm. */
export function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  if (asChild) {
    return (
      <Slot className={cn(buttonVariants({ variant, size, className }))} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button className={cn(buttonVariants({ variant, size, className }))} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
