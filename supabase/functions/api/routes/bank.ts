// The bank read API, /v1/bank/* (T6-06, D-100, B6.5, B6.9, docs/17 §4.2). A bank's system reads its own bank's
// inspections with an API key an admin created on the bank's page:
//
//   Authorization: Bearer fpos_<env>_<random>
//
//   GET /v1/bank/inspections?since=<cursor>&limit=<1–500>   inspections changed since the cursor, oldest first
//   GET /v1/bank/inspections/:id                             one inspection: answers with labels, amendments, a custody
//                                                            summary and the evidence with 15-minute download links
//
// Read-only; the key's bank only; by default only inspections that have reached a decision (the bank's settings can widen
// it). Each key is rate-limited per minute, and every call, allowed or refused, is recorded before the response leaves.
import { Hono } from 'hono';
import { BANK_KEY_PATTERN, type Cursor, decodeCursor, encodeCursor, labelledAnswers, routeName, type StoredAnswer } from '../../_shared/bank.ts';
import { sha256Hex } from '../../_shared/crypto.ts';
import { asService, rpc } from '../../_shared/db.ts';
import { PosError } from '../../_shared/errors.ts';
import { clientIp, rateLimit, rid } from '../../_shared/http.ts';
import { log } from '../../_shared/log.ts';
import { signedReadUrl } from '../../_shared/storage.ts';
import type { AppEnv, BankAuth } from '../../_shared/types.ts';

export const bankRoutes = new Hono<AppEnv>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_SECONDS = 900; // 15 minutes (DEVELOPMENT-GUIDELINES §4: signed URLs ≤ 15 min)

interface Authorization {
  allowed: boolean;
  code?: string;
  message?: string;
  limit?: number;
  retry_after_s?: number;
  key_id?: string;
  bank_id?: string;
  bank_code?: string;
  statuses?: string[];
  remaining?: number;
}

interface EvidenceRow {
  id: string;
  upload_state: string;
  storage_path: string;
  [k: string]: unknown;
}

interface Detail {
  inspection: Record<string, unknown>;
  job: Record<string, unknown>;
  decision: Record<string, unknown> | null;
  answers: Record<string, StoredAnswer>;
  form: { family: string; version: number; definition: unknown } | null;
  amendments: unknown[];
  custody: Record<string, unknown>;
  evidence: EvidenceRow[];
}

const actor = (requestId: string) => ({ id: null, role: 'bank_api', requestId });

bankRoutes.use('*', async (c, next) => {
  const ip = clientIp(c);
  const key = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('authorization') ?? '')?.[1] ?? '';
  if (!BANK_KEY_PATTERN.test(key)) {
    rateLimit(`bank-key:${ip ?? 'unknown'}`, 30, 60_000); // a speed bump; 256-bit keys are what stop guessing
    throw new PosError('UNAUTHENTICATED', 'send your bank API key as "Authorization: Bearer fpos_…"');
  }
  const method = c.req.method;
  const route = routeName(c.req.path);
  const userAgent = c.req.header('user-agent') ?? null;
  const keyHash = await sha256Hex(key);
  const auth = await asService(actor(rid(c)), (tx) => rpc<Authorization>(tx, 'bank_key_authorize', [
    [keyHash, 'text'], [method, 'text'], [route, 'text'], [ip, 'text'], [userAgent, 'text'], [rid(c), 'text'],
  ]));
  if (!auth.allowed) {
    if (auth.code !== 'RATE_LIMITED') rateLimit(`bank-key:${ip ?? 'unknown'}`, 30, 60_000);
    throw new PosError(auth.code ?? 'UNAUTHENTICATED', auth.message ?? 'not allowed',
      auth.code === 'RATE_LIMITED' ? { limit: auth.limit, retry_after_s: auth.retry_after_s } : undefined);
  }
  const bank: BankAuth = {
    kind: 'bank',
    keyId: auth.key_id!,
    bankId: auth.bank_id!,
    bankCode: auth.bank_code!,
    statuses: auth.statuses ?? [],
    limit: auth.limit ?? 0,
    remaining: auth.remaining ?? 0,
  };
  c.set('bank', bank);

  await next(); // a handler error has already become c.res here (app.onError)

  // Every call is recorded before the response leaves (D-100): a read that can't be recorded is not returned.
  try {
    await asService(actor(rid(c)), (tx) => rpc(tx, 'bank_call_record', [
      [bank.keyId, 'uuid'], [method, 'text'], [route, 'text'], [c.get('bankSubject') ?? null, 'uuid'], [c.res.status, 'integer'],
      [c.get('bankItems') ?? null, 'integer'], [rid(c), 'text'], [ip, 'text'], [userAgent, 'text'],
    ]));
  } catch (e) {
    log('error', 'a bank API call could not be recorded', { request_id: rid(c), error: String(e) });
    throw new PosError('UNAVAILABLE', 'the call could not be recorded; try again');
  }
  c.header('x-ratelimit-limit', String(bank.limit));
  c.header('x-ratelimit-remaining', String(bank.remaining));
  c.header('cache-control', 'no-store');
});

bankRoutes.get('/inspections', async (c) => {
  const bank = c.get('bank');
  const since = c.req.query('since');
  const cursor = since ? decodeCursor(since) : null;
  if (since && !cursor) throw new PosError('INVALID_REQUEST', 'since must be the next_cursor of an earlier response');
  const rawLimit = c.req.query('limit');
  const limit = rawLimit === undefined ? 100 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new PosError('INVALID_REQUEST', 'limit must be a whole number from 1 to 500');
  const page = await asService(actor(rid(c)), (tx) => rpc<{ items: unknown[]; has_more: boolean; last: Cursor | null }>(tx, 'bank_inspections_changed', [
    [bank.bankId, 'uuid'], [bank.statuses, 'text[]'], [cursor?.changed_at ?? null, 'timestamptz'], [cursor?.id ?? null, 'uuid'], [limit, 'integer'],
  ]));
  c.set('bankItems', page.items.length);
  return c.json({
    items: page.items,
    has_more: page.has_more,
    // Keep polling with next_cursor: when nothing changed it is the cursor you sent.
    next_cursor: page.last ? encodeCursor(page.last) : since ?? null,
    statuses: bank.statuses,
  });
});

bankRoutes.get('/inspections/:id', async (c) => {
  const bank = c.get('bank');
  const id = c.req.param('id');
  if (!UUID.test(id)) throw new PosError('INVALID_REQUEST', 'the inspection id must be a uuid');
  c.set('bankSubject', id);
  const r = await asService(actor(rid(c)), (tx) => rpc<Detail>(tx, 'bank_inspection_get', [
    [bank.bankId, 'uuid'], [bank.statuses, 'text[]'], [id, 'uuid'],
  ]));
  const expiresAt = new Date(Date.now() + LINK_SECONDS * 1000).toISOString();
  const evidence = await Promise.all(r.evidence.map(async ({ storage_path, ...e }) => {
    const readable = e.upload_state === 'uploaded' || e.upload_state === 'verified';
    const url = readable ? await signedReadUrl('evidence', storage_path, LINK_SECONDS).catch(() => null) : null;
    return { ...e, url, url_expires_at: url ? expiresAt : null };
  }));
  c.set('bankItems', 1);
  return c.json({
    inspection: r.inspection,
    job: r.job,
    decision: r.decision,
    form: r.form ? { family: r.form.family, version: r.form.version } : null,
    answers: labelledAnswers(r.form?.definition ?? null, r.answers),
    amendments: r.amendments,
    custody: r.custody,
    evidence,
  });
});
