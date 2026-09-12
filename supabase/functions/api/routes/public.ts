// GET /v1/public/verify/{token} — authorisation-card QRs (docs/07 §10). Open to anyone (a merchant's phone),
// rate-limited; tokens are 128-bit random so enumeration is impossible. Wording comes from content definitions
// (keys `verify.*`); the strings below are only the bundled fallback.
import { Hono } from 'hono';
import { sha256Hex } from '../../_shared/crypto.ts';
import { asService, rpc } from '../../_shared/db.ts';
import { clientIp, rateLimit, rid } from '../../_shared/http.ts';
import { signedReadUrl } from '../../_shared/storage.ts';
import type { AppEnv } from '../../_shared/types.ts';

export const publicRoutes = new Hono<AppEnv>();

interface VerifyResult {
  status: 'valid' | 'invalid';
  kind?: 'agent_card' | 'job_card';
  valid_to?: string;
  agent?: { first_name: string; last_name: string; employee_number_masked: string; photo_path: string | null };
  job?: { reference: string; bank: string; scheduled_start: string | null; scheduled_end: string | null } | null;
}

const FALLBACK: Record<string, string> = {
  'verify.page_title': 'POS agent verification',
  'verify.valid_heading': 'Authorised POS agent',
  'verify.valid_body': 'This person is currently authorised to carry out merchant site verifications.',
  'verify.job_heading': 'Authorised for this visit',
  'verify.invalid_heading': 'Not verified',
  'verify.invalid_body': 'This card could not be verified. Do not allow the visit to continue, and report your concern.',
  'verify.report_concern': 'Report a concern to your bank or to Fidelity Security Services.',
  'verify.valid_until': 'Valid until',
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

publicRoutes.get('/public/verify/:token', async (c) => {
  rateLimit(`verify:${clientIp(c) ?? 'unknown'}`, 60, 60_000);
  const token = c.req.param('token');
  const ctx = { id: null, role: 'public', requestId: rid(c) };
  const [result, strings] = /^[0-9a-f]{32,128}$/.test(token)
    ? await asService(ctx, async (tx) => [
      await rpc<VerifyResult>(tx, 'public_verify', [[await sha256Hex(token), 'text']]),
      (await rpc<Record<string, string>>(tx, 'content_bundle', [[null, 'uuid']])) ?? {},
    ] as const)
    : [{ status: 'invalid' } as VerifyResult, {} as Record<string, string>];
  const t = (k: string) => strings[k] ?? FALLBACK[k] ?? k;

  let photoUrl: string | null = null;
  if (result.status === 'valid' && result.agent?.photo_path) {
    photoUrl = await signedReadUrl('profiles', result.agent.photo_path, 300).catch(() => null);
  }
  const body = {
    status: result.status,
    kind: result.kind,
    valid_to: result.valid_to,
    agent: result.agent
      ? { first_name: result.agent.first_name, last_name: result.agent.last_name, employee_number_masked: result.agent.employee_number_masked, photo_url: photoUrl }
      : undefined,
    job: result.job ?? undefined,
    report_concern: t('verify.report_concern'),
    checked_at: new Date().toISOString(),
  };
  c.header('cache-control', 'no-store');

  if ((c.req.header('accept') ?? '').includes('text/html')) {
    const ok = body.status === 'valid';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t('verify.page_title'))}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:${ok ? '#ecfdf3' : '#fef2f2'};color:#111}
main{max-width:420px;margin:0 auto;padding:32px 20px}.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 4px #0002}
h1{font-size:22px;margin:0 0 8px;color:${ok ? '#067647' : '#b42318'}}img{width:96px;height:96px;border-radius:50%;object-fit:cover}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:16px 0}dt{color:#555}small{color:#555}</style></head>
<body><main><div class="card">
<h1>${esc(ok ? (body.kind === 'job_card' ? t('verify.job_heading') : t('verify.valid_heading')) : t('verify.invalid_heading'))}</h1>
<p>${esc(ok ? t('verify.valid_body') : t('verify.invalid_body'))}</p>
${ok && photoUrl ? `<img src="${esc(photoUrl)}" alt="">` : ''}
${ok && body.agent ? `<dl><dt>Name</dt><dd>${esc(`${body.agent.first_name} ${body.agent.last_name}`)}</dd><dt>Employee</dt><dd>${esc(body.agent.employee_number_masked)}</dd>
${body.job ? `<dt>Job</dt><dd>${esc(body.job.reference)}</dd><dt>Bank</dt><dd>${esc(body.job.bank)}</dd>` : ''}
<dt>${esc(t('verify.valid_until'))}</dt><dd>${esc(new Date(body.valid_to ?? '').toLocaleString('en-ZA'))}</dd></dl>` : ''}
<small>${esc(body.report_concern)}</small></div></main></body></html>`;
    return c.html(html);
  }
  return c.json(body);
});
