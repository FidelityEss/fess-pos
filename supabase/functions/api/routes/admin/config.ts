// Remote config (docs/13 §5–6, B7.2, B7.5): typed + bounded validation by the engine's config contract, append-only
// versions per layer, four-eyes when an integrity-relevant key changes (D-31), resolved view for a user/device/bank.
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePermission } from '../../../_shared/auth.ts';
import { validateRemoteConfig } from '../../../_shared/engine-adapter.ts';
import { PosError } from '../../../_shared/errors.ts';
import { readJson } from '../../../_shared/http.ts';
import type { AppEnv } from '../../../_shared/types.ts';
import { adminRpc, assertBankScope, fourEyesResponse, isoDateTime, jsonObject, reason, serviceRpc, uuid, uuidQuery } from './_util.ts';

export const configRoutes = new Hono<AppEnv>();
const admin = requirePermission(null);

/** Version of the typed config contract the values were validated against (schema/config). */
const CONFIG_SCHEMA_VERSION = '1.0';

configRoutes.post('/config/validate', admin, async (c) => {
  const body = await readJson(c, z.object({ values: jsonObject }), 512 * 1024);
  const check = await validateRemoteConfig(body.values);
  return c.json({ ok: check.ok, errors: check.errors, integrity_relevant_keys: check.integrityRelevantKeys });
});

const Publish = z.object({
  layer: z.enum(['global', 'bank', 'agent', 'device']),
  subject_id: uuid.nullable().optional(),
  values: jsonObject,
  reason,
  effective_from: isoDateTime.optional(),
});

/** Dotted key path ('geofence.profiles') whatever separator the contract uses — the database diffs by dotted path. */
function dotted(path: string): string {
  return path.replace(/^\//, '').replaceAll('/', '.');
}

configRoutes.post('/config', admin, async (c) => {
  const body = await readJson(c, Publish, 512 * 1024);
  // Integrity-relevant paths that differ from the layer's current version (removals included); the database re-diffs
  // these paths itself before deciding on four-eyes, so a stale or partial list can never skip an approval it needs.
  const current = await adminRpc<{ values: Record<string, unknown> } | null>(c, 'admin_config_current', [
    [body.layer, 'text'],
    [body.subject_id ?? null, 'uuid'],
  ]);
  const check = validateRemoteConfig(body.values, current?.values ?? {});
  if (!check.ok) throw new PosError('VALIDATION_FAILED', 'remote config failed validation (types / bounds)', check.errors);
  const paths = [...new Set(check.integrityRelevantKeys.map(dotted))];
  const result = await adminRpc<{ status: string } & Record<string, unknown>>(c, 'admin_config_publish', [
    [body.layer, 'text'],
    [body.subject_id ?? null, 'uuid'],
    [body.values, 'jsonb'],
    [CONFIG_SCHEMA_VERSION, 'text'],
    [body.reason, 'text'],
    [body.effective_from ?? null, 'timestamptz'],
    [paths, 'text[]'],
  ]);
  return fourEyesResponse(c, result);
});

// What a given agent/device would receive, all layers merged (also freezes a config snapshot, as sync/pull does).
configRoutes.get('/config/resolved', admin, async (c) => {
  const userId = uuidQuery(c, 'user_id');
  const deviceId = uuidQuery(c, 'device_id');
  const bankId = uuidQuery(c, 'bank_id');
  assertBankScope(c, bankId);
  const resolved = await serviceRpc<{ config_version_id: string; values: Record<string, unknown> }>(c, 'resolve_config', [
    [userId, 'uuid'],
    [deviceId, 'uuid'],
    [bankId, 'uuid'],
  ]);
  return c.json(resolved);
});
