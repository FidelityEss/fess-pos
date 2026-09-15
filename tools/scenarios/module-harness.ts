// Sign-in details for running the Flutter module against QA (fess-pos-qa) — never production. It stands in for the
// host app: the seed admin mints the host tokens FESS would hold for QA agents (stand-in issuer pos_dev), and the
// details go to a file that `flutter run` / `flutter test` read with --dart-define-from-file.
//
//   POS_PUBLISHABLE_KEY=<QA publishable key> deno run -A --node-modules-dir=none --config tools/scenarios/deno.json \
//     tools/scenarios/module-harness.ts [EMPLOYEE_NUMBER …]
//
// One login per agent (default SEED-AG01), each a host token valid for 24 h. The first also fills the single-login
// keys the device tests read; the harness app lists them all (POS_HOST_LOGINS), so on a phone you pick who logs in.
// Writes ~/.fess-pos/module-harness-qa.json (mode 600: it holds the tokens), then e.g.:
//   cd packages/fess_pos/example && flutter run --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json
//
// Needs the seed admin from ~/.fess-pos/seed-state-qa.json (run the scenario seeder once); its credentials never leave
// this machine. Creates no QA data itself; logging in with a token registers the device and a session, as a real phone
// would.
import { call } from './lib/api.ts';
import { apiUrl, env, refuseProduction, target } from './lib/env.ts';
import { Staff, type StaffCreds } from './lib/staff.ts';

refuseProduction('The module harness sign-in');
const employeeNumbers = Deno.args.length > 0 ? Deno.args : ['SEED-AG01'];
const home = Deno.env.get('HOME');
const statePath = `${home}/.fess-pos/seed-state-${target}.json`;
let creds: StaffCreds | undefined;
try {
  creds = JSON.parse(Deno.readTextFileSync(statePath)).admin;
} catch {
  // reported just below
}
if (!creds?.password) throw new Error(`No seed admin in ${statePath}: run the scenario seeder against ${target} first.`);

type HostToken = { issuer: string; token: string; issued_at: string; employee_number: string };

const admin = new Staff('seed admin', creds);
await admin.login();
const logins: HostToken[] = [];
for (const employeeNumber of employeeNumbers) {
  logins.push(
    await call<HostToken>('POST', '/v1/dev/host-token', {
      bearer: admin.token,
      body: { employee_number: employeeNumber, ttl_seconds: 86400 },
    }),
  );
}
const first = logins[0];

const out = `${home}/.fess-pos/module-harness-${target}.json`;
Deno.writeTextFileSync(
  out,
  JSON.stringify(
    {
      POS_API_URL: apiUrl,
      POS_PUBLISHABLE_KEY: env.publishableKey,
      POS_ENVIRONMENT: target,
      POS_HOST_ISSUER: first.issuer,
      POS_HOST_TOKEN: first.token,
      POS_HOST_TOKEN_ISSUED_AT: first.issued_at,
      POS_EMPLOYEE_NUMBER: first.employee_number,
      POS_HOST_LOGINS: JSON.stringify(
        logins.map((l) => ({ employee_number: l.employee_number, token: l.token, issued_at: l.issued_at })),
      ),
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
Deno.chmodSync(out, 0o600);
console.log(
  `Wrote ${out} for ${logins.map((l) => l.employee_number).join(', ')} on ${target} (host tokens valid 24 h).`,
);
