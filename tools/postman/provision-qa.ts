// Creates the QA test users the Postman collection signs in as (T2-31, D-50), then writes a ready-to-import QA
// environment with their sign-in details to ~/.fess-pos/postman/ (outside the repo, mode 600). QA only: it refuses
// production.
//
//   POS_PUBLISHABLE_KEY=<QA publishable key> \
//     deno run -A --node-modules-dir=none --config tools/scenarios/deno.json tools/postman/provision-qa.ts
//
// Test users (created once through the admin API, remembered in ~/.fess-pos/postman-state-qa.json):
//   bank   APIT       "API Test Bank (QA)"
//   admin  API-ADM01  api.tester@fess-pos.test — scoped to APIT, permission schedule_jobs (joins by registration link,
//                     signs in with a password; D-96)
//   agents API-AG01, API-AG02
// Needs the seed admin from one scenario-seeder run: it creates the users. Re-runs only refresh the environment file.
import { env, refuseProduction, target } from '../scenarios/lib/env.ts';
import { inviteAndRegister, Staff, type StaffCreds } from '../scenarios/lib/staff.ts';

refuseProduction('Postman test-user provisioning');

const dir = `${Deno.env.get('HOME')}/.fess-pos`;
const statePath = `${dir}/postman-state-${target}.json`;
interface State {
  bank_id?: string;
  agents: Record<string, string>;
  admin?: StaffCreds & { employee_number: string };
}
let state: State = { agents: {} };
try {
  state = JSON.parse(Deno.readTextFileSync(statePath));
} catch {
  // first run
}
function save(): void {
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

let seedCreds: StaffCreds | undefined;
try {
  seedCreds = JSON.parse(Deno.readTextFileSync(`${dir}/seed-state-${target}.json`)).admin;
} catch {
  // reported just below
}
if (!seedCreds?.password) throw new Error(`No seed admin in ${dir}/seed-state-${target}.json: run the scenario seeder against ${target} first.`);
const seedAdmin = new Staff('seed admin', seedCreds);
await seedAdmin.login();
console.log(`── provisioning Postman test users on ${target} (${env.supabaseUrl})`);

if (!state.bank_id) {
  const [existing] = await seedAdmin.select<{ id: string }>('banks', 'code=eq.APIT&select=id');
  state.bank_id = existing?.id ?? (await seedAdmin.api('POST', '/banks', { code: 'APIT', name: 'API Test Bank (QA)', four_eyes_enabled: false, contacts: [] })).id;
  save();
}
console.log(`  bank APIT ${state.bank_id}`);

for (const [emp, first, last] of [['API-AG01', 'Api', 'Agent One'], ['API-AG02', 'Api', 'Agent Two']]) {
  if (!state.agents[emp]) {
    const [existing] = await seedAdmin.select<{ id: string }>('pos_users', `employee_number=eq.${emp}&select=id`);
    state.agents[emp] = existing?.id ?? (await seedAdmin.api('POST', '/users', {
      employee_number: emp, first_name: first, last_name: last, role: 'pos_agent', permissions: [], attributes: { region: 'gauteng' },
    })).id;
    save();
  }
  console.log(`  agent ${emp} ${state.agents[emp]}`);
}

if (!state.admin) {
  const creds = await inviteAndRegister(seedAdmin, {
    email: 'api.tester@fess-pos.test',
    person: {
      employee_number: 'API-ADM01', first_name: 'Api', last_name: 'Tester', role: 'pos_admin', permissions: ['schedule_jobs'],
      bank_ids: [state.bank_id],
    },
  });
  state.admin = { ...creds, employee_number: 'API-ADM01' };
  save();
}
const tester = new Staff('API tester', state.admin);
await tester.login(); // password; a second step only while admin.require_mfa is on
save();
const me = await tester.api('GET', '/me');
console.log(`  admin API-ADM01 ${state.admin.email} (signed in with ${tester.aal === 'aal2' ? 'password + second step' : 'a password'} as ${me.role})`);

const values: Array<[string, string, 'default' | 'secret']> = [
  ['env', target, 'default'],
  ['supabaseUrl', env.supabaseUrl, 'default'],
  ['apiBaseUrl', `${env.supabaseUrl}/functions/v1/api`, 'default'],
  ['publishableKey', env.publishableKey, 'default'],
  ['moduleVersion', '0.1.0', 'default'],
  ['adminEmail', state.admin.email, 'default'],
  ['adminPassword', state.admin.password, 'secret'],
  ['adminTotpSecret', state.admin.totp_secret ?? '', 'secret'],
  ['testBankId', state.bank_id, 'default'],
  ['agentEmployeeNumber', 'API-AG01', 'default'],
  ['agentUserId', state.agents['API-AG01'], 'default'],
  ['agent2EmployeeNumber', 'API-AG02', 'default'],
  ['agent2UserId', state.agents['API-AG02'], 'default'],
];
const environment = {
  id: 'b4b3f0a1-1c2d-4e5f-8a9b-0c1d2e3f4a53',
  name: 'FESS POS — QA (test users)',
  values: values.map(([key, value, type]) => ({ key, value, type, enabled: true })),
  _postman_variable_scope: 'environment',
};
Deno.mkdirSync(`${dir}/postman`, { recursive: true });
const envPath = `${dir}/postman/fess-pos-qa.local.postman_environment.json`;
Deno.writeTextFileSync(envPath, `${JSON.stringify(environment, null, 2)}\n`, { mode: 0o600 });
console.log(`\nReady-to-import QA environment (holds the test admin's password, and TOTP secret if one was set up; keep it private):\n  ${envPath}`);
