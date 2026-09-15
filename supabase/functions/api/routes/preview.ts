// GET /v1/preview/:token (T3-12, D-101, docs/04 §10): the draft a "Preview on a phone" link names, for a signed-in agent
// or tester, as the preview request the module's sandbox draws: {kind, definition, bundle, context, theme?, expires_at}.
// An unknown or expired token is NOT_FOUND either way. Opening it is counted (pos_rpc.preview_link_open).
import { Hono } from 'hono';
import { requireAgent, requirePublishable } from '../../_shared/auth.ts';
import { sha256Hex } from '../../_shared/crypto.ts';
import { asService, rpc } from '../../_shared/db.ts';
import { PosError } from '../../_shared/errors.ts';
import { rid } from '../../_shared/http.ts';
import type { AppEnv } from '../../_shared/types.ts';

export const previewRoutes = new Hono<AppEnv>();

/** The module's link pattern (pos_link.dart). */
const TOKEN = /^[0-9A-Za-z_-]{16,256}$/;

previewRoutes.get('/preview/:token', requirePublishable, requireAgent(['full']), async (c) => {
  const token = c.req.param('token');
  if (!TOKEN.test(token)) throw new PosError('NOT_FOUND', 'this preview link has expired or does not exist; ask for a new one');
  const agent = c.get('agent');
  const hash = await sha256Hex(token);
  const request = await asService({ id: agent.userId, role: 'pos_agent', requestId: rid(c) }, (tx) =>
    rpc<Record<string, unknown>>(tx, 'preview_link_open', [[agent.userId, 'uuid'], [hash, 'text']]));
  c.header('cache-control', 'no-store');
  return c.json(request);
});
