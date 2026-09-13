#!/usr/bin/env node
// pgTAP against QA without Docker (T1-33). `supabase test db --linked` runs pg_prove in a Docker container, and laptops
// no longer run Docker since the local stack was retired (D-48). Instead, each supabase/tests/*.sql file is sent through
// `supabase db query --linked -f` as the one transaction it already is (begin … rollback), so nothing stays behind.
// That path returns only the last result set, so a summary query over pgTAP's results is added just before the file's
// final rollback. Run it through `pnpm db:test`, which first checks the CLI is linked to QA (require-qa-link.mjs).
//   node tools/ops/pgtap-qa.mjs [name-filter …]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TESTS = new URL('../../supabase/tests/', import.meta.url);
const only = process.argv.slice(2);
const files = readdirSync(TESTS).filter((f) => f.endsWith('.sql') && (!only.length || only.some((o) => f.includes(o)))).sort();
// pgTAP keeps only counters in this session (no per-assertion results table), so the summary is counts: which
// assertion failed shows with `pnpm db:test:docker` or by running the file in the SQL editor.
const SUMMARY = `select _get('curr_test')::int as total, num_failed()::int as failed;
`;

const work = mkdtempSync(join(tmpdir(), 'pgtap-qa-'));
let total = 0;
let failed = 0;
let broken = 0;
for (const f of files) {
  const sql = readFileSync(new URL(f, TESTS), 'utf8');
  const at = sql.toLowerCase().lastIndexOf('rollback');
  if (at < 0) {
    console.log(`✗ ${f}: no final rollback, so it was not run (every test file must roll back)`);
    broken++;
    continue;
  }
  const path = join(work, f);
  writeFileSync(path, sql.slice(0, at) + SUMMARY + sql.slice(at));
  let out;
  try {
    out = execFileSync('supabase', ['db', 'query', '--linked', '-f', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.log(`✗ ${f}: ${`${e.stdout ?? ''}${e.stderr ?? ''}`.trim().slice(0, 2000)}`);
    broken++;
    continue;
  }
  const row = (JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows ?? [])[0] ?? {};
  total += row.total ?? 0;
  failed += row.failed ?? 0;
  console.log(`${row.failed ? '✗' : '✓'} ${f}: ${(row.total ?? 0) - (row.failed ?? 0)}/${row.total ?? 0}`);
}
rmSync(work, { recursive: true, force: true });
console.log(`\n${total - failed}/${total} assertions passed${failed ? `, ${failed} failed` : ''}${broken ? `, ${broken} file(s) did not run` : ''}`);
process.exit(failed || broken ? 1 : 0);
