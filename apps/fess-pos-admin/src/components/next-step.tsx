'use client';

// "Always offer the next step" (docs/17 §2 rule 3, §4.5): after an action, say what happened and offer the obvious next
// thing — "Job created → Assign an agent". A success toast with one button that opens the screen for the next step.
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { toast } from 'sonner';

export interface NextStep {
  /** Button text, e.g. "Assign an agent". */
  label: string;
  /** Where the button goes. */
  href: string;
}

/** Hook: `(message, next?, description?) => void` — a success toast, with a next-step button when `next` is given. */
export function useNextStepToast(): (message: string, next?: NextStep | null, description?: string) => void {
  const router = useRouter();
  return useCallback(
    (message, next, description) => {
      toast.success(message, {
        description,
        duration: next ? 10_000 : undefined,
        action: next ? { label: next.label, onClick: () => router.push(next.href) } : undefined,
      });
    },
    [router],
  );
}
