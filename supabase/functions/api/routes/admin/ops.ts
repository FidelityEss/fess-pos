// Review decisions and amendments, evidence access, envelope inbox, alerts, sessions & devices, exports, queue depths and
// the server epoch (docs/06 §2, docs/07 §2 & §8, docs/12 §5, §9–12; B6, B7.7, C10.5).
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePermission } from '../../../_shared/auth.ts';
import { readJson } from '../../../_shared/http.ts';
import { signedReadUrl } from '../../../_shared/storage.ts';
import type { AppEnv } from '../../../_shared/types.ts';
import { adminRpc, reason, reasonCode, serviceRpc, uuid, uuidParam } from './_util.ts';

export const opsRoutes = new Hono<AppEnv>();
const admin = requirePermission(null);
const reviewer = requirePermission('review_inspections');

// ── Review ────────────────────────────────────────────────────────────────────────────────────
const Review = z.object({
  decision: z.enum(['approved', 'returned', 'rejected']),
  reason_code: reasonCode.optional(),
  note: z.string().trim().max(2000).optional(),
  override_acknowledged: z.boolean().optional(),
});
opsRoutes.post('/inspections/:id/review', reviewer, async (c) => {
  const body = await readJson(c, Review);
  return c.json(await adminRpc(c, 'admin_review_decide', [
    [uuidParam(c, 'id'), 'uuid'], [body.decision, 'text'], [body.reason_code ?? null, 'text'], [body.note ?? null, 'text'],
    [body.override_acknowledged ?? false, 'boolean'],
  ]));
});

const Amendment = z.object({ field_key: z.string().regex(/^[a-z][a-z0-9_]*(\[[0-9]+\]\.[a-z][a-z0-9_]*)?$/), new_value: z.unknown(), justification: reason });
opsRoutes.post('/inspections/:id/amendments', reviewer, async (c) => {
  const body = await readJson(c, Amendment);
  return c.json(await adminRpc(c, 'admin_amendment_create', [
    [uuidParam(c, 'id'), 'uuid'], [body.field_key, 'text'], [body.new_value ?? null, 'jsonb'], [body.justification, 'text'],
  ]), 201);
});

// ── Evidence (signed URL ≤ 15 min after the bank-scope check) ──────────────────────────────────
opsRoutes.get('/evidence/:id/url', admin, async (c) => {
  const ev = await adminRpc<{ bucket: string; storage_path: string }>(c, 'admin_evidence_for_url', [[uuidParam(c, 'id'), 'uuid']]);
  c.header('cache-control', 'no-store');
  return c.json({ url: await signedReadUrl(ev.bucket, ev.storage_path, 900), expires_in_s: 900 });
});

// ── Envelope inbox ────────────────────────────────────────────────────────────────────────────
opsRoutes.post('/envelopes/:id/reprocess', admin, async (c) => {
  const body = await readJson(c, z.object({ note: reason }));
  return c.json(await adminRpc(c, 'admin_envelope_reprocess', [[uuidParam(c, 'id'), 'uuid'], [body.note, 'text']]));
});
const Resolve = z.object({
  resolution: z.enum(['resolved', 'attached']),
  note: reason,
  job_id: uuid.optional(),
  reason_code: reasonCode.optional(),
});
opsRoutes.post('/envelopes/:id/resolve', admin, async (c) => {
  const body = await readJson(c, Resolve);
  return c.json(await adminRpc(c, 'admin_envelope_resolve', [
    [uuidParam(c, 'id'), 'uuid'], [body.resolution, 'text'], [body.note, 'text'], [body.job_id ?? null, 'uuid'], [body.reason_code ?? null, 'text'],
  ]));
});

// ── Alerts ────────────────────────────────────────────────────────────────────────────────────
opsRoutes.post('/alerts/ack', admin, async (c) => {
  const body = await readJson(c, z.object({ ids: z.array(uuid).min(1).max(500) }));
  return c.json({ acknowledged: await adminRpc<number>(c, 'admin_alerts_ack', [[body.ids, 'uuid[]']]) });
});

// ── Sessions & devices ────────────────────────────────────────────────────────────────────────
opsRoutes.post('/sessions/:id/revoke', admin, async (c) => {
  const body = await readJson(c, z.object({ reason }));
  return c.json({ revoked: await adminRpc<number>(c, 'admin_session_revoke', [[uuidParam(c, 'id'), 'uuid'], [body.reason, 'text']]) });
});
opsRoutes.post('/devices/:id/revoke', admin, async (c) => {
  const body = await readJson(c, z.object({ reason }));
  return c.json(await adminRpc(c, 'admin_device_revoke', [[uuidParam(c, 'id'), 'uuid'], [body.reason, 'text']]));
});
opsRoutes.post('/devices/:id/restore', admin, async (c) => {
  const body = await readJson(c, z.object({ reason }));
  return c.json(await adminRpc(c, 'admin_device_restore', [[uuidParam(c, 'id'), 'uuid'], [body.reason, 'text']]));
});

// Exports moved to ./exports.ts with their worker (T6-03).

// ── Operations ────────────────────────────────────────────────────────────────────────────────
opsRoutes.get('/queues', admin, async (c) => {
  return c.json(await serviceRpc<Record<string, number>>(c, 'queue_depths'));
});
opsRoutes.post('/server-epoch/rotate', admin, async (c) => {
  const body = await readJson(c, z.object({ reason }));
  return c.json(await adminRpc(c, 'admin_server_epoch_rotate', [[body.reason, 'text']]));
});
