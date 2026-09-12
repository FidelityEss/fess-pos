'use client';

// Browser auth helpers: AAL checks, sign-out, the local-only MFA skip flag and safe redirects.
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { env } from './env';
import { getSupabase } from './supabase';

const SKIP_MFA_KEY = 'fess-pos-admin.skip-mfa';
/** Friendly name of the TOTP factor the panel enrols. */
export const TOTP_FRIENDLY_NAME = 'FESS POS admin';

/** True when the local-only "Skip (local test only)" escape hatch is active for this tab. */
export function isMfaSkipped(): boolean {
  if (!env.allowSkipMfa) return false;
  try {
    return window.sessionStorage.getItem(SKIP_MFA_KEY) === '1';
  } catch {
    return false;
  }
}

/** Set or clear the local-only MFA skip flag (no-op unless allowed by env). */
export function setMfaSkipped(skipped: boolean): void {
  try {
    if (skipped && env.allowSkipMfa) window.sessionStorage.setItem(SKIP_MFA_KEY, '1');
    else window.sessionStorage.removeItem(SKIP_MFA_KEY);
  } catch {
    // storage unavailable — nothing to do
  }
}

/** Current Authenticator Assurance Level of the session ('aal1' | 'aal2'), or null when signed out. */
export async function currentAal(): Promise<'aal1' | 'aal2' | null> {
  const { data, error } = await getSupabase().auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return null;
  return data.currentLevel === 'aal2' ? 'aal2' : data.currentLevel === 'aal1' ? 'aal1' : null;
}

/** Only allow same-origin relative redirects, never back into the auth pages. */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (raw.startsWith('/sign-in') || raw.startsWith('/mfa')) return fallback;
  return raw;
}

/** Sign out of this browser (local scope) and clear the skip flag. */
export async function signOut(): Promise<void> {
  setMfaSkipped(false);
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
