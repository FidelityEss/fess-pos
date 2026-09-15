// POST /v1/device (T2-31): the module keeps its own device registration current — a refreshed push token (the host's
// FCM / OneSignal token can change at any time, docs/03 §3 PosPushConfig) or a new module / host app / OS version —
// without a new exchange. Only the calling session's own device. ingest_only sessions may call it too, so a signed-out
// device still reports its versions while its outbox drains. An explicit null push_token unregisters push.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAgent, requirePublishable } from '../../_shared/auth.ts';
import { asService, rpc } from '../../_shared/db.ts';
import { rateLimit, readJson, rid } from '../../_shared/http.ts';
import type { AppEnv } from '../../_shared/types.ts';

export const deviceRoutes = new Hono<AppEnv>();

const DeviceUpdateBody = z
  .object({
    push_provider: z.string().min(1).max(40).optional(),
    push_token: z.string().min(1).max(4096).nullable().optional(),
    platform: z.string().max(40).optional(),
    model: z.string().max(120).optional(),
    os_version: z.string().max(60).optional(),
    host_app_version: z.string().max(60).optional(),
    module_version: z.string().max(60).optional(),
    capabilities: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'send at least one field' })
  .refine((b) => typeof b.push_token !== 'string' || b.push_provider !== undefined, {
    message: 'push_provider is required with a push_token',
    path: ['push_provider'],
  });

deviceRoutes.post('/device', requirePublishable, requireAgent(['full', 'ingest_only']), async (c) => {
  const agent = c.get('agent');
  rateLimit(`device:${agent.deviceId}`, 30, 60_000);
  const body = await readJson(c, DeviceUpdateBody, 64 * 1024);
  const result = await asService({ id: agent.userId, role: 'pos_agent', requestId: rid(c) }, (tx) =>
    rpc(tx, 'device_update', [[agent.userId, 'uuid'], [agent.deviceId, 'uuid'], [body, 'jsonb']]));
  return c.json(result);
});
