// Destructive maintenance for a POS Supabase project (docs/15 §5, rebuild runbook): removes stored files from the POS
// buckets and removes Auth users. The database itself is rebuilt with `supabase db reset --linked`; this covers what
// that reset leaves behind (Storage objects and Auth accounts live outside our schemas).
//
//   POS_TARGET=qa|production POS_PUBLISHABLE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
//     deno run -A --node-modules-dir=none --config tools/scenarios/deno.json tools/ops/purge-remote.ts \
//       [--files] [--auth-domain fess-pos.test] [--auth-email a@b.c ...] [--keep-email you@x.y ...] [--apply --confirm <ref>]
//
// Dry run by default: it lists what it would remove. `--apply` needs `--confirm <project ref>` typed out, so the target
// can never be confused. On production this runs only as part of an approved action (instructions §11).
import { createClient } from '@supabase/supabase-js';
import { env, target } from '../scenarios/lib/env.ts';

const BUCKETS = ['evidence', 'evidence-replica', 'reports', 'assets', 'profiles'] as const;

const argv = [...Deno.args];
const has = (flag: string) => argv.includes(flag);
const values = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]!] : []));

if (!env.serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
const apply = has('--apply');
if (apply && values('--confirm')[0] !== env.ref) throw new Error(`--apply needs --confirm ${env.ref} (the ${target} project ref)`);

const sb = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const report: Record<string, unknown> = { target, ref: env.ref, mode: apply ? 'APPLY' : 'dry run' };

async function listAll(bucket: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) out.push(...(await listAll(bucket, path))); // a folder
      else out.push(path);
    }
    if (data.length < 1000) break;
  }
  return out;
}

if (has('--files')) {
  const files: Record<string, number> = {};
  for (const bucket of BUCKETS) {
    const paths = await listAll(bucket);
    files[bucket] = paths.length;
    if (apply) {
      for (let i = 0; i < paths.length; i += 500) {
        const { error } = await sb.storage.from(bucket).remove(paths.slice(i, i + 500));
        if (error) throw new Error(`remove from ${bucket}: ${error.message}`);
      }
    }
  }
  report.files = files;
}

const domains = values('--auth-domain').map((d) => `@${d.toLowerCase()}`);
const emails = values('--auth-email').map((e) => e.toLowerCase());
const keep = new Set(values('--keep-email').map((e) => e.toLowerCase()));
if (domains.length || emails.length) {
  const matched: { id: string; email: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`list auth users: ${error.message}`);
    for (const u of data.users) {
      const email = (u.email ?? '').toLowerCase();
      if (keep.has(email)) continue;
      if (emails.includes(email) || domains.some((d) => email.endsWith(d))) matched.push({ id: u.id, email });
    }
    if (data.users.length < 1000) break;
  }
  if (apply) {
    for (const u of matched) {
      const { error } = await sb.auth.admin.deleteUser(u.id);
      if (error) throw new Error(`delete auth user ${u.email}: ${error.message}`);
    }
  }
  report.auth_users = matched.map((u) => u.email);
  report.kept = [...keep];
}

console.log(JSON.stringify(report, null, 2));
