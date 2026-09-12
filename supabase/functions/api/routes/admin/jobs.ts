// Jobs (docs/06 §1–2, §1a; B1): create/edit with bank-specific attributes validated against the active job_schema,
// bulk import with a per-row report, appointment scheduling, allocation, revoke / reassign, cancel, close.
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePermission } from '../../../_shared/auth.ts';
import { PosError } from '../../../_shared/errors.ts';
import { readJson } from '../../../_shared/http.ts';
import type { AppEnv } from '../../../_shared/types.ts';
import { adminRpc, type AdminContext, issues, isoDateTime, jsonObject, note, reasonCode, uuid, uuidParam } from './_util.ts';
import { validateAttributes } from './attributes.ts';

export const jobRoutes = new Hono<AppEnv>();
const admin = requirePermission(null);
const scheduler = requirePermission('schedule_jobs');

const LatLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const Address = z.object({
  line1: z.string().trim().min(1).max(300),
  line2: z.string().max(300).optional(),
  suburb: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  province: z.string().max(120).optional(),
  postal_code: z.string().max(20).optional(),
  country: z.string().max(80).optional(),
  bank_coordinates: LatLng.optional(),
}).passthrough();
const Contact = z.object({ name: z.string().max(200).optional(), phone: z.string().max(40).optional(), email: z.string().max(320).optional() }).passthrough();

const JobFields = z.object({
  merchant_name: z.string().trim().min(1).max(300),
  trading_name: z.string().max(300).nullable(),
  external_ref: z.string().max(120).nullable(),
  address: Address,
  location: LatLng.nullable(),
  location_source: z.enum(['geocoded', 'pinned', 'bank_supplied']),
  location_type: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  mcc_code: z.string().regex(/^[0-9]{4}$/).nullable(),
  contact: Contact.nullable(),
  notes: z.string().max(5000).nullable(),
  attributes: jsonObject,
  geofence_radius_m: z.number().int().min(25).max(500).nullable(),
  gps_accuracy_max_m: z.number().int().min(5).max(200).nullable(),
  parent_job_id: uuid.nullable(),
});
const JobInput = JobFields.partial().extend({ merchant_name: JobFields.shape.merchant_name, address: Address });
const JobCreate = JobInput.extend({ bank_id: uuid });

interface FormContext {
  job_schema: { version_id: string; definition: unknown } | null;
  location_types: string[];
  default_location_type: string;
}

async function createOne(c: AdminContext, bankId: string, row: z.infer<typeof JobInput>, ctx: FormContext) {
  return await adminRpc<Record<string, unknown>>(c, 'admin_job_create', [[{
    ...row,
    bank_id: bankId,
    expected_job_schema_version_id: ctx.job_schema?.version_id ?? null,
  }, 'jsonb']]);
}

jobRoutes.post('/jobs', admin, async (c) => {
  const body = await readJson(c, JobCreate);
  const ctx = await adminRpc<FormContext>(c, 'admin_job_create_context', [[body.bank_id, 'uuid']]);
  const attrIssues = validateAttributes(ctx.job_schema?.definition ?? null, body.attributes ?? {});
  if (attrIssues.length) throw new PosError('VALIDATION_FAILED', 'job attributes failed the bank\'s job schema', attrIssues);
  const { bank_id, ...row } = body;
  return c.json(await createOne(c, bank_id, row, ctx), 201);
});

jobRoutes.patch('/jobs/:id', admin, async (c) => {
  const jobId = uuidParam(c, 'id');
  const body = await readJson(c, JobFields.partial());
  if (body.attributes !== undefined) {
    // validated against the job schema version pinned on the job at creation
    const ctx = await adminRpc<{ job_schema: { definition: unknown } | null }>(c, 'admin_job_context', [[jobId, 'uuid']]);
    const attrIssues = validateAttributes(ctx.job_schema?.definition ?? null, body.attributes);
    if (attrIssues.length) throw new PosError('VALIDATION_FAILED', 'job attributes failed the job schema', attrIssues);
  }
  return c.json(await adminRpc(c, 'admin_job_update', [[jobId, 'uuid'], [body, 'jsonb']]));
});

// Bulk import (B1.6): rows are JSON (the panel parses CSV/XLSX and maps columns in the browser). Every row is validated
// first; unless dry_run, valid rows are created one transaction each so one bad row never blocks the rest.
const ImportBody = z.object({ bank_id: uuid, rows: z.array(z.unknown()).min(1).max(500), dry_run: z.boolean().default(false) });
interface RowReport {
  index: number;
  ok: boolean;
  job_id?: string;
  reference?: string;
  errors?: Array<{ path: string; message: string }>;
}

jobRoutes.post('/jobs/import', admin, async (c) => {
  const body = await readJson(c, ImportBody, 4 * 1_048_576);
  const ctx = await adminRpc<FormContext>(c, 'admin_job_create_context', [[body.bank_id, 'uuid']]);
  const reports: RowReport[] = [];
  const valid: Array<{ index: number; row: z.infer<typeof JobInput> }> = [];
  body.rows.forEach((raw, index) => {
    const parsed = JobInput.safeParse(raw);
    if (!parsed.success) {
      reports[index] = { index, ok: false, errors: issues(parsed.error) };
      return;
    }
    const errors = validateAttributes(ctx.job_schema?.definition ?? null, parsed.data.attributes ?? {});
    if (parsed.data.location_type && !ctx.location_types.includes(parsed.data.location_type)) {
      errors.push({ path: 'location_type', message: `must be one of ${ctx.location_types.join(', ')}` });
    }
    if (errors.length) {
      reports[index] = { index, ok: false, errors };
      return;
    }
    reports[index] = { index, ok: true };
    valid.push({ index, row: parsed.data });
  });

  let created = 0;
  if (!body.dry_run) {
    for (const { index, row } of valid) {
      try {
        const job = await createOne(c, body.bank_id, row, ctx);
        reports[index] = { index, ok: true, job_id: String(job.id), reference: String(job.reference) };
        created++;
      } catch (e) {
        const err = e instanceof PosError ? e : new PosError('INTERNAL', 'internal error');
        const detail = Array.isArray(err.details) ? (err.details as Array<{ path: string; message: string }>) : [];
        reports[index] = { index, ok: false, errors: detail.length ? detail : [{ path: err.code, message: err.message }] };
      }
    }
  }
  return c.json({
    dry_run: body.dry_run,
    total: body.rows.length,
    valid: valid.length,
    created,
    failed: reports.filter((r) => !r.ok).length,
    rows: reports,
  }, body.dry_run ? 200 : 201);
});

// ── Appointment scheduling (docs/06 §1a) ─────────────────────────────────────────────────────
const ContactAttempt = z.object({
  attempted_at: isoDateTime.optional(),
  channel: z.enum(['phone', 'email', 'whatsapp', 'in_person', 'other']),
  outcome: z.enum(['no_answer', 'declined', 'rescheduled', 'confirmed', 'wrong_number', 'other']),
  proposed_start: isoDateTime.optional(),
  proposed_end: isoDateTime.optional(),
  contact_name: z.string().max(200).optional(),
  note,
});
jobRoutes.post('/jobs/:id/contact-attempts', scheduler, async (c) => {
  const body = await readJson(c, ContactAttempt);
  return c.json(await adminRpc(c, 'admin_job_contact_attempt', [[uuidParam(c, 'id'), 'uuid'], [body, 'jsonb']]), 201);
});

const Schedule = z.object({
  scheduled_start: isoDateTime,
  scheduled_end: isoDateTime,
  onsite_contact: z.object({ name: z.string().trim().min(1).max(200), phone: z.string().max(40).optional(), email: z.string().max(320).optional(),
                             role: z.string().max(120).optional() }).passthrough(),
  note,
});
jobRoutes.post('/jobs/:id/schedule', scheduler, async (c) => {
  const body = await readJson(c, Schedule);
  return c.json(await adminRpc(c, 'admin_job_schedule', [
    [uuidParam(c, 'id'), 'uuid'], [body.scheduled_start, 'timestamptz'], [body.scheduled_end, 'timestamptz'],
    [body.onsite_contact, 'jsonb'], [body.note ?? null, 'text'],
  ]));
});

const Reasoned = z.object({ reason_code: reasonCode, note });
jobRoutes.post('/jobs/:id/unschedule', scheduler, async (c) => {
  const body = await readJson(c, Reasoned);
  return c.json(await adminRpc(c, 'admin_job_unschedule', [[uuidParam(c, 'id'), 'uuid'], [body.reason_code, 'text'], [body.note ?? null, 'text']]));
});
jobRoutes.post('/jobs/:id/not-secured', scheduler, async (c) => {
  const body = await readJson(c, Reasoned);
  return c.json(await adminRpc(c, 'admin_job_not_secured', [[uuidParam(c, 'id'), 'uuid'], [body.reason_code, 'text'], [body.note ?? null, 'text']]));
});

// ── Allocation ────────────────────────────────────────────────────────────────────────────────
jobRoutes.post('/jobs/:id/allocate', admin, async (c) => {
  const body = await readJson(c, z.object({ agent_id: uuid, note }));
  return c.json(await adminRpc(c, 'admin_job_allocate', [[uuidParam(c, 'id'), 'uuid'], [body.agent_id, 'uuid'], [body.note ?? null, 'text']]));
});
jobRoutes.post('/jobs/:id/revoke', admin, async (c) => {
  const body = await readJson(c, Reasoned);
  return c.json(await adminRpc(c, 'admin_job_revoke', [[uuidParam(c, 'id'), 'uuid'], [body.reason_code, 'text'], [body.note ?? null, 'text']]));
});
jobRoutes.post('/jobs/:id/reassign', admin, async (c) => {
  const body = await readJson(c, Reasoned.extend({ agent_id: uuid }));
  return c.json(await adminRpc(c, 'admin_job_reassign', [
    [uuidParam(c, 'id'), 'uuid'], [body.agent_id, 'uuid'], [body.reason_code, 'text'], [body.note ?? null, 'text'],
  ]));
});
jobRoutes.post('/jobs/:id/cancel', admin, async (c) => {
  const body = await readJson(c, Reasoned);
  return c.json(await adminRpc(c, 'admin_job_cancel', [[uuidParam(c, 'id'), 'uuid'], [body.reason_code, 'text'], [body.note ?? null, 'text']]));
});
jobRoutes.post('/jobs/:id/close', admin, async (c) => {
  const body = await readJson(c, z.object({ note }));
  return c.json(await adminRpc(c, 'admin_job_close', [[uuidParam(c, 'id'), 'uuid'], [body.note ?? null, 'text']]));
});
