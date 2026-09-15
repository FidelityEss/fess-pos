'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { Details } from '@/components/details';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage, isApiError } from '@/lib/api';
import { DbError } from '@/lib/supabase';
import { cn } from '@/lib/utils';

/** What went wrong, in words (per ApiError code). */
const TITLES: Record<string, string> = {
  UNAUTHENTICATED: 'You’ve been signed out',
  MFA_REQUIRED: 'Please confirm it’s you by signing in again',
  FORBIDDEN: 'You’re not allowed to do that',
  NOT_FOUND: 'We couldn’t find that',
  CONFLICT: 'Someone else changed this in the meantime',
  INVALID_TRANSITION: 'That can’t be done at this stage of the job',
  ALREADY_EXISTS: 'That already exists',
  INVALID_REQUEST: 'Some details need fixing',
  VALIDATION_FAILED: 'Some details need fixing',
  INVALID_REASON: 'Please choose a valid reason',
  NOTE_REQUIRED: 'Please add a note',
  NETWORK_ERROR: 'We can’t reach the server. Check your internet connection',
};

/** What to do about it (per ApiError code), when there's a useful hint. */
const NEXT: Record<string, string> = {
  UNAUTHENTICATED: 'Sign in again to carry on.',
  FORBIDDEN: 'Ask an administrator if you need to do this.',
  CONFLICT: 'The page has been refreshed with the latest details. Check them and try again.',
  INVALID_TRANSITION: 'The page has been refreshed with the latest details. Check the job’s status and try again.',
  NETWORK_ERROR: 'Try again in a moment.',
};

/** Title for an error (friendly per ApiError code). */
export function errorTitle(error: unknown): string {
  if (isApiError(error)) return TITLES[error.code] ?? 'That didn’t work';
  if (error instanceof DbError) return error.isMissingFunction ? 'This isn’t available yet' : 'We couldn’t load this';
  return 'Something went wrong';
}

/**
 * Renders any error (ApiError, DbError, Error) in plain words: what went wrong, the server's message, the fields to fix
 * ([{path,message}]) and what to do next. The error code, hint and request id sit behind "Details". Renders nothing when
 * error is null/undefined.
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
  const next = api ? NEXT[api.code] : db && !db.isMissingFunction ? 'Try again. If it keeps happening, tell your administrator.' : undefined;
  const code = api?.code ?? db?.code ?? null;
  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle />
      <AlertTitle>{title ?? errorTitle(error)}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{db?.isMissingFunction ? 'This part of the panel needs a server update that hasn’t been installed yet.' : errorMessage(error)}</p>
        {issues.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4 text-sm">
            {issues.slice(0, 20).map((issue, i) => (
              <li key={i}>
                {issue.message}
                {issue.code && issue.code.startsWith('warning') ? <span className="ml-1 text-amber-700">(a warning, not an error)</span> : null}
              </li>
            ))}
            {issues.length > 20 ? <li>…and {issues.length - 20} more</li> : null}
          </ul>
        ) : null}
        {next ? <p className="text-sm">{next}</p> : null}
        {onRetry ? (
          <div className="pt-1">
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              <RotateCw /> Try again
            </Button>
          </div>
        ) : null}
        {code || api?.requestId || db?.hint || db?.isMissingFunction || issues.some((i) => i.path || i.field) ? (
          <Details summary="Details for support" className="text-red-900/80">
            {code ? (
              <p>
                Error code: <code className="rounded bg-red-100 px-1 py-0.5 text-xs">{code}</code>
              </p>
            ) : null}
            {db?.isMissingFunction ? <p>{db.message}. The database migration for this feature may not be applied yet.</p> : null}
            {db?.hint ? <p>Hint: {db.hint}</p> : null}
            {issues.some((i) => i.path || i.field) ? (
              <ul className="space-y-0.5">
                {issues.slice(0, 20).map((issue, i) =>
                  issue.path || issue.field ? (
                    <li key={i}>
                      <code className="text-xs">{issue.path ?? issue.field}</code>: {issue.message}
                    </li>
                  ) : null,
                )}
              </ul>
            ) : null}
            {api?.requestId ? (
              <span className="inline-flex items-center gap-1 text-xs">
                Request {api.requestId}
                <CopyButton value={api.requestId} title="Copy the request number" />
              </span>
            ) : null}
          </Details>
        ) : null}
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
