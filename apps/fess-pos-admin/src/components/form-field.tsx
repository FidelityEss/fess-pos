import type { ReactNode } from 'react';
import type { ZodError } from 'zod';
import { Label } from '@/components/ui/label';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Field errors keyed by dotted path, e.g. { "address.line1": "Address line 1 is required" }. */
export type FieldErrors = Record<string, string>;

/** Label + control + error/hint. Pass the control as children with a matching id = htmlFor. */
export function FormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  action,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  /** Small element on the right of the label row (e.g. a link or copy button). */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label htmlFor={htmlFor}>
          {label}
          {required ? <span className="text-destructive"> *</span> : null}
        </Label>
        {action}
      </div>
      {children}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Responsive grid for form fields (1 column on mobile). */
export function FormGrid({ cols = 2, className, children }: { cols?: 1 | 2 | 3; className?: string; children: ReactNode }) {
  const grid = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3' }[cols];
  return <div className={cn('grid gap-4', grid, className)}>{children}</div>;
}

/** Titled group of fields. */
export function FormSection({ title, description, className, children }: { title: ReactNode; description?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn('space-y-3', className)}>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Right-aligned row of form buttons. */
export function FormActions({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-wrap items-center justify-end gap-2 pt-2', className)}>{children}</div>;
}

/** First message per dotted path from a ZodError (use with schema.safeParse). */
export function zodFieldErrors(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Field errors from an ApiError's details (INVALID_REQUEST / VALIDATION_FAILED); {} for other errors. */
export function apiFieldErrors(error: unknown): FieldErrors {
  if (!isApiError(error)) return {};
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = (issue.path ?? issue.field ?? '').replace(/^\/+/, '').replace(/\//g, '.');
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}
