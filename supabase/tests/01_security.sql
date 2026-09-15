-- Grants, RLS and schema boundaries: allow AND deny for every caller kind (docs/05 §9, DEVELOPMENT-GUIDELINES §3).
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select no_plan();

-- ── fixtures ───────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@test.local', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000002', 'reader@test.local', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000003', 'scoped@test.local', 'authenticated', 'authenticated');
insert into pos.banks (id, code, name) values
  ('b0000000-0000-0000-0000-000000000001', 'TBANKA', 'Test Bank A'),
  ('b0000000-0000-0000-0000-000000000002', 'TBANKB', 'Test Bank B');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, admin_auth_uid, bank_ids) values
  ('c0000000-0000-0000-0000-000000000001', 'TA001', 'Ada', 'Admin', 'pos_admin', array['review_inspections', 'schedule_jobs'], 'a0000000-0000-0000-0000-000000000001', null),
  ('c0000000-0000-0000-0000-000000000002', 'TR001', 'Rita', 'Reader', 'pos_bank_reader', '{}', 'a0000000-0000-0000-0000-000000000002', array['b0000000-0000-0000-0000-000000000001']::uuid[]),
  ('c0000000-0000-0000-0000-000000000003', 'TS001', 'Sam', 'Scoped', 'pos_admin', '{}', 'a0000000-0000-0000-0000-000000000003', array['b0000000-0000-0000-0000-000000000002']::uuid[]),
  ('d0000000-0000-0000-0000-000000000001', 'TG001', 'Gugu', 'Agent', 'pos_agent', '{}', null, null),
  ('d0000000-0000-0000-0000-000000000002', 'TG002', 'Thabo', 'Agent', 'pos_agent', '{}', null, null);
insert into pos.jobs (id, bank_id, merchant_name, address) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Spaza One', '{"line1": "1 Main Rd"}'),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Shop Two', '{"line1": "2 Main Rd"}');
update pos.jobs set status = 'scheduled', scheduled_start = now() + interval '1 hour', scheduled_end = now() + interval '3 hours'
 where id = 'e0000000-0000-0000-0000-000000000001';
update pos.jobs set status = 'assigned', assigned_to = 'd0000000-0000-0000-0000-000000000001', assigned_at = now()
 where id = 'e0000000-0000-0000-0000-000000000001';
insert into pos.job_assignments (job_id, user_id) values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001');
insert into pos.reason_codes (category, code, label) values ('cancel', 'duplicate', 'Duplicate') on conflict do nothing;
insert into pos.definition_families (id, kind, key, title) values ('90000000-0000-0000-0000-000000000001', 'form', 'zz_security_test', 'Security test form');

create function pg_temp.as_agent(p_user uuid, p_scope text default 'full', p_token_use text default 'pos_access') returns void
language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'token_use', p_token_use,
    'pos_user_id', p_user, 'pos_role', 'pos_agent', 'scope', p_scope, 'device_id', 'f0000000-0000-0000-0000-000000000001',
    'session_id', 'f0000000-0000-0000-0000-000000000009')::text, true);
$$;
create function pg_temp.as_staff(p_auth uuid, p_aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_auth, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- ── structure ──────────────────────────────────────────────────────────────────────────────────
select has_schema('pos');
select has_schema('pos_rpc');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'pos' and c.relkind = 'r' and not c.relrowsecurity), 0::bigint, 'RLS enabled on every pos table');
select ok(not has_schema_privilege('anon', 'pos', 'usage'), 'anon has no usage on pos');
select ok(not has_schema_privilege('authenticated', 'pos_rpc', 'usage'), 'authenticated cannot reach pos_rpc (write paths)');
select ok(not has_schema_privilege('anon', 'pos_rpc', 'usage'), 'anon cannot reach pos_rpc');
select ok(has_schema_privilege('service_role', 'pos_rpc', 'usage'), 'service_role can reach pos_rpc');
select is((select count(*) from information_schema.role_table_grants
            where grantee = 'authenticated' and table_schema = 'pos'
              and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE') and table_name <> 'definition_drafts'),
          0::bigint, 'clients have no write grants except definition_drafts');
select is((select count(*) from information_schema.role_table_grants
            where grantee = 'service_role' and table_schema = 'pos' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
          0::bigint, 'service_role writes only through pos_rpc functions');
select is((select count(*) from storage.buckets where id in ('evidence', 'evidence-replica', 'reports', 'assets', 'profiles') and public),
          0::bigint, 'all POS buckets are private');
select is((select count(*) from storage.buckets where id in ('evidence', 'evidence-replica', 'reports', 'assets', 'profiles')),
          5::bigint, 'all POS buckets exist');

-- ── agent: full scope ──────────────────────────────────────────────────────────────────────────
select pg_temp.as_agent('d0000000-0000-0000-0000-000000000001');
set local role authenticated;
select results_eq('select id from pos.jobs', $$values ('e0000000-0000-0000-0000-000000000001'::uuid)$$, 'agent sees only jobs assigned to them');
select results_eq('select id from pos.pos_users', $$values ('d0000000-0000-0000-0000-000000000001'::uuid)$$, 'agent sees only their own user row');
select is_empty('select 1 from pos.pos_sessions', 'agent cannot read sessions');
select is_empty('select 1 from pos.audit_log', 'agent cannot read the audit log');
select is_empty('select 1 from pos.remote_config_versions', 'agent reads config only through sync (resolved, client-safe)');
select isnt_empty('select 1 from pos.reason_codes', 'agent can read reason codes');
select isnt_empty('select 1 from pos.banks', 'agent can read the bank of an assigned job');
select results_eq('select count(*) from pos.banks', $$values (1::bigint)$$, 'agent cannot read other banks');
select throws_ok($$insert into pos.banks (code, name) values ('XX', 'x')$$, '42501', null, 'agent cannot insert');
select throws_ok($$insert into pos.definition_drafts (family_id, definition, updated_by)
                   values ('90000000-0000-0000-0000-000000000001', '{}', 'd0000000-0000-0000-0000-000000000001')$$,
                 '42501', null, 'agent cannot write definition drafts');
select throws_ok($$select pos_rpc.fail('X', 'y')$$, '42501', null, 'agent cannot call pos_rpc');
set local role postgres;

-- another agent, no assignment
select pg_temp.as_agent('d0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is_empty('select 1 from pos.jobs', 'unassigned agent sees no jobs');
set local role postgres;

-- ingest_only scope reads nothing (docs/05 §9)
select pg_temp.as_agent('d0000000-0000-0000-0000-000000000001', 'ingest_only');
set local role authenticated;
select is_empty('select 1 from pos.jobs', 'ingest_only session reads nothing');
select is_empty('select 1 from pos.reason_codes', 'ingest_only session reads no reference data');
set local role postgres;

-- claims the POS API did not mark as its own are not agent claims
select pg_temp.as_agent('d0000000-0000-0000-0000-000000000001', 'full', 'forged');
set local role authenticated;
select is_empty('select 1 from pos.jobs', 'forged claims without token_use=pos_access see nothing');
set local role postgres;

-- ── admins ─────────────────────────────────────────────────────────────────────────────────────
-- admin.require_mfa (off since D-96, 2026-09-15). Checked both ways so the switch keeps working: on, a password-only
-- (aal1) session sees nothing; off, the same session is an admin.
update pos.settings set value = 'true'::jsonb where key = 'admin.require_mfa';
select pg_temp.as_staff('a0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select is_empty('select 1 from pos.jobs', 'with admin.require_mfa on, an admin without a second step (aal1) sees nothing');
set local role postgres;
update pos.settings set value = 'false'::jsonb where key = 'admin.require_mfa';
select pg_temp.as_staff('a0000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select isnt_empty('select 1 from pos.jobs', 'with admin.require_mfa off (D-96), a password-only admin session reads');
set local role postgres;

select pg_temp.as_staff('a0000000-0000-0000-0000-000000000001');
set local role authenticated;
select results_eq($$select count(*) from pos.jobs where id in ('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002')$$,
                  $$values (2::bigint)$$, 'admin (aal2, all banks) sees every job');
select lives_ok('select count(*) from pos.pos_sessions', 'admin can read sessions');
select isnt_empty('select 1 from pos.audit_log', 'admin can read the audit log');
select is_empty('select 1 from pos.settings', 'nobody reads server settings through the API');
select lives_ok($$insert into pos.definition_drafts (family_id, definition, updated_by)
                  values ('90000000-0000-0000-0000-000000000001', '{"kind": "form"}', 'c0000000-0000-0000-0000-000000000001')$$,
                'admin can upsert a definition draft');
select throws_ok($$insert into pos.definition_drafts (family_id, definition, updated_by)
                   values ('90000000-0000-0000-0000-000000000001', '{}', 'c0000000-0000-0000-0000-000000000003')$$,
                 null, null, 'admin cannot write a draft attributed to someone else');
select throws_ok($$insert into pos.jobs (bank_id, merchant_name, address) values ('b0000000-0000-0000-0000-000000000001', 'x', '{}')$$,
                 '42501', null, 'admin cannot write jobs directly (only via /v1/admin)');
set local role postgres;

-- bank-scoped admin
select pg_temp.as_staff('a0000000-0000-0000-0000-000000000003');
set local role authenticated;
select results_eq('select id from pos.jobs', $$values ('e0000000-0000-0000-0000-000000000002'::uuid)$$, 'bank-scoped admin sees only their bank');
select results_eq('select count(*) from pos.banks', $$values (1::bigint)$$, 'bank-scoped admin sees only their bank row');
set local role postgres;

-- bank reader: approved inspections of their bank only
select pg_temp.as_staff('a0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is_empty('select 1 from pos.jobs', 'bank reader sees nothing until an inspection is approved');
select is_empty('select 1 from pos.inspections', 'bank reader sees no unapproved inspections');
set local role postgres;

-- deactivated admin
update pos.pos_users set active = false where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.as_staff('a0000000-0000-0000-0000-000000000001');
set local role authenticated;
select is_empty('select 1 from pos.jobs', 'deactivated admin sees nothing');
set local role postgres;

-- ── anon ───────────────────────────────────────────────────────────────────────────────────────
set local role anon;
select throws_ok('select 1 from pos.jobs', '42501', null, 'anon cannot read pos');
set local role postgres;

select * from finish();
rollback;
