// End-to-end check of "Preview on a phone" links, against QA only (T3-12, D-101, docs/04 §10). As the admin panel and the
// module use them:
//   1. the seed admin makes a link for a form draft (with its family) and one for a global preview (no family): the token
//      is shown once, in the links, and the link expires in about 30 minutes;
//   2. a signed-in agent opens it with GET /v1/preview/:token and gets the preview request, not cached;
//   3. an unknown or malformed token is not found, the same either way; no session, or an admin's own session, is refused;
//      a request of another kind than its family's is refused;
//   4. the opening is counted, with who opened it.
//
//   POS_PUBLISHABLE_KEY=<QA publishable key> deno run -A --node-modules-dir=none --config tools/scenarios/deno.json tools/scenarios/preview-links.ts
//
// Needs the seed admin (the scenario seeder makes it) and uses the smoke test's agent (SMOKE01), making it if missing.
// Left on QA: the two links, which expire by themselves.
import { ApiError, call } from './lib/api.ts';
import { Device } from './lib/device.ts';
import { env, refuseProduction, target } from './lib/env.ts';
import { Staff, type StaffCreds } from './lib/staff.ts';
import { Check } from './lib/util.ts';

refuseProduction('The preview link check');
const check = new Check();
const statePath = `${Deno.env.get('HOME')}/.fess-pos/seed-state-${target}.json`;
let creds: StaffCreds | undefined;
try {
  creds = JSON.parse(Deno.readTextFileSync(statePath)).admin;
} catch {
  // reported just below
}
if (!creds?.password) throw new Error(`No seed admin in ${statePath}: run the scenario seeder against ${target} first.`);

async function refused(label: string, fn: () => Promise<unknown>, status: number, code?: string): Promise<void> {
  try {
    await fn();
    check.ok(false, `${label} (it was allowed)`);
  } catch (e) {
    const ok = e instanceof ApiError && e.status === status && (!code || e.code === code);
    check.ok(ok, ok ? label : `${label} (${e instanceof ApiError ? `${e.status} ${e.code}` : String(e)})`);
  }
}

interface Link {
  id: string;
  kind: string;
  token: string;
  path: string;
  links: Record<string, string>;
  expires_at: string;
}

console.log(`── the admin makes links (${target}: ${env.supabaseUrl})`);
const admin = new Staff('seed admin', creds);
await admin.login();
const [family] = await admin.select<{ id: string; key: string }>('definition_families', 'kind=eq.form&scope=eq.global&select=id,key&limit=1');
if (!family) throw new Error('No global form family on QA: run the scenario seeder first.');
const today = new Date().toISOString().slice(0, 10);
const formDraft = {
  kind: 'form', family: family.key, title: 'QA preview link check',
  sections: [{ key: 'about', title: 'About', fields: [{ key: 'q1', type: 'text', label: 'A question' }] }],
};
const made = await admin.api<Link>('POST', '/preview-links', {
  kind: 'form',
  definition: formDraft,
  bundle: { strings: { 'preview.label': 'Preview' } },
  context: { today, job: { id: '00000000-0000-4000-8000-000000000042', reference: 'POS-PREVIEW' } },
  theme: { primary_color: '#00664b' },
  family_id: family.id,
});
check.ok(/^[0-9A-Za-z_-]{43}$/.test(made.token), 'the token is random and fits the module’s link pattern');
check.eq(made.path, `/pos/preview/${made.token}`, 'the path the module opens');
check.ok(Object.keys(made.links).length >= 2 && Object.values(made.links).every((l) => l.endsWith(`/pos/preview/${made.token}`)),
  `a link per phone platform (${Object.keys(made.links).join(', ')})`);
const minutes = (Date.parse(made.expires_at) - Date.now()) / 60_000;
check.ok(minutes > 28 && minutes <= 30, `it expires in about 30 minutes (${minutes.toFixed(1)})`);
const global = await admin.api<Link>('POST', '/preview-links', {
  kind: 'content', definition: { kind: 'content', family: 'core', strings: {} }, context: { today },
});
check.ok(global.token !== made.token && global.kind === 'content', 'a global preview (App settings) needs no family');
await refused('a request of another kind than its family’s is refused', () => admin.api('POST', '/preview-links', {
  kind: 'view', definition: { kind: 'view', family: family.key, items: [] }, family_id: family.id,
}), 400, 'INVALID_REQUEST');
await refused('a request that isn’t a preview is refused', () => admin.api('POST', '/preview-links', { kind: 'form' }), 400);

console.log('── an agent opens it on the phone');
let [agent] = await admin.select<{ id: string }>('pos_users', 'employee_number=eq.SMOKE01&select=id');
agent ??= await admin.api('POST', '/users', { employee_number: 'SMOKE01', first_name: 'Sipho', last_name: 'Smoke', role: 'pos_agent', permissions: [] });
const phone = new Device('preview-phone');
const host = await call<{ token: string }>('POST', '/v1/dev/host-token', { bearer: admin.token, body: { user_id: agent.id } });
await phone.exchange(host.token, { employee_number: 'SMOKE01', first_name: 'Sipho', last_name: 'Smoke' });
const res = await fetch(`${env.supabaseUrl}/functions/v1/api/v1/preview/${made.token}`, {
  headers: { apikey: env.publishableKey, authorization: `Bearer ${phone.access}` },
});
check.eq(res.status, 200, 'GET /v1/preview/:token answers');
check.ok((res.headers.get('cache-control') ?? '').includes('no-store'), 'and isn’t cached');
const opened = await res.json();
check.eq(opened.kind, 'form', 'as a preview request of its kind');
check.eq(opened.definition?.title, 'QA preview link check', 'with the draft as the admin drew it');
check.ok(opened.bundle && opened.context?.today === today && opened.theme?.primary_color === '#00664b', 'its bundle, sample context and look');
check.ok(typeof opened.expires_at === 'string', 'and when it expires');

console.log('── what is refused');
await refused('an unknown token is not found', () => call('GET', `/v1/preview/${'x'.repeat(43)}`, { bearer: phone.access }), 404, 'NOT_FOUND');
await refused('a malformed one reads the same', () => call('GET', '/v1/preview/short', { bearer: phone.access }), 404, 'NOT_FOUND');
await refused('no session is refused', () => call('GET', `/v1/preview/${made.token}`), 401);
await refused('an admin’s own session is not an agent session', () => call('GET', `/v1/preview/${made.token}`, { bearer: admin.token }), 401);

console.log('── the opening is recorded');
const [row] = await admin.select<{ opened_count: number; last_opened_by: string; request: unknown }>('preview_sessions',
  `id=eq.${made.id}&select=opened_count,last_opened_by,token_hash`);
check.ok(row?.opened_count === 1 && row.last_opened_by === agent.id, 'opened once, by the agent');
check.ok(row && !('token' in row), 'only the token’s fingerprint is kept');

Deno.exit(check.summary());
