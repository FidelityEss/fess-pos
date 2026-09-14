// Sign-in details for running the Flutter module against QA (fess-pos-qa) — never production. It stands in for the
// host app: the seed admin mints the host token FESS would hold for a QA agent (stand-in issuer pos_dev), and the
// details go to a file that `flutter run` / `flutter test` read with --dart-define-from-file.
//
//   POS_PUBLISHABLE_KEY=<QA publishable key> deno run -A --node-modules-dir=none --config tools/scenarios/deno.json \
//     tools/scenarios/module-harness.ts [EMPLOYEE_NUMBER]
//
// Writes ~/.fess-pos/module-harness-qa.json (mode 600; it holds a host token valid for 24 h), then e.g.:
//   cd packages/fess_pos/example && flutter run --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json
//
// Needs the seed admin from ~/.fess-pos/seed-state-qa.json (run the scenario seeder once). Creates no QA data itself;
// signing in with the token registers the device and a session, as a real phone would.
import { call } from './lib/api.ts';
import { apiUrl, env, refuseProduction, target } from './lib/env.ts';
import { Staff, type StaffCreds } from './lib/staff.ts';

refuseProduction('The module harness sign-in');
const employeeNumber = Deno.args[0] ?? 'SEED-AG01';
const home = Deno.env.get('HOME');
const statePath = `${home}/.fess-pos/seed-state-${target}.json`;
let creds: StaffCreds | undefined;
try {
  creds = JSON.parse(Deno.readTextFileSync(statePath)).admin;
} catch {
  // reported just below
}
if (!creds?.totp_secret) throw new Error(`No seed admin in ${statePath}: run the scenario seeder against ${target} first.`);

const admin = new Staff('seed admin', creds);
await admin.login();
const host = await call<{ issuer: string; token: string; issued_at: string; employee_number: string }>('POST', '/v1/dev/host-token', {
  bearer: admin.token,
  body: { employee_number: employeeNumber, ttl_seconds: 86400 },
});

const out = `${home}/.fess-pos/module-harness-${target}.json`;
Deno.writeTextFileSync(
  out,
  JSON.stringify(
    {
      POS_API_URL: apiUrl,
      POS_PUBLISHABLE_KEY: env.publishableKey,
      POS_ENVIRONMENT: target,
      POS_HOST_ISSUER: host.issuer,
      POS_HOST_TOKEN: host.token,
      POS_HOST_TOKEN_ISSUED_AT: host.issued_at,
      POS_EMPLOYEE_NUMBER: host.employee_number,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
Deno.chmodSync(out, 0o600);
console.log(`Wrote ${out} for ${host.employee_number} on ${target} (host token valid 24 h).`);
