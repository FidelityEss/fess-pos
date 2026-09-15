// Banks, POS users (deactivation, photos), trusted issuers and identity links (docs/05 §1–2, docs/07 §2, B7.1, B7.3,
// B7.6). Admin panel sign-ins are made by registration links in ./invitations.ts (D-96).
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePermission } from '../../../_shared/auth.ts';
import { PosError } from '../../../_shared/errors.ts';
import { readJson } from '../../../_shared/http.ts';
import { service, signedReadUrl } from '../../../_shared/storage.ts';
import type { AppEnv } from '../../../_shared/types.ts';
import { adminRpc, jsonObject, reason, snakeKey, uuid, uuidParam } from './_util.ts';

export const peopleRoutes = new Hono<AppEnv>();
const admin = requirePermission(null);

// ── Banks ─────────────────────────────────────────────────────────────────────────────────────
const Contact = z.object({
  name: z.string().trim().min(1).max(200),
  role: z.string().max(120).optional(),
  email: z.string().email().max(320).optional(),
  phone: z.string().max(40).optional(),
}).passthrough();
const BankFields = z.object({
  name: z.string().trim().min(1).max(200),
  active: z.boolean(),
  contacts: z.array(Contact).max(50),
  export_settings: jsonObject,
  billing_settings: z.record(z.object({ default: z.boolean().optional(), codes: z.record(z.boolean()).optional() })),
  four_eyes_enabled: z.boolean(),
});
const BankCreate = BankFields.partial().extend({ code: z.string().regex(/^[A-Za-z0-9_]{2,16}$/), name: z.string().trim().min(1).max(200) });

peopleRoutes.post('/banks', admin, async (c) => {
  const body = await readJson(c, BankCreate);
  return c.json(await adminRpc(c, 'admin_bank_create', [[body, 'jsonb']]), 201);
});
peopleRoutes.patch('/banks/:id', admin, async (c) => {
  const body = await readJson(c, BankFields.partial());
  return c.json(await adminRpc(c, 'admin_bank_update', [[uuidParam(c, 'id'), 'uuid'], [body, 'jsonb']]));
});

// ── Users ─────────────────────────────────────────────────────────────────────────────────────
const Permission = z.enum(['review_inspections', 'approve_definitions', 'schedule_jobs']);
const UserFields = z.object({
  first_name: z.string().trim().min(1).max(120),
  last_name: z.string().trim().min(1).max(120),
  email: z.string().email().max(320).nullable(),
  phone: z.string().max(40).nullable(),
  role: z.enum(['pos_agent', 'pos_admin', 'pos_bank_reader']),
  permissions: z.array(Permission).max(3),
  bank_ids: z.array(uuid).max(100).nullable(),
  attributes: jsonObject,
});
const UserCreate = UserFields.partial().extend({
  employee_number: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
  first_name: z.string().trim().min(1).max(120),
  last_name: z.string().trim().min(1).max(120),
  role: z.enum(['pos_agent', 'pos_admin', 'pos_bank_reader']),
});

peopleRoutes.post('/users', admin, async (c) => {
  const body = await readJson(c, UserCreate);
  return c.json(await adminRpc(c, 'admin_user_create', [[body, 'jsonb']]), 201);
});
peopleRoutes.patch('/users/:id', admin, async (c) => {
  const body = await readJson(c, UserFields.partial());
  return c.json(await adminRpc(c, 'admin_user_update', [[uuidParam(c, 'id'), 'uuid'], [body, 'jsonb']]));
});

// D-35: ingest_only (default) keeps uploads flowing; hard_revoke refuses everything (reason required, audited).
const Deactivate = z.object({ mode: z.enum(['ingest_only', 'hard_revoke']).default('ingest_only'), reason });
peopleRoutes.post('/users/:id/deactivate', admin, async (c) => {
  const body = await readJson(c, Deactivate);
  return c.json(await adminRpc(c, 'admin_user_deactivate', [[uuidParam(c, 'id'), 'uuid'], [body.mode, 'text'], [body.reason, 'text']]));
});
peopleRoutes.post('/users/:id/reactivate', admin, async (c) => {
  const body = await readJson(c, z.object({ reason }));
  return c.json(await adminRpc(c, 'admin_user_reactivate', [[uuidParam(c, 'id'), 'uuid'], [body.reason, 'text']]));
});

// Admin panel sign-ins are made by registration links (./invitations.ts, D-96). The temporary-password route
// (POST /users/:id/admin-login) was removed with the authenticator-app step (T2-37).

// Profile photo for the authorisation card (profiles bucket, server-derived path, never overwritten).
const PHOTO_TYPES: Record<string, { ext: string; magic: number[] }> = {
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/webp': { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
};
const Photo = z.object({ content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']), data_base64: z.string().min(16).max(7_000_000) });

peopleRoutes.post('/users/:id/photo', admin, async (c) => {
  const userId = uuidParam(c, 'id');
  const body = await readJson(c, Photo, 7_200_000);
  await adminRpc(c, 'admin_user_get', [[userId, 'uuid']]);   // scope check before anything is stored
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(body.data_base64.replace(/^data:[^,]+,/, '')), (ch) => ch.charCodeAt(0));
  } catch {
    throw new PosError('INVALID_REQUEST', 'data_base64 is not valid base64');
  }
  if (bytes.length > 5 * 1024 * 1024) throw new PosError('PAYLOAD_TOO_LARGE', 'photo exceeds 5 MB');
  const spec = PHOTO_TYPES[body.content_type];
  if (!spec || !spec.magic.every((b, i) => bytes[i] === b)) throw new PosError('INVALID_REQUEST', 'file content does not match content_type');
  const path = `users/${userId}/${crypto.randomUUID()}.${spec.ext}`;
  const { error } = await service().storage.from('profiles').upload(path, bytes, { upsert: false, contentType: body.content_type });
  if (error) throw new PosError('UNAVAILABLE', 'storage upload failed');
  return c.json(await adminRpc(c, 'admin_user_set_photo', [[userId, 'uuid'], [path, 'text']]));
});

peopleRoutes.get('/users/:id/photo-url', admin, async (c) => {
  const path = await adminRpc<string>(c, 'admin_user_photo_path', [[uuidParam(c, 'id'), 'uuid']]);
  return c.json({ url: await signedReadUrl('profiles', path, 300), expires_in_s: 300 });
});

// ── Trusted issuers (config, not code — D-05) & identity links ───────────────────────────────
const IssuerFields = z.object({
  type: z.enum(['jwks', 'introspection', 'dev_stub']),
  title: z.string().trim().min(1).max(200),
  issuer: z.string().max(500).nullable(),
  audience: z.string().max(500).nullable(),
  jwks_url: z.string().url().max(2000).nullable(),
  introspection_url: z.string().url().max(2000).nullable(),
  request_template: jsonObject,
  subject_claim: z.string().max(200).nullable(),
  employee_number_source: jsonObject,
  secret_name: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/, 'function secret name (UPPER_SNAKE)').nullable(),
  primary_issuer: z.boolean(),
  active: z.boolean(),
});
const IssuerCreate = IssuerFields.partial().extend({ key: snakeKey, type: IssuerFields.shape.type, title: IssuerFields.shape.title });

peopleRoutes.post('/issuers', admin, async (c) => {
  const body = await readJson(c, IssuerCreate);
  return c.json(await adminRpc(c, 'admin_issuer_create', [[body, 'jsonb']]), 201);
});
peopleRoutes.patch('/issuers/:id', admin, async (c) => {
  const body = await readJson(c, IssuerFields.partial());
  return c.json(await adminRpc(c, 'admin_issuer_update', [[uuidParam(c, 'id'), 'uuid'], [body, 'jsonb']]));
});
peopleRoutes.post('/issuers/:id/active', admin, async (c) => {
  const body = await readJson(c, z.object({ active: z.boolean(), reason }));
  return c.json(await adminRpc(c, 'admin_issuer_set_active', [[uuidParam(c, 'id'), 'uuid'], [body.active, 'boolean'], [body.reason, 'text']]));
});

peopleRoutes.post('/identity-links', admin, async (c) => {
  const body = await readJson(c, z.object({ user_id: uuid, issuer_key: snakeKey, subject: z.string().trim().min(1).max(500) }));
  return c.json(await adminRpc(c, 'admin_identity_link', [[body.user_id, 'uuid'], [body.issuer_key, 'text'], [body.subject, 'text']]), 201);
});
peopleRoutes.post('/identity-links/:id/revoke', admin, async (c) => {
  const body = await readJson(c, z.object({ reason }));
  return c.json(await adminRpc(c, 'admin_identity_revoke', [[uuidParam(c, 'id'), 'uuid'], [body.reason, 'text']]));
});
