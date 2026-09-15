// Unit tests for the export files (T6-03, D-102): CSV, the ZIP writer (read back by an independent reader and, where
// installed, by unzip and Python's openpyxl), the Excel workbook, the answer tables and the photo ZIP with its manifest.
// Run: pnpm functions:test. No downloads.
import { csvCell, csvText } from './csv.ts';
import { buildCsv, buildEvidenceZip, buildXlsx, type Claim, ExportRefused, fileBase } from './build.ts';
import { answerCell, answerTables, correctedAnswers, type ExportInspection, type FormVersion, localTime, sourceTable } from './tables.ts';
import { columnName, sheetNames, xlsxChunks, xmlText } from './xlsx.ts';
import { concatBytes, crc32, safeEntryName, ZipTooLarge, ZipWriter } from './zip.ts';

function assert(cond: unknown, message = 'assertion failed'): asserts cond {
  if (!cond) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message ? `${message}: ` : ''}expected ${e}, got ${a}`);
}
async function assertRejects(fn: () => Promise<unknown>, type: new (...args: never[]) => Error, message = ''): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof type) return;
    throw new Error(`${message}: expected ${type.name}, got ${e}`);
  }
  throw new Error(`${message}: expected ${type.name}, nothing was thrown`);
}

/** An independent ZIP reader: the central directory, each local header, inflate, and a CRC check per file. */
async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  assert(end >= 0, 'no end-of-directory record');
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    assertEquals(v.getUint32(p, true), 0x02014b50, 'central header signature');
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const packed = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const skip = v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    const at = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    assertEquals(v.getUint32(at, true), 0x04034b50, `local header of ${name}`);
    const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
    const data = bytes.subarray(start, start + packed);
    const plain = method === 8
      ? new Uint8Array(await new Response(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
      : data;
    assertEquals(plain.length, size, `size of ${name}`);
    assertEquals(crc32(plain), crc, `CRC of ${name}`);
    out.set(name, plain);
    p += 46 + nameLen + skip;
  }
  return out;
}

async function tool(cmd: string, args: string[]): Promise<{ ok: boolean; out: string } | null> {
  try {
    const r = await new Deno.Command(cmd, { args, stdout: 'piped', stderr: 'piped' }).output();
    return { ok: r.success, out: new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr) };
  } catch {
    return null; // not installed: that check is skipped
  }
}

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────
Deno.test('CSV cells are quoted when needed, and formulas are neutralised but numbers are not', () => {
  assertEquals(csvCell(null), '');
  assertEquals(csvCell(42.5), '42.5');
  assertEquals(csvCell(-3), '-3', 'numbers are never touched');
  assertEquals(csvCell('plain'), 'plain');
  assertEquals(csvCell('a,b'), '"a,b"');
  assertEquals(csvCell('say "hi"'), '"say ""hi"""');
  assertEquals(csvCell('two\nlines'), '"two\nlines"');
  assertEquals(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assertEquals(csvCell('+27 82 000 0000'), "'+27 82 000 0000");
  assertEquals(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assertEquals(csvCell(' padded '), '" padded "');
  const file = csvText([['A', 'B'], ['é', 1]]);
  assert(file.startsWith('\uFEFFA,B\r\n'), 'a BOM, then CRLF rows');
  assert(file.endsWith('é,1\r\n'));
});

// ── ZIP ───────────────────────────────────────────────────────────────────────────────────────
Deno.test('CRC-32 matches the standard check value', () => {
  assertEquals(crc32(new TextEncoder().encode('123456789')).toString(16), 'cbf43926');
});

Deno.test('a ZIP reads back entry by entry, stored and deflated, with UTF-8 names', async () => {
  const zip = new ZipWriter();
  const big = new TextEncoder().encode('repeat me '.repeat(500));
  const photo = crypto.getRandomValues(new Uint8Array(3000));
  await zip.add({ name: 'notes/über.txt', data: big, compress: true });
  await zip.add({ name: 'photos/a.jpg', data: photo });
  await zip.add({ name: 'empty.txt', data: new Uint8Array(0), compress: true });
  const bytes = concatBytes(zip.finish());
  const files = await unzip(bytes);
  assertEquals([...files.keys()], ['notes/über.txt', 'photos/a.jpg', 'empty.txt']);
  assertEquals(text(files.get('notes/über.txt')), 'repeat me '.repeat(500));
  assertEquals([...files.get('photos/a.jpg')!], [...photo]);
  assert(bytes.length < big.length + photo.length, 'text was deflated');
  const path = await Deno.makeTempFile({ suffix: '.zip' });
  await Deno.writeFile(path, bytes);
  const t = await tool('unzip', ['-t', path]);
  if (t) assert(t.ok, `unzip -t: ${t.out}`);
  await Deno.remove(path);
});

Deno.test('the ZIP refuses duplicates and anything over its size limit; names are made safe', async () => {
  const zip = new ZipWriter(1000);
  await zip.add({ name: 'a.txt', data: new Uint8Array(10) });
  await assertRejects(() => zip.add({ name: 'a.txt', data: new Uint8Array(1) }), Error, 'duplicate');
  await assertRejects(() => zip.add({ name: 'b.bin', data: new Uint8Array(2000) }), ZipTooLarge, 'too large');
  assertEquals(safeEntryName('../../etc/passwd'), 'etc/passwd');
  assertEquals(safeEntryName('/a\\b/./c:d'), 'a/b/c_d');
});

// ── Excel ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('column names and sheet names follow Excel’s rules', () => {
  assertEquals([0, 25, 26, 701, 702].map(columnName), ['A', 'Z', 'AA', 'ZZ', 'AAA']);
  assertEquals(sheetNames(['All answers', 'All answers', 'a/b [c]', 'x'.repeat(40), '']), ['All answers', 'All answers (2)', 'a b  c', 'x'.repeat(31), 'Sheet']);
  assertEquals(xmlText('a<b & "c"\u0001'), 'a&lt;b &amp; &quot;c&quot;\ufffd');
});

Deno.test('an Excel workbook has its parts, inline text and numbers, and opens in openpyxl where installed', async () => {
  const chunks = await xlsxChunks([
    { name: 'All answers', rows: [['Name', 'Count'], ['=cmd|x', 3], ['<b>', null]] },
    { name: 'About this file', rows: [['About', ''], ['Export ID', 'abc']] },
  ], { title: 'Test & title', created: new Date('2026-09-15T10:00:00Z') });
  const bytes = concatBytes(chunks);
  const files = await unzip(bytes);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'docProps/core.xml']) {
    assert(files.has(part), `has ${part}`);
  }
  const sheet = text(files.get('xl/worksheets/sheet1.xml'));
  assert(sheet.includes('<c r="A2" t="inlineStr"><is><t xml:space="preserve">=cmd|x</t></is></c>'), 'a formula-looking answer is plain text');
  assert(sheet.includes('<c r="B2"><v>3</v></c>'), 'numbers are numbers');
  assert(sheet.includes('&lt;b&gt;'), 'text is escaped');
  assert(text(files.get('xl/workbook.xml')).includes('name="About this file"'));
  const path = await Deno.makeTempFile({ suffix: '.xlsx' });
  await Deno.writeFile(path, bytes);
  const py = await tool('python3', ['-c', `import sys
try:
    import openpyxl
except ImportError:
    print('skip'); sys.exit(0)
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb['All answers']
assert wb.sheetnames == ['All answers', 'About this file'], wb.sheetnames
assert ws['A2'].value == '=cmd|x' and ws['A2'].data_type == 's', (ws['A2'].value, ws['A2'].data_type)
assert ws['B2'].value == 3
assert ws['A1'].font.b
print('ok')`, path]);
  if (py) assert(py.ok && /ok|skip/.test(py.out), `openpyxl: ${py.out}`);
  await Deno.remove(path);
});

// ── Tables ────────────────────────────────────────────────────────────────────────────────────
const V1: FormVersion = {
  id: '00000000-0000-0000-0000-0000000000v1', family_key: 'site_visit', title: 'Site visit', version: 1,
  definition: {
    kind: 'form',
    sections: [{
      key: 'business', title: 'Business', fields: [
        { key: 'premises_type', type: 'single_choice', label: 'Type of premises', options: [{ value: 'shop', label: 'Shop' }, { value: 'complex', label: 'Shopping complex' }] },
        { key: 'staff_count', type: 'number', label: 'Staff' },
        { key: 'internal_note', type: 'text', label: 'Internal note', export: { include: false } },
        { key: 'shopfront_photo', type: 'photo', label: 'Shop front' },
      ],
    }],
  },
};
const V2: FormVersion = {
  ...V1, id: '00000000-0000-0000-0000-0000000000v2', version: 2,
  definition: {
    kind: 'form',
    sections: [{
      key: 'business', title: 'Business', fields: [
        { key: 'premises_type', type: 'single_choice', label: 'Kind of premises', options: [{ value: 'shop', label: 'Shop' }] },
        { key: 'trading_hours', type: 'text', label: 'Trading hours', export: { column_label: 'Hours' } },
        { key: 'shopfront_photo', type: 'photo', label: 'Shop front' },
      ],
    }],
  },
};
const VERSIONS = { [V1.id]: V1, [V2.id]: V2 };

function visit(n: number, version: FormVersion, answers: ExportInspection['answers'], extra: Partial<ExportInspection> = {}): ExportInspection {
  return {
    id: `00000000-0000-0000-0000-00000000000${n}`, sort_at: `2026-09-1${n}T08:00:00.000001+00:00`, job_id: `job-${n}`,
    job_reference: `POS-2026-00000${n}`, external_ref: n === 1 ? 'BANK-9' : null, merchant_name: `Spaza ${n}`, trading_name: null,
    bank_code: 'ABC', status: 'approved', attempt: 1, submitted_at: `2026-09-1${n}T08:00:00.000001+00:00`,
    decision: { decision: 'approved', reason_code: null, decided_at: `2026-09-1${n}T09:30:00+00:00` }, form_version_id: version.id,
    definition_hash: 'd'.repeat(64), answers_hash: String(n).repeat(64), submission_hash: 's'.repeat(64), answers, amendments: [],
    evidence_expected: 1, evidence_received: 1, evidence_verified: 1, ...extra,
  };
}

const VISITS = [
  visit(2, V2, { premises_type: { v: 'shop' }, trading_hours: { v: '08:00–17:00' }, shopfront_photo: { v: ['ev-2'] } }),
  visit(1, V1, {
    premises_type: { v: 'complex' }, staff_count: { v: 4 }, internal_note: { v: 'secret' }, shopfront_photo: { v: ['ev-1'] },
    legacy_flag: { v: true },
  }, {
    amendments: [{ field_key: 'staff_count', old_value: { v: 4 }, new_value: 5, justification: 'Counted again', created_at: '2026-09-11T10:00:00+00:00' }],
  }),
];

Deno.test('times read in the configured time zone, with the offset', () => {
  assertEquals(localTime('2026-09-15T10:00:00.123456+00:00', 'Africa/Johannesburg'), '2026-09-15 12:00:00 +02:00');
  assertEquals(localTime(null, 'Africa/Johannesburg'), null);
});

Deno.test('the answer tables: one per version, and all answers as the union with the newest labels', () => {
  const { all, perVersion } = answerTables(VISITS, VERSIONS, 'Africa/Johannesburg');
  assertEquals(perVersion.map((t) => t.name), ['Site visit v2', 'Site visit v1']);
  const header = all.rows[0];
  assertEquals(header.slice(0, 5), ['Job reference', 'Bank’s reference', 'Merchant', 'Bank', 'Visit ID']);
  assertEquals(header.slice(12), ['Kind of premises', 'Hours', 'Shop front', 'Staff', 'legacy_flag', 'Corrections after submission', 'Answers fingerprint (SHA-256)']);
  assert(!header.includes('Internal note'), 'a field left out of exports stays out');
  const [first, second] = all.rows.slice(1);
  assertEquals(first[4], VISITS[1].id, 'oldest visit first, and each row carries its visit ID');
  assertEquals(first.slice(12, 17), ['Shopping complex', null, 'ev-1', 5, 'Yes']);
  assertEquals(first[17], 'Staff: 4 → 5 (Counted again)', 'a correction replaces the value and is listed with the old one');
  assertEquals(first[18], '1'.repeat(64));
  assertEquals(first[9], '2026-09-11 10:00:00 +02:00');
  assertEquals(second.slice(12, 15), ['Shop', '08:00–17:00', 'ev-2']);
  const v1 = perVersion[1].rows[0];
  assertEquals(v1.slice(12), ['Type of premises', 'Staff', 'Shop front', 'legacy_flag', 'Corrections after submission', 'Answers fingerprint (SHA-256)'],
               'a version table uses that version’s labels and keeps answers the form doesn’t describe');
  const src = sourceTable(VISITS, VERSIONS, 'Africa/Johannesburg');
  assertEquals(src.rows[1].slice(0, 2), [VISITS[1].id, 'POS-2026-000001']);
});

Deno.test('answer cells: option labels, several choices, evidence, Yes/No and JSON', () => {
  const base = { section: null, section_title: null, key: 'k', label: 'K', type: null, source: 'agent' as const };
  assertEquals(answerCell({ ...base, value: ['a', 'z'], value_label: ['A', null] }), 'A; z');
  assertEquals(answerCell({ ...base, value: 'x', value_label: null }), 'x');
  assertEquals(answerCell({ ...base, value: ['e1', 'e2'], evidence_ids: ['e1', 'e2'] }), 'e1; e2');
  assertEquals(answerCell({ ...base, value: false }), 'No');
  assertEquals(answerCell({ ...base, value: { lat: 1 } }), '{"lat":1}');
  assertEquals(correctedAnswers({ ...VISITS[1], amendments: [{ field_key: 'items[0].name', old_value: 'a', new_value: 'b', justification: 'x', created_at: 'z' }] }).staff_count,
               { v: 4 }, 'nested corrections are listed, not applied');
});

// ── Whole files ───────────────────────────────────────────────────────────────────────────────
const CLAIM: Claim = {
  run: true,
  export: { id: 'e0000000-0000-0000-0000-000000000001', type: 'csv', scope: { from: '2026-09-01', to: '2026-09-30' }, statuses: ['approved', 'rejected'], attempts: 1, bank_id: 'b', created_at: '2026-09-15T08:00:00+00:00' },
  bank: { code: 'ABC', name: 'ABC Bank' },
  form: null,
  time_zone: 'Africa/Johannesburg',
  visits: 2,
  max_file_bytes: 5 * 1048576,
};

Deno.test('file names say whose, what and when', () => {
  assertEquals(fileBase(CLAIM, 'answers'), 'ABC-visit-answers-2026-09-01-to-2026-09-30');
  assertEquals(fileBase({ ...CLAIM, bank: null, form: { key: 'site_visit', title: 'Site visit' }, export: { ...CLAIM.export, scope: {} } }, 'photos', new Date('2026-09-15T00:00:00Z')),
               'all-banks-site_visit-visit-photos-to-2026-09-15');
});

Deno.test('CSV export: one version is one CSV file; several make a ZIP of CSVs', async () => {
  const one = await buildCsv(CLAIM, [VISITS[0]], VERSIONS);
  assertEquals([one.fileName, one.mime], ['ABC-visit-answers-2026-09-01-to-2026-09-30.csv', 'text/csv']);
  assertEquals(one.items.map((i) => i.inspection_id), [VISITS[0].id]);
  const many = await buildCsv(CLAIM, VISITS, VERSIONS);
  assertEquals(many.mime, 'application/zip');
  const files = await unzip(concatBytes(many.chunks));
  assertEquals([...files.keys()], ['all-answers.csv', 'answers-Site-visit-v2.csv', 'answers-Site-visit-v1.csv', 'where-each-visit-came-from.csv']);
  assert(text(files.get('all-answers.csv')).includes('Kind of premises'));
});

Deno.test('Excel export: all answers, one sheet per version, the sources and about this file', async () => {
  const built = await buildXlsx({ ...CLAIM, export: { ...CLAIM.export, type: 'xlsx' } }, VISITS, VERSIONS, new Date('2026-09-15T10:00:00Z'));
  const files = await unzip(concatBytes(built.chunks));
  const wb = text(files.get('xl/workbook.xml'));
  for (const s of ['All answers', 'Site visit v2', 'Site visit v1', 'Where each visit came from', 'About this file']) assert(wb.includes(`name="${s}"`), s);
  assertEquals(built.items.length, 2);
});

Deno.test('photo ZIP: files with a manifest of fingerprints and custody; nothing silently left out', async () => {
  const good = new TextEncoder().encode('photo one');
  const goodSha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', good))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const ev = (id: string, state: string, sha: string, path: string) => ({
    id, field_key: 'shopfront_photo', category: null, type: 'photo', mime: 'image/jpeg', bytes: 9, captured_at: '2026-09-11T07:59:00+00:00', sha256: sha,
    integrity_verified: true, upload_state: state, replica_state: 'replicated', storage_path: path,
    custody: [{ event: 'verified', at: '2026-09-11T08:01:00+00:00' }],
  });
  const withPhotos = [
    visit(1, V1, {}, { evidence: [ev('ev-good', 'verified', goodSha, 'p/good.jpg'), ev('ev-bad', 'verified', 'f'.repeat(64), 'p/bad.jpg'),
                                  ev('ev-late', 'pending', 'a'.repeat(64), 'p/late.jpg'), ev('ev-gone', 'uploaded', 'b'.repeat(64), 'p/gone.jpg')] }),
  ];
  const store: Record<string, Uint8Array> = { 'p/good.jpg': good, 'p/bad.jpg': new TextEncoder().encode('tampered') };
  const built = await buildEvidenceZip({ ...CLAIM, export: { ...CLAIM.export, type: 'evidence_zip' } }, withPhotos, VERSIONS, (p) => Promise.resolve(store[p] ?? null));
  const files = await unzip(concatBytes(built.chunks));
  const photo = `photos/POS-2026-000001/visit-1/shopfront_photo-ev-good.jpg`;
  assert(files.has(photo) && files.has('manifest.csv') && files.has('manifest.json') && files.has('README.txt'), [...files.keys()].join(', '));
  assertEquals(text(files.get(photo)), 'photo one');
  const manifest = JSON.parse(text(files.get('manifest.json')));
  const byId = Object.fromEntries(manifest.files.map((f: { evidence_id: string }) => [f.evidence_id, f]));
  assertEquals([byId['ev-good'].matches, byId['ev-good'].included, byId['ev-good'].question], [true, true, 'Shop front']);
  assertEquals([byId['ev-bad'].matches, byId['ev-bad'].included], [false, true], 'a mismatch is kept and flagged');
  assertEquals([byId['ev-late'].included, byId['ev-late'].not_included_because], [false, 'Not received from the phone yet']);
  assertEquals([byId['ev-gone'].included, byId['ev-gone'].not_included_because], [false, 'Not found in storage']);
  assertEquals(built.items, [{ inspection_id: withPhotos[0].id, form_version_id: V1.id, answers_hash: '1'.repeat(64), submission_hash: 's'.repeat(64), evidence_listed: 4, evidence_included: 2 }]);
  assertEquals(built.problems.map((p) => [p.kind, p.severity, p.count]).sort(), [['fingerprint_mismatch', 'critical', 1], ['missing_in_storage', 'critical', 1], ['not_received', 'info', 1]]);
  assert(text(files.get('manifest.csv')).includes('verified 2026-09-11 10:01:00 +02:00'), 'custody events in local time');
  await assertRejects(() => buildEvidenceZip({ ...CLAIM, max_file_bytes: 100 }, withPhotos, VERSIONS, (p) => Promise.resolve(store[p] ?? null)),
                      ExportRefused, 'too big for one download');
});
