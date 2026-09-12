// Authentication for every caller kind (docs/07 §2, D-32):
//   publishable key — required on module-facing routes (auth, sync, ingest, evidence)
//   agent           — POS access token (HS256, signed with the Vault key), session re-checked in the database
//   staff           — Supabase Auth session (email + MFA) mapped to pos_users.admin_auth_uid
//   worker          — pg_cron's shared key (Vault)
import type { Context, MiddlewareHandler } from 'hono';
import { decodeJwt, errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { asService, rpc } from './db.ts';
import { env, TOKEN_AUDIENCE, TOKEN_ISSUER } from './env.ts';
import { PosError } from './errors.ts';
import { rid } from './http.ts';
import { secret, secretKeyBytes } from './secrets.ts';
import type { AgentAuth, AppEnv, StaffAuth } from './types.ts';

function bearer(c: Context): string {
  const h = c.req.header('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) throw new PosError('UNAUTHENTICATED', 'missing bearer token');
  return m[1].trim();
}

export const requirePublishable: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (env.publishableKeys.length === 0) throw new PosError('UNAVAILABLE', 'publishable keys not configured');
  const key = c.req.header('apikey');
  if (!key || !env.publishableKeys.includes(key)) throw new PosError('UNAUTHENTICATED', 'missing or unknown publishable key (apikey header)');
  await next();
};

// ── POS access tokens ─────────────────────────────────────────────────────────────────────────
let signingKey: Uint8Array | null = null;
async function sessionKey(): Promise<Uint8Array> {
  if (!signingKey) signingKey = secretKeyBytes(await secret('pos_session_signing_key'));
  return signingKey;
}

export interface AccessTokenInput {
  userId: string;
  role: string;
  scope: string;
  deviceId: string;
  sessionId: string;
  ttlSeconds: number;
}

export async function signAccessToken(p: AccessTokenInput): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + p.ttlSeconds;
  const token = await new SignJWT({
    token_use: 'pos_access',
    role: 'authenticated',
    pos_user_id: p.userId,
    pos_role: p.role,
    scope: p.scope,
    device_id: p.deviceId,
    session_id: p.sessionId,
  })
    .setProtectedHeader({ alg: 'HS256', kid: 'v1', typ: 'JWT' })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setSubject(p.userId)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(await sessionKey());
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

export function agentClaims(a: { userId: string; role: string; scope: string; deviceId: string; sessionId: string }): Record<string, unknown> {
  return {
    sub: a.userId,
    role: 'authenticated',
    token_use: 'pos_access',
    pos_user_id: a.userId,
    pos_role: a.role,
    scope: a.scope,
    device_id: a.deviceId,
    session_id: a.sessionId,
  };
}

interface SessionState {
  exists: boolean;
  revoked: boolean;
  scope: 'full' | 'ingest_only' | null;
  user_active: boolean | null;
  user_id: string | null;
  device_id: string | null;
}

/** Agent routes. `scopes` lists the session scopes allowed; the database's current scope is authoritative. */
export function requireAgent(scopes: Array<'full' | 'ingest_only'>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c);
    let payload: Record<string, unknown>;
    try {
      const res = await jwtVerify(token, await sessionKey(), { issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE, algorithms: ['HS256'] });
      payload = res.payload as Record<string, unknown>;
    } catch (e) {
      if (e instanceof joseErrors.JWTExpired) throw new PosError('TOKEN_EXPIRED', 'access token expired; refresh');
      throw new PosError('UNAUTHENTICATED', 'invalid access token');
    }
    if (payload.token_use !== 'pos_access') throw new PosError('UNAUTHENTICATED', 'not a POS access token');
    const sessionId = String(payload.session_id);
    const state = await asService({ id: null, role: 'system', requestId: rid(c) }, (tx) =>
      rpc<SessionState>(tx, 'auth_session_state', [[sessionId, 'uuid']]));
    if (!state?.exists || state.revoked) throw new PosError('SESSION_REVOKED', 'session revoked');
    const scope = (state.scope ?? 'ingest_only') as 'full' | 'ingest_only';
    if (!scopes.includes(scope)) throw new PosError('SCOPE_INSUFFICIENT', `this endpoint needs a ${scopes.join(' or ')} session`);
    const auth: AgentAuth = {
      kind: 'agent',
      userId: String(payload.pos_user_id),
      role: payload.pos_role === 'pos_admin' ? 'pos_admin' : 'pos_agent',
      scope,
      deviceId: String(payload.device_id),
      sessionId,
      claims: {},
    };
    auth.claims = agentClaims(auth);
    c.set('agent', auth);
    await next();
  };
}

// ── Staff (admin panel) ───────────────────────────────────────────────────────────────────────
interface StaffRow {
  id: string;
  role: 'pos_admin' | 'pos_bank_reader' | 'pos_agent';
  permissions: string[];
  bank_ids: string[] | null;
  active: boolean;
  first_name: string;
  last_name: string;
  email: string | null;
}

export function requireStaff(opts: { permission?: string; allowReader?: boolean } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c);
    const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: env.publishableKeys[0] ?? '', authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new PosError('UNAUTHENTICATED', 'invalid or expired admin session');
    const user = (await res.json()) as { id: string; email?: string };
    const claims = decodeJwt(token) as Record<string, unknown>;
    const aal = String(claims.aal ?? 'aal1');

    const ctx = { id: null, role: 'system', requestId: rid(c) };
    const [staff, requireMfa] = await asService(ctx, async (tx) => [
      await rpc<StaffRow | null>(tx, 'staff_for_auth_uid', [[user.id, 'uuid']]),
      await rpc<boolean | null>(tx, 'setting', [['admin.require_mfa', 'text']]),
    ] as const);
    if (!staff || !staff.active || staff.role === 'pos_agent') throw new PosError('FORBIDDEN', 'not a POS admin');
    if (staff.role === 'pos_bank_reader' && !opts.allowReader) throw new PosError('FORBIDDEN', 'bank readers cannot use this endpoint');
    if (requireMfa !== false && aal !== 'aal2') throw new PosError('MFA_REQUIRED', 'complete multi-factor authentication first');
    if (opts.permission && !staff.permissions.includes(opts.permission)) {
      throw new PosError('FORBIDDEN', `missing permission ${opts.permission}`, { permission: opts.permission });
    }
    const auth: StaffAuth = {
      kind: 'staff',
      userId: staff.id,
      authUid: user.id,
      role: staff.role,
      permissions: staff.permissions,
      bankIds: staff.bank_ids,
      aal,
      email: user.email ?? staff.email,
      firstName: staff.first_name,
      lastName: staff.last_name,
      accessToken: token,
    };
    c.set('staff', auth);
    await next();
  };
}

/** After requireStaff on a router: gate a single route on a permission (and the admin role unless allowReader). */
export function requirePermission(permission: string | null, opts: { allowReader?: boolean } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const staff = c.get('staff');
    if (!staff) throw new PosError('UNAUTHENTICATED', 'admin session required');
    if (staff.role === 'pos_bank_reader' && !opts.allowReader) throw new PosError('FORBIDDEN', 'bank readers cannot use this endpoint');
    if (permission && !staff.permissions.includes(permission)) {
      throw new PosError('FORBIDDEN', `missing permission ${permission}`, { permission });
    }
    await next();
  };
}

// ── Workers (pg_cron) ─────────────────────────────────────────────────────────────────────────
export const requireWorker: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = c.req.header('x-pos-worker-key');
  if (!key) throw new PosError('UNAUTHENTICATED', 'missing worker key');
  const ok = await asService({ id: null, role: 'system', requestId: rid(c) }, (tx) => rpc<boolean>(tx, 'worker_key_valid', [[key, 'text']]));
  if (!ok) throw new PosError('UNAUTHENTICATED', 'invalid worker key');
  await next();
};
