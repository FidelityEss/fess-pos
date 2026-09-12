// POS API v1 (docs/03 §4) — one edge function, internal routing, shared middleware.
// Mounted at /functions/v1/api, so a device's apiBaseUrl is https://<ref>.supabase.co/functions/v1/api.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from '../_shared/env.ts';
import { errorResponse, PosError } from '../_shared/errors.ts';
import { requestId, rid } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import type { AppEnv } from '../_shared/types.ts';
import { adminRoutes } from './routes/admin/index.ts';
import { authRoutes } from './routes/auth.ts';
import { evidenceRoutes } from './routes/evidence.ts';
import { healthRoutes } from './routes/health.ts';
import { ingestRoutes } from './routes/ingest.ts';
import { publicRoutes } from './routes/public.ts';
import { syncRoutes } from './routes/sync.ts';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', cors({
  origin: env.adminOrigins.includes('*') ? '*' : env.adminOrigins,
  allowHeaders: ['authorization', 'apikey', 'content-type', 'x-pos-request-id', 'x-client-info'],
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS'],
  exposeHeaders: ['x-pos-request-id'],
  maxAge: 600,
}));
app.use('*', requestId);
app.use('*', async (c, next) => {
  const started = Date.now();
  await next();
  log('info', 'request', { request_id: rid(c), method: c.req.method, path: c.req.routePath, status: c.res.status, ms: Date.now() - started });
});

app.onError((e, c) => {
  if (!(e instanceof PosError)) log('error', 'unhandled', { request_id: rid(c), error: String(e) });
  return errorResponse(e, rid(c));
});
app.notFound((c) => errorResponse(new PosError('NOT_FOUND', 'no such endpoint'), rid(c)));

app.route('/v1', healthRoutes);
app.route('/v1', publicRoutes);
app.route('/v1', authRoutes);
app.route('/v1', syncRoutes);
app.route('/v1', ingestRoutes);
app.route('/v1', evidenceRoutes);
app.route('/v1/admin', adminRoutes);

Deno.serve(app.fetch);
