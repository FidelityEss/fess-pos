// Staff (admin panel) sessions for the scenario tools: Supabase Auth email + password, then TOTP to reach aal2 — exactly
// how an admin signs in to the panel (docs/07 §2, admin.require_mfa). Plus a PostgREST reader for the pos schema, which
// the panel also uses for reads (RLS applies, as the staff member).
import * as OTPAuth from 'otpauth';
import { call } from './api.ts';
import { env } from './env.ts';

export interface StaffCreds {
  user_id: string;       // pos.pos_users.id
  email: string;
  password: string;
  totp_secret?: string;  // base32, recorded at first enrolment
  factor_id?: string;
}

// deno-lint-ignore no-explicit-any
async function gotrue(path: string, opts: { bearer?: string; body?: unknown; service?: boolean } = {}): Promise<any> {
  const headers: Record<string, string> = { apikey: opts.service ? env.serviceKey : env.publishableKey, 'content-type': 'application/json' };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  else if (opts.service) headers.authorization = `Bearer ${env.serviceKey}`;
  const res = await fetch(`${env.supabaseUrl}/auth/v1${path}`, { method: 'POST', headers, body: JSON.stringify(opts.body ?? {}) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`auth ${path.split('?')[0]} → ${res.status} ${json.msg ?? json.message ?? json.error_description ?? text}`);
  return json;
}

/** Create a confirmed Auth account (service key). Used only for the seed admin; other staff go through the admin API. */
export async function createAuthUser(email: string, password: string): Promise<string> {
  if (!env.serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to create the seed admin Auth account');
  const u = await gotrue('/admin/users', { service: true, body: { email, password, email_confirm: true, app_metadata: { pos_seed: true } } });
  return u.id as string;
}

export function strongPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return `${btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, 'x')}-Aa9`;
}

function totpCode(secret: string): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' }).generate();
}

export class Staff {
  token?: string;

  constructor(readonly label: string, public creds: StaffCreds) {}

  /** Password sign-in, then TOTP: enrol at the first sign-in (as the panel forces), verify thereafter → aal2 session. */
  async login(): Promise<void> {
    const s = await gotrue('/token?grant_type=password', { body: { email: this.creds.email, password: this.creds.password } });
    const bearer = s.access_token as string;
    const verified = ((s.user?.factors ?? []) as Array<{ id: string; status: string; factor_type: string }>)
      .find((f) => f.status === 'verified' && f.factor_type === 'totp');
    if (verified) {
      if (!this.creds.totp_secret) throw new Error(`${this.label}: has a TOTP factor whose secret is not in the seed state`);
      this.creds.factor_id = verified.id;
    } else {
      const f = await gotrue('/factors', { bearer, body: { factor_type: 'totp', friendly_name: `seed-${Date.now()}`, issuer: 'FESS POS' } });
      this.creds.factor_id = f.id;
      this.creds.totp_secret = f.totp.secret;
    }
    const challenge = await gotrue(`/factors/${this.creds.factor_id}/challenge`, { bearer });
    const v = await gotrue(`/factors/${this.creds.factor_id}/verify`, {
      bearer, body: { challenge_id: challenge.id, code: totpCode(this.creds.totp_secret!) },
    });
    this.token = v.access_token as string;
  }

  /** POS API as this staff member; paths without /v1/ are admin routes (/v1/admin/…). */
  // deno-lint-ignore no-explicit-any
  async api<T = any>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    if (!this.token) throw new Error(`${this.label}: not signed in`);
    return await call<T>(method, path.startsWith('/v1/') ? path : `/v1/admin${path}`, { bearer: this.token, body });
  }

  /** Read the pos schema through PostgREST as this staff member (RLS and the aal2 check apply). */
  // deno-lint-ignore no-explicit-any
  async select<T = any>(table: string, query: string): Promise<T[]> {
    const res = await fetch(`${env.supabaseUrl}/rest/v1/${table}?${query}`, {
      headers: { apikey: env.publishableKey, authorization: `Bearer ${this.token}`, 'accept-profile': 'pos' },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`select ${table} → ${res.status} ${json.message ?? JSON.stringify(json)}`);
    return json as T[];
  }
}
