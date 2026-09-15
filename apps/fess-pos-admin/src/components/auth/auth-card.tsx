import type { ReactNode } from 'react';
import { Brand } from '@/components/shell/brand';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Centred card layout for the sign-in, registration and access-problem pages. */
export function AuthCard({
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-[85vh] items-center justify-center px-4 py-10">
      <div className={cn('w-full', wide ? 'max-w-md' : 'max-w-sm')}>
        <div className="mb-8 flex justify-center">
          <Brand variant="full" />
        </div>
        <Card className="p-6">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          {children ? <div className="mt-5">{children}</div> : null}
        </Card>
        {footer ? <div className="mt-4 flex flex-col items-center gap-2 text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </div>
  );
}
