'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Tabs (Radix): <Tabs><TabsList><TabsTrigger/></TabsList><TabsContent/></Tabs>. */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('inline-flex h-11 items-center gap-1 border-b w-full', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px inline-flex h-11 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:text-foreground [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('pt-5 focus-visible:outline-none', className)} {...props} />;
}
