// Bank API keys (T6-06, D-100): an admin with the bank in scope creates a key (shown once), lists the bank's keys and
// switches one off. The key is made here; the database only ever receives its SHA-256 fingerprint and last four characters.
//
//   POST /banks/:id/api-keys      {name, expires_in_months?, rate_limit_per_minute?} → the key row + `key`, once
//   GET  /banks/:id/api-keys      the bank's keys (never a fingerprint), with status, last use and calls in the last 24 h
//   POST /api-keys/:id/revoke     {reason}
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePermission } from '../../../_shared/auth.ts';
import { newBankKey } from '../../../_shared/bank.ts';
import { sha256Hex } from '../../../_shared/crypto.ts';
import { env } from '../../../_shared/env.ts';
import { readJson } from '../../../_shared/http.ts';
import type { AppEnv } from '../../../_shared/types.ts';
import { adminRpc, reason, uuidParam } from './_util.ts';

export const bankKeyRoutes = new Hono<AppEnv>();
const admin = requirePermission(null);

const KeyCreate = z.object({
  name: z.string().trim().min(1).max(120),
  expires_in_months: z.number().int().min(1).max(60).optional(),
  rate_limit_per_minute: z.number().int().min(1).max(6000).nullable().optional(),
}).strict();

bankKeyRoutes.post('/banks/:id/api-keys', admin, async (c) => {
  const bankId = uuidParam(c, 'id');
  const body = await readJson(c, KeyCreate);
  const { key, lastFour } = newBankKey(env.posEnv);
  const row = await adminRpc<Record<string, unknown>>(c, 'admin_api_key_create', [
    [bankId, 'uuid'], [body, 'jsonb'], [await sha256Hex(key), 'text'], [lastFour, 'text'],
  ]);
  c.header('cache-control', 'no-store');
  return c.json({ ...row, key }, 201);
});

bankKeyRoutes.get('/banks/:id/api-keys', admin, async (c) => {
  return c.json(await adminRpc(c, 'admin_api_key_list', [[uuidParam(c, 'id'), 'uuid']]));
});

bankKeyRoutes.post('/api-keys/:id/revoke', admin, async (c) => {
  const body = await readJson(c, z.object({ reason }));
  return c.json(await adminRpc(c, 'admin_api_key_revoke', [[uuidParam(c, 'id'), 'uuid'], [body.reason, 'text']]));
});
