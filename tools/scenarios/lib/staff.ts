// Staff (admin panel) sessions for the scenario tools, signed in exactly as a person signs in to the panel: Supabase Auth
// email + password (docs/07 §2, D-96). A second step (TOTP → aal2) is done only when the POS API asks for it, i.e. while
// admin.require_mfa is true, so the tools work whichever way that setting is. New staff join by a registration link
// (inviteAndRegister), the same way a person does on the panel's /register page. Plus a PostgREST reader for the pos
// schema, which the panel also uses for reads (RLS applies, as the staff member).
import * as OTPAuth from 'otpauth';
import { ApiError, call } from './api.ts';
import { adminOrigin, env } from './env.ts';

export interface StaffCreds {
  user_id: string;       // pos.pos_users.id
  email: string;
  password: string;
  totp_secret?: string;  // base32, recorded only if a second step was ever set up
  factor_id?: string;
}

// deno-lint-ignore no-explicit-any
async function gotrue(path: string, opts: { bearer?: string; body?: unknown; service?: boolean; method?: 'POST' | 'PUT' } = {}): Promise<any> {
  const headers: Record<string, string> = { apikey: opts.service ? env.serviceKey : env.publishableKey, 'content-type': 'application/json' };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  else if (opts.service) headers.authorization = `Bearer ${env.serviceKey}`;
  const res = await fetch(`${env.supabaseUrl}/auth/v1${path}`, { method: opts.method ?? 'POST', headers, body: JSON.stringify(opts.body ?? {}) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`auth ${path.split('?')[0]} → ${res.status} ${json.error_code ?? json.code ?? ''} ${json.msg ?? json.message ?? json.error_description ?? ''}`.trim());
    Object.assign(err, { status: res.status, code: json.error_code ?? json.code });
    throw err;
  }
  return json;
}

/** Create a confirmed Auth account (service key). Used only for the seed admin; other staff join by registration link. */
export async function createAuthUser(email: string, password: string): Promise<string> {
  if (!env.serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to create the seed admin Auth account');
  const u = await gotrue('/admin/users', { service: true, body: { email, password, email_confirm: true, app_metadata: { pos_seed: true } } });
  return u.id as string;
}

/** 20 random characters plus a capital, a small letter and a digit: meets the Auth policy (12+, mixed case, digits). */
export function strongPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return `${btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, 'x')}-Aa9`;
}

function totpCode(secret: string): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' }).generate();
}

export class Staff {
  token?: string;
  /** 'aal1' (password) or 'aal2' (password + second step). */
  aal?: 'aal1' | 'aal2';

  constructor(readonly label: string, public creds: StaffCreds) {}

  /** Password sign-in; then the second step only if the POS API asks for it (MFA_REQUIRED). */
  async login(): Promise<void> {
    const s = await gotrue('/token?grant_type=password', { body: { email: this.creds.email, password: this.creds.password } });
    this.token = s.access_token as string;
    this.aal = 'aal1';
    try {
      await this.api('GET', '/me');
    } catch (e) {
      // Anything but MFA_REQUIRED (e.g. FORBIDDEN for an unlinked account) is the caller's to handle on its own /me call.
      if (e instanceof ApiError && e.code === 'MFA_REQUIRED') await this.secondStep(s);
    }
  }

  // deno-lint-ignore no-explicit-any
  private async secondStep(session: any): Promise<void> {
    const bearer = session.access_token as string;
    const verified = ((session.user?.factors ?? []) as Array<{ id: string; status: string; factor_type: string }>)
      .find((f) => f.status === 'verified' && f.factor_type === 'totp');
    if (verified) {
      if (!this.creds.totp_secret) throw new Error(`${this.label}: has a TOTP factor whose secret is not in the tool's state`);
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
    this.aal = 'aal2';
  }

  /** POS API as this staff member; paths without /v1/ are admin routes (/v1/admin/…). */
  // deno-lint-ignore no-explicit-any
  async api<T = any>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    if (!this.token) throw new Error(`${this.label}: not signed in`);
    return await call<T>(method, path.startsWith('/v1/') ? path : `/v1/admin${path}`, { bearer: this.token, body, headers });
  }

  /** Admin routes that make registration links need the panel's address, as the browser sends it (Origin). */
  // deno-lint-ignore no-explicit-any
  async fromPanel<T = any>(path: string, body?: unknown): Promise<T> {
    return await this.api<T>('POST', path, body ?? {}, { origin: adminOrigin });
  }

  /** Read the pos schema through PostgREST as this staff member (RLS applies, and the second-step check when it is on). */
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

/** The token in a registration link (…/register?token_hash=…&type=invite). */
export function linkToken(link: string): string {
  const url = new URL(link);
  const token = url.searchParams.get('token_hash');
  if (!token || url.searchParams.get('type') !== 'invite' || !url.pathname.endsWith('/register')) throw new Error('not a registration link');
  return token;
}

/**
 * Finish a registration link the way the panel's /register page does: spend the token (Supabase Auth confirms the
 * address and returns a session), then choose the password. Returns the session's access token.
 */
export async function registerWithLink(link: string, password: string): Promise<{ accessToken: string; authUid: string }> {
  const s = await gotrue('/verify', { body: { type: 'invite', token_hash: linkToken(link) } });
  await gotrue('/user', { method: 'PUT', bearer: s.access_token, body: { password } });
  return { accessToken: s.access_token as string, authUid: s.user?.id as string };
}

export interface InviteBody {
  email: string;
  user_id?: string;
  person?: {
    employee_number?: string;
    first_name: string;
    last_name: string;
    role: 'pos_admin' | 'pos_bank_reader';
    permissions: string[];
    bank_ids: string[] | null;
  };
}

/** Send a registration link as `admin` and complete it at once, as the new person would. Returns their sign-in. */
export async function inviteAndRegister(admin: Staff, body: InviteBody): Promise<StaffCreds> {
  const r = await admin.fromPanel<{ link: string; user: { id: string } }>('/invitations', body);
  const password = strongPassword();
  const { accessToken } = await registerWithLink(r.link, password);
  await call('POST', '/v1/admin/invitations/accept', { bearer: accessToken });
  return { user_id: r.user.id, email: body.email, password };
}
