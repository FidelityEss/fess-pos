// The export worker (T6-03, B6.4, D-102, docs/12 §8): takes one export off the `export` queue, makes the file from the
// visits the export covers, stores it in the private `reports` bucket, reads it back to prove the stored copy is whole
// (A-03), and only then marks the export done. Called by the `workers` function for the 'export' task.
//
//   csv           one form version: a .csv of the answers. Several: a .zip with "all answers" (the union of every
//                 version's columns), one CSV per version and a "where each visit came from" CSV.
//   xlsx          one workbook: All answers, one sheet per version (when there are several), where each visit came from,
//                 and about this file.
//   evidence_zip  the photos and files, as photos/<job>/visit-<try>/<question>-<id>.<ext>, with manifest.csv and
//                 manifest.json: each file's recorded and actual SHA-256, its checks and its chain of custody. Photos not
//                 received yet, held back or missing are listed, never silently left out.
//
// States stay honest (A-07): a try that fails for a passing reason goes back to queued with the reason and is retried
// with backoff; a refusal, or the last try, ends in failed with the reason. The file is held in memory, so its size is
// capped (exports.max_file_mb); docs/03 §4 moves heavy work to a worker outside the edge runtime later (D-102).
import { sha256Hex } from '../crypto.ts';
import { asService, rpc, rpcRows } from '../db.ts';
import { PosError } from '../errors.ts';
import { log } from '../log.ts';
import { download, uploadOnce } from '../storage.ts';
import { buildCsv, buildEvidenceZip, buildXlsx, type Built, type Claim, ExportRefused } from './build.ts';
import type { ExportInspection, FormVersion } from './tables.ts';
import { concatBytes } from './zip.ts';

export const REPORTS_BUCKET = 'reports';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 200;
const SYSTEM = (requestId: string) => ({ id: null, role: 'system', requestId });

// ── One export ────────────────────────────────────────────────────────────────────────────────
async function loadVisits(exportId: string, withEvidence: boolean, requestId: string): Promise<ExportInspection[]> {
  const out: ExportInspection[] = [];
  let after: { at: string; id: string } | null = null;
  for (;;) {
    const page: { items: ExportInspection[]; has_more: boolean; last: { at: string; id: string } | null } = await asService(SYSTEM(requestId), (tx) =>
      rpc(tx, 'export_page', [[exportId, 'uuid'], [after?.at ?? null, 'timestamptz'], [after?.id ?? null, 'uuid'], [PAGE, 'integer'], [withEvidence, 'boolean']]));
    out.push(...page.items);
    if (!page.has_more || !page.last) return out;
    after = page.last;
  }
}

const BUILDERS: Record<string, (c: Claim, v: ExportInspection[], f: Record<string, FormVersion>) => Promise<Built>> = {
  csv: buildCsv,
  xlsx: buildXlsx,
  evidence_zip: (c, v, f) => buildEvidenceZip(c, v, f, (path) => download('evidence', path)),
};

/** What the person who asked sees while it's retried, or when the last try failed. */
function plainReason(e: unknown): string {
  if (e instanceof PosError && e.code === 'UNAVAILABLE') return /storage/i.test(e.message) ? 'the file store didn’t answer' : 'the database didn’t answer';
  return 'something unexpected went wrong';
}

/** Make one export. Returns normally when the export is done, refused or finally failed; throws to have it retried. */
export async function runExport(message: Record<string, unknown>, requestId: string, lastTry: boolean): Promise<void> {
  const exportId = message.export_id;
  if (typeof exportId !== 'string' || !UUID.test(exportId)) throw new PosError('INVALID_REQUEST', 'export message without export_id');
  const claim = await asService(SYSTEM(requestId), (tx) => rpc<Claim>(tx, 'export_claim', [[exportId, 'uuid']]));
  if (!claim.run) return; // done, failed, refused (the reason is on the row) or gone
  const attempt = claim.export.attempts;
  try {
    const build = BUILDERS[claim.export.type];
    if (!build) throw new ExportRefused('This kind of export can’t be made yet. Nothing was lost: ask again once it’s available.');
    const visits = await loadVisits(exportId, claim.export.type === 'evidence_zip', requestId);
    const ids = [...new Set(visits.map((v) => v.form_version_id).filter((x): x is string => !!x))];
    const versions = ids.length
      ? await asService(SYSTEM(requestId), (tx) => rpc<Record<string, FormVersion>>(tx, 'export_versions', [[ids, 'uuid[]']]))
      : {};
    const built = await build(claim, visits, versions);
    const bytes = concatBytes(built.chunks);
    built.chunks.length = 0;
    if (bytes.length > claim.max_file_bytes) {
      throw new ExportRefused(`The file comes to more than ${Math.floor(claim.max_file_bytes / 1048576)} MB, the most one download can hold. Choose fewer dates or one form, and ask again.`);
    }
    const sha256 = await sha256Hex(bytes);
    const path = `exports/${claim.export.bank_id ?? 'all'}/${exportId}/try-${attempt}/${built.fileName}`;
    await uploadOnce(REPORTS_BUCKET, path, bytes, built.mime);
    // Verify the stored copy itself (A-03): read it back and compare, before saying it's ready.
    const stored = await download(REPORTS_BUCKET, path);
    if (!stored || stored.length !== bytes.length || (await sha256Hex(stored)) !== sha256) {
      throw new PosError('UNAVAILABLE', 'storage: the stored file does not match what was written');
    }
    await asService(SYSTEM(requestId), (tx) => rpc(tx, 'export_finish', [
      [exportId, 'uuid'], [attempt, 'integer'],
      [{ storage_path: path, file_name: built.fileName, mime: built.mime, bytes: bytes.length, sha256 }, 'jsonb'],
      [built.items, 'jsonb'], [built.problems, 'jsonb'],
    ]));
    log('info', 'export ready', { request_id: requestId, export_id: exportId, type: claim.export.type, bytes: bytes.length, visits: visits.length });
  } catch (e) {
    const refused = e instanceof ExportRefused;
    const final = refused || lastTry;
    const reason = refused
      ? e.message
      : final
      ? `It couldn’t be made after ${attempt} tries (${plainReason(e)}). Use Try again, or ask support to look at request ${requestId}.`
      : `The last try didn’t finish (${plainReason(e)}). It will be tried again by itself.`;
    log(refused ? 'info' : 'warn', 'export try failed', { request_id: requestId, export_id: exportId, attempt, final, error: String(e) });
    await asService(SYSTEM(requestId), (tx) => rpc(tx, 'export_fail', [[exportId, 'uuid'], [attempt, 'integer'], [reason, 'text'], [final, 'boolean']]));
    if (!final) throw e;
  }
}

// ── The export task ───────────────────────────────────────────────────────────────────────────
interface QueueMessage {
  msg_id: number;
  read_ct: number;
  message: Record<string, unknown>;
}

interface Policy {
  max_attempts: number | null;
  vt_seconds: number;
  backoff: { base_s: number; cap_s: number };
}

/**
 * Drain the `export` queue one message at a time until the budget is spent (docs/12 §8). A message is deleted only
 * after its export is done or has finally failed; other failures are retried with jittered backoff; a message that
 * still fails on its last attempt (e.g. malformed) is dead-lettered with an alert.
 */
export async function drainExports(requestId: string, budgetMs: number): Promise<{ done: number; retried: number; dead: number }> {
  const svc = <T>(fn: Parameters<typeof asService<T>>[1]) => asService<T>(SYSTEM(requestId), fn);
  const policies = (await svc((tx) => rpc<Record<string, Policy>>(tx, 'setting', [['queues.policy', 'text']]))) ?? {};
  const p: Policy = policies.export ?? { max_attempts: 5, vt_seconds: 900, backoff: { base_s: 60, cap_s: 3600 } };
  const stats = { done: 0, retried: 0, dead: 0 };
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const [m] = await svc((tx) => rpcRows<QueueMessage>(tx, 'queue_read', [['export', 'text'], [p.vt_seconds, 'integer'], [1, 'integer']]));
    if (!m) break;
    const lastTry = p.max_attempts !== null && m.read_ct >= p.max_attempts;
    try {
      await runExport(m.message, requestId, lastTry);
      await svc((tx) => rpc(tx, 'queue_ack', [['export', 'text'], [m.msg_id, 'bigint']]));
      stats.done++;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (lastTry) {
        await svc((tx) => rpc(tx, 'queue_dead_letter', [['export', 'text'], [m.msg_id, 'bigint'], [m.message, 'jsonb'], [error, 'text']]));
        stats.dead++;
      } else {
        const delay = Math.min(p.backoff.cap_s, p.backoff.base_s * 2 ** Math.max(0, m.read_ct - 1));
        await svc((tx) => rpc(tx, 'queue_retry', [['export', 'text'], [m.msg_id, 'bigint'], [Math.floor(delay / 2 + Math.random() * (delay / 2)), 'integer']]));
        stats.retried++;
      }
      log('warn', 'export message failed', { request_id: requestId, msg_id: m.msg_id, read_ct: m.read_ct, error });
    }
  }
  return stats;
}
