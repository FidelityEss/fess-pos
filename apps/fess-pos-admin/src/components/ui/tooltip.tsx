'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Tooltip (Radix). TooltipProvider is already mounted in <Providers>. */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn('z-50 max-w-xs rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-md animate-in-fade', className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/** Shorthand: wrap a single focusable child with a text tooltip. */
export function SimpleTooltip({ content, children, side }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
}
