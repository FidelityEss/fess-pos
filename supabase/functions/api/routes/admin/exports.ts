// Exports from the admin panel (T6-03, T6-04, B6.4, D-102, docs/17 §4.2). The worker (_shared/exports/run.ts) makes the
// file in the background; these routes ask for one, try a failed one again and hand out an audited download link.
//
//   GET  /exports/formats         the formats the worker can make now (exports.formats_ready)
//   POST /exports                 {type, scope: {bank_id?, from?, to?, family_id?, job_ids?}, recipient?} → the export row
//   POST /exports/:id/retry       a failed export back in the queue
//   POST /exports/:id/download    records the download, then a signed link (≤ 15 min) that saves under the file's name
//
// The list and progress are read under RLS from pos.exports (admins with the export's bank in scope).
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePermission } from '../../../_shared/auth.ts';
import { REPORTS_BUCKET } from '../../../_shared/exports/run.ts';
import { clientIp, readJson } from '../../../_shared/http.ts';
import { signedReadUrl } from '../../../_shared/storage.ts';
import type { AppEnv } from '../../../_shared/types.ts';
import { adminRpc, serviceRpc, uuid, uuidParam } from './_util.ts';

export const exportRoutes = new Hono<AppEnv>();
const admin = requirePermission(null);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date written as YYYY-MM-DD');
const ExportBody = z.object({
  type: z.enum(['pdf', 'csv', 'xlsx', 'evidence_zip', 'spec_pdf', 'billing_csv']),
  scope: z.object({
    bank_id: uuid.optional(),
    from: day.optional(),
    to: day.optional(),
    family_id: uuid.optional(),
    job_ids: z.array(uuid).max(1000).optional(),
  }).strict().default({}),
  recipient: z.string().trim().max(320).optional(),
}).strict();

exportRoutes.get('/exports/formats', admin, async (c) => {
  return c.json({ ready: await serviceRpc<string[]>(c, 'export_formats') });
});

exportRoutes.post('/exports', admin, async (c) => {
  const body = await readJson(c, ExportBody);
  return c.json(await adminRpc(c, 'admin_export_request', [[body.type, 'text'], [body.scope, 'jsonb'], [body.recipient ?? null, 'text']]), 201);
});

exportRoutes.post('/exports/:id/retry', admin, async (c) => {
  return c.json(await adminRpc(c, 'admin_export_retry', [[uuidParam(c, 'id'), 'uuid']]));
});

exportRoutes.post('/exports/:id/download', admin, async (c) => {
  const file = await adminRpc<{ storage_path: string; file_name: string; mime: string; bytes: number; sha256: string; link_seconds: number }>(
    c, 'admin_export_download', [[uuidParam(c, 'id'), 'uuid'], [clientIp(c), 'text'], [c.req.header('user-agent') ?? null, 'text']],
  );
  const seconds = Math.min(file.link_seconds, 900);
  const url = await signedReadUrl(REPORTS_BUCKET, file.storage_path, seconds, file.file_name);
  c.header('cache-control', 'no-store');
  return c.json({ url, expires_in_s: seconds, file_name: file.file_name, mime: file.mime, bytes: file.bytes, sha256: file.sha256 });
});
