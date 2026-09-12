#!/usr/bin/env node
// First POS admin for a fresh environment (local by default). Creates the Supabase Auth user with a one-time password and
// links it to a new all-bank pos_admin through pos_rpc.admin_bootstrap(), which refuses as soon as any active admin
// exists. Further admins are provisioned in the panel (Users → Admin login). The admin enrols TOTP at first sign-in.
//
//   node scripts/bootstrap-admin.mjs --email you@example.com --employee ADM-0001 --first Jo --last Admin
//
// Env: SUPABASE_URL (default http://127.0.0.1:54321), SUPABASE_SERVICE_ROLE_KEY (required; never commit it).
// Local only: the SQL runs through `docker exec supabase_db_fess-pos psql`. Elsewhere (--print-sql) the script prints the
// statement to run once in the project's SQL editor instead. No agent may target the FESS project (instructions §10).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = arg('email');
const employee = arg('employee', 'ADM-0001');
const first = arg('first', 'POS');
const last = arg('last', 'Administrator');
const printSql = process.argv.includes('--print-sql');
const container = arg('container', 'supabase_db_fess-pos');

if (!email || !serviceKey) {
  console.error('usage: SUPABASE_SERVICE_ROLE_KEY=… node scripts/bootstrap-admin.mjs --email you@example.com [--employee ADM-0001 --first Jo --last Admin] [--print-sql]');
  process.exit(2);
}
if (url.includes('ceudfdtceyprrdnktitb')) {
  console.error('Refusing: that is the FESS app project, which is off-limits.');
  process.exit(2);
}
const quote = (s) => `'${String(s).replaceAll("'", "''")}'`;
if (!/^[A-Za-z0-9-]{1,32}$/.test(employee)) {
  console.error('employee number must match ^[A-Za-z0-9-]{1,32}$');
  process.exit(2);
}

const password = `${randomBytes(15).toString('base64url')}-Aa9`;
const res = await fetch(`${url}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { pos_bootstrap: true } }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Could not create the auth user (${res.status}): ${body.msg ?? body.message ?? JSON.stringify(body)}`);
  process.exit(1);
}
const sql = `select pos_rpc.admin_bootstrap(${quote(employee)}, ${quote(first)}, ${quote(last)}, ${quote(email)}, ${quote(body.id)});`;

if (printSql) {
  console.log('Run this once in the SQL editor of the POS project:\n');
  console.log(sql);
} else {
  try {
    execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch {
    console.error('\nThe bootstrap SQL failed (is an active admin already present?). The auth user was created; remove or reuse it.');
    process.exit(1);
  }
}
console.log(`\nAdmin ${email} ${printSql ? 'created in Auth — finish with the SQL above' : 'bootstrapped'}.`);
console.log(`One-time password (shown once, not stored): ${password}`);
console.log('Sign in to the admin panel and enrol an authenticator app (TOTP) when prompted.');
