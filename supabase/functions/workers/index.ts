// Queue workers (docs/12 §6–8), kicked every 15 s by pg_cron with the Vault worker key.
// Idempotent handlers; a message is deleted only after its effect commits; exhausted retries dead-letter + alert.
import { Hono } from 'hono';
import { requireWorker } from '../_shared/auth.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { asService, rpc, rpcRows } from '../_shared/db.ts';
import { errorResponse, PosError } from '../_shared/errors.ts';
import { requestId, rid } from '../_shared/http.ts';
import { applyLanded, type Envelope, EnvelopeWrapper } from '../_shared/ingest.ts';
import { log } from '../_shared/log.ts';
import { deliver } from '../_shared/notify.ts';
import { download, exists, uploadOnce } from '../_shared/storage.ts';
import type { AppEnv } from '../_shared/types.ts';

interface QueueMessage {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  message: Record<string, unknown>;
}

interface Policy {
  max_attempts: number | null;
  vt_seconds: number;
  backoff: { base_s: number; cap_s: number };
}

const SYSTEM = (requestId: string) => ({ id: null, role: 'system', requestId });
// Stay well inside the edge runtime's wall-clock limit; pg_cron kicks again every 15 s and pgmq visibility timeouts
// keep overlapping drains from double-processing.
const BUDGET_MS = 25_000;

async function policies(requestId: string): Promise<Record<string, Policy>> {
  return (await asService(SYSTEM(requestId), (tx) => rpc<Record<string, Policy>>(tx, 'setting', [['queues.policy', 'text']]))) ?? {};
}

async function drain(queue: string, policy: Policy | undefined, deadline: number, requestId: string,
                     handle: (msg: Record<string, unknown>) => Promise<void>): Promise<{ done: number; retried: number; dead: number }> {
  const p: Policy = policy ?? { max_attempts: 10, vt_seconds: 120, backoff: { base_s: 30, cap_s: 3600 } };
  const stats = { done: 0, retried: 0, dead: 0 };
  while (Date.now() < deadline) {
    const batch = await asService(SYSTEM(requestId), (tx) =>
      rpcRows<QueueMessage>(tx, 'queue_read', [[queue, 'text'], [p.vt_seconds, 'integer'], [10, 'integer']]));
    if (batch.length === 0) break;
    for (const m of batch) {
      try {
        await handle(m.message);
        await asService(SYSTEM(requestId), (tx) => rpc(tx, 'queue_ack', [[queue, 'text'], [m.msg_id, 'bigint']]));
        stats.done++;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        if (p.max_attempts !== null && m.read_ct >= p.max_attempts) {
          await asService(SYSTEM(requestId), (tx) =>
            rpc(tx, 'queue_dead_letter', [[queue, 'text'], [m.msg_id, 'bigint'], [m.message, 'jsonb'], [error, 'text']]));
          stats.dead++;
        } else {
          const delay = Math.min(p.backoff.cap_s, p.backoff.base_s * 2 ** Math.max(0, m.read_ct - 1));
          const jittered = Math.floor(delay / 2 + Math.random() * (delay / 2));
          await asService(SYSTEM(requestId), (tx) => rpc(tx, 'queue_retry', [[queue, 'text'], [m.msg_id, 'bigint'], [jittered, 'integer']]));
          stats.retried++;
        }
        log('warn', 'worker message failed', { request_id: requestId, queue, msg_id: m.msg_id, read_ct: m.read_ct, error });
      }
    }
  }
  return stats;
}

interface EvidenceRow {
  id: string;
  inspection_id: string;
  storage_path: string;
  sha256_client: string;
  upload_state: string;
  replica_state: string;
  mime: string | null;
}

async function evidence(id: unknown, requestId: string): Promise<EvidenceRow> {
  if (typeof id !== 'string') throw new PosError('INVALID_REQUEST', 'message without evidence_id');
  const row = await asService(SYSTEM(requestId), (tx) => rpc<EvidenceRow | null>(tx, 'evidence_for_worker', [[id, 'uuid']]));
  if (!row) throw new PosError('NOT_FOUND', `evidence ${id} not found`);
  return row;
}

// verify_evidence: recompute SHA-256 of the stored object (docs/07 §4 step 6).
async function verify(msg: Record<string, unknown>, requestId: string): Promise<void> {
  const ev = await evidence(msg.evidence_id, requestId);
  if (ev.upload_state === 'verified' || ev.upload_state === 'quarantined') return;
  const bytes = await download('evidence', ev.storage_path);
  if (!bytes) throw new Error('object not in storage yet');
  const sha = await sha256Hex(bytes);
  await asService(SYSTEM(requestId), (tx) => rpc(tx, 'evidence_verified', [[ev.id, 'uuid'], [sha, 'text'], [bytes.length, 'bigint']]));
}

// replicate_evidence: second copy in the replica bucket, hash re-verified (docs/12 §12, D-25).
async function replicate(msg: Record<string, unknown>, requestId: string): Promise<void> {
  const ev = await evidence(msg.evidence_id, requestId);
  if (ev.replica_state === 'replicated') return;
  const bytes = await download('evidence', ev.storage_path);
  if (!bytes) throw new Error('primary object missing');
  const created = await uploadOnce('evidence-replica', ev.storage_path, bytes, ev.mime ?? 'application/octet-stream');
  const replica = created === 'created' ? bytes : await download('evidence-replica', ev.storage_path);
  if (!replica) throw new Error('replica unreadable');
  const sha = await sha256Hex(replica);
  await asService(SYSTEM(requestId), (tx) =>
    rpc(tx, 'evidence_replicated', [[ev.id, 'uuid'], ['evidence-replica', 'text'], [ev.storage_path, 'text'], [sha, 'text']]));
}

async function notify(msg: Record<string, unknown>, requestId: string, final: boolean): Promise<void> {
  if (typeof msg.notification_id !== 'string') throw new PosError('INVALID_REQUEST', 'message without notification_id');
  await deliver(msg.notification_id, requestId, final);
}

// Reprocessor (docs/12 §5): `received` > 2 min, or `deferred` whose dependency now exists.
async function reprocess(deadline: number, requestId: string): Promise<{ applied: number }> {
  const ids = await asService(SYSTEM(requestId), (tx) => rpcRows<{ envelope_id: string }>(tx, 'reprocess_candidates', [[50, 'integer']]));
  let applied = 0;
  for (const { envelope_id } of ids) {
    if (Date.now() > deadline) break;
    const row = await asService(SYSTEM(requestId), async (tx) => {
      await rpc(tx, 'reopen_deferred', [[envelope_id, 'uuid']]);
      return await rpc<Record<string, unknown> | null>(tx, 'envelope_get', [[envelope_id, 'uuid']]);
    });
    if (!row) continue;
    const envelope = EnvelopeWrapper.parse({ ...(row.wrapper as Record<string, unknown>), payload: row.payload }) as Envelope;
    await applyLanded(envelope, String(row.stored_hash), requestId);
    applied++;
  }
  return { applied };
}

// Sweeper (docs/12 §6 step 4): evidence still `pending` after 5 min whose object is already in storage.
async function sweep(requestId: string): Promise<{ found: number }> {
  const rows = await asService(SYSTEM(requestId), (tx) =>
    rpcRows<{ evidence_id: string; storage_path: string }>(tx, 'evidence_sweep_candidates', [[20, 'integer']]));
  let found = 0;
  for (const r of rows) {
    if (await exists('evidence', r.storage_path)) {
      await asService(SYSTEM(requestId), (tx) => rpc(tx, 'evidence_mark_uploaded', [[r.evidence_id, 'uuid']]));
      found++;
    }
  }
  return { found };
}

const app = new Hono<AppEnv>();
app.use('*', requestId);
app.onError((e, c) => errorResponse(e, rid(c)));

app.post('*', requireWorker, async (c) => {
  const id = rid(c);
  const deadline = Date.now() + BUDGET_MS;
  const pol = await policies(id);
  const notifyPolicy = pol.notify;
  const result = {
    verify_evidence: await drain('verify_evidence', pol.verify_evidence, deadline, id, (m) => verify(m, id)),
    replicate_evidence: await drain('replicate_evidence', pol.replicate_evidence, deadline, id, (m) => replicate(m, id)),
    notify: await drain('notify', notifyPolicy, deadline, id, (m) => notify(m, id, false)),
    reprocess: await reprocess(deadline, id),
    sweep: await sweep(id),
  };
  return c.json(result);
});

Deno.serve(app.fetch);
