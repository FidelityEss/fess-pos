// End-to-end smoke test of the POS API against QA (fess-pos-qa) — never production. It uses the real APIs only, as the
// scenario seeder does: setup through the admin API as the seed admin (password; a second step only if the API asks), a
// simulated phone through the POS API with the stand-in issuer, and checks through PostgREST reads under RLS. pg_cron
// kicks the workers every 15 s, so the verify/replicate checks poll rather than calling the workers. Covers admin
// registration links (sent, copied, resent, cancelled), sign-in, pull, a full inspection with evidence, verification +
// replication, receipts, public verify and sessions.
//
//   POS_PUBLISHABLE_KEY=<QA publishable key> deno run -A --node-modules-dir=none --config tools/scenarios/deno.json tools/scenarios/smoke.ts
//
// Needs the seed admin's sign-in details from ~/.fess-pos/seed-state-qa.json, so run the scenario seeder once first.
// Test data left on QA: bank SMOKE, agent SMOKE01 and bank viewer SMOKE-INV01 (created once), plus one job with its
// inspection and one cancelled registration link per run (its Auth account is removed by the cancel).
import { ApiError, call } from './lib/api.ts';
import { Device } from './lib/device.ts';
import { env, refuseProduction, target } from './lib/env.ts';
import { runInspection } from './lib/inspection.ts';
import { registerWithLink, Staff, type StaffCreds, strongPassword } from './lib/staff.ts';
import { Check, sleep } from './lib/util.ts';

refuseProduction('The smoke test');
const check = new Check();
const startedAt = new Date().toISOString();

async function poll<T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 180_000): Promise<T> {
  const t0 = Date.now();
  let v = await read();
  while (!done(v) && Date.now() - t0 < timeoutMs) {
    await sleep(5_000);
    v = await read();
  }
  return v;
}

console.log(`── setup (${target}: ${env.supabaseUrl})`);
const statePath = `${Deno.env.get('HOME')}/.fess-pos/seed-state-${target}.json`;
let creds: StaffCreds | undefined;
try {
  creds = JSON.parse(Deno.readTextFileSync(statePath)).admin;
} catch {
  // reported just below
}
if (!creds?.password) throw new Error(`No seed admin in ${statePath}: run the scenario seeder against ${target} first.`);
const admin = new Staff('seed admin', creds);
await admin.login();

const stamp = Date.now().toString(36).toUpperCase();
let [bank] = await admin.select<{ id: string }>('banks', 'code=eq.SMOKE&select=id');
bank ??= await admin.api('POST', '/banks', { code: 'SMOKE', name: 'Smoke Test Bank (QA)', four_eyes_enabled: false, contacts: [] });
let [agent] = await admin.select<{ id: string }>('pos_users', 'employee_number=eq.SMOKE01&select=id');
agent ??= await admin.api('POST', '/users', { employee_number: 'SMOKE01', first_name: 'Sipho', last_name: 'Smoke', role: 'pos_agent', permissions: [] });
const job = await admin.api('POST', '/jobs', {
  bank_id: bank.id, merchant_name: `Smoke Spaza ${stamp}`, trading_name: null, external_ref: `SMOKE-${stamp}`,
  address: { line1: '12 Vilakazi St', suburb: 'Orlando West', city: 'Soweto', province: 'Gauteng', postal_code: '1804', country: 'ZA' },
  location: { lat: -26.2385, lng: 27.9087 }, location_source: 'pinned', location_type: 'standalone', mcc_code: '5411',
  contact: { name: 'Sipho Smoke', phone: '+27823450099' }, notes: 'Smoke test (QA dummy data)',
  attributes: { branch_code: '632005', account_manager: 'Smoke Test', risk_tier: 'standard' },
});
const start = new Date(Date.now() - 30 * 60_000);
await admin.api('POST', `/jobs/${job.id}/contact-attempts`, { channel: 'phone', outcome: 'confirmed', contact_name: 'Sipho Smoke' });
await admin.api('POST', `/jobs/${job.id}/schedule`, {
  scheduled_start: start.toISOString(), scheduled_end: new Date(start.getTime() + 4 * 3_600_000).toISOString(),
  onsite_contact: { name: 'Sipho Smoke', phone: '+27823450099', role: 'Owner' }, note: 'Smoke test',
});
await admin.api('POST', `/jobs/${job.id}/allocate`, { agent_id: agent.id });
console.log(`  job ${job.reference}`);

console.log('── admin registration link (D-96)');
/** True when Supabase Auth refuses the link (used up, replaced or cancelled). Nothing is spent when it refuses. */
async function linkRefused(link: string): Promise<boolean> {
  try {
    await registerWithLink(link, strongPassword());
    return false;
  } catch {
    return true;
  }
}
let [invitee] = await admin.select<{ id: string }>('pos_users', 'employee_number=eq.SMOKE-INV01&select=id');
invitee ??= await admin.api('POST', '/users', {
  employee_number: 'SMOKE-INV01', first_name: 'Vuyo', last_name: 'Smoke', role: 'pos_bank_reader', permissions: [], bank_ids: [bank.id],
});
type Sent = { invitation: { id: string; status: string }; link: string; email_sent: boolean; email_error: string | null };
const sent = await admin.fromPanel<Sent>('/invitations', { email: `pos-smoke-invite+${stamp.toLowerCase()}@example.com`, user_id: invitee.id });
check.ok(/\/register\?token_hash=[^&]+&type=invite$/.test(sent.link), 'a registration link to the panel’s /register page is made');
check.ok(sent.email_sent || !!sent.email_error, `emailed, or why not is recorded (${sent.email_sent ? 'emailed' : sent.email_error})`);
const copied = await admin.fromPanel<{ link: string }>(`/invitations/${sent.invitation.id}/link`);
check.eq(copied.link, sent.link, 'Copy link gives the same link as the email, without making a new one');
const resent = await admin.fromPanel<Sent>(`/invitations/${sent.invitation.id}/resend`);
check.ok(resent.link !== sent.link, 'Resend makes a new link');
check.ok(await linkRefused(sent.link), 'the earlier link stops working after Resend');
const cancelled = await admin.fromPanel<{ status: string }>(`/invitations/${sent.invitation.id}/cancel`, { reason: 'smoke test' });
check.eq(cancelled.status, 'cancelled', 'the link is cancelled');
check.ok(await linkRefused(resent.link), 'a cancelled link no longer works');

console.log('── sign-in (stand-in issuer → POS session)');
const phone = new Device('smoke-phone');
const host = await call<{ token: string }>('POST', '/v1/dev/host-token', { bearer: admin.token, body: { user_id: agent.id } });
const session = await phone.exchange(host.token, { employee_number: 'SMOKE01', first_name: 'Sipho', last_name: 'Smoke' });
check.eq(session.scope, 'full', 'exchange issues a full-scope session');
check.eq(session.user.employee_number, 'SMOKE01', 'session bound to the issuer-verified employee number');
try {
  await call('POST', '/v1/auth/exchange', { body: { issuer: 'pos_dev', token: 'garbage', device: phone.deviceInfo() } });
  check.ok(false, 'a forged host token is refused');
} catch (e) {
  check.eq((e as ApiError).code, 'INVALID_HOST_TOKEN', 'a forged host token is refused');
}

console.log('── pull');
await phone.pull();
const synced = phone.jobs.get(job.id);
check.ok(synced && synced.assigned_to_me, 'the assigned job arrives');
check.ok(phone.tokens.has(job.id), 'a session token is issued for it');
check.ok(!!phone.agentCard, 'an agent-card token is issued');
const globals = phone.manifest.filter((m) => m.context_bank_id === null);
check.ok(globals.length > 0 && phone.manifest.every((m) => phone.defs.has(m.version_id)),
  `all ${globals.length} active global definitions are resolved, with their bodies`);
check.eq(phone.defs.size, new Set(phone.manifest.map((m) => m.version_id)).size, 'definition bodies delivered once');
check.ok(phone.declarations.has('agent_declaration'), 'declarations delivered');
const again = await phone.pull();
check.eq(again.definitions.bodies.length, 0, 'bodies are not re-sent when the device has them');
check.eq(again.session_tokens.length, 0, 'tokens are not re-issued when the device has them');

console.log('── inspection with evidence');
const run = await runInspection(phone, synced!, { premises: 'complex', snapshot: true });
check.ok(run.receipts.every((r) => r.state === 'committed'), `every envelope committed (${run.receipts.length} receipts)`);
const sub = run.receipts[run.receipts.length - 1];
check.eq(sub.result?.inspection_status, 'verifying', 'submission committed; evidence all received → verifying');
const [flags] = await admin.select<{ flags: string[] }>('inspections', `id=eq.${run.inspectionId}&select=flags`);
check.eq(flags?.flags, [], 'a clean inspection carries no integrity flags (hashes, token, versions all match)');
const [report] = await phone.ingest([{ ...(await phone.envelope('sync_report', {
  reported_at_device: new Date().toISOString().replace('Z', '+00:00'), pending: { submission: 0 }, oldest_pending_at: null,
  last_success_at: null, free_storage_mb: 2048, battery_restricted: false, module_version: '0.1.0', config_version_id: null,
  capabilities: { spec_versions: ['1.0'] } })) }]);
check.eq(report.state, 'committed', 'sync report committed');

console.log('── workers (pg_cron every 15 s): verify + replicate');
type Insp = { status: string; evidence_expected: number; evidence_verified: number };
const insp = await poll(
  async () => (await admin.select<Insp>('inspections', `id=eq.${run.inspectionId}&select=status,evidence_expected,evidence_verified`))[0],
  (i) => i?.status === 'under_review',
);
check.eq(insp?.status, 'under_review', 'all evidence verified → inspection UNDER_REVIEW');
check.eq(insp?.evidence_verified, insp?.evidence_expected, `evidence verified ${insp?.evidence_verified}/${insp?.evidence_expected}`);
const [jobNow] = await admin.select<{ status: string }>('jobs', `id=eq.${job.id}&select=status`);
check.eq(jobNow?.status, 'under_review', 'job UNDER_REVIEW');
const evidence = await poll(
  () => admin.select<{ replica_state: string }>('evidence', `inspection_id=eq.${run.inspectionId}&select=replica_state`),
  (rows) => rows.length > 0 && rows.every((r) => r.replica_state === 'replicated'),
);
const replicated = evidence.filter((r) => r.replica_state === 'replicated').length;
check.eq(replicated, insp?.evidence_expected, `every verified item replicated with its hash re-verified (${replicated})`);
const mismatches = await admin.select('alerts', `kind=eq.payload_hash_mismatch&created_at=gte.${startedAt}&select=id`);
check.eq(mismatches.length, 0, 'device and server JCS hashes agree on every envelope');
await phone.pull();
check.ok([...phone.evidenceStatus.values()].filter((s) => s === 'verified').length >= (insp?.evidence_expected ?? 1),
  'the device learns `verified` for its evidence');

console.log('── public verification');
const verify = await call<{ status: string; agent?: { employee_number_masked: string } }>('GET', `/v1/public/verify/${phone.agentCard!.token}`, { publishable: false });
check.eq(verify.status, 'valid', 'the agent-card QR verifies');
check.eq(verify.agent?.employee_number_masked, '••••E01', 'employee number is masked to its last 3 characters');

console.log('── sessions');
const oldRefresh = phone.session!.refresh_token;
await phone.refresh();
check.ok(phone.session!.refresh_token !== oldRefresh, 'refresh rotates the refresh token');
const out = await phone.signout();
check.eq(out.scope, 'ingest_only', 'sign-out drops to ingest_only');
await phone.refresh();
try {
  await phone.pull();
  check.ok(false, 'ingest_only cannot pull');
} catch (e) {
  check.eq((e as ApiError).code, 'SCOPE_INSUFFICIENT', 'ingest_only cannot pull');
}
const late = await phone.send('custody_batch', { events: [{ subject_type: 'inspection', subject_id: run.inspectionId, event: 'receipt_received',
  at_device: new Date().toISOString().replace('Z', '+00:00'), monotonic_ms: 999_999 }] });
check.eq(late.state, 'committed', 'uploads still land after sign-out');
try {
  await call('POST', '/v1/auth/refresh', { body: { refresh_token: oldRefresh, device_id: phone.deviceId } });
  check.ok(false, 'reusing a rotated refresh token is refused');
} catch (e) {
  check.eq((e as ApiError).code, 'SESSION_REVOKED', 'reusing a rotated refresh token revokes the family');
}

Deno.exit(check.summary());
