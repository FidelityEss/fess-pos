// POST /v1/ingest — 1–50 envelopes, ≤ 1 MB, one receipt each (docs/12 §4–5).
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAgent, requirePublishable } from '../../_shared/auth.ts';
import { readJson, rid } from '../../_shared/http.ts';
import { processEnvelope } from '../../_shared/ingest.ts';
import type { AppEnv } from '../../_shared/types.ts';

export const ingestRoutes = new Hono<AppEnv>();

const IngestBody = z.object({ envelopes: z.array(z.unknown()).min(1).max(50) });

ingestRoutes.post('/ingest', requirePublishable, requireAgent(['full', 'ingest_only']), async (c) => {
  const body = await readJson(c, IngestBody, 1_048_576);
  const agent = c.get('agent');
  const receipts: unknown[] = [];
  // Sequential: order within a batch is preserved, which minimises deferrals (the server tolerates any order).
  for (const envelope of body.envelopes) {
    receipts.push(await processEnvelope(envelope, {
      userId: agent.userId,
      sessionId: agent.sessionId,
      deviceId: agent.deviceId,
      requestId: rid(c),
    }));
  }
  return c.json({ receipts, server_time: new Date().toISOString() });
});
