// End-to-end check of bank API keys and the bank read API, against QA only (T6-06, D-100). As an admin and a bank's
// system would use them:
//   1. the seed admin creates a key for a bank that has a decided inspection (the key is shown once);
//   2. the bank's system lists what changed, pages with the cursor, and reads one inspection: labelled answers, a
//      custody summary and evidence with 15-minute links (one is downloaded and its SHA-256 compared);
//   3. another bank's inspection and an undecided one are not found; no key, a made-up key, a switched-off key and a
//      key over its per-minute limit are refused;
//   4. every call is in the call record and the activity history.
//
//   POS_PUBLISHABLE_KEY=<QA publishable key> deno run -A --node-modules-dir=none --config tools/scenarios/deno.json tools/scenarios/bank-api.ts
//
// Needs the seed admin and at least one approved inspection (the scenario seeder makes both). Left on QA: the two test
// keys, switched off (rows are never deleted), and their call records.
import { env, refuseProduction, target } from './lib/env.ts';
import { Staff, type StaffCreds } from './lib/staff.ts';
import { Check, sha256Hex } from './lib/util.ts';

refuseProduction('The bank API check');
const check = new Check();
const statePath = `${Deno.env.get('HOME')}/.fess-pos/seed-state-${target}.json`;
let creds: StaffCreds | undefined;
try {
  creds = JSON.parse(Deno.readTextFileSync(statePath)).admin;
} catch {
  // reported just below
}
if (!creds?.password) throw new Error(`No seed admin in ${statePath}: run the scenario seeder against ${target} first.`);
const bankApi = `${env.supabaseUrl}/functions/v1/api/v1/bank`;

// deno-lint-ignore no-explicit-any
async function bankGet(path: string, key: string | null): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(`${bankApi}${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

console.log(`── the admin creates a key (${target}: ${env.supabaseUrl})`);
const admin = new Staff('seed admin', creds);
await admin.login();
type InspectionRow = { id: string; status: string; jobs: { bank_id: string; reference: string } };
const approved = await admin.select<InspectionRow>('inspections', 'status=eq.approved&select=id,status,jobs!inner(bank_id,reference)&order=submitted_at_server.desc&limit=20');
if (approved.length === 0) throw new Error('No approved inspection on QA: run the scenario seeder first.');
const bankId = approved[0].jobs.bank_id;
const mine = approved[0];
const other = approved.find((r) => r.jobs.bank_id !== bankId) ?? null;
const [undecided] = await admin.select<InspectionRow>('inspections', `status=eq.under_review&select=id,status,jobs!inner(bank_id,reference)&jobs.bank_id=eq.${bankId}&limit=1`);
const made = await admin.api<{ id: string; key: string; last_four: string; status: string; expires_at: string }>('POST', `/banks/${bankId}/api-keys`, {
  name: `QA bank API check ${new Date().toISOString().slice(0, 16)}`, expires_in_months: 1,
});
check.ok(/^fpos_qa_[A-Za-z0-9]{43}$/.test(made.key), 'the key is shown once, as fpos_qa_…');
check.ok(made.status === 'active' && made.key.endsWith(made.last_four), 'it is active, and its last four characters are kept');
const listed = await admin.api<Array<Record<string, unknown>>>('GET', `/banks/${bankId}/api-keys`);
const row = listed.find((k) => k.id === made.id);
check.ok(row && !('key' in row) && !('key_hash' in row), 'the list shows the key without the key or its fingerprint');

console.log('── the bank reads its inspections');
const first = await bankGet('/inspections?limit=2', made.key);
check.eq(first.status, 200, 'GET /v1/bank/inspections answers');
check.ok(first.headers.get('x-ratelimit-limit') === '60', `a per-minute limit is announced (${first.headers.get('x-ratelimit-limit')})`);
check.ok((first.body.items as Array<{ status: string }>).every((i) => ['approved', 'rejected'].includes(i.status)), 'only decided inspections by default');
let all = [...first.body.items] as Array<{ id: string }>;
let cursor = first.body.next_cursor as string | null;
let more = first.body.has_more as boolean;
for (let pages = 0; more && pages < 20; pages++) {
  const next = await bankGet(`/inspections?limit=2&since=${encodeURIComponent(cursor!)}`, made.key);
  all = all.concat(next.body.items);
  cursor = next.body.next_cursor;
  more = next.body.has_more;
}
check.ok(all.some((i) => i.id === mine.id), `paging with the cursor reaches the approved inspection (${all.length} read)`);
check.eq(new Set(all.map((i) => i.id)).size, all.length, 'no inspection twice across pages');
const again = await bankGet(`/inspections?since=${encodeURIComponent(cursor!)}`, made.key);
check.ok(again.body.items.length === 0 && again.body.next_cursor === cursor, 'nothing new since the last cursor, and the cursor stays');
if (other) {
  check.ok(!all.some((i) => i.id === other.id), 'another bank’s inspections are not listed');
}

const detail = await bankGet(`/inspections/${mine.id}`, made.key);
check.eq(detail.status, 200, `GET /v1/bank/inspections/:id answers (${mine.jobs.reference})`);
const answers = detail.body.answers as Array<{ key: string; label: string }>;
check.ok(answers.length > 0 && answers.some((a) => a.label !== a.key), `answers come with their labels (${answers.length})`);
check.ok(Array.isArray(detail.body.custody?.events) && detail.body.custody.events.length > 0, 'a custody summary with its events');
const evidence = detail.body.evidence as Array<{ id: string; url: string | null; url_expires_at: string | null; sha256: string; storage_path?: string }>;
check.ok(evidence.length > 0 && evidence.every((e) => !('storage_path' in e)), `evidence listed without storage paths (${evidence.length})`);
const withUrl = evidence.find((e) => e.url);
if (withUrl) {
  const minutes = (Date.parse(withUrl.url_expires_at!) - Date.now()) / 60_000;
  check.ok(minutes > 0 && minutes <= 15, `download links last 15 minutes at most (${minutes.toFixed(1)})`);
  const bytes = new Uint8Array(await (await fetch(withUrl.url!)).arrayBuffer());
  check.eq(await sha256Hex(bytes), withUrl.sha256, 'a downloaded photo matches its recorded SHA-256');
} else {
  check.ok(false, 'at least one evidence item has a download link');
}
if (other) {
  const theirs = await bankGet(`/inspections/${other.id}`, made.key);
  check.eq(theirs.status, 404, 'another bank’s inspection is not found');
}
if (undecided) {
  const early = await bankGet(`/inspections/${undecided.id}`, made.key);
  check.eq(early.status, 404, 'an inspection still under review is not found');
}

console.log('── refusals');
check.eq((await bankGet('/inspections', null)).status, 401, 'no key: refused');
check.eq((await bankGet('/inspections', `fpos_qa_${'A'.repeat(43)}`)).status, 401, 'a made-up key: refused');
const tight = await admin.api<{ id: string; key: string }>('POST', `/banks/${bankId}/api-keys`, {
  name: 'QA rate-limit check', expires_in_months: 1, rate_limit_per_minute: 2,
});
const codes = [];
for (let i = 0; i < 3; i++) codes.push((await bankGet('/inspections?limit=1', tight.key)).status);
check.eq(codes.join(','), '200,200,429', `a key over its per-minute limit is refused (${codes.join(',')})`);
const off = await admin.api<{ status: string }>('POST', `/api-keys/${made.id}/revoke`, { reason: 'QA bank API check finished' });
check.eq(off.status, 'revoked', 'the admin switches the key off');
const refused = await bankGet('/inspections', made.key);
check.ok(refused.status === 401 && /switched off/.test(refused.body.error?.message ?? ''), 'a switched-off key is refused');
await admin.api('POST', `/api-keys/${tight.id}/revoke`, { reason: 'QA bank API check finished' });

console.log('── the record');
const calls = await admin.select<{ status: number; route: string }>('bank_api_calls', `key_id=eq.${made.id}&select=status,route&order=at`);
check.ok(calls.length >= all.length / 2 + 3, `every call with this key is recorded (${calls.length})`);
check.ok(calls.some((r) => r.status === 404) && calls.at(-1)?.status === 401, 'refused and not-found calls are recorded too');
const tightCalls = await admin.select<{ status: number }>('bank_api_calls', `key_id=eq.${tight.id}&select=status`);
check.ok(tightCalls.some((r) => r.status === 429), 'the rate-limited call is recorded');
const history = await admin.select<{ id: string }>('audit_log', `table_name=eq.bank_api_calls&select=id&limit=1&order=seq.desc`);
check.ok(history.length === 1, 'bank calls are in the activity history');

Deno.exit(check.summary());
