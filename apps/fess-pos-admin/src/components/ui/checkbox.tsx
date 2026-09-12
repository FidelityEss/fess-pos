'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Checkbox (Radix). `checked` may be true | false | 'indeterminate'. */
export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-[1.125rem] shrink-0 rounded-[4px] border border-input bg-card shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        {props.checked === 'indeterminate' ? <Minus className="size-3.5" /> : <Check className="size-3.5" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
