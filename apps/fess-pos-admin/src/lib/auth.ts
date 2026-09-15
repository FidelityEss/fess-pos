'use client';

// Browser auth helpers: sign-out, safe redirects and the password rules. Since D-96 (T2-37) admins sign in with email and
// password only; people join by a registration link (/register). There is no authenticator-app step in the panel.
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { getSupabase } from './supabase';

/** Only allow same-origin relative redirects, never back into the sign-in, registration or forgotten-password pages. */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (['/sign-in', '/register', '/forgot-password', '/mfa'].some((p) => raw.startsWith(p))) return fallback;
  return raw;
}

/** Sign out of this browser (local scope). */
export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut({ scope: 'local' });
}

/** Hook: sign out, clear all cached queries, go to /sign-in. */
export function useSignOut(): () => Promise<void> {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    await signOut();
    queryClient.clear();
    router.replace('/sign-in');
  }, [queryClient, router]);
}

// ── Password rules ────────────────────────────────────────────────────────────────────────────
// A mirror of Supabase Auth's policy (supabase/config.toml: minimum_password_length = 12, password_requirements =
// lower_upper_letters_digits). Supabase Auth is the rule; this only lets the page say what's missing before sending.
export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordRule {
  key: 'length' | 'upper' | 'lower' | 'digit';
  label: string;
  met: boolean;
}

export function passwordRules(password: string): PasswordRule[] {
  return [
    { key: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: password.length >= PASSWORD_MIN_LENGTH },
    { key: 'upper', label: 'A capital letter', met: /[A-Z]/.test(password) },
    { key: 'lower', label: 'A small letter', met: /[a-z]/.test(password) },
    { key: 'digit', label: 'A number', met: /[0-9]/.test(password) },
  ];
}
