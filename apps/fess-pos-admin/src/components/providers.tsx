'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { isApiError } from '@/lib/api';
import { PreferencesProvider } from '@/lib/preferences';
import { DbError } from '@/lib/supabase';

/** App-wide client providers: display preferences, TanStack Query, tooltips, toasts. */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (isApiError(error)) return error.retryable && failureCount < 2;
              if (error instanceof DbError) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <PreferencesProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster position="top-right" richColors closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </PreferencesProvider>
  );
}
