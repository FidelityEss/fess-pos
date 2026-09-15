// End-to-end check of admin sign-up by registration link, against QA only (T2-37, D-96). Uses the real APIs, as a person
// and an admin would through the panel:
//   1. the seed admin (signed in with a password alone) adds a new bank-scoped administrator and sends the link;
//   2. Copy link gives the same link; the password rules are enforced; the link works once;
//   3. the new person signs in with their password alone and reads admin data that needed the second step before D-96;
//   4. they leave the "waiting to sign up" list; then they are switched off (hard revoke), since pos rows are never deleted.
//
//   POS_PUBLISHABLE_KEY=<QA publishable key> deno run -A --node-modules-dir=none --config tools/scenarios/deno.json tools/scenarios/registration.ts
//
// Needs the seed admin from one scenario-seeder run. Left on QA: the switched-off test person, and their Supabase Auth
// account, whose id is printed at the end so it can be removed (Supabase's built-in mailer won't deliver to the test
// address, so the link is copied rather than emailed — which is the point of Copy link).
import { ApiError, call } from './lib/api.ts';
import { env, refuseProduction, target } from './lib/env.ts';
import { registerWithLink, Staff, type StaffCreds, strongPassword } from './lib/staff.ts';
import { Check } from './lib/util.ts';

refuseProduction('The registration-link check');
const check = new Check();
const statePath = `${Deno.env.get('HOME')}/.fess-pos/seed-state-${target}.json`;
let creds: StaffCreds | undefined;
try {
  creds = JSON.parse(Deno.readTextFileSync(statePath)).admin;
} catch {
  // reported just below
}
if (!creds?.password) throw new Error(`No seed admin in ${statePath}: run the scenario seeder against ${target} first.`);

async function expectCode(label: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check.ok(false, `${label} (expected ${code})`);
  } catch (e) {
    check.eq(e instanceof ApiError ? e.code : (e as { code?: string }).code ?? String(e), code, label);
  }
}

console.log(`── the admin sends a registration link (${target}: ${env.supabaseUrl})`);
const admin = new Staff('seed admin', creds);
await admin.login();
check.eq(admin.aal, 'aal1', 'the seed admin signs in with a password alone');
let [bank] = await admin.select<{ id: string }>('banks', 'code=eq.SMOKE&select=id');
bank ??= await admin.api('POST', '/banks', { code: 'SMOKE', name: 'Smoke Test Bank (QA)', four_eyes_enabled: false, contacts: [] });
const stamp = Date.now();
const email = `pos-invite-test+${stamp}@example.com`;
type Sent = { invitation: { id: string; expires_at: string }; user: { id: string; employee_number: string; admin_auth_uid: string }; link: string; email_sent: boolean; email_error: string | null };
const sent = await admin.fromPanel<Sent>('/invitations', {
  email,
  person: { first_name: 'Rene', last_name: `Register ${stamp}`, role: 'pos_admin', permissions: [], bank_ids: [bank.id] },
});
console.log(`  ${sent.user.employee_number} ${email}: ${sent.email_sent ? 'emailed' : `not emailed (${sent.email_error}), link made for copying`}`);
check.ok(sent.link.startsWith('https://fess-pos-admin-qa.vercel.app/register?token_hash='), 'the link opens the QA admin panel’s /register page');
// pos.settings admin.invite_ttl_hours: 24, or 1 on a project whose Supabase Auth otp_expiry is still 1 hour.
const hours = (Date.parse(sent.invitation.expires_at) - Date.now()) / 3_600_000;
check.ok(hours > 0.9 && hours <= 24, `the link is recorded with its expiry (${hours.toFixed(2)} h)`);
const copied = await admin.fromPanel<{ link: string }>(`/invitations/${sent.invitation.id}/link`);
check.eq(copied.link, sent.link, 'Copy link gives the same link, and the emailed one keeps working');
await expectCode('a second link for the same person is refused (Resend instead)', 'ALREADY_EXISTS',
  () => admin.fromPanel('/invitations', { email: `other+${stamp}@example.com`, user_id: sent.user.id }));

console.log('── the new person opens the link and chooses a password');
const url = new URL(copied.link);
const verified = await fetch(`${env.supabaseUrl}/auth/v1/verify`, {
  method: 'POST',
  headers: { apikey: env.publishableKey, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'invite', token_hash: url.searchParams.get('token_hash') }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
check.eq(verified.status, 200, 'Supabase Auth accepts the link and signs the person in');
const session = verified.body.access_token as string;
const weak = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
  method: 'PUT',
  headers: { apikey: env.publishableKey, authorization: `Bearer ${session}`, 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'Short1pass' }),
});
check.eq(weak.status, 422, `a 10-character password is refused by Supabase Auth (${weak.status})`);
await weak.body?.cancel();
const password = strongPassword();
const set = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
  method: 'PUT',
  headers: { apikey: env.publishableKey, authorization: `Bearer ${session}`, 'content-type': 'application/json' },
  body: JSON.stringify({ password }),
});
check.eq(set.status, 200, 'a strong password is accepted');
await set.body?.cancel();
const accepted = await call<{ accepted: boolean }>('POST', '/v1/admin/invitations/accept', { bearer: session });
check.eq(accepted.accepted, true, 'the registration page marks the link accepted');
let reused = false;
try {
  await registerWithLink(copied.link, strongPassword());
  reused = true;
} catch {
  // refused: expected
}
check.ok(!reused, 'the link works only once');
await expectCode('a used link can no longer be copied', 'CONFLICT', () => admin.fromPanel(`/invitations/${sent.invitation.id}/link`));

console.log('── they sign in with the password alone');
const person = new Staff('new admin', { user_id: sent.user.id, email, password });
await person.login();
check.eq(person.aal, 'aal1', 'signed in with email and password, no authenticator app');
const me = await person.api<{ id: string; role: string; bank_ids: string[] | null }>('GET', '/me');
check.ok(me.id === sent.user.id && me.role === 'pos_admin' && me.bank_ids?.[0] === bank.id, 'GET /v1/admin/me: an administrator for the SMOKE bank');
const jobs = await person.select<{ id: string; bank_id: string }>('jobs', `select=id,bank_id&bank_id=eq.${bank.id}&limit=5`);
check.ok(jobs.length > 0, `reads the bank’s jobs under RLS, which needed the second step before D-96 (${jobs.length} read)`);
const other = await person.select<{ id: string }>('jobs', `select=id&bank_id=neq.${bank.id}&limit=1`);
check.eq(other.length, 0, 'and nothing from other banks');
const waiting = await fetch(`${env.supabaseUrl}/rest/v1/rpc/admin_invitations_waiting`, {
  method: 'POST',
  headers: { apikey: env.publishableKey, authorization: `Bearer ${admin.token}`, 'content-profile': 'pos', 'content-type': 'application/json' },
  body: JSON.stringify({ p_user_id: sent.user.id }),
}).then((r) => r.json());
check.eq(JSON.stringify(waiting), '[]', 'they have left the “waiting to sign up” list');

console.log('── clean-up');
const off = await admin.api<{ mode: string }>('POST', `/users/${sent.user.id}/deactivate`, { mode: 'hard_revoke', reason: 'registration-link check (QA test person)' });
check.eq(off.mode, 'hard_revoke', 'the test person is switched off');
await expectCode('once switched off, their sign-in no longer reaches the admin API', 'FORBIDDEN', () => person.api('GET', '/me'));
console.log(`  Auth account to remove on QA: ${sent.user.admin_auth_uid} (${email})`);

Deno.exit(check.summary());
