import { type APIRequestContext, expect, test } from '@playwright/test';
import { adminHeaders, findAdminUser, POS_API_URL } from './auth';

// Critical path through the POS API the panel uses (docs/06 §1a–2): a job goes create → contact attempt → confirm →
// allocate → cancel, with the guards that matter (MFA, allocation only after confirmation, four-eyes 202).
// Local only (see ./auth.ts). Each run uses fresh codes, so it can run against a DB that already holds data.

const tag = Date.now().toString(36).slice(-5).toUpperCase();

async function call(request: APIRequestContext, headers: Record<string, string>, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
  const res = await request.fetch(`${POS_API_URL}/v1/admin${path}`, { method, headers, data });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status(), body: body ?? {} };
}

test.describe('admin API critical path', () => {
  test('job lifecycle and guards', async ({ request }) => {
    const admin = await findAdminUser();
    test.skip(!admin, 'no local admin — run scripts/bootstrap-admin.mjs');
    const H = adminHeaders(admin!);

    expect((await call(request, adminHeaders(admin!, 'aal1'), 'GET', '/me')).status, 'aal1 is refused (MFA)').toBe(403);
    expect((await call(request, H, 'GET', '/me')).status).toBe(200);

    const bank = await call(request, H, 'POST', '/banks', { code: `E${tag}`, name: `E2E Bank ${tag}` });
    expect(bank.status).toBe(201);
    const bankId = String(bank.body.id);
    const agent = await call(request, H, 'POST', '/users', {
      employee_number: `E2E-${tag}`, first_name: 'Eve', last_name: 'Tester', role: 'pos_agent', bank_ids: [bankId],
    });
    expect(agent.status).toBe(201);
    const code = `zz_e2e_${tag.toLowerCase()}`;
    for (const category of ['cancel', 'reassign']) {
      expect((await call(request, H, 'POST', '/reason-codes', { category, code, label: 'E2E', bank_id: bankId })).status).toBe(201);
    }

    const job = await call(request, H, 'POST', '/jobs', {
      bank_id: bankId, merchant_name: 'E2E Spaza', address: { line1: '1 Test Road', city: 'Johannesburg' }, location: { lat: -26.2, lng: 28.04 },
    });
    expect(job.status).toBe(201);
    expect(String(job.body.reference)).toMatch(/^POS-\d{4}-\d{6,}$/);
    const jobId = String(job.body.id);

    expect((await call(request, H, 'POST', `/jobs/${jobId}/allocate`, { agent_id: agent.body.id })).status, 'pending jobs cannot be allocated').toBe(409);
    expect((await call(request, H, 'POST', `/jobs/${jobId}/contact-attempts`, { channel: 'phone', outcome: 'confirmed' })).status).toBe(201);
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 90_000_000).toISOString();
    const scheduled = await call(request, H, 'POST', `/jobs/${jobId}/schedule`, { scheduled_start: start, scheduled_end: end, onsite_contact: { name: 'Joe' } });
    expect(scheduled.body.status).toBe('scheduled');
    const allocated = await call(request, H, 'POST', `/jobs/${jobId}/allocate`, { agent_id: agent.body.id });
    expect(allocated.body.status).toBe('assigned');
    const cancelled = await call(request, H, 'POST', `/jobs/${jobId}/cancel`, { reason_code: code });
    expect(cancelled.body.status).toBe('cancelled');
    expect((await call(request, H, 'POST', `/jobs/${jobId}/close`, {})).body.status).toBe('closed');
  });

  test('four-eyes: integrity-relevant config on a four-eyes bank needs approval', async ({ request }) => {
    const admin = await findAdminUser();
    test.skip(!admin, 'no local admin — run scripts/bootstrap-admin.mjs');
    const H = adminHeaders(admin!);
    const bank = await call(request, H, 'POST', '/banks', { code: `F${tag}`, name: `E2E Four Eyes ${tag}`, four_eyes_enabled: true });
    expect(bank.status).toBe(201);
    const res = await call(request, H, 'POST', '/config', {
      layer: 'bank', subject_id: bank.body.id, values: { integrity: { block_on_root: false } }, reason: 'e2e',
    });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('approval_required');
    const self = await call(request, H, 'POST', `/approvals/${String(res.body.approval_id)}/decide`, { decision: 'approved' });
    expect(self.status, 'the requester cannot approve their own request').toBe(403);
    expect((await call(request, H, 'POST', `/approvals/${String(res.body.approval_id)}/decide`, { decision: 'withdrawn' })).status).toBe(200);
  });
});
