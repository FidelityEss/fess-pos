// POST /v1/evidence/upload-grant (docs/12 §6): ownership checked, path derived by the server, never overwritten.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAgent, requirePublishable } from '../../_shared/auth.ts';
import { asService, rpc } from '../../_shared/db.ts';
import { env } from '../../_shared/env.ts';
import { PosError } from '../../_shared/errors.ts';
import { readJson, rid } from '../../_shared/http.ts';
import { createUploadGrant } from '../../_shared/storage.ts';
import type { AppEnv } from '../../_shared/types.ts';

export const evidenceRoutes = new Hono<AppEnv>();

const GrantBody = z.object({ evidence_id: z.string().uuid() });

interface GrantInfo {
  id: string;
  storage_path: string;
  upload_state: 'pending' | 'uploaded' | 'verified' | 'quarantined';
  mime: string | null;
  owner_matches: boolean;
}

evidenceRoutes.post('/evidence/upload-grant', requirePublishable, requireAgent(['full', 'ingest_only']), async (c) => {
  const body = await readJson(c, GrantBody, 4096);
  const agent = c.get('agent');
  const info = await asService({ id: agent.userId, role: 'pos_agent', requestId: rid(c) }, (tx) =>
    rpc<GrantInfo | null>(tx, 'evidence_for_grant', [[body.evidence_id, 'uuid'], [agent.userId, 'uuid']]));
  if (!info) throw new PosError('EVIDENCE_NOT_LANDED', 'send the evidence_meta envelope first');
  if (!info.owner_matches) throw new PosError('FORBIDDEN', 'not your evidence');
  if (info.upload_state === 'verified') return c.json({ state: 'already_verified', evidence_id: info.id });
  if (info.upload_state === 'quarantined') return c.json({ state: 'quarantined', evidence_id: info.id });
  if (info.upload_state === 'uploaded') return c.json({ state: 'already_uploaded', evidence_id: info.id });

  const grant = await createUploadGrant('evidence', info.storage_path);
  if (grant.exists) return c.json({ state: 'already_uploaded', evidence_id: info.id });
  return c.json({
    state: 'upload',
    evidence_id: info.id,
    bucket: 'evidence',
    path: grant.path,
    content_type: info.mime,
    signed_url: grant.signedUrl,
    token: grant.token,
    expires_in_s: 7200,
    // Resumable (TUS) upload against the same signed grant; client maturity covered by spike T1-26.
    resumable: { endpoint: `${env.publicSupabaseUrl}/storage/v1/upload/resumable/sign`, headers: { 'x-signature': grant.token } },
  });
});
