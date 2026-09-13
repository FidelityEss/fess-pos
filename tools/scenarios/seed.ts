// Scenario seeder (T2-22): realistic dummy data that exercises every flow end to end through the real APIs — the admin
// API as signed-in staff (password + TOTP, aal2) and the POS API as simulated phones (stand-in issuer pos_dev). Nothing
// is written behind the API's back except the seed admin's own pos_users row (the bootstrap, like scripts/bootstrap-admin).
//
//   POS_PUBLISHABLE_KEY=<QA publishable key> SUPABASE_SERVICE_ROLE_KEY=<QA service key; first run only> \
//     deno run -A --node-modules-dir=none --config tools/scenarios/deno.json tools/scenarios/seed.ts
//   QA only (POS_TARGET=qa, the default): it refuses production, and env.ts refuses any other project.
//
// Re-runnable: banks, staff and agents are created once and remembered in ~/.fess-pos/seed-state-<target>.json — outside
// the repo, because it holds the seed staff's passwords and TOTP secrets. Every run adds a fresh batch of jobs.
import { ApiError, call } from './lib/api.ts';
import { Device, type SyncJob } from './lib/device.ts';
import { env, refuseProduction, target } from './lib/env.ts';
import { type InspectionOptions, reasonEvent, runInspection } from './lib/inspection.ts';
import { createAuthUser, Staff, type StaffCreds, strongPassword } from './lib/staff.ts';
import { Check, isoSast, sleep } from './lib/util.ts';

refuseProduction('The scenario seeder');

// ── state ─────────────────────────────────────────────────────────────────────────────────────
type AdminCreds = StaffCreds & { employee_number: string; linked?: boolean; bootstrap_sql?: string };
interface SeedState {
  admin?: AdminCreds;
  staff: Record<string, StaffCreds>;
  banks: Record<string, string>;
  agents: Record<string, string>;
  definitions: Record<string, string>;
  runs: number;
}
const stateDir = `${Deno.env.get('HOME')}/.fess-pos`;
const statePath = `${stateDir}/seed-state-${target}.json`;
function loadState(): SeedState {
  try {
    return JSON.parse(Deno.readTextFileSync(statePath));
  } catch {
    return { staff: {}, banks: {}, agents: {}, definitions: {}, runs: 0 };
  }
}
const state = loadState();
function saveState(): void {
  Deno.mkdirSync(stateDir, { recursive: true });
  Deno.writeTextFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

const check = new Check();
state.runs = (state.runs ?? 0) + 1;
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const runLabel = `seed run ${state.runs} (${stamp})`;
const ago = (min: number) => new Date(Date.now() - min * 60_000);
const errText = (e: unknown) => e instanceof ApiError ? `${e.message} ${JSON.stringify(e.body.error?.details ?? '')}` : String(e);

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    check.ok(false, `${name}: ${errText(e)}`);
  }
}

async function expectError(label: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check.ok(false, `${label} (expected ${code})`);
  } catch (e) {
    check.eq(e instanceof ApiError ? e.code : String(e), code, label);
  }
}

// ── staff ─────────────────────────────────────────────────────────────────────────────────────
async function signInSeedAdmin(): Promise<Staff> {
  if (!state.admin) {
    const email = 'seed.admin@fess-pos.test';
    const password = strongPassword();
    const authUid = await createAuthUser(email, password);
    const userId = crypto.randomUUID();
    const bootstrap = `insert into pos.pos_users (id, employee_number, first_name, last_name, email, role, permissions, bank_ids, admin_auth_uid)
values ('${userId}', 'SEED-ADM01', 'Seed', 'Administrator', '${email}', 'pos_admin',
        array['review_inspections', 'approve_definitions', 'schedule_jobs'], null, '${authUid}')
on conflict (employee_number) do nothing;`;
    state.admin = { user_id: userId, email, password, employee_number: 'SEED-ADM01', bootstrap_sql: bootstrap };
    saveState();
  }
  const admin = new Staff('seed admin', state.admin);
  await admin.login();
  saveState();
  try {
    await admin.api('GET', '/me');
  } catch (e) {
    if (!state.admin.linked) {
      console.log(`\nThe seed admin's Auth account exists; link it to a POS admin once with this insert on the target project (supabase db query --linked --project-ref <ref> "…"), then re-run:\n\n${state.admin.bootstrap_sql}\n`);
      Deno.exit(3);
    }
    throw e;
  }
  state.admin.linked = true;
  saveState();
  return admin;
}

interface StaffSpec {
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string;
  role: 'pos_admin' | 'pos_bank_reader';
  permissions: string[];
  bank_ids?: string[] | null;
}

async function ensureStaff(admin: Staff, key: string, spec: StaffSpec): Promise<Staff> {
  let creds = state.staff[key];
  if (!creds) {
    const u = await admin.api('POST', '/users', { ...spec, bank_ids: spec.bank_ids ?? null });
    const login = await admin.api('POST', `/users/${u.id}/admin-login`, { email: spec.email });
    creds = { user_id: u.id, email: spec.email, password: login.temporary_password };
    state.staff[key] = creds;
    saveState();
  }
  const s = new Staff(`${spec.first_name} ${spec.last_name}`, creds);
  await s.login();
  saveState();
  return s;
}

// ── reference: merchants around South Africa (fictional businesses, real places) ──────────────
interface Merchant {
  name: string; line1: string; suburb: string; city: string; province: string; postal: string;
  lat: number; lng: number; mcc: string; type: string; contact: string; phone: string;
}
const m = (name: string, line1: string, suburb: string, city: string, province: string, postal: string, lat: number, lng: number,
           mcc: string, type: string, contact: string, phone: string): Merchant => ({ name, line1, suburb, city, province, postal, lat, lng, mcc, type, contact, phone });
const GP = 'Gauteng', WC = 'Western Cape', KZN = 'KwaZulu-Natal';
const MERCHANTS = {
  spaza: m("Mama Joy's Spaza", '1187 Vilakazi St', 'Orlando West', 'Soweto', GP, '1804', -26.2385, 27.9087, '5411', 'residential', 'Joyce Mthembu', '+27823450011'),
  kicks: m('Kasi Kicks Sneakers', '22 Commissioner St', 'Marshalltown', 'Johannesburg', GP, '2001', -26.2069, 28.0395, '5661', 'standalone', 'Sibusiso Ndlovu', '+27823450012'),
  coffee: m('Braam Coffee Co.', '41 De Korte St', 'Braamfontein', 'Johannesburg', GP, '2001', -26.1929, 28.0339, '5812', 'standalone', 'Karabo Moloi', '+27823450013'),
  tech: m('Rosebank Tech Hub Electronics', 'Shop 14, The Zone, 177 Oxford Rd', 'Rosebank', 'Johannesburg', GP, '2196', -26.1466, 28.0419, '5732', 'shopping_centre', 'Rajesh Naidoo', '+27823450014'),
  hair: m('Mzansi Hair Studio', '9 Rockey St', 'Yeoville', 'Johannesburg', GP, '2198', -26.1837, 28.0612, '7230', 'standalone', 'Precious Dube', '+27823450015'),
  hardware: m('Tembisa Hardware & Build', '12 Andrew Mapheto Dr', 'Tembisa', 'Ekurhuleni', GP, '1632', -25.9964, 28.2268, '5251', 'large_site', 'Vusi Mabena', '+27823450016'),
  pharmacy: m('Hatfield Pharmacy', '1122 Burnett St', 'Hatfield', 'Pretoria', GP, '0083', -25.7487, 28.2380, '5912', 'standalone', 'Anita Pretorius', '+27823450017'),
  gold: m('Menlyn Gold Traders', 'Shop G41, Menlyn Park, Atterbury Rd', 'Menlyn', 'Pretoria', GP, '0181', -25.7826, 28.2759, '5944', 'shopping_centre', 'David Cohen', '+27823450018'),
  consult: m('Sandton Consulting Group', '3rd Floor, 5 Rivonia Rd', 'Sandhurst', 'Sandton', GP, '2196', -26.1076, 28.0567, '7399', 'office_park', 'Lindiwe Mokoena', '+27823450019'),
  butchery: m('Alex Butchery', '45 Selborne St', 'Alexandra', 'Johannesburg', GP, '2090', -26.1030, 28.0977, '5422', 'standalone', 'Themba Mahlaba', '+27823450020'),
  auto: m('Midrand Auto Care', '14 Old Pretoria Rd', 'Halfway House', 'Midrand', GP, '1685', -25.9992, 28.1263, '7538', 'standalone', 'Frans Venter', '+27823450021'),
  fastfood: m('Soshanguve Fast Foods', 'Block L, Stand 1422', 'Soshanguve', 'Pretoria', GP, '0152', -25.5231, 28.0960, '5814', 'residential', 'Mpho Sebola', '+27823450022'),
  florist: m('Fourways Florist', 'Shop 8, Cedar Square, Willow Ave', 'Fourways', 'Johannesburg', GP, '2191', -26.0180, 28.0069, '5992', 'shopping_centre', 'Charlene Botha', '+27823450023'),
  gallery: m('Maboneng Gallery Shop', '286 Fox St', 'Maboneng', 'Johannesburg', GP, '2094', -26.2044, 28.0588, '5999', 'standalone', 'Neo Radebe', '+27823450024'),
  liquor: m('Benoni Liquor Den', '63 Tom Jones St', 'Benoni', 'Ekurhuleni', GP, '1501', -26.1885, 28.3207, '5921', 'standalone', 'Kobus Smit', '+27823450025'),
  cellular: m('Kempton Cellular World', 'Shop 3, Kempton City, Pretoria Rd', 'Kempton Park', 'Ekurhuleni', GP, '1619', -26.1003, 28.2319, '4814', 'shopping_centre', 'Ahmed Essop', '+27823450026'),
  bakery: m('Vosloorus Bakery', '1840 Mabuya St', 'Vosloorus', 'Ekurhuleni', GP, '1475', -26.3516, 28.2011, '5462', 'residential', 'Nomvula Khoza', '+27823450027'),
  stationers: m('Randburg Stationers', '22 Hill St', 'Randburg', 'Johannesburg', GP, '2194', -26.0936, 27.9988, '5399', 'standalone', 'Grace Pillay', '+27823450028'),
  spice: m('Bo-Kaap Spice Merchants', '71 Wale St', 'Bo-Kaap', 'Cape Town', WC, '8001', -33.9200, 18.4150, '5499', 'standalone', 'Faiza Abrahams', '+27823450029'),
  tyres: m('Khayelitsha Tyre Fitment', 'Site C, Lansdowne Rd', 'Khayelitsha', 'Cape Town', WC, '7784', -34.0357, 18.6780, '7538', 'standalone', 'Lwazi Mgqibela', '+27823450030'),
  office: m('Century City Office Supplies', 'Unit 5, Park Lane, Century Blvd', 'Century City', 'Cape Town', WC, '7441', -33.8908, 18.5116, '5399', 'office_park', 'Megan Adams', '+27823450031'),
  wine: m('Stellenbosch Cellar Door', 'R44, Annandale Rd', 'Stellenbosch', 'Stellenbosch', WC, '7600', -33.9844, 18.8456, '5921', 'large_site', 'Pieter Louw', '+27823450032'),
  clothing: m('Mitchells Plain Clothing', 'Shop 22, Town Centre, AZ Berman Dr', 'Mitchells Plain', 'Cape Town', WC, '7785', -34.0478, 18.6180, '5651', 'shopping_centre', 'Shireen Jacobs', '+27823450033'),
  surf: m('Durban Beachfront Surf', '14 OR Tambo Pde', 'South Beach', 'Durban', KZN, '4001', -29.8587, 31.0385, '5941', 'standalone', 'Kyle Govender', '+27823450034'),
  cashcarry: m('Umlazi Cash & Carry', 'V1210 Mangosuthu Hwy', 'Umlazi', 'Durban', KZN, '4031', -29.9701, 30.8866, '5411', 'standalone', 'Sipho Zungu', '+27823450035'),
  jewellers: m('Gateway Jewellers', 'Shop U320, Gateway Theatre of Shopping', 'Umhlanga', 'Durban', KZN, '4319', -29.7266, 31.0664, '5944', 'shopping_centre', 'Priya Moodley', '+27823450036'),
  spares: m('Pinetown Motor Spares', '31 Old Main Rd', 'Pinetown', 'Durban', KZN, '3610', -29.8177, 30.8561, '5999', 'standalone', 'Bheki Cele', '+27823450037'),
  dental: m('Pietermaritzburg Dental Rooms', '220 Church St', 'Pietermaritzburg', 'Msunduzi', KZN, '3201', -29.6006, 30.3794, '8021', 'office_park', 'Dr Nadia Hassim', '+27823450038'),
};

const AGENTS: Array<[string, string, string, string]> = [
  ['SEED-AG01', 'Gugu', 'Dlamini', 'gauteng'],
  ['SEED-AG02', 'Musa', 'Khumalo', 'gauteng'],
  ['SEED-AG03', 'Lerato', 'Molefe', 'gauteng'],
  ['SEED-AG04', 'Pieter', 'van Wyk', 'western_cape'],
  ['SEED-AG05', 'Ayesha', 'Patel', 'kwazulu_natal'],
  ['SEED-AG06', 'Themba', 'Nkosi', 'gauteng'],
];
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ── run ───────────────────────────────────────────────────────────────────────────────────────
console.log(`── ${runLabel} → ${target} (${env.supabaseUrl})`);
const admin = await signInSeedAdmin();
check.ok(true, 'seed admin signed in with password + TOTP (aal2)');

console.log('── banks');
async function ensureBank(code: string, body: Record<string, unknown>): Promise<string> {
  if (!state.banks[code]) {
    const b = await admin.api('POST', '/banks', { code, ...body });
    state.banks[code] = b.id;
    saveState();
  }
  return state.banks[code];
}
const bankA = await ensureBank('UBNK', {
  name: 'Ubuntu Bank (demo)', four_eyes_enabled: false,
  contacts: [{ name: 'Nomsa Zulu', role: 'Merchant onboarding', email: 'onboarding@ubuntu-bank.test', phone: '+27115550100' }],
});
const bankB = await ensureBank('KARO', {
  name: 'Karoo Mutual (demo)', four_eyes_enabled: true,
  contacts: [{ name: 'Johan Botha', role: 'Acquiring risk', email: 'risk@karoo-mutual.test', phone: '+27215550199' }],
});
check.ok(bankA && bankB, 'two banks: Ubuntu Bank (four-eyes off) and Karoo Mutual (four-eyes on)');

console.log('── staff (admin-login + TOTP enrolment)');
const scheduler = await ensureStaff(admin, 'scheduler', { employee_number: 'SEED-SCH01', first_name: 'Sizwe', last_name: 'Mahlangu',
  email: 'sizwe.mahlangu@fess-pos.test', role: 'pos_admin', permissions: ['schedule_jobs'] });
const reviewer = await ensureStaff(admin, 'reviewer', { employee_number: 'SEED-REV01', first_name: 'Rethabile', last_name: 'Sithole',
  email: 'rethabile.sithole@fess-pos.test', role: 'pos_admin', permissions: ['review_inspections'] });
const approver = await ensureStaff(admin, 'approver', { employee_number: 'SEED-APR01', first_name: 'Anele', last_name: 'Ntuli',
  email: 'anele.ntuli@fess-pos.test', role: 'pos_admin', permissions: ['approve_definitions'] });
check.ok(scheduler.token && reviewer.token && approver.token, 'scheduler, reviewer and approver provisioned and signed in (aal2)');

console.log('── agents');
for (const [emp, first, last, region] of AGENTS) {
  if (state.agents[emp]) continue;
  const u = await admin.api('POST', '/users', { employee_number: emp, first_name: first, last_name: last, role: 'pos_agent', permissions: [],
                                                attributes: { region } });
  state.agents[emp] = u.id;
  saveState();
}
check.eq(Object.keys(state.agents).length, AGENTS.length, `${AGENTS.length} agents`);
await step('agent card photo', async () => {
  await admin.api('POST', `/users/${state.agents['SEED-AG01']}/photo`, { content_type: 'image/png', data_base64: PNG_1PX });
  check.ok(true, 'profile photo stored for the authorisation card');
});

// ── definitions & config (bank A: bank-specific job schema; bank B: four-eyes on publish/activate/config) ──
async function viaFourEyes(label: string, res: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (res?.status !== 'approval_required') return res;
  check.ok(true, `four-eyes: ${label} → approval required`);
  await expectError(`four-eyes: the requester cannot approve their own ${label}`, 'FORBIDDEN',
    () => admin.api('POST', `/approvals/${res.approval_id}/decide`, { decision: 'approved' }));
  const d = await approver.api('POST', `/approvals/${res.approval_id}/decide`, { decision: 'approved', note: `Checked ${label}` });
  check.ok(d.executed, `four-eyes: ${label} approved by a second admin and executed`);
  return d;
}

async function latestVersion(familyId: string): Promise<string> {
  const [v] = await admin.select<{ id: string }>('definition_versions', `family_id=eq.${familyId}&select=id,version&order=version.desc&limit=1`);
  if (!v) throw new Error(`no published version for family ${familyId}`);
  return v.id;
}

async function publishAndActivate(label: string, family: Record<string, unknown>, definition: Record<string, unknown>): Promise<void> {
  if (!state.definitions[label]) {
    const f = await admin.api('POST', '/definitions/families', family);
    state.definitions[label] = f.id;
    saveState();
  }
  const familyId = state.definitions[label];
  const [existing] = await admin.select('definition_versions', `family_id=eq.${familyId}&select=id&limit=1`);
  if (existing) return;
  await viaFourEyes(`${label} publish`, await admin.api('POST', `/definitions/families/${familyId}/publish`, { definition, note: 'Seeded' }));
  const versionId = await latestVersion(familyId);
  await viaFourEyes(`${label} activation`, await admin.api('POST', `/definitions/families/${familyId}/activations`, {
    version_id: versionId, audience: { type: 'all' }, reason: 'Seeded bank override',
  }));
  check.ok(true, `${label}: published and activated`);
}

let bankSchema = false;
console.log('── definitions & remote config');
await step('bank A job schema', async () => {
  await publishAndActivate('UBNK job_schema', { kind: 'job_schema', key: 'job_attributes', bank_id: bankA, title: 'Job attributes — Ubuntu Bank' }, {
    spec_version: '1.0', kind: 'job_schema', family: 'job_attributes', version: 1, scope: null, title: 'Job attributes — Ubuntu Bank',
    attributes: [
      { key: 'branch_code', type: 'text', label: 'Bank branch code', props: { pattern: '^[0-9]{6}$' } },
      { key: 'account_manager', type: 'text', label: 'Bank account manager' },
      { key: 'risk_tier', type: 'single_select', label: 'Bank risk tier', options: [{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }] },
      { key: 'sector', type: 'single_select', label: 'Ubuntu Bank sector', options: [
        { value: 'retail', label: 'Retail' }, { value: 'hospitality', label: 'Hospitality' }, { value: 'services', label: 'Services' }] },
    ],
  });
  bankSchema = true;
});
await step('bank B content (four-eyes)', async () => {
  await publishAndActivate('KARO content', { kind: 'content', key: 'core', bank_id: bankB, title: 'Core copy — Karoo Mutual' }, {
    spec_version: '1.0', kind: 'content', family: 'core', version: 1, scope: null, title: 'Core copy — Karoo Mutual', locale: 'en-ZA',
    strings: { 'verify.report_concern': 'Report a concern to Karoo Mutual on 0800 555 0199, or to Fidelity Security Services.' },
  });
});
await step('bank B remote config (four-eyes)', async () => {
  const [current] = await admin.select('remote_config_versions', `layer=eq.bank&subject_id=eq.${bankB}&select=id&limit=1`);
  if (current) return;
  const res = await admin.api('POST', '/config', { layer: 'bank', subject_id: bankB, reason: 'Karoo Mutual risk policy',
    values: { assignment: { response_timeout_h: 12 }, integrity: { attestation_max_age_h: 12 } } });
  await viaFourEyes('bank config (integrity-relevant key)', res);
});
await step('agent remote config', async () => {
  const [current] = await admin.select('remote_config_versions', `layer=eq.agent&subject_id=eq.${state.agents['SEED-AG01']}&select=id&limit=1`);
  if (current) return;
  const res = await admin.api('POST', '/config', { layer: 'agent', subject_id: state.agents['SEED-AG01'], reason: 'Pilot: faster sync',
    values: { sync: { foreground_interval_s: 30 } } });
  check.ok(res.status !== 'approval_required', 'a non-integrity agent-layer config change publishes directly');
});

// ── job helpers ───────────────────────────────────────────────────────────────────────────────
interface Job { id: string; reference: string; m: Merchant }
const expected: Array<{ scenario: string; job: Job; want: string[] }> = [];
const expect = (scenario: string, job: Job, ...want: string[]) => expected.push({ scenario, job, want });
let seq = 0;
const sectorOf = (mcc: string) => ['5812', '5814', '5462'].includes(mcc) ? 'hospitality' : ['7230', '7538', '8021', '7399'].includes(mcc) ? 'services' : 'retail';

async function newJob(bank: 'A' | 'B', mer: Merchant, risk: 'standard' | 'high' = 'standard'): Promise<Job> {
  const n = String(++seq).padStart(2, '0');
  const attributes: Record<string, unknown> = {
    branch_code: bank === 'A' ? '250655' : '632005', account_manager: bank === 'A' ? 'Nomsa Zulu' : 'Johan Botha', risk_tier: risk,
  };
  if (bank === 'A' && bankSchema) attributes.sector = sectorOf(mer.mcc);
  const j = await admin.api('POST', '/jobs', {
    bank_id: bank === 'A' ? bankA : bankB, merchant_name: mer.name, trading_name: null, external_ref: `SEED-${stamp}-${n}`,
    address: { line1: mer.line1, suburb: mer.suburb, city: mer.city, province: mer.province, postal_code: mer.postal, country: 'ZA' },
    location: { lat: mer.lat, lng: mer.lng }, location_source: 'pinned', location_type: mer.type, mcc_code: mer.mcc,
    contact: { name: mer.contact, phone: mer.phone }, notes: `Dummy data — ${runLabel}`, attributes,
  });
  return { id: j.id, reference: j.reference, m: mer };
}

async function schedule(j: Job): Promise<void> {
  const start = ago(30);
  await scheduler.api('POST', `/jobs/${j.id}/contact-attempts`, { channel: 'phone', outcome: 'confirmed', contact_name: j.m.contact });
  await scheduler.api('POST', `/jobs/${j.id}/schedule`, {
    scheduled_start: start.toISOString(), scheduled_end: new Date(start.getTime() + 4 * 3_600_000).toISOString(),
    onsite_contact: { name: j.m.contact, phone: j.m.phone, role: 'Owner' }, note: 'Owner confirmed by phone',
  });
}

async function assigned(bank: 'A' | 'B', mer: Merchant, emp: string, risk: 'standard' | 'high' = 'standard'): Promise<Job> {
  const j = await newJob(bank, mer, risk);
  await schedule(j);
  await admin.api('POST', `/jobs/${j.id}/allocate`, { agent_id: state.agents[emp] });
  return j;
}

const devices: Record<string, Device> = {};
async function phone(emp: string): Promise<Device> {
  if (!devices[emp]) {
    const d = new Device(emp);
    const host = await call<{ token: string }>('POST', '/v1/dev/host-token', { bearer: admin.token, body: { user_id: state.agents[emp] } });
    await d.exchange(host.token);
    devices[emp] = d;
  }
  return devices[emp];
}

async function pullJob(emp: string, jobId: string): Promise<SyncJob> {
  const d = await phone(emp);
  await d.pull();
  const j = d.jobs.get(jobId);
  if (!j) throw new Error(`${emp} did not receive job ${jobId}`);
  return j;
}

async function inspect(emp: string, j: Job, opts: InspectionOptions = {}) {
  const run = await runInspection(await phone(emp), await pullJob(emp, j.id), { at: ago(45), ...opts });
  const bad = run.receipts.filter((r) => r.state !== 'committed');
  check.ok(bad.length === 0, `${j.reference}: ${run.receipts.length} envelopes committed` +
    (bad.length ? ` — not committed: ${bad.map((r) => `${r.state}:${r.error?.code ?? ''}`).join(', ')}` : ''));
  return run;
}

// pg_cron kicks the workers every 15 s, so waiting for them is polling.
async function waitStatus(j: Job, want: string[], timeoutMs = 150_000): Promise<string> {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    const [r] = await admin.select<{ status: string }>('jobs', `id=eq.${j.id}&select=status`);
    last = r?.status ?? '';
    if (want.includes(last)) return last;
    await sleep(5_000);
  }
  return last;
}

async function reviewed(j: Job, inspectionId: string, decision: 'approved' | 'returned' | 'rejected', body: Record<string, unknown> = {}) {
  const s = await waitStatus(j, ['under_review']);
  check.eq(s, 'under_review', `${j.reference}: evidence verified by the worker → under_review`);
  return await reviewer.api('POST', `/inspections/${inspectionId}/review`, { decision, ...body });
}

// ── scheduling & allocation flows ─────────────────────────────────────────────────────────────
console.log('── scheduling & allocation');
const M = MERCHANTS;
await step('pending', async () => {
  const j = await newJob('A', M.stationers);
  await scheduler.api('POST', `/jobs/${j.id}/contact-attempts`, { channel: 'phone', outcome: 'no_answer', note: 'Voicemail full' });
  expect('pending — created, first call unanswered', j, 'pending');
});
await step('appointment not secured', async () => {
  const j = await newJob('A', M.liquor);
  await scheduler.api('POST', `/jobs/${j.id}/contact-attempts`, { channel: 'phone', outcome: 'wrong_number' });
  await scheduler.api('POST', `/jobs/${j.id}/contact-attempts`, { channel: 'whatsapp', outcome: 'no_answer' });
  await scheduler.api('POST', `/jobs/${j.id}/not-secured`, { reason_code: 'wrong_contact_details', note: 'Number on the application belongs to someone else' });
  expect('appointment not secured — wrong contact details', j, 'appointment_not_secured');
});
await step('scheduled', async () => {
  const j = await newJob('B', M.office);
  await schedule(j);
  expect('scheduled — appointment confirmed, not yet allocated', j, 'scheduled');
});
await step('unscheduled', async () => {
  const j = await newJob('A', M.auto);
  await schedule(j);
  await scheduler.api('POST', `/jobs/${j.id}/unschedule`, { reason_code: 'merchant_cancelled_appointment', note: 'Owner travelling; call back next week' });
  expect('back to pending — merchant cancelled the appointment', j, 'pending');
});
await step('assigned', async () => {
  const j = await assigned('A', M.kicks, 'SEED-AG01');
  expect('assigned — waiting for the agent to respond', j, 'assigned');
});
await step('agent rejects', async () => {
  const j = await assigned('A', M.fastfood, 'SEED-AG02');
  const r = await reasonEvent(await phone('SEED-AG02'), await pullJob('SEED-AG02', j.id), 'reject', 'too_far', 'I am covering Soweto this week');
  check.eq(r.state, 'committed', `${j.reference}: agent rejection committed`);
  expect('agent rejected (too far) → back to scheduled', j, 'scheduled');
});
await step('revoked', async () => {
  const j = await assigned('B', M.pharmacy, 'SEED-AG03');
  await admin.api('POST', `/jobs/${j.id}/revoke`, { reason_code: 'agent_unavailable', note: 'Agent on leave' });
  expect('assignment revoked by admin → scheduled', j, 'scheduled');
});
await step('reassigned', async () => {
  const j = await assigned('A', M.hair, 'SEED-AG01');
  await admin.api('POST', `/jobs/${j.id}/reassign`, { agent_id: state.agents['SEED-AG02'], reason_code: 'workload' });
  expect('reassigned to another agent (workload)', j, 'assigned');
});
let goldJob: Job | null = null;
await step('assigned (other agent)', async () => {
  goldJob = await assigned('A', M.gold, 'SEED-AG03', 'high');
  expect('assigned to Lerato — another agent tries to accept it', goldJob, 'assigned');
});
await step('accepted', async () => {
  const j = await assigned('A', M.butchery, 'SEED-AG02');
  await pullJob('SEED-AG02', j.id);
  const r = await (await phone('SEED-AG02')).send('job_event', { job_id: j.id, action: 'accept' }, ago(10));
  check.eq(r.state, 'committed', `${j.reference}: accept committed`);
  expect('accepted by the agent', j, 'accepted');
});
await step('cancelled (scheduled)', async () => {
  const j = await newJob('B', M.clothing);
  await schedule(j);
  await admin.api('POST', `/jobs/${j.id}/cancel`, { reason_code: 'duplicate' });
  expect('cancelled before allocation (duplicate)', j, 'cancelled');
});
await step('cancelled (assigned)', async () => {
  const j = await assigned('A', M.cashcarry, 'SEED-AG05');
  await admin.api('POST', `/jobs/${j.id}/cancel`, { reason_code: 'bank_withdrew' });
  const d = await phone('SEED-AG05');
  await d.pull();
  check.eq(d.jobs.get(j.id)?.status, 'cancelled', `${j.reference}: the agent's phone learns the cancellation`);
  expect('cancelled after allocation (bank withdrew)', j, 'cancelled');
});

// ── field work ────────────────────────────────────────────────────────────────────────────────
console.log('── field work');
await step('in progress', async () => {
  const j = await assigned('A', M.coffee, 'SEED-AG01');
  await inspect('SEED-AG01', j, { stopAfter: 'started', at: ago(15) });
  expect('in progress — inspection started on site', j, 'in_progress');
});
await step('paused', async () => {
  const j = await assigned('B', M.consult, 'SEED-AG03');
  const run = await inspect('SEED-AG03', j, { stopAfter: 'started', at: ago(20) });
  const r = await (await phone('SEED-AG03')).send('job_event', { job_id: j.id, inspection_id: run.inspectionId, action: 'pause',
                                                                 trigger: 'geofence_exit' }, ago(5));
  check.eq(r.state, 'committed', `${j.reference}: fence-exit pause committed`);
  expect('paused — agent left the geofence mid-inspection', j, 'paused');
});
await step('submitted, evidence outstanding', async () => {
  const j = await assigned('A', M.gallery, 'SEED-AG01');
  await inspect('SEED-AG01', j, { upload: 'none', at: ago(70) });
  expect('submitted — photos still uploading (phone offline)', j, 'submitted');
});
await step('under review + amendment', async () => {
  const j = await assigned('A', M.spaza, 'SEED-AG02');
  const run = await inspect('SEED-AG02', j, { premises: 'other', snapshot: true });
  check.eq(await waitStatus(j, ['under_review']), 'under_review', `${j.reference}: evidence verified → under_review`);
  await reviewer.api('POST', `/inspections/${run.inspectionId}/amendments`, {
    field_key: 'contact_number', new_value: '+27829876543', justification: 'Merchant phoned in with the correct number; confirmed with the bank',
  });
  check.ok(true, `${j.reference}: reviewer amendment recorded (original answer preserved)`);
  expect('under review — with a reviewer amendment', j, 'under_review');
});
await step('approved (high risk, home premises)', async () => {
  const j = await assigned('A', M.bakery, 'SEED-AG01', 'high');
  const run = await inspect('SEED-AG01', j, { premises: 'home' });
  await reviewed(j, run.inspectionId, 'approved', { note: 'Home bakery; stock and ovens consistent with the application' });
  expect('approved — high-risk home business (4 internal + 3 external photos)', j, 'approved');
});
await step('closed', async () => {
  const j = await assigned('B', M.spice, 'SEED-AG04');
  const run = await inspect('SEED-AG04', j);
  await reviewed(j, run.inspectionId, 'approved');
  await admin.api('POST', `/jobs/${j.id}/close`, { note: 'Report sent to the bank' });
  expect('closed — approved and reported to the bank', j, 'closed');
});
await step('rejected', async () => {
  const j = await assigned('B', M.cellular, 'SEED-AG03');
  const run = await inspect('SEED-AG03', j, { risk: 'suspicious' });
  await reviewed(j, run.inspectionId, 'rejected', { reason_code: 'merchant_not_legitimate',
    note: 'Six square metres, no stock, 95% e-commerce with no fulfilment; other acquirers present' });
  expect('rejected — risk indicators (merchant not legitimate)', j, 'rejected');
});
await step('returned', async () => {
  const j = await assigned('A', M.hardware, 'SEED-AG02');
  const run = await inspect('SEED-AG02', j);
  await reviewed(j, run.inspectionId, 'returned', { reason_code: 'photos_insufficient', note: 'Yard stock not visible — add wide shots of the yard' });
  expect('returned for rework — waiting for the agent', j, 'returned');
});
await step('returned → second attempt → approved', async () => {
  const j = await assigned('A', M.florist, 'SEED-AG01');
  const first = await inspect('SEED-AG01', j, { at: ago(180) });
  await reviewed(j, first.inspectionId, 'returned', { reason_code: 'signature_missing', note: 'Signature image is blank' });
  const d = await phone('SEED-AG01');
  d.tokens.delete(j.id);
  const second = await inspect('SEED-AG01', j, { at: ago(40) });
  await reviewed(j, second.inspectionId, 'approved', { note: 'Second attempt complete' });
  expect('approved on the second attempt after a return', j, 'approved');
});
await step('integrity failure', async () => {
  const j = await assigned('B', M.tyres, 'SEED-AG04');
  const run = await inspect('SEED-AG04', j, { upload: 'tamper_one' });
  await waitStatus(j, ['under_review']);
  const [insp] = await admin.select<{ status: string; flags: string[] }>('inspections', `id=eq.${run.inspectionId}&select=status,flags`);
  check.ok(insp?.status === 'integrity_failed' && insp.flags.includes('evidence_quarantined'),
           `${j.reference}: stored photo bytes ≠ hash captured on the phone → inspection integrity_failed, photo quarantined`);
  expect('under review — inspection INTEGRITY_FAILED (a photo was substituted after capture)', j, 'under_review');
});
await step('unable to complete', async () => {
  const j = await assigned('A', M.spares, 'SEED-AG05');
  const d = await phone('SEED-AG05');
  const sj = await pullJob('SEED-AG05', j.id);
  await d.send('job_event', { job_id: j.id, action: 'accept' }, ago(90));
  const r = await reasonEvent(d, sj, 'unable', 'business_closed', 'Shutters down; the neighbour says it closed in March', ago(20));
  check.eq(r.state, 'committed', `${j.reference}: unable-to-complete committed`);
  expect('unable to complete — business closed', j, 'unable_to_complete');
});
await step('unable (premises not found, with photo)', async () => {
  const j = await assigned('B', M.wine, 'SEED-AG04');
  const r = await reasonEvent(await phone('SEED-AG04'), await pullJob('SEED-AG04', j.id), 'unable', 'premises_not_found',
                              'No cellar door at this address; farm gate locked', ago(25));
  check.ok(['committed', 'deferred'].includes(String(r.state)), `${j.reference}: unable with a photo landed (${r.state})`);
  expect('unable to complete — premises not found (photo evidence)', j, 'unable_to_complete', 'assigned');
});
await step('submitted after cancel', async () => {
  const j = await assigned('A', M.surf, 'SEED-AG05');
  await inspect('SEED-AG05', j, {
    beforeSubmit: async () => {
      await admin.api('POST', `/jobs/${j.id}/cancel`, { reason_code: 'merchant_withdrew', note: 'Merchant withdrew the application this morning' });
    },
  });
  const [ev] = await admin.select<{ type: string; verdict: string }>('job_events',
    `job_id=eq.${j.id}&type=in.(submission,submitted,inspection_submitted,submitted_after_cancel)&select=type,verdict&order=created_at.desc&limit=1`).catch(() => []);
  if (ev) check.ok(ev.verdict !== 'applied' || ev.type === 'submitted_after_cancel', `${j.reference}: the late submission is kept and recorded, not applied (${ev.type}/${ev.verdict})`);
  expect('cancelled while on site — the submission still landed (kept, flagged)', j, 'cancelled');
});
await step('geofence override', async () => {
  const j = await assigned('A', M.jewellers, 'SEED-AG05', 'high');
  const run = await inspect('SEED-AG05', j, { override: true, premises: 'mall' });
  await expectError(`${j.reference}: approval needs the override acknowledged`, 'VALIDATION_FAILED',
    () => reviewed(j, run.inspectionId, 'approved'));
  await reviewer.api('POST', `/inspections/${run.inspectionId}/review`, { decision: 'approved', override_acknowledged: true,
    note: 'Unit signage visible in the override photo' });
  expect('approved — geofence override acknowledged by the reviewer', j, 'approved');
});
await step('outside fix', async () => {
  const j = await assigned('B', M.dental, 'SEED-AG05');
  await inspect('SEED-AG05', j, { method: 'outside_fix', premises: 'office' });
  check.eq(await waitStatus(j, ['under_review']), 'under_review', `${j.reference}: evidence verified → under_review`);
  expect('under review — office park, location recorded outside before going in', j, 'under_review');
});
await step('agent deactivated (ingest-only)', async () => {
  // a previous run deactivated Themba: reactivate first (also exercises reactivation)
  await admin.api('POST', `/users/${state.agents['SEED-AG06']}/reactivate`, { reason: 'Re-contracted (dummy data)' }).catch(() => {});
  const j = await assigned('A', M.tech, 'SEED-AG06');
  const run = await inspect('SEED-AG06', j);
  await admin.api('POST', `/users/${state.agents['SEED-AG06']}/deactivate`, { mode: 'ingest_only', reason: 'Contract ended (dummy data)' });
  const d = await phone('SEED-AG06');
  const s = await d.refresh();
  check.eq(s.scope, 'ingest_only', 'a deactivated agent keeps an ingest-only session (D-35)');
  const r = await d.send('custody_batch', { events: [{ subject_type: 'inspection', subject_id: run.inspectionId, event: 'receipt_received',
    at_device: isoSast(new Date()), monotonic_ms: 9_999_999 }] });
  check.eq(r.state, 'committed', 'uploads still land after deactivation');
  check.eq(await waitStatus(j, ['under_review']), 'under_review', `${j.reference}: evidence verified → under_review`);
  expect('under review — agent deactivated afterwards, data still landed', j, 'under_review');
});

// ── envelopes in every receipt state ──────────────────────────────────────────────────────────
console.log('── envelope receipts');
await step('envelope receipts', async () => {
  const d = await phone('SEED-AG01');
  const report = await d.envelope('sync_report', {
    reported_at_device: isoSast(new Date()), pending: { submission: 0, evidence: 3 }, oldest_pending_at: isoSast(ago(70)), last_success_at: isoSast(ago(2)),
    free_storage_mb: 1840, battery_restricted: true, module_version: '0.1.0', config_version_id: null, capabilities: { spec_versions: ['1.0'] },
  });
  const [r1] = await d.ingest([report]);
  const [r2] = await d.ingest([report]);
  check.eq(r1.state, 'committed', 'sync report committed');
  check.ok(r2.id === r1.id && r2.state === 'duplicate' && r2.durable, `re-sending the same envelope is idempotent (receipt: ${r2.state})`);
  const held = await d.send('future_widget', { note: 'sent by a newer module build' });
  check.eq(held.state, 'deferred', 'an unknown envelope type is landed and held, never refused');
  const invalid = await d.send('job_event', { job_id: crypto.randomUUID() });
  check.ok(invalid.durable && invalid.state !== 'committed', `an invalid payload is kept for the envelope inbox (${invalid.state})`);
  if (goldJob) {
    const other = await d.send('job_event', { job_id: (goldJob as Job).id, action: 'accept' });
    check.ok(other.state !== 'committed' || (other.result as { verdict?: string } | null)?.verdict !== 'applied',
             `accepting someone else's job is not applied (${other.state})`);
  }
  if (held.id) {
    await admin.api('POST', `/envelopes/${held.id}/resolve`, { resolution: 'resolved', reason_code: 'other',
      note: 'Pilot build sent a type this server does not know yet; nothing to apply' });
    check.ok(true, 'admin resolved the held envelope from the inbox');
  }
});

// ── bulk import ───────────────────────────────────────────────────────────────────────────────
console.log('── bulk import');
await step('bulk import', async () => {
  const row = (name: string, line1: string, city: string, mcc: string, extra: Record<string, unknown> = {}) => ({
    merchant_name: name, external_ref: `IMP-${stamp}-${name.slice(0, 3).toUpperCase()}`,
    address: { line1, city, province: GP, country: 'ZA' }, location: null, location_source: 'geocoded', location_type: 'standalone', mcc_code: mcc,
    attributes: { branch_code: '250655', risk_tier: 'standard', ...(bankSchema ? { sector: sectorOf(mcc) } : {}) }, ...extra,
  });
  const rows = [
    row('Germiston Cycle Shop', '8 President St', 'Germiston', '5941'),
    row('Boksburg Laundromat', '17 Commissioner St', 'Boksburg', '7299'),
    row('Springs Tuck Shop', '4 Third Ave', 'Springs', '5499'),
    row('Nigel Bottle Store', '', 'Nigel', '5921', { attributes: { branch_code: '12AB' } }),
  ];
  const dry = await admin.api('POST', '/jobs/import', { bank_id: bankA, rows, dry_run: true });
  check.ok(dry.valid === 3 && dry.failed === 1 && dry.created === 0, `import dry run: 3 valid, 1 rejected with row errors (${dry.valid}/${dry.failed})`);
  const real = await admin.api('POST', '/jobs/import', { bank_id: bankA, rows: rows.slice(0, 3) });
  check.eq(real.created, 3, 'bulk import created 3 jobs');
});

// ── people, sessions, devices, alerts, exports ────────────────────────────────────────────────
console.log('── operations');
await step('bank reader', async () => {
  const reader = await ensureStaff(admin, 'reader', { employee_number: 'SEED-RDR01', first_name: 'Bongani', last_name: 'Shabalala',
    email: 'bongani.shabalala@fess-pos.test', role: 'pos_bank_reader', permissions: [], bank_ids: [bankA] });
  const me = await reader.api('GET', '/me');
  check.eq(me.role, 'pos_bank_reader', 'bank reader signs in (read-only, Ubuntu Bank only)');
  const jobs = await reader.select<{ bank_id: string }>('jobs', 'select=bank_id&limit=500');
  check.ok(jobs.length > 0 && jobs.every((r) => r.bank_id === bankA), `bank reader sees only Ubuntu Bank jobs (${jobs.length})`);
  await expectError('bank reader cannot write', 'FORBIDDEN', () => reader.api('POST', '/banks', { code: 'NOPE', name: 'Nope' }));
});
await step('device revoke + restore', async () => {
  const d = await phone('SEED-AG04');
  const [row] = await admin.select<{ id: string }>('devices', `device_id=eq.${d.deviceId}&select=id`);
  await admin.api('POST', `/devices/${row.id}/revoke`, { reason: 'Phone reported lost (dummy data)' });
  await admin.api('POST', `/devices/${row.id}/restore`, { reason: 'Phone found' });
  check.ok(true, 'device revoked and restored');
});
await step('alerts + export + queues', async () => {
  const open = await admin.select<{ id: string }>('alerts', 'acknowledged_at=is.null&select=id&order=created_at.asc&limit=2');
  if (open.length) {
    const r = await admin.api('POST', '/alerts/ack', { ids: open.map((a) => a.id) });
    check.ok(r.acknowledged >= 1, `acknowledged ${r.acknowledged} alert(s); the rest stay open for the dashboard`);
  }
  await admin.api('POST', '/exports', { type: 'csv', scope: { bank_id: bankA, status: ['approved', 'rejected'] } });
  check.ok(true, 'CSV export requested (queued for the export worker)');
  const q = await admin.api('GET', '/queues');
  check.ok(typeof q === 'object', `queue depths: ${JSON.stringify(q)}`);
});
await step('session revoke', async () => {
  const d = await phone('SEED-AG03');
  await admin.api('POST', `/sessions/${d.session!.session_id}/revoke`, { reason: 'Signed in on a borrowed phone (dummy data)' });
  await expectError('a revoked session is refused', 'SESSION_REVOKED', () => d.pull());
});

// ── final states ──────────────────────────────────────────────────────────────────────────────
console.log('\n── final job states');
const ids = expected.map((e) => e.job.id);
const rows = ids.length ? await admin.select<{ id: string; status: string }>('jobs', `id=in.(${ids.join(',')})&select=id,status`) : [];
for (const e of expected) {
  const status = rows.find((r) => r.id === e.job.id)?.status ?? '?';
  check.ok(e.want.includes(status), `${e.job.reference.padEnd(16)} ${status.padEnd(24)} ${e.scenario}${e.want.includes(status) ? '' : `  (expected ${e.want.join(' | ')})`}`);
}

saveState();
console.log(`\nSeed staff sign-in details (passwords, TOTP secrets) are in ${statePath} — outside the repo; keep it private.`);
Deno.exit(check.summary());
