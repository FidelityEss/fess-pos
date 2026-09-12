'use client';

import { type QueryKey, useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage, isApiError } from './api';

/** Show an error toast for any thrown value (ApiError code + message + request id). */
export function toastError(error: unknown, title = 'Action failed'): void {
  if (isApiError(error)) {
    const issues = error.issues;
    const extra = issues.length ? ` — ${issues.slice(0, 3).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ')}` : '';
    toast.error(title, {
      description: `${error.message}${extra}`,
      // Keep the request id visible so support can trace it.
      ...(error.requestId ? { action: { label: 'Copy ID', onClick: () => void navigator.clipboard?.writeText(error.requestId ?? '') } } : {}),
    });
    return;
  }
  toast.error(title, { description: errorMessage(error) });
}

export interface MutationWithToastOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  /** Success toast text; return null to suppress (e.g. to show your own for a 202). */
  successMessage?: string | ((data: TData, variables: TVariables) => string | null);
  /** Title of the error toast (default "Action failed"). */
  errorTitle?: string;
  /** Show the error toast (default true). Set false when the form renders <ApiErrorAlert> itself. */
  toastErrors?: boolean;
  /** Query keys (prefixes) to invalidate after success. */
  invalidate?: QueryKey[];
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  onError?: (error: Error, variables: TVariables) => void;
}

/** useMutation + success/error toasts + query invalidation. */
export function useMutationWithToast<TData = unknown, TVariables = void>(
  options: MutationWithToastOptions<TData, TVariables>,
): UseMutationResult<TData, Error, TVariables> {
  const queryClient = useQueryClient();
  return useMutation<TData, Error, TVariables>({
    mutationFn: options.mutationFn,
    onSuccess: async (data, variables) => {
      if (options.invalidate?.length) {
        await Promise.all(options.invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      }
      const msg =
        typeof options.successMessage === 'function' ? options.successMessage(data, variables) : options.successMessage;
      if (msg) toast.success(msg);
      await options.onSuccess?.(data, variables);
    },
    onError: (error, variables) => {
      if (options.toastErrors !== false) toastError(error, options.errorTitle);
      options.onError?.(error, variables);
    },
  });
}
