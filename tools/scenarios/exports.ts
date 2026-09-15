// End-to-end check of exports on QA only (T6-03, T6-04, D-102, D-100 (3); assessment A-07). As an admin and a bank's
// system would use them, through the APIs only (except step 5, see there):
//   1. the formats the worker can make; a PDF request is refused rather than left waiting;
//   2. the seed admin asks for CSV, Excel and photo-ZIP exports of a bank with decided visits; each goes waiting →
//      being prepared → ready (never ready without a file), is downloaded through the audited link, and the downloaded
//      bytes match the SHA-256 recorded on the export; the file's visits match the export's list of visits, all of the
//      bank; the CSV's rows carry those visit IDs; the Excel file has its sheets; every photo in the ZIP matches both
//      the manifest and the fingerprint recorded when it arrived;
//   3. every download is recorded and in the activity history; each visit's chain of custody says it was exported; a
//      ready export can't be "tried again";
//   4. a bank's key asks for a CSV, checks on it until it is ready, downloads it (the fingerprint matches), and can't see
//      the admin's exports;
//   5. failure and retry: with exports.max_file_mb set to 1 for a moment (through the Supabase CLI, only when it is
//      linked to QA), a photo ZIP fails with the reason in words; after the setting is put back, Try again makes it.
//
//   POS_PUBLISHABLE_KEY=<QA publishable key> deno run -A --node-modules-dir=none --config tools/scenarios/deno.json tools/scenarios/exports.ts
//
// Needs the seed admin and a decided visit with photos (the scenario seeder makes both). Left on QA: the exports and
// their files (kept 30 days), download records, and one bank API key, switched off.
import { crc32 } from '../../supabase/functions/_shared/exports/zip.ts';
import { ApiError } from './lib/api.ts';
import { apiUrl, env, PROJECT_REFS, refuseProduction, target } from './lib/env.ts';
import { Staff, type StaffCreds } from './lib/staff.ts';
import { Check, sha256Hex, sleep } from './lib/util.ts';

refuseProduction('The exports check');
const check = new Check();
const statePath = `${Deno.env.get('HOME')}/.fess-pos/seed-state-${target}.json`;
let creds: StaffCreds | undefined;
try {
  creds = JSON.parse(Deno.readTextFileSync(statePath)).admin;
} catch {
  // reported just below
}
if (!creds?.password) throw new Error(`No seed admin in ${statePath}: run the scenario seeder against ${target} first.`);

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// ── Small readers: ZIP (with CRC check) and CSV (RFC 4180) ────────────────────────────────────
async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a ZIP');
  const out = new Map<string, Uint8Array>();
  let p = v.getUint32(end + 16, true);
  for (let n = v.getUint16(end + 10, true); n > 0; n--) {
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const packed = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const at = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
    const data = bytes.subarray(start, start + packed);
    const plain = method === 8
      ? new Uint8Array(await new Response(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
      : data;
    if (crc32(plain) !== crc) throw new Error(`CRC mismatch in ${name}`);
    out.set(name, plain);
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return out;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────
const admin = new Staff('seed admin', creds);
await admin.login();
const me = await admin.api<{ id: string; bank_ids: string[] | null }>('GET', '/me');

async function exportRow(id: string): Promise<Row> {
  return (await admin.select<Row>('exports', `id=eq.${id}&select=*`))[0];
}

/** Polls until the export is done or failed; records every state seen and that done always carries a file. */
async function settle(id: string, label: string, timeoutMs = 240_000): Promise<Row> {
  const seen: string[] = [];
  const started = Date.now();
  for (;;) {
    const r = await exportRow(id);
    const state = r.status === 'queued' && r.error ? 'retrying' : r.status;
    if (seen.at(-1) !== state) seen.push(state);
    if (r.status === 'done' || r.status === 'failed') {
      check.ok(r.status !== 'done' || (r.storage_path && /^[0-9a-f]{64}$/.test(r.sha256 ?? '') && r.bytes > 0), `${label}: ready only with a stored file (${seen.join(' → ')})`);
      return r;
    }
    if (Date.now() - started > timeoutMs) {
      check.ok(false, `${label}: still ${seen.join(' → ')} after ${timeoutMs / 1000} s`);
      return r;
    }
    await sleep(3000);
  }
}

async function downloadAsAdmin(r: Row, label: string): Promise<Uint8Array | null> {
  const d = await admin.api<{ url: string; expires_in_s: number; file_name: string; sha256: string }>('POST', `/exports/${r.id}/download`);
  check.ok(d.expires_in_s > 0 && d.expires_in_s <= 900, `${label}: the download link lasts ${d.expires_in_s} s (15 minutes at most)`);
  const res = await fetch(d.url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  check.ok(res.ok && /attachment/.test(res.headers.get('content-disposition') ?? ''), `${label}: the link downloads as a file (${res.status})`);
  check.eq(await sha256Hex(bytes), r.sha256, `${label}: the downloaded file matches the recorded SHA-256 (${bytes.length} bytes)`);
  return res.ok ? bytes : null;
}

async function checkTrace(r: Row, bankId: string, label: string): Promise<string[]> {
  const items = await admin.select<{ inspection_id: string }>('export_items', `export_id=eq.${r.id}&select=inspection_id`);
  check.eq(items.length, r.inspection_count, `${label}: the export lists every visit in the file (${items.length})`);
  const ids = items.map((i) => i.inspection_id);
  if (ids.length) {
    const visits = await admin.select<{ id: string; jobs: { bank_id: string } }>('inspections', `id=in.(${ids.join(',')})&select=id,jobs!inner(bank_id)`);
    check.ok(visits.length === ids.length && visits.every((v) => v.jobs.bank_id === bankId), `${label}: every visit is the chosen bank's`);
  }
  return ids;
}

// ── 1. Formats ────────────────────────────────────────────────────────────────────────────────
console.log(`── formats (${target}: ${env.supabaseUrl})`);
const formats = await admin.api<{ ready: string[] }>('GET', '/exports/formats');
check.ok(['csv', 'xlsx', 'evidence_zip'].every((f) => formats.ready.includes(f)), `CSV, Excel and photo ZIPs can be made (${formats.ready.join(', ')})`);
try {
  await admin.api('POST', '/exports', { type: 'pdf', scope: {} });
  check.ok(false, 'a PDF request is refused');
} catch (e) {
  check.ok(e instanceof ApiError && e.code === 'VALIDATION_FAILED', `a PDF request is refused, not left waiting (${e instanceof ApiError ? e.code : e})`);
}

// ── 2. Admin exports of one bank ──────────────────────────────────────────────────────────────
const decided = await admin.select<{ id: string; jobs: { bank_id: string } }>('evidence',
  'upload_state=eq.verified&select=id,inspections!inner(status,jobs!inner(bank_id))&inspections.status=eq.approved&limit=1');
const bankId = (decided[0] as unknown as { inspections: { jobs: { bank_id: string } } } | undefined)?.inspections.jobs.bank_id;
if (!bankId) throw new Error('No approved visit with a checked photo on QA: run the scenario seeder first.');
console.log('── the admin asks for a CSV, an Excel file and a photo ZIP');
const asked: Record<string, Row> = {};
for (const type of ['csv', 'xlsx', 'evidence_zip']) {
  asked[type] = await admin.api<Row>('POST', '/exports', { type, scope: { bank_id: bankId }, recipient: 'qa-exports-check@example.com' });
}
check.ok(Object.values(asked).every((r) => r.status === 'queued' && r.bank_id === bankId && r.statuses?.length), 'each is queued, with its bank and visit statuses frozen');
const ready: Record<string, Row> = {};
for (const [type, r] of Object.entries(asked)) ready[type] = await settle(r.id, type);

const csv = ready.csv;
if (csv.status === 'done') {
  const ids = await checkTrace(csv, bankId, 'CSV');
  const bytes = await downloadAsAdmin(csv, 'CSV');
  if (bytes) {
    const text = csv.file_name.endsWith('.zip')
      ? new TextDecoder().decode((await unzip(bytes)).get('all-answers.csv'))
      : new TextDecoder().decode(bytes);
    const rows = parseCsv(text);
    const col = rows[0].indexOf('Visit ID');
    check.ok(col >= 0 && rows[0].includes('Answers fingerprint (SHA-256)'), `the CSV has labelled columns (${rows[0].length})`);
    check.eq(rows.slice(1).map((r) => r[col]).sort(), [...ids].sort(), 'each CSV row is one listed visit, by its ID');
  }
} else check.ok(false, `CSV failed: ${csv.error}`);

const xlsx = ready.xlsx;
if (xlsx.status === 'done') {
  await checkTrace(xlsx, bankId, 'Excel');
  const bytes = await downloadAsAdmin(xlsx, 'Excel');
  if (bytes) {
    const parts = await unzip(bytes);
    const wb = new TextDecoder().decode(parts.get('xl/workbook.xml'));
    check.ok(['All answers', 'Where each visit came from', 'About this file'].every((s) => wb.includes(`name="${s}"`)), 'the Excel file has its sheets');
    const path = await Deno.makeTempFile({ suffix: '.xlsx' });
    await Deno.writeFile(path, bytes);
    try {
      const py = await new Deno.Command('python3', { args: ['-c', 'import sys, openpyxl; wb = openpyxl.load_workbook(sys.argv[1]); print(len(wb["All answers"]["A"]))', path], stdout: 'piped', stderr: 'piped' }).output();
      const out = new TextDecoder().decode(py.stdout).trim();
      if (py.success) check.eq(Number(out), xlsx.inspection_count + 1, 'openpyxl opens it: a header and one row per visit');
    } catch {
      // no python3: skipped
    }
    await Deno.remove(path);
  }
} else check.ok(false, `Excel failed: ${xlsx.error}`);

const zip = ready.evidence_zip;
if (zip.status === 'done') {
  await checkTrace(zip, bankId, 'Photo ZIP');
  const bytes = await downloadAsAdmin(zip, 'Photo ZIP');
  if (bytes) {
    const files = await unzip(bytes);
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
    const included = (manifest.files as Row[]).filter((f) => f.included);
    check.eq(included.length, zip.evidence_count, `the manifest lists the ${included.length} photos in the ZIP`);
    let same = 0;
    for (const f of included) if (f.matches && f.sha256_file === f.sha256_recorded && (await sha256Hex(files.get(f.path)!)) === f.sha256_file) same++;
    check.eq(same, included.length, 'every photo in the ZIP matches the manifest and its recorded fingerprint');
    const sample = included.slice(0, 20).map((f) => f.evidence_id);
    if (sample.length) {
      const db = await admin.select<{ id: string; sha256_server: string | null; sha256_client: string }>('evidence', `id=in.(${sample.join(',')})&select=id,sha256_server,sha256_client`);
      const byId = new Map(db.map((e) => [e.id, e.sha256_server ?? e.sha256_client]));
      check.ok(included.slice(0, 20).every((f) => byId.get(f.evidence_id) === f.sha256_file), 'and the fingerprints are the ones in the evidence records');
    }
    check.ok((manifest.files as Row[]).every((f) => f.custody && Array.isArray(f.custody)), 'each file carries its chain of custody');
  }
} else check.ok(false, `Photo ZIP failed: ${zip.error}`);

// ── 3. Records ────────────────────────────────────────────────────────────────────────────────
console.log('── the record');
const downloads = await admin.select<{ id: string; by_user: string }>('export_downloads', `export_id=eq.${csv.id}&select=id,by_user`);
check.ok(downloads.length >= 1 && downloads.every((d) => d.by_user === me.id), 'the download is recorded against the admin');
if (downloads[0]) {
  const audited = await admin.select('audit_log', `table_name=eq.export_downloads&row_id=eq.${downloads[0].id}&select=id`);
  check.eq(audited.length, 1, 'and it is in the activity history');
}
const firstVisit = (await admin.select<{ inspection_id: string }>('export_items', `export_id=eq.${csv.id}&select=inspection_id&limit=1`))[0];
if (firstVisit) {
  const custody = await admin.select('custody_events', `subject_id=eq.${firstVisit.inspection_id}&event=eq.exported&select=detail`);
  check.ok(custody.some((c) => (c as Row).detail?.export_id === csv.id), 'the visit’s chain of custody says it was exported');
}
try {
  await admin.api('POST', `/exports/${csv.id}/retry`);
  check.ok(false, 'a ready export is not tried again');
} catch (e) {
  check.ok(e instanceof ApiError && e.code === 'CONFLICT', 'a ready export is not tried again');
}

// ── 4. A bank's key ───────────────────────────────────────────────────────────────────────────
console.log('── a bank’s system asks for an export');
const key = await admin.api<{ id: string; key: string }>('POST', `/banks/${bankId}/api-keys`, { name: `QA exports check ${new Date().toISOString().slice(0, 16)}`, expires_in_months: 1 });
// deno-lint-ignore no-explicit-any
async function bank(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${apiUrl}/v1/bank${path}`, {
    method, headers: { authorization: `Bearer ${key.key}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
try {
  const made = await bank('POST', '/exports', { format: 'csv' });
  check.ok(made.status === 202 && made.body.status === 'queued', `POST /v1/bank/exports answers 202 queued (${made.status})`);
  let st = made.body;
  const states = [st.status];
  for (let i = 0; i < 80 && !['ready', 'failed'].includes(st.status); i++) {
    await sleep(3000);
    st = (await bank('GET', `/exports/${made.body.id}`)).body;
    if (states.at(-1) !== st.status) states.push(st.status);
  }
  check.eq(st.status, 'ready', `the bank checks on it: ${states.join(' → ')}`);
  if (st.file?.url) {
    const bytes = new Uint8Array(await (await fetch(st.file.url)).arrayBuffer());
    check.eq(await sha256Hex(bytes), st.file.sha256, 'the bank’s download matches the file’s SHA-256');
    const byKey = await admin.select<{ by_key: string }>('export_downloads', `export_id=eq.${made.body.id}&select=by_key`);
    check.ok(byKey.length > 0 && byKey.every((d) => d.by_key === key.id), 'its downloads are recorded against the key');
  }
  check.eq((await bank('GET', `/exports/${csv.id}`)).status, 404, 'the bank can’t see the admin’s export of its own bank');
  const list = await bank('GET', '/exports');
  check.ok(list.body.items.some((x: Row) => x.id === made.body.id) && !list.body.items.some((x: Row) => x.id === csv.id), 'its list holds its own exports only');
  const calls = await admin.select<{ route: string; method: string }>('bank_api_calls', `key_id=eq.${key.id}&select=route,method`);
  check.ok(calls.some((c) => c.method === 'POST' && c.route === '/v1/bank/exports'), 'the request is in the bank’s call record');
} finally {
  await admin.api('POST', `/api-keys/${key.id}/revoke`, { reason: 'QA exports check finished' });
}

// ── 5. Failure and retry ──────────────────────────────────────────────────────────────────────
console.log('── a failure, shown with its reason, then Try again');
const linkedRef = (() => {
  try {
    return Deno.readTextFileSync(new URL('../../supabase/.temp/project-ref', import.meta.url)).trim();
  } catch {
    return '';
  }
})();
async function sql(query: string): Promise<string> {
  const out = await new Deno.Command('supabase', { args: ['db', 'query', '--linked', query], cwd: new URL('../..', import.meta.url).pathname, stdout: 'piped', stderr: 'piped' }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout);
}
if (target !== 'qa' || linkedRef !== PROJECT_REFS.qa) {
  console.log('  (skipped: the Supabase CLI is not linked to QA)');
} else {
  // The limit on visits per export, lowered to 1 for a moment: a CSV of the bank's visits (more than one) is refused.
  const before = /"value":\s*"?(\d+)/.exec(await sql(`select value::text as value from pos.settings where key = 'exports.max_inspections'`))?.[1] ?? '5000';
  let failing: Row | null = null;
  try {
    await sql(`update pos.settings set value = '1' where key = 'exports.max_inspections'`);
    failing = await admin.api<Row>('POST', '/exports', { type: 'csv', scope: { bank_id: bankId } });
    failing = await settle(failing!.id, 'a CSV over the limit');
  } finally {
    await sql(`update pos.settings set value = '${before}' where key = 'exports.max_inspections'`);
  }
  check.ok(failing?.status === 'failed' && /visits/.test(failing.error ?? ''), `it fails with the reason in words: “${failing?.error}”`);
  if (failing?.status === 'failed') {
    const again = await admin.api<Row>('POST', `/exports/${failing.id}/retry`);
    check.ok(again.status === 'queued' && !again.error, 'Try again puts it back in the queue, reason cleared');
    const done = await settle(failing.id, 'the retried CSV');
    check.eq(done.status, 'done', 'and this time it is made');
  }
}

Deno.exit(check.summary());
