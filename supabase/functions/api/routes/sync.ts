// POST /v1/sync/pull (docs/08 §2). One transaction: service_role issues the per-device secrets (session tokens,
// card tokens) and resolves config, then the same transaction switches to the agent's claims and reads under RLS.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAgent, requirePublishable } from '../../_shared/auth.ts';
import { asService, becomeAgent, rpc } from '../../_shared/db.ts';
import { readJson, rid } from '../../_shared/http.ts';
import type { AppEnv } from '../../_shared/types.ts';

export const syncRoutes = new Hono<AppEnv>();

const PullBody = z.object({
  cursors: z.record(z.string().max(200)).default({}),
  have: z.object({
    definition_version_ids: z.array(z.string().uuid()).max(2000).optional(),
    pinned_version_ids: z.array(z.string().uuid()).max(500).optional(),
    lookup_version_ids: z.array(z.string().uuid()).max(2000).optional(),
    declaration_ids: z.array(z.string().uuid()).max(500).optional(),
    reason_codes_hash: z.string().max(128).optional(),
    session_token_job_ids: z.array(z.string().uuid()).max(2000).optional(),
    job_card_job_ids: z.array(z.string().uuid()).max(2000).optional(),
    agent_card_valid: z.boolean().optional(),
  }).default({}),
  capabilities: z.record(z.unknown()).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

interface Prepared {
  session_tokens: unknown[];
  job_cards: unknown[];
  agent_card: unknown;
  config: unknown;
}

syncRoutes.post('/sync/pull', requirePublishable, requireAgent(['full']), async (c) => {
  const body = await readJson(c, PullBody, 256 * 1024);
  const agent = c.get('agent');
  const have = body.have ?? {};
  const cursors = body.cursors ?? {};
  const result = await asService({ id: agent.userId, role: 'pos_agent', requestId: rid(c) }, async (tx) => {
    const prepared = await rpc<Prepared>(tx, 'sync_prepare', [
      [agent.userId, 'uuid'],
      [agent.deviceId, 'uuid'],
      [have.session_token_job_ids ?? [], 'uuid[]'],
      [have.agent_card_valid ?? false, 'boolean'],
      [have.job_card_job_ids ?? [], 'uuid[]'],
    ]);
    await becomeAgent(tx, agent.claims);
    const rows = await tx`select pos.sync_read(${JSON.stringify(cursors)}::text::jsonb, ${JSON.stringify(have)}::text::jsonb, ${body.limit ?? 200}::integer) as r`;
    return { ...(rows[0].r as Record<string, unknown>), ...prepared };
  });
  return c.json(result);
});
