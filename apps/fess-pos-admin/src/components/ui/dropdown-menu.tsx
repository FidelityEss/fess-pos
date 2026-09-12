'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Dropdown menu (Radix). */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn('z-50 min-w-44 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in-fade', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

/** Menu item. `destructive` colours it red. */
export function DropdownMenuItem({
  className,
  destructive = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        destructive && 'text-destructive focus:bg-red-50',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn('relative flex cursor-default select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn('px-2 py-1.5 text-sm font-semibold text-muted-foreground', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}
