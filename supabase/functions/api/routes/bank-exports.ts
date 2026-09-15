// Exports a bank's system asks for with its API key (T6-03, D-100 (3), D-102). Mounted under /v1/bank, behind the key
// check, rate limit and call record in ./bank.ts. The same worker as the admin's exports makes the file.
//
//   POST /v1/bank/exports       {format: csv|xlsx|evidence_zip, from?, to?, form?} → 202 {id, status: queued, …}
//   GET  /v1/bank/exports       this bank's API exports, newest first (50)
//   GET  /v1/bank/exports/:id   status: queued | preparing | ready | failed | expired. When ready, `file` carries a
//                               15-minute link; each link handed out is recorded as a download.
//
// The key's bank only, and only exports its bank's keys asked for (never an admin's, which can cover visits the bank's
// API may not read). The export covers the visit statuses the bank may read, frozen at request.
import { Hono } from 'hono';
import { z } from 'zod';
import { asService, rpc } from '../../_shared/db.ts';
import { REPORTS_BUCKET } from '../../_shared/exports/run.ts';
import { PosError } from '../../_shared/errors.ts';
import { clientIp, readJson, rid } from '../../_shared/http.ts';
import { signedReadUrl } from '../../_shared/storage.ts';
import type { AppEnv } from '../../_shared/types.ts';

export const bankExportRoutes = new Hono<AppEnv>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date written as YYYY-MM-DD');
const Body = z.object({
  format: z.enum(['csv', 'xlsx', 'evidence_zip']),
  from: day.optional(),
  to: day.optional(),
  form: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'a form key').optional(),
}).strict();

interface BankExport {
  id: string;
  status: string;
  file: { name: string; mime: string; bytes: number; sha256: string; url?: string; url_expires_at?: string } | null;
  [k: string]: unknown;
}

const actor = (requestId: string) => ({ id: null, role: 'bank_api', requestId });

bankExportRoutes.post('/exports', async (c) => {
  const bank = c.get('bank');
  const body = await readJson(c, Body, 16_384);
  const out = await asService(actor(rid(c)), (tx) => rpc<BankExport>(tx, 'bank_export_request', [
    [bank.keyId, 'uuid'], [bank.bankId, 'uuid'], [bank.statuses, 'text[]'], [body.format, 'text'],
    [{ from: body.from ?? null, to: body.to ?? null, form: body.form ?? null }, 'jsonb'],
  ]));
  c.set('bankSubject', out.id);
  c.set('bankItems', 1);
  return c.json(out, 202);
});

bankExportRoutes.get('/exports', async (c) => {
  const bank = c.get('bank');
  const items = await asService(actor(rid(c)), (tx) => rpc<BankExport[]>(tx, 'bank_export_list', [[bank.bankId, 'uuid'], [50, 'integer']]));
  c.set('bankItems', items.length);
  return c.json({ items });
});

bankExportRoutes.get('/exports/:id', async (c) => {
  const bank = c.get('bank');
  const id = c.req.param('id');
  if (!UUID.test(id)) throw new PosError('INVALID_REQUEST', 'the export id must be a uuid');
  c.set('bankSubject', id);
  const out = await asService(actor(rid(c)), (tx) => rpc<BankExport>(tx, 'bank_export_get', [[bank.bankId, 'uuid'], [id, 'uuid']]));
  if (out.status === 'ready' && out.file) {
    const dl = await asService(actor(rid(c)), (tx) => rpc<{ storage_path: string; file_name: string; link_seconds: number } | null>(tx, 'bank_export_download', [
      [bank.keyId, 'uuid'], [bank.bankId, 'uuid'], [id, 'uuid'], [clientIp(c), 'text'], [c.req.header('user-agent') ?? null, 'text'], [rid(c), 'text'],
    ]));
    if (dl) {
      const seconds = Math.min(dl.link_seconds, 900);
      out.file = {
        ...out.file,
        url: await signedReadUrl(REPORTS_BUCKET, dl.storage_path, seconds, dl.file_name),
        url_expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
      };
    }
  }
  c.set('bankItems', 1);
  return c.json(out);
});
