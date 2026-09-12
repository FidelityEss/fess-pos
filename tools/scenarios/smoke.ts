// End-to-end smoke test of the POS API against the LOCAL stack (never staging): sign-in with the stand-in issuer,
// pull, a full inspection with evidence, workers verifying + replicating, receipts, sessions, public verify.
// Setup rows are inserted directly into the local database (the admin API path is covered by the seeder).
//   deno run -A --config tools/scenarios/deno.json tools/scenarios/smoke.ts
import postgres from 'postgres';
import { SignJWT } from 'jose';
import { ApiError, call } from './lib/api.ts';
import { Device } from './lib/device.ts';
import { env, functionsUrl, target } from './lib/env.ts';
import { runInspection } from './lib/inspection.ts';
import { Check, sleep } from './lib/util.ts';

if (target !== 'local') throw new Error('smoke.ts only runs against the local stack');
const sql = postgres(env.dbUrl, { onnotice: () => {} });
const check = new Check();
const hexBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));

async function secret(name: string): Promise<string> {
  const [r] = await sql`select pos_rpc.secret_value(${name}) as v`;
  return r.v as string;
}

async function hostToken(emp: string, first: string, last: string): Promise<string> {
  return await new SignJWT({ employee_number: emp, first_name: first, last_name: last })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('pos-dev-issuer').setAudience('fess-pos')
    .setSubject(`dev:${emp}`).setIssuedAt().setExpirationTime('1h').sign(hexBytes(await secret('pos_dev_issuer_secret')));
}

async function kickWorkers(times = 1): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> = {};
  for (let i = 0; i < times; i++) {
    const res = await fetch(`${functionsUrl}/workers`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-pos-worker-key': await secret('pos_worker_key') }, body: '{"task":"drain"}',
    });
    last = await res.json();
  }
  return last;
}

console.log('── setup (local database)');
const stamp = Date.now().toString(36).toUpperCase();
await sql`insert into pos.banks (code, name) values ('SMOKE', 'Smoke Test Bank') on conflict (code) do nothing`;
await sql`insert into pos.pos_users (employee_number, first_name, last_name, role) values ('SMOKE01', 'Sipho', 'Smoke', 'pos_agent')
          on conflict (employee_number) do nothing`;
const [bank] = await sql`select id from pos.banks where code = 'SMOKE'`;
const [agent] = await sql`select id from pos.pos_users where employee_number = 'SMOKE01'`;
const [job] = await sql`insert into pos.jobs (bank_id, merchant_name, address, location, location_source, location_type, mcc_code)
  values (${bank.id}, ${'Smoke Spaza ' + stamp}, ${sql.json({ line1: '12 Vilakazi St', suburb: 'Orlando West', city: 'Soweto', province: 'GP', postal_code: '1804' })},
          extensions.st_setsrid(extensions.st_makepoint(27.9087, -26.2385), 4326)::extensions.geography, 'pinned', 'standalone', '5411')
  returning id, reference`;
await sql`update pos.jobs set status = 'scheduled', scheduled_start = now() + interval '1 hour', scheduled_end = now() + interval '3 hours' where id = ${job.id}`;
await sql`update pos.jobs set status = 'assigned', assigned_to = ${agent.id}, assigned_at = now() where id = ${job.id}`;
await sql`insert into pos.job_assignments (job_id, user_id) values (${job.id}, ${agent.id})`;
console.log(`  job ${job.reference}`);

console.log('── sign-in (stand-in issuer → POS session)');
const phone = new Device('smoke-phone');
const session = await phone.exchange(await hostToken('SMOKE01', 'Sipho', 'Smoke'), { employee_number: 'SMOKE01', first_name: 'Sipho', last_name: 'Smoke' });
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
const [globals] = await sql`select count(distinct f.id)::int as n from pos.definition_families f
  join pos.definition_activations a on a.family_id = f.id where f.bank_id is null and a.audience ->> 'type' = 'all'`;
check.eq(phone.manifest.filter((m) => m.context_bank_id === null).length, globals.n, `all ${globals.n} active global definitions are resolved`);
check.eq(phone.defs.size, globals.n, 'definition bodies delivered once');
check.ok(phone.declarations.has('agent_declaration'), 'declarations delivered');
const again = await phone.pull();
check.eq(again.definitions.bodies.length, 0, 'bodies are not re-sent when the device has them');
check.eq(again.session_tokens.length, 0, 'tokens are not re-issued when the device has them');

console.log('── inspection with evidence');
const run = await runInspection(phone, synced!, { premises: 'complex', snapshot: true });
check.ok(run.receipts.every((r) => r.state === 'committed'), `every envelope committed (${run.receipts.length} receipts)`);
const sub = run.receipts[run.receipts.length - 1];
check.eq(sub.result?.inspection_status, 'verifying', 'submission committed; evidence all received → verifying');
const [flags] = await sql`select flags from pos.inspections where id = ${run.inspectionId}`;
check.eq(flags.flags, [], 'a clean inspection carries no integrity flags (hashes, token, versions all match)');
const [dup] = await phone.ingest([{ ...(await phone.envelope('sync_report', {
  reported_at_device: new Date().toISOString().replace('Z', '+00:00'), pending: { submission: 0 }, oldest_pending_at: null,
  last_success_at: null, free_storage_mb: 2048, battery_restricted: false, module_version: '0.1.0', config_version_id: null,
  capabilities: { spec_versions: ['1.0'] } })) }]);
check.eq(dup.state, 'committed', 'sync report committed');

console.log('── workers: verify + replicate');
for (let i = 0; i < 4; i++) {
  await kickWorkers();
  const [s] = await sql`select status from pos.inspections where id = ${run.inspectionId}`;
  if (s.status === 'under_review') break;
  await sleep(500);
}
const [insp] = await sql`select status, evidence_expected, evidence_verified from pos.inspections where id = ${run.inspectionId}`;
check.eq(insp.status, 'under_review', 'all evidence verified → inspection UNDER_REVIEW');
check.eq(insp.evidence_verified, insp.evidence_expected, `evidence verified ${insp.evidence_verified}/${insp.evidence_expected}`);
const [jobNow] = await sql`select status from pos.jobs where id = ${job.id}`;
check.eq(jobNow.status, 'under_review', 'job UNDER_REVIEW');
await kickWorkers();
const [rep] = await sql`select count(*)::int as n from pos.evidence_replicas r join pos.evidence e on e.id = r.evidence_id where e.inspection_id = ${run.inspectionId}`;
check.eq(rep.n, insp.evidence_expected, 'every verified item replicated with its hash re-verified');
const [mismatch] = await sql`select count(*)::int as n from pos.alerts where kind = 'payload_hash_mismatch'`;
check.eq(mismatch.n, 0, 'device and server JCS hashes agree on every envelope');
await phone.pull();
check.ok([...phone.evidenceStatus.values()].filter((s) => s === 'verified').length >= insp.evidence_expected, 'the device learns `verified` for its evidence');

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

await sql.end();
Deno.exit(check.summary());
