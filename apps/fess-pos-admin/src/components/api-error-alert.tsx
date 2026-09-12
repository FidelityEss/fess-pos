'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage, isApiError } from '@/lib/api';
import { DbError } from '@/lib/supabase';
import { cn } from '@/lib/utils';

const TITLES: Record<string, string> = {
  UNAUTHENTICATED: 'You are signed out',
  MFA_REQUIRED: 'Two-factor verification required',
  FORBIDDEN: "You don't have permission to do that",
  NOT_FOUND: 'Not found',
  CONFLICT: 'That conflicts with the current state',
  INVALID_TRANSITION: 'That change is not allowed in the current status',
  ALREADY_EXISTS: 'Already exists',
  INVALID_REQUEST: 'Some fields are invalid',
  VALIDATION_FAILED: 'Validation failed',
  INVALID_REASON: 'Invalid reason',
  NOTE_REQUIRED: 'A note is required',
  NETWORK_ERROR: 'Cannot reach the POS API',
};

/** Title for an error (friendly per ApiError code). */
export function errorTitle(error: unknown): string {
  if (isApiError(error)) return TITLES[error.code] ?? 'Request failed';
  if (error instanceof DbError) return error.isMissingFunction ? 'Not available yet' : 'Could not load data';
  return 'Something went wrong';
}

/**
 * Renders any error (ApiError, DbError, Error) with code, message, validation details ([{path,message}]) and
 * the request id. Renders nothing when error is null/undefined.
 */
export function ApiErrorAlert({
  error,
  title,
  onRetry,
  className,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}) {
  if (error === null || error === undefined) return null;
  const api = isApiError(error) ? error : null;
  const db = error instanceof DbError ? error : null;
  const issues = api?.issues ?? [];
  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {title ?? errorTitle(error)}
        {api ? <code className="rounded bg-red-100 px-1 py-0.5 text-xs font-normal">{api.code}</code> : null}
        {db ? <code className="rounded bg-red-100 px-1 py-0.5 text-xs font-normal">{db.code}</code> : null}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{db?.isMissingFunction ? `${db.message} — the database migration for this feature may not be applied yet.` : errorMessage(error)}</p>
        {db?.hint ? <p className="text-sm">Hint: {db.hint}</p> : null}
        {issues.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4 text-sm">
            {issues.slice(0, 20).map((issue, i) => (
              <li key={i}>
                {issue.path || issue.field ? <code className="mr-1 font-medium">{issue.path ?? issue.field}</code> : null}
                {issue.message}
                {issue.code && issue.code.startsWith('warning') ? <span className="ml-1 text-amber-700">(warning)</span> : null}
              </li>
            ))}
            {issues.length > 20 ? <li>…and {issues.length - 20} more</li> : null}
          </ul>
        ) : null}
        {(api?.requestId || onRetry) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {onRetry ? (
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                <RotateCw /> Try again
              </Button>
            ) : null}
            {api?.requestId ? (
              <span className="inline-flex items-center gap-1 text-xs opacity-75">
                Request {api.requestId}
                <CopyButton value={api.requestId} title="Copy request id" />
              </span>
            ) : null}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Page-level error block (use when a whole page's data failed to load). */
export function ErrorState({ error, onRetry, title, className }: { error: unknown; onRetry?: () => void; title?: string; className?: string }) {
  return (
    <div className={cn('mx-auto max-w-2xl py-8', className)}>
      <ApiErrorAlert error={error} onRetry={onRetry} title={title} />
    </div>
  );
}
