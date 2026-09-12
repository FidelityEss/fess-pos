import { Hono } from 'hono';
import { asService } from '../../_shared/db.ts';
import { env } from '../../_shared/env.ts';
import { rid } from '../../_shared/http.ts';
import type { AppEnv } from '../../_shared/types.ts';

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get('/health', async (c) => {
  let db = 'skipped';
  if (c.req.query('deep') === '1') {
    await asService({ id: null, role: 'system', requestId: rid(c) }, async (tx) => {
      await tx`select 1`;
    });
    db = 'ok';
  }
  return c.json({ ok: true, api_version: env.apiVersion, env: env.posEnv, build: env.build, db, server_time: new Date().toISOString() });
});
