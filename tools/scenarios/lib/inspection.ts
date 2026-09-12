// Drives one site inspection on a simulated device, exactly in the order the module does it (docs/08, docs/12):
// accept → inspection_started (session token) → traces → evidence meta → uploads → evidence_uploaded → submission.
// Answers are validated locally with the engine before sending, as the module blocks submit on client validation.
import * as engine from '../../../packages/fess_pos_engine_ts/src/index.ts';
import type { Device, Receipt, SyncJob } from './device.ts';
import { fakeJpeg, isoSast, sha256Hex, todaySast, uuidv7 } from './util.ts';

export interface InspectionOptions {
  at?: Date;                         // device clock at start (backdated scenarios)
  durationMin?: number;              // time on site
  premises?: 'mall' | 'complex' | 'office' | 'home' | 'other';
  profile?: string;                  // geofence profile used (defaults to the job's location type)
  method?: 'inside_fix' | 'outside_fix';
  override?: boolean;                // geofence override with the bank's override form
  accept?: boolean;                  // send the accept event first (default true when the job is ASSIGNED)
  risk?: 'clean' | 'suspicious';     // answers that raise risk indicators
  upload?: 'all' | 'none' | 'tamper_one'; // tamper_one: stored bytes differ from the hash the device declared
  stopAfter?: 'started' | 'evidence' | 'submitted';
  snapshot?: boolean;                // send an in-progress snapshot
  beforeSubmit?: () => Promise<void>; // runs after uploads, before the submission (e.g. an admin cancels meanwhile)
}

export interface InspectionRun {
  inspectionId: string;
  receipts: Receipt[];
  evidenceIds: string[];
}

interface Captured {
  id: string;
  field_key: string;
  category: string;
  type: string;
  bytes: Uint8Array;
  sha256: string;
}

const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

function jitter(p: { lat: number; lng: number }, metres: number): { lat: number; lng: number } {
  const dLat = ((Math.random() - 0.5) * 2 * metres) / 111_320;
  const dLng = ((Math.random() - 0.5) * 2 * metres) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: Number((p.lat + dLat).toFixed(7)), lng: Number((p.lng + dLng).toFixed(7)) };
}

export async function runInspection(device: Device, job: SyncJob, opts: InspectionOptions = {}): Promise<InspectionRun> {
  const receipts: Receipt[] = [];
  const start = opts.at ?? new Date();
  const end = minutes(start, opts.durationMin ?? 35);
  const bankId = job.bank.id;
  const form = device.definitionFor('form', 'site_inspection', bankId);
  const flow = device.definitionFor('flow', 'site_inspection_flow', bankId);
  const jobSchema = device.definitionFor('job_schema', 'job_attributes', bankId);
  const cfg = device.config.by_bank[bankId] ?? device.config.default;
  const values = (cfg?.values ?? {}) as { geofence?: { profiles?: Record<string, Record<string, unknown>> } };
  const profile = opts.profile ?? job.location_type ?? 'standalone';
  const params = values.geofence?.profiles?.[profile] ?? { radius_m: 75, max_accuracy_m: 30, exit_consecutive_fixes: 3, prompt_checkin_on_arrival: false };
  const method = opts.method ?? 'inside_fix';
  const relaxed = !['standalone', 'residential'].includes(profile);
  const token = device.tokens.get(job.id) ?? null;
  const agentDecl = device.declarations.get('agent_declaration');
  const merchantDecl = device.declarations.get('merchant_certification');
  if (!agentDecl || !merchantDecl) throw new Error('declarations not delivered');
  const loc = job.location ?? { lat: -26.2041, lng: 28.0473 };
  const attempt = (job.attempts ?? 0) + 1;
  const inspectionId = uuidv7(start.getTime());
  const fix = (at: Date, metres = 15) => ({ ...jitter(loc, metres), accuracy_m: 8 + Math.round(Math.random() * 10), ts: isoSast(at), gnss_ts: null, is_mocked: false });

  // 1. accept (the module sends it when the agent taps Accept; order-tolerant server-side anyway)
  if ((opts.accept ?? job.status === 'assigned') && job.status === 'assigned') {
    receipts.push(await device.send('job_event', { job_id: job.id, action: 'accept' }, minutes(start, -60)));
  }

  // 2. inspection_started — pins versions, consumes the session token, freezes the context (docs/04 §4.4)
  const overrideForm = opts.override ? device.definitionFor('form', 'geofence_override', bankId) : null;
  const overridePhoto: Captured | null = opts.override ? await capture('override_photo', 'override', 'override_photo', 'override') : null;
  const geofence = {
    profile,
    profile_params: {
      radius_m: Number(params.radius_m), max_accuracy_m: Number(params.max_accuracy_m),
      exit_consecutive_fixes: Number(params.exit_consecutive_fixes), prompt_checkin_on_arrival: Boolean(params.prompt_checkin_on_arrival),
    },
    method,
    passed: true,
    relaxed,
    override: !!opts.override,
    override_detail: null as Record<string, unknown> | null,
    job_location: job.location,
    fix: fix(start, opts.override ? 180 : 20),
    checkin_fix: method === 'outside_fix' ? fix(minutes(start, -3), 20) : null,
    distance_m: opts.override ? 180 : 14,
    sampled_seconds: method === 'outside_fix' ? 60 : 12,
    config_version_id: cfg?.config_version_id ?? null,
    evaluated_at_device: isoSast(start),
  };
  if (opts.override && overrideForm && overridePhoto) {
    const answers = {
      override_info: undefined,
      reason_code: { v: 'gps_inaccurate_indoors' },
      note: { v: 'Shop is deep inside the centre; no GPS lock at the unit. Photo of the unit signage attached.' },
      override_photo: { v: [overridePhoto.id] },
    };
    delete (answers as Record<string, unknown>).override_info;
    geofence.override_detail = {
      reason_code: 'gps_inaccurate_indoors', note: 'Shop is deep inside the centre; no GPS lock at the unit.',
      form_version_id: overrideForm.id, definition_hash: overrideForm.definition_hash, answers,
      answers_hash: await engine.answersHash(answers), photo_evidence_ids: [overridePhoto.id],
      distance_m: 180, allowed_max_m: Math.min(Number(params.radius_m) * 2, 500),
    };
  }
  const integrity = {
    mock_location: false, rooted: false, hooked: false, debugger: false, emulator: false, tampered: false,
    rasp_provider: 'none', attestation: { provider: 'none', verdict: null, obtained_at: null }, clock_offset_ms: 0,
    checked_at: isoSast(start),
  };
  const context = {
    today: todaySast(start),
    job: {
      id: job.id, reference: job.reference, merchant_name: job.merchant_name, mcc: job.mcc, address: job.address,
      attributes: job.attributes ?? {}, location_type: job.location_type, bank: job.bank,
    },
    agent: { id: device.userId, employee_number: device.session?.user.employee_number, first_name: device.session?.user.first_name,
             last_name: device.session?.user.last_name, attributes: (device.me?.attributes ?? {}) as Record<string, unknown> },
    inspection: { attempt, geofence: { inside: method === 'inside_fix' && !opts.override, method, profile, relaxed, override: !!opts.override },
                  client_type: 'native', started_at: isoSast(start) },
    stats: device.totals,
    previous: null,
  };
  receipts.push(await device.send('inspection_started', {
    inspection_id: inspectionId, job_id: job.id, attempt,
    session_token_id: token?.token_id ?? null, session_token: token?.token ?? null,
    form_version_id: form.id, definition_hash: form.definition_hash, flow_version_id: flow.id, flow_hash: flow.definition_hash,
    job_schema_version_id: jobSchema.id, config_version_id: cfg?.config_version_id ?? null, context_snapshot: context,
    geofence_result: geofence, integrity, started_at_device: isoSast(start), clock_offset_ms: 0,
  }, start));
  if (opts.stopAfter === 'started') return { inspectionId, receipts, evidenceIds: [] };

  // 3. breadcrumbs every ~20 s on site (docs/07 §7) — a handful is enough here
  const fixes = Array.from({ length: 6 }, (_, i) => {
    const at = minutes(start, i * 5);
    const f = fix(at, 25);
    return { fix_id: uuidv7(at.getTime()), ts_device: isoSast(at), ts_monotonic_ms: 10_000 + i * 300_000, gnss_ts: null,
             lat: f.lat, lng: f.lng, accuracy_m: f.accuracy_m, speed: 0, is_mocked: false, inside_fence: true,
             event: i === 0 ? 'enter' : 'fix' };
  });
  receipts.push(await device.send('traces_batch', { inspection_id: inspectionId, job_id: job.id, batch_seq: 0, fixes }, minutes(start, 30)));

  // 4. evidence capture (hash of the canonical bytes, docs/07 §4)
  async function capture(field: string, category: string, type: string, label: string): Promise<Captured> {
    const bytes = fakeJpeg(`${job.reference} ${label}`);
    return { id: uuidv7(), field_key: field, category, type, bytes, sha256: await sha256Hex(bytes) };
  }
  const risk = String((job.attributes ?? {}).risk_tier ?? 'standard');
  const premises = opts.premises ?? 'complex';
  const externalCount = risk === 'high' ? 3 : 2;
  const internalCount = premises === 'home' ? 4 : 2;
  const needShopfront = ['shopping_centre', 'office_park', 'large_site'].includes(profile) || method === 'outside_fix';
  const captured: Captured[] = [];
  for (let i = 0; i < externalCount; i++) captured.push(await capture('external_photos', 'external', 'photo', `external ${i + 1}`));
  for (let i = 0; i < internalCount; i++) captured.push(await capture('internal_photos', 'internal', 'photo', `internal ${i + 1}`));
  if (needShopfront) captured.push(await capture('shopfront_photo', 'shopfront', 'photo', 'shopfront'));
  captured.push(await capture('interviewee_signature', 'signature', 'signature', 'signature'));
  if (overridePhoto) captured.push(overridePhoto);

  const metas = await Promise.all(captured.map((c, i) => device.envelope('evidence_meta', {
    evidence_id: c.id, inspection_id: inspectionId, job_id: job.id, session_token_id: token?.token_id ?? null,
    field_key: c.field_key, category: c.category, type: c.type, sha256: c.sha256, bytes: c.bytes.length, mime: 'image/jpeg',
    width: 1, height: 1, captured_at_device: isoSast(minutes(start, 5 + i)), captured_at_monotonic_ms: 60_000 * (5 + i),
    gnss_time: null, location: jitter(loc, 10), accuracy_m: 9, is_mocked: false,
  }, minutes(start, 5 + i))));
  receipts.push(...await device.ingest(metas));
  if (opts.stopAfter === 'evidence') return { inspectionId, receipts, evidenceIds: captured.map((c) => c.id) };

  // 5. answers (validated locally first — the module blocks submit on client validation)
  const photoIds = (f: string) => captured.filter((c) => c.field_key === f).map((c) => c.id);
  const suspicious = opts.risk === 'suspicious';
  const answers: Record<string, { v: unknown; prefilled?: boolean; computed?: boolean }> = {
    inspection_date: { v: context.today, computed: true },
    merchant_name: { v: job.merchant_name, prefilled: true },
    ...(job.mcc ? { mcc_code: { v: job.mcc.code, prefilled: true }, mcc_description: { v: job.mcc.description, prefilled: true } } : {}),
    address: { v: job.address, prefilled: true },
    registration_date: { v: '2019-03-01' },
    time_in_business: { v: { value: suspicious ? 2 : 6, unit: suspicious ? 'months' : 'years' } },
    nature_of_business: { v: suspicious ? 'Online electronics resale' : 'General dealer — groceries, airtime and household goods' },
    contact_person: { v: 'Thandi Mokoena' },
    contact_number: { v: '+27821234567' },
    business_hours: { v: { weekdays: { open: '08:00', close: '18:00' }, saturday: { open: '08:00', close: '14:00' }, sunday: 'closed', public_holidays: 'closed' } },
    payment_methods: { v: suspicious ? ['ecommerce', 'eft'] : ['pos', 'cash', 'qr'] },
    premises_type: { v: premises },
    ...(premises === 'other' ? { premises_type_other: { v: 'Container shop at the taxi rank' } } : {}),
    property_tenure: { v: 'leased' },
    floor_area_m2: { v: suspicious ? 6 : 45 },
    other_businesses: { v: 'None observed' },
    office_equipment: { v: 'Card terminal, till, laptop' },
    equipment_compatible: { v: !suspicious },
    external_photos: { v: photoIds('external_photos') },
    ...(needShopfront ? { shopfront_photo: { v: photoIds('shopfront_photo') } } : {}),
    internal_photos: { v: photoIds('internal_photos') },
    inventory_sufficient: { v: !suspicious },
    appears_legitimate: { v: !suspicious },
    customers_present: { v: !suspicious },
    other_bank_evidence: { v: suspicious },
    ...(suspicious ? { other_bank_evidence_which: { v: 'Stickers from two other acquirers on the door' } } : {}),
    goods_delivered_at_pos: { v: !suspicious },
    ...(!suspicious ? { delivered_at_pos_pct: { v: 80 } } : {}),
    ecommerce_sales: { v: true },
    ecommerce_pct: { v: suspicious ? 95 : 15 },
    refund_policy: { v: 'Exchange within 7 days with a slip' },
    delivery_policy: { v: 'no' },
    data_security: { v: 'Terminal kept behind the counter; slips filed in a locked drawer; cards never leave the customer.' },
    interviewee_name: { v: 'Thandi Mokoena' },
    interviewee_designation: { v: 'Owner' },
    merchant_certification: { v: { given: true, text_version_id: merchantDecl.id, at: isoSast(minutes(start, 30)), by_name: 'Thandi Mokoena' } },
    interviewee_signature: { v: photoIds('interviewee_signature')[0] },
    agent_declaration: { v: { accepted: true, declaration_version_id: agentDecl.id, accepted_at: isoSast(end) } },
  };
  const parsed = engine.parseDefinitionOfKind(form.definition, 'form');
  if (!parsed.ok) throw new Error(`form did not parse: ${JSON.stringify(parsed.errors)}`);
  const local = engine.validateAnswers(parsed.definition, answers,
                                       engine.contextFromSnapshot(context as unknown as Parameters<typeof engine.contextFromSnapshot>[0]));
  if (!local.ok) throw new Error(`local validation failed for ${job.reference}: ${JSON.stringify(local.errors)}`);

  if (opts.snapshot) {
    receipts.push(await device.send('inspection_snapshot', {
      inspection_id: inspectionId, job_id: job.id, attempt, answers, current_step: 'review', snapshot_at_device: isoSast(minutes(end, -2)),
    }, minutes(end, -2)));
  }

  // 6. uploads, then evidence_uploaded (the server verifies the stored bytes' hash)
  const upload = opts.upload ?? 'all';
  const uploadedEnvs = [];
  for (const [i, c] of captured.entries()) {
    if (upload === 'none') break;
    const bytes = upload === 'tamper_one' && i === 0 ? fakeJpeg('substituted after capture') : c.bytes;
    await device.upload(c.id, bytes, 'image/jpeg');
    uploadedEnvs.push(await device.envelope('evidence_uploaded', {
      evidence_id: c.id, sha256: c.sha256, bytes: c.bytes.length, uploaded_at_device: isoSast(minutes(end, 1)),
    }, minutes(end, 1)));
  }
  if (uploadedEnvs.length) receipts.push(...await device.ingest(uploadedEnvs));
  if (opts.beforeSubmit) await opts.beforeSubmit();

  // 7. submission — self-sufficient, sealed by the submission hash (docs/07 §4 step 9)
  const answersHash = await engine.answersHash(answers);
  const items = captured.map((c) => ({ evidence_id: c.id, field_key: c.field_key, category: c.category, sha256: c.sha256, bytes: c.bytes.length }));
  const submissionHash = await engine.submissionHash({
    answers_hash: answersHash, evidence_hashes: items.map((i) => i.sha256), session_token_id: token?.token_id ?? null,
    started_at_device: isoSast(start), submitted_at_device: isoSast(end), device_id: device.deviceId,
  });
  receipts.push(await device.send('submission', {
    inspection_id: inspectionId, job_id: job.id, attempt,
    definition_refs: { form: { version_id: form.id, hash: form.definition_hash }, flow: { version_id: flow.id, hash: flow.definition_hash },
                       job_schema: { version_id: jobSchema.id, hash: jobSchema.definition_hash } },
    config_version_id: cfg?.config_version_id ?? null, context_snapshot: context, answers, answers_hash: answersHash,
    manifest: { items, trace_batch_count: 1, last_trace_at: fixes[fixes.length - 1].ts_device },
    session_token_id: token?.token_id ?? null, session_token: token?.token ?? null,
    geofence, integrity: { ...integrity, checked_at: isoSast(end) },
    diagnostics: { module_version: '0.1.0', platform: 'android', host_app_version: '7.4.0', os_version: '13', model: device.model,
                   free_storage_mb: 2048, battery_restricted: false, network: 'cellular' },
    submission_hash: submissionHash, started_at_device: isoSast(start), submitted_at_device: isoSast(end), clock_offset_ms: 0,
  }, end));
  return { inspectionId, receipts, evidenceIds: captured.map((c) => c.id) };
}

/** A reason-form job event (reject / unable) with answers pinned to the delivered form version. */
export async function reasonEvent(device: Device, job: SyncJob, action: 'reject' | 'unable', reasonCode: string, note: string,
                                  at = new Date()): Promise<Receipt> {
  const form = device.definitionFor('form', action === 'reject' ? 'assignment_reject' : 'unable_to_complete', job.bank.id);
  const answers: Record<string, { v: unknown }> = { reason_code: { v: reasonCode }, note: { v: note } };
  const evidenceIds: string[] = [];
  if (action === 'unable' && ['incorrect_address', 'premises_not_found'].includes(reasonCode)) {
    const bytes = fakeJpeg(`${job.reference} unable`);
    const id = uuidv7();
    evidenceIds.push(id);
    answers.unable_photo = { v: [id] };
  }
  return await device.send('job_event', {
    job_id: job.id, action, trigger: 'agent', reason_code: reasonCode, note,
    form_version_id: form.id, definition_hash: form.definition_hash, form_answers: answers,
    answers_hash: await engine.answersHash(answers), ...(evidenceIds.length ? { evidence_ids: evidenceIds } : {}),
  }, at);
}
