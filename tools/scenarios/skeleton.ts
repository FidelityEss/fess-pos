// The walking-skeleton inspection on QA (T4-27) — never production. A test bank with its own minimal inspection form
// and flow (text, choice, photo, signature, declaration), and a job for a QA agent, so the module can run one
// inspection end to end on a phone; then a check of what reached the server.
//
//   POS_PUBLISHABLE_KEY=<QA publishable key> deno run -A --node-modules-dir=none --config tools/scenarios/deno.json \
//     tools/scenarios/skeleton.ts setup [EMPLOYEE_NUMBER]     # the bank, its definitions, one new job for the agent
//   ... tools/scenarios/skeleton.ts check                    # the bank's jobs, inspections, evidence and custody
//
// setup is re-runnable: the bank and its definitions are made once (bank-scoped, so no other bank changes), and each run
// adds one new job, allocated to the agent (default SEED-AG01, the module harness's). Needs the seed admin from
// ~/.fess-pos/seed-state-qa.json (run the scenario seeder once). Remembers what it made in
// ~/.fess-pos/skeleton-state-qa.json.
import { ApiError } from './lib/api.ts';
import { env, refuseProduction, target } from './lib/env.ts';
import { Staff, type StaffCreds } from './lib/staff.ts';
import { sha256Hex } from './lib/util.ts';

refuseProduction('The walking-skeleton setup');

const mode = Deno.args[0] ?? 'check';
const employeeNumber = Deno.args[1] ?? 'SEED-AG01';
const home = Deno.env.get('HOME');
const seedPath = `${home}/.fess-pos/seed-state-${target}.json`;
const statePath = `${home}/.fess-pos/skeleton-state-${target}.json`;

interface SeedState {
  admin?: StaffCreds;
  agents: Record<string, string>;
}
interface SkeletonState {
  bank?: string;
  families: Record<string, string>;
  jobs: string[];
}

const seed = JSON.parse(Deno.readTextFileSync(seedPath)) as SeedState;
if (!seed.admin?.totp_secret) throw new Error(`No seed admin in ${seedPath}: run the scenario seeder against ${target} first.`);
let state: SkeletonState = { families: {}, jobs: [] };
try {
  state = JSON.parse(Deno.readTextFileSync(statePath));
} catch {
  // first run
}
const save = () => Deno.writeTextFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });

const admin = new Staff('seed admin', seed.admin);
await admin.login();
console.log(`── walking skeleton → ${target} (${env.supabaseUrl})`);

// The minimal inspection (docs/04 §3.1–3.2): every section is in the flow, one declaration field, and the integrity
// steps (location_check, declaration, submit) the analyser requires.
const FORM = {
  spec_version: '1.0', kind: 'form', family: 'site_inspection', version: 1, scope: null,
  title: 'Walking-skeleton inspection (QA)', locale: 'en-ZA', declaration_key: 'agent_declaration',
  sections: [
    {
      key: 'visit', title: 'The business',
      fields: [
        { key: 'trading_name', type: 'text', label: 'Trading name on the signage', required: true, props: { capitalise: 'words' } },
        {
          key: 'premises_type', type: 'single_select', display: 'radio', label: 'Premises', required: true,
          options: [{ value: 'shop', label: 'Shop' }, { value: 'office', label: 'Office' }, { value: 'home', label: 'Home-based' }],
        },
      ],
    },
    {
      key: 'evidence', title: 'Photographs',
      fields: [
        { key: 'external_photos', type: 'photo', display: 'grid', label: 'Outside the premises', required: true,
          props: { category: 'external', min_count: 1, max_count: 3 } },
      ],
    },
    {
      key: 'interviewee', title: 'Interviewee',
      fields: [
        { key: 'interviewee_name', type: 'text', label: 'Interviewee name', required: true, props: { capitalise: 'words' } },
        { key: 'interviewee_signature', type: 'signature', label: 'Interviewee signature', required: true,
          props: { signer_name_field: 'interviewee_name' } },
      ],
    },
    {
      key: 'agent', title: 'Agent declaration',
      fields: [
        { key: 'agent_declaration', type: 'declaration', label: 'Agent declaration', required: true,
          props: { declaration_key: 'agent_declaration' } },
      ],
    },
  ],
};

const FLOW = {
  spec_version: '1.0', kind: 'flow', family: 'site_inspection_flow', version: 1, scope: null,
  title: 'Walking-skeleton inspection (QA)', form_family: 'site_inspection', action: 'inspection.submit',
  steps: [
    { id: 'location', type: 'location_check' },
    { id: 'visit', type: 'form', sections: ['visit'], paging: 'single_page' },
    { id: 'photos', type: 'form', sections: ['evidence'], paging: 'single_page' },
    { id: 'interviewee', type: 'form', sections: ['interviewee', 'agent'], paging: 'single_page' },
    { id: 'declare', type: 'declaration', declaration_key: 'agent_declaration' },
    { id: 'submit', type: 'submit', label: 'Submit inspection', confirm_text: "Submit this inspection? You can't change it afterwards." },
  ],
};

async function ensureBank(): Promise<string> {
  if (!state.bank) {
    const b = await admin.api('POST', '/banks', {
      code: 'SKEL', name: 'Walking Skeleton Bank (QA test)', four_eyes_enabled: false,
      contacts: [{ name: 'QA', role: 'Test only', email: 'skeleton@fess-pos.test', phone: '+27115550000' }],
    });
    state.bank = b.id as string;
    save();
  }
  return state.bank;
}

async function ensureDefinition(bank: string, definition: Record<string, unknown>): Promise<void> {
  const label = `${definition.kind}/${definition.family}`;
  if (!state.families[label]) {
    const f = await admin.api('POST', '/definitions/families', {
      kind: definition.kind, key: definition.family, bank_id: bank, title: definition.title,
    });
    state.families[label] = f.id as string;
    save();
  }
  const familyId = state.families[label];
  const [existing] = await admin.select<{ id: string }>('definition_versions', `family_id=eq.${familyId}&select=id&limit=1`);
  if (existing) {
    console.log(`  ${label}: already published`);
    return;
  }
  try {
    await admin.api('POST', `/definitions/families/${familyId}/publish`, { definition, note: 'Walking skeleton (T4-27)' });
  } catch (e) {
    if (e instanceof ApiError) console.error(JSON.stringify(e.body, null, 2));
    throw e;
  }
  const [v] = await admin.select<{ id: string }>('definition_versions', `family_id=eq.${familyId}&select=id&order=version.desc&limit=1`);
  await admin.api('POST', `/definitions/families/${familyId}/activations`, {
    version_id: v.id, audience: { type: 'all' }, reason: 'Walking skeleton (T4-27)',
  });
  console.log(`  ${label}: published and activated for SKEL`);
}

async function newJob(bank: string, agentId: string): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const j = await admin.api('POST', '/jobs', {
    bank_id: bank, merchant_name: `Walking Skeleton Spaza ${stamp}`, trading_name: null, external_ref: `SKEL-${stamp}`,
    address: { line1: '1 Test Street', suburb: 'Marshalltown', city: 'Johannesburg', province: 'GP', postal_code: '2001', country: 'ZA' },
    location: { lat: -26.2041, lng: 28.0473 }, location_source: 'pinned', location_type: 'standalone', mcc_code: '5411',
    contact: { name: 'Thandi Test', phone: '+27821230000' }, notes: 'Dummy data — walking skeleton (T4-27)',
    attributes: { branch_code: '000000', account_manager: 'QA', risk_tier: 'standard' },
  });
  const start = new Date(Date.now() - 30 * 60_000);
  await admin.api('POST', `/jobs/${j.id}/contact-attempts`, { channel: 'phone', outcome: 'confirmed', contact_name: 'Thandi Test' });
  await admin.api('POST', `/jobs/${j.id}/schedule`, {
    scheduled_start: start.toISOString(), scheduled_end: new Date(start.getTime() + 6 * 3_600_000).toISOString(),
    onsite_contact: { name: 'Thandi Test', phone: '+27821230000', role: 'Owner' }, note: 'Walking skeleton (QA)',
  });
  await admin.api('POST', `/jobs/${j.id}/allocate`, { agent_id: agentId });
  state.jobs.push(j.id as string);
  save();
  console.log(`  job ${j.reference} (${j.id}) allocated to ${employeeNumber}`);
}

async function check(bank: string): Promise<void> {
  // The phone keeps a declaration only when its text matches its hash (docs/07 §4), so a mismatch here means an agent
  // can't finish an inspection.
  const declarations = await admin.select<{ key: string; version: number; hash: string; text: string }>(
    'declarations', 'select=key,version,hash,text&order=key,version.desc');
  const latest = new Map<string, { key: string; version: number; hash: string; text: string }>();
  for (const d of declarations) if (!latest.has(d.key)) latest.set(d.key, d);
  for (const d of latest.values()) {
    const sha = await sha256Hex(new TextEncoder().encode(d.text));
    console.log(`declaration ${d.key} v${d.version}: ` +
      (sha === d.hash ? 'hash matches its text' : `hash does NOT match its text (stored ${d.hash.slice(0, 12)}…, text ${sha.slice(0, 12)}…)`));
  }
  const jobs = await admin.select<{ id: string; reference: string; status: string; merchant_name: string }>(
    'jobs', `bank_id=eq.${bank}&select=id,reference,status,merchant_name&order=created_at.desc&limit=5`);
  for (const j of jobs) {
    console.log(`job ${j.reference} "${j.merchant_name}": ${j.status}`);
    const inspections = await admin.select<Record<string, unknown>>('inspections',
      `job_id=eq.${j.id}&select=id,attempt,status,flags,evidence_expected,evidence_received,evidence_verified,answers_hash,submission_hash&order=attempt.desc`);
    for (const i of inspections) {
      console.log(`  inspection #${i.attempt} ${i.status} · evidence ${i.evidence_verified}/${i.evidence_expected} verified ` +
        `(${i.evidence_received} received) · flags ${JSON.stringify(i.flags)} · sealed ${i.submission_hash ? 'yes' : 'no'}`);
      const evidence = await admin.select<Record<string, unknown>>('evidence',
        `inspection_id=eq.${i.id}&select=id,type,field_key,upload_state,replica_state,in_manifest,bytes,mime&order=created_at`);
      for (const e of evidence) {
        const replicas = await admin.select<{ target: string }>('evidence_replicas', `evidence_id=eq.${e.id}&select=target`);
        console.log(`    ${e.type} ${e.field_key} ${e.mime} ${e.bytes} B · ${e.upload_state} · replica ${e.replica_state}` +
          ` (${replicas.map((r) => r.target).join(',') || 'none'}) · in manifest ${e.in_manifest}`);
      }
      const custody = await admin.select<{ event: string }>('custody_events',
        `subject_id=eq.${i.id}&select=event&order=at_server`);
      console.log(`    custody: ${custody.map((c) => c.event).join(' → ') || 'none'}`);
    }
  }
}

const bank = await ensureBank();
if (mode === 'setup') {
  const agentId = seed.agents[employeeNumber];
  if (!agentId) throw new Error(`No agent ${employeeNumber} in ${seedPath}`);
  await ensureDefinition(bank, FORM);
  await ensureDefinition(bank, FLOW);
  await newJob(bank, agentId);
} else if (mode === 'check') {
  await check(bank);
} else {
  throw new Error('mode must be setup or check');
}
