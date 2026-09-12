// LOCAL-ONLY e2e authentication. The local stack disables email/password sign-in, so the tests sign the admin in by
// injecting a short-lived aal2 session minted with the local Supabase demo JWT secret — the same token shape GoTrue
// issues after TOTP verification. It refuses any Supabase URL that is not localhost/127.0.0.1, so it can never be
// pointed at staging or production (and never at the FESS project).
//
// Needs a bootstrapped admin: `SUPABASE_SERVICE_ROLE_KEY=… node scripts/bootstrap-admin.mjs --email admin@fess-pos.local`.
import { createHmac } from 'node:crypto';
import type { Page } from '@playwright/test';

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(SUPABASE_URL);
// Public Supabase CLI demo values — valid only against a local stack.
const JWT_SECRET = process.env.E2E_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@fess-pos.local';
const STORAGE_KEY = 'fess-pos-admin.auth';

interface AuthUser {
  id: string;
  email?: string;
}

export async function findAdminUser(email = ADMIN_EMAIL): Promise<AuthUser | null> {
  if (!LOCAL) throw new Error(`e2e auth injection is local-only; refusing ${SUPABASE_URL}`);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=500`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json()) as { users?: AuthUser[] };
  return body.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

export const POS_API_URL = process.env.E2E_POS_API_URL ?? `${SUPABASE_URL}/functions/v1/api`;
export const PUBLISHABLE_KEY = process.env.E2E_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

/** Headers for calling /v1/admin/* as this admin (local only). */
export function adminHeaders(user: AuthUser, aal: 'aal1' | 'aal2' = 'aal2'): Record<string, string> {
  return { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${mintAccessToken(user, aal).token}`, 'content-type': 'application/json' };
}

export function mintAccessToken(user: AuthUser, aal: 'aal1' | 'aal2', ttlSeconds = 1800): { token: string; expiresAt: number } {
  if (!LOCAL) throw new Error(`e2e token minting is local-only; refusing ${SUPABASE_URL}`);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', aal, iat: now, exp: now + ttlSeconds,
    amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: now }],
  });
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return { token: `${header}.${payload}.${sig}`, expiresAt: now + ttlSeconds };
}

/** Put a signed-in session into localStorage before the app boots. */
export async function signInAs(page: Page, user: AuthUser, aal: 'aal1' | 'aal2' = 'aal2'): Promise<void> {
  const { token, expiresAt } = mintAccessToken(user, aal);
  const session = {
    access_token: token,
    refresh_token: `e2e-${user.id}`,
    token_type: 'bearer',
    expires_in: expiresAt - Math.floor(Date.now() / 1000),
    expires_at: expiresAt,
    user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, factors: [] },
  };
  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value);
  }, [STORAGE_KEY, JSON.stringify(session)] as const);
}
