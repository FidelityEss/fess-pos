// Reference data: reason codes, MCC codes, lookup lists (immutable versions), declarations (versioned legal text) and
// the module release registry (docs/05 §1, docs/06 §3, docs/13 §3).
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePermission } from '../../../_shared/auth.ts';
import { canonicalHash } from '../../../_shared/engine-adapter.ts';
import { readJson } from '../../../_shared/http.ts';
import type { AppEnv } from '../../../_shared/types.ts';
import { adminRpc, jsonObject, reasonCode, snakeKey, uuid, uuidParam } from './_util.ts';

export const referenceRoutes = new Hono<AppEnv>();
const admin = requirePermission(null);

// ── Reason codes ──────────────────────────────────────────────────────────────────────────────
const ReasonCategory = z.enum([
  'assignment_reject', 'unable_to_complete', 'cancel', 'geofence_override', 'review_return', 'review_reject',
  'appointment_not_secured', 'reassign', 'unschedule', 'envelope_resolution',
]);
const ReasonFields = z.object({
  label: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable(),
  requires_note: z.boolean(),
  requires_photo: z.boolean(),
  billable: z.boolean(),
  sort_order: z.number().int().min(-10000).max(10000),
  active: z.boolean(),
});
const ReasonCreate = ReasonFields.omit({ active: true }).partial().extend({
  category: ReasonCategory,
  code: reasonCode,
  label: ReasonFields.shape.label,
  bank_id: uuid.nullable().optional(),
});

referenceRoutes.post('/reason-codes', admin, async (c) => {
  const body = await readJson(c, ReasonCreate);
  return c.json(await adminRpc(c, 'admin_reason_create', [[body, 'jsonb']]), 201);
});
referenceRoutes.patch('/reason-codes/:id', admin, async (c) => {
  const body = await readJson(c, ReasonFields.partial());
  return c.json(await adminRpc(c, 'admin_reason_update', [[uuidParam(c, 'id'), 'uuid'], [body, 'jsonb']]));
});

// ── MCC codes ─────────────────────────────────────────────────────────────────────────────────
const RiskTier = z.enum(['low', 'standard', 'elevated', 'high']);
referenceRoutes.post('/mcc', admin, async (c) => {
  const body = await readJson(c, z.object({ code: z.string().regex(/^[0-9]{4}$/), description: z.string().trim().min(1).max(300), risk_tier: RiskTier.optional() }));
  return c.json(await adminRpc(c, 'admin_mcc_create', [[body, 'jsonb']]), 201);
});
referenceRoutes.patch('/mcc/:code', admin, async (c) => {
  const code = z.string().regex(/^[0-9]{4}$/).parse(c.req.param('code'));
  const body = await readJson(c, z.object({ description: z.string().trim().min(1).max(300), risk_tier: RiskTier, active: z.boolean() }).partial());
  return c.json(await adminRpc(c, 'admin_mcc_update', [[code, 'text'], [body, 'jsonb']]));
});

// ── Lookup lists ─────────────────────────────────────────────────────────────────────────────
referenceRoutes.post('/lookup-lists', admin, async (c) => {
  const body = await readJson(c, z.object({ key: snakeKey, bank_id: uuid.nullable().optional(), title: z.string().trim().min(1).max(200) }));
  return c.json(await adminRpc(c, 'admin_lookup_list_create', [[body, 'jsonb']]), 201);
});
referenceRoutes.patch('/lookup-lists/:id', admin, async (c) => {
  const body = await readJson(c, z.object({ title: z.string().trim().min(1).max(200) }));
  return c.json(await adminRpc(c, 'admin_lookup_list_update', [[uuidParam(c, 'id'), 'uuid'], [body, 'jsonb']]));
});
const LookupItem = z.object({ value: z.string().min(1).max(200), label: z.string().min(1).max(500), meta: jsonObject.optional() }).strict();
referenceRoutes.post('/lookup-lists/:id/versions', admin, async (c) => {
  const body = await readJson(c, z.object({ items: z.array(LookupItem).min(1).max(5000) }), 4 * 1_048_576);
  const hash = await canonicalHash(body.items);   // sha256(JCS(items)) — the same canonicalisation devices verify with
  return c.json(await adminRpc(c, 'admin_lookup_list_publish', [[uuidParam(c, 'id'), 'uuid'], [body.items, 'jsonb'], [hash, 'text']]), 201);
});

// ── Declarations (immutable versions; hash = sha256 of the text, computed in the database) ──────
referenceRoutes.post('/declarations', admin, async (c) => {
  const body = await readJson(c, z.object({ key: snakeKey, title: z.string().trim().min(1).max(300), text: z.string().trim().min(1).max(50_000) }));
  return c.json(await adminRpc(c, 'admin_declaration_publish', [[body.key, 'text'], [body.title, 'text'], [body.text, 'text']]), 201);
});

// ── Module releases (B7.4) ───────────────────────────────────────────────────────────────────
const ReleaseStatus = z.enum(['supported', 'deprecated', 'unsupported_for_new_work']);
const ReleaseFields = z.object({
  status: ReleaseStatus,
  api_versions: z.array(z.string().regex(/^[0-9]+$/)).min(1).max(10),
  spec_range: z.string().trim().min(1).max(64),
  components: z.record(z.number().int().positive()),
  page_types: z.record(z.number().int().positive()),
  notes: z.string().max(5000).nullable(),
});
const ReleaseCreate = ReleaseFields.partial().extend({
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$/, 'semver'),
  spec_range: ReleaseFields.shape.spec_range,
  released_at: z.string().datetime({ offset: true }).optional(),
});
referenceRoutes.post('/releases', admin, async (c) => {
  const body = await readJson(c, ReleaseCreate);
  return c.json(await adminRpc(c, 'admin_release_create', [[body, 'jsonb']]), 201);
});
referenceRoutes.patch('/releases/:id', admin, async (c) => {
  const body = await readJson(c, ReleaseFields.partial());
  return c.json(await adminRpc(c, 'admin_release_update', [[uuidParam(c, 'id'), 'uuid'], [body, 'jsonb']]));
});
