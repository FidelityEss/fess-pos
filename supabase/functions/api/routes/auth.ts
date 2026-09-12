// Module sessions (docs/07 §2, D-32): exchange a verified host token for a POS session; rotate; sign out.
// Plus the stand-in identity provider for dev/staging (admin-only; refused in production).
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAgent, requirePublishable, requireStaff, signAccessToken } from '../../_shared/auth.ts';
import { randomToken, sha256Hex } from '../../_shared/crypto.ts';
import { asService, rpc, type Tx } from '../../_shared/db.ts';
import { PosError } from '../../_shared/errors.ts';
import { clientIp, rateLimit, readJson, rid } from '../../_shared/http.ts';
import { type IssuerRow, mintDevHostToken, verifyHostToken } from '../../_shared/issuers.ts';
import type { AppEnv } from '../../_shared/types.ts';

export const authRoutes = new Hono<AppEnv>();

const Device = z.object({
  device_id: z.string().uuid(),
  client_type: z.enum(['native', 'web']).optional(),
  platform: z.string().max(40).optional(),
  model: z.string().max(120).optional(),
  os_version: z.string().max(60).optional(),
  host_app_version: z.string().max(60).optional(),
  module_version: z.string().max(60).optional(),
  capabilities: z.record(z.unknown()).optional(),
  push_provider: z.string().max(40).optional(),
  push_token: z.string().max(4096).optional(),
});

const Profile = z.object({
  employee_number: z.string().max(32).optional(),
  first_name: z.string().max(120).optional(),
  last_name: z.string().max(120).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(40).optional(),
  photo_url: z.string().max(2048).optional(),
  extra: z.record(z.string()).optional(),
}).partial();

const ExchangeBody = z.object({
  issuer: z.string().min(1).max(64),
  token: z.string().min(1).max(16384),
  issued_at: z.string().datetime({ offset: true }).optional(),
  secondary_token: z.string().max(16384).optional(),
  device: Device,
  profile: Profile.optional(),
});

const RefreshBody = z.object({ refresh_token: z.string().min(20).max(200), device_id: z.string().uuid() });

interface SessionResult {
  error?: { code: string; message: string };
  session_id: string;
  scope: 'full' | 'ingest_only';
  refresh_expires_at: string;
  device_id: string;
  profile_mismatch: Record<string, unknown> | null;
  user: { id: string; employee_number: string; first_name: string; last_name: string; role: string; active: boolean };
}

async function configNumber(tx: Tx, path: string[], fallback: number): Promise<number> {
  const rows = await tx`select pos.config_value(${path}::text[], ${JSON.stringify(fallback)}::text::jsonb) as v`;
  const v = Number(rows[0]?.v);
  return Number.isFinite(v) ? v : fallback;
}

async function tokensFor(result: SessionResult, refreshToken: string, ttl: number) {
  const access = await signAccessToken({
    userId: result.user.id,
    role: result.user.role,
    scope: result.scope,
    deviceId: result.device_id,
    sessionId: result.session_id,
    ttlSeconds: ttl,
  });
  return {
    access_token: access.token,
    access_expires_at: access.expiresAt,
    refresh_token: refreshToken,
    refresh_expires_at: result.refresh_expires_at,
    session_id: result.session_id,
    scope: result.scope,
    user: result.user,
    server_time: new Date().toISOString(),
  };
}

authRoutes.post('/auth/exchange', requirePublishable, async (c) => {
  rateLimit(`exchange:${clientIp(c) ?? 'unknown'}`, 30, 60_000);
  const body = await readJson(c, ExchangeBody, 64 * 1024);
  const ctx = { id: null, role: 'system', requestId: rid(c) };

  const { issuer, maxAgeH, ttl } = await asService(ctx, async (tx) => ({
    issuer: await rpc<IssuerRow | null>(tx, 'issuer_get', [[body.issuer, 'text']]),
    maxAgeH: await configNumber(tx, ['auth', 'max_host_token_age_h'], 696),
    ttl: await configNumber(tx, ['auth', 'access_token_ttl_s'], 900),
  }));
  if (!issuer || !issuer.active || !issuer.primary_issuer) throw new PosError('ISSUER_NOT_ACCEPTED', `issuer ${body.issuer} is not accepted`);
  if (body.issued_at && Date.now() - Date.parse(body.issued_at) > maxAgeH * 3600_000) {
    throw new PosError('HOST_TOKEN_TOO_OLD', 'host token is older than the host allows; sign in to the host app again');
  }

  const verified = await verifyHostToken(issuer, body.token);
  const refreshToken = randomToken(32);
  const refreshHash = await sha256Hex(refreshToken);
  const result = await asService(ctx, (tx) =>
    rpc<SessionResult>(tx, 'auth_exchange', [
      [issuer.key, 'text'],
      [verified.subject, 'text'],
      [verified.employeeNumber, 'text'],
      [{ first_name: verified.firstName, last_name: verified.lastName }, 'jsonb'],
      [body.device, 'jsonb'],
      [body.profile ?? null, 'jsonb'],
      [refreshHash, 'text'],
      [clientIp(c), 'text'],
      [c.req.header('user-agent') ?? null, 'text'],
    ]));
  if (result.error) throw new PosError(result.error.code, result.error.message);
  return c.json({ ...(await tokensFor(result, refreshToken, ttl)), profile_mismatch: result.profile_mismatch });
});

authRoutes.post('/auth/refresh', requirePublishable, async (c) => {
  rateLimit(`refresh:${clientIp(c) ?? 'unknown'}`, 120, 60_000);
  const body = await readJson(c, RefreshBody, 4096);
  const ctx = { id: null, role: 'system', requestId: rid(c) };
  const next = randomToken(32);
  const { result, ttl } = await asService(ctx, async (tx) => ({
    result: await rpc<SessionResult>(tx, 'auth_refresh', [
      [await sha256Hex(body.refresh_token), 'text'],
      [await sha256Hex(next), 'text'],
      [body.device_id, 'uuid'],
      [clientIp(c), 'text'],
      [c.req.header('user-agent') ?? null, 'text'],
    ]),
    ttl: await configNumber(tx, ['auth', 'access_token_ttl_s'], 900),
  }));
  if (result.error) throw new PosError(result.error.code, result.error.message);
  return c.json(await tokensFor(result, next, ttl));
});

// UI access ends; the outbox keeps draining under ingest_only (docs/03 §3).
authRoutes.post('/auth/signout', requirePublishable, requireAgent(['full', 'ingest_only']), async (c) => {
  const agent = c.get('agent');
  const res = await asService({ id: agent.userId, role: 'pos_agent', requestId: rid(c) }, (tx) =>
    rpc<{ scope: string }>(tx, 'auth_signout', [[agent.sessionId, 'uuid']]));
  return c.json(res);
});

// Stand-in identity provider (instructions §10.5: dev and staging never call FESS). An admin mints the host token
// a host app would hold for a provisioned agent — used by the scenario seeder and the admin "simulate sign-in" tool.
const DevTokenBody = z.object({ user_id: z.string().uuid(), ttl_seconds: z.number().int().min(60).max(86400).optional() });
authRoutes.post('/dev/host-token', requireStaff(), async (c) => {
  const body = await readJson(c, DevTokenBody, 4096);
  const staff = c.get('staff');
  const { issuer, user } = await asService({ id: staff.userId, role: 'pos_admin', requestId: rid(c) }, async (tx) => ({
    issuer: await rpc<IssuerRow | null>(tx, 'issuer_get', [['pos_dev', 'text']]),
    user: (await tx`select employee_number, first_name, last_name, role, active from pos.pos_users where id = ${body.user_id}::uuid`)[0] as
      | { employee_number: string; first_name: string; last_name: string; role: string; active: boolean }
      | undefined,
  }));
  if (!issuer || !issuer.active) throw new PosError('ISSUER_NOT_ACCEPTED', 'the stand-in issuer pos_dev is not active in this environment');
  if (!user) throw new PosError('NOT_FOUND', 'user not found');
  const token = await mintDevHostToken(issuer, user, body.ttl_seconds ?? 3600);
  return c.json({ issuer: 'pos_dev', token, issued_at: new Date().toISOString(), employee_number: user.employee_number });
});
