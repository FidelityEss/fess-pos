'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

// Side panel built on Radix Dialog. Always include a <SheetTitle>.

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/** Slide-in panel. side: right (default) | left; size: sm | md (default) | lg | xl. */
export function SheetContent({
  className,
  children,
  side = 'right',
  size = 'md',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: 'left' | 'right'; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/40 animate-in-fade" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 z-50 flex w-full flex-col bg-card shadow-xl focus:outline-none',
          side === 'right' ? 'right-0 border-l animate-slide-in-right' : 'left-0 border-r animate-slide-in-left',
          width,
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 border-b px-6 py-5 pr-12', className)} {...props} />;
}

/** Scrollable body area. */
export function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex-1 overflow-y-auto px-6 py-5', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex justify-end gap-2 border-t px-6 py-4', className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold leading-snug', className)} {...props} />;
}

export function SheetDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
