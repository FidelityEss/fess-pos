-- A bank API key's fingerprint (pos.api_keys.key_hash) is never readable through the database API (T6-06 follow-up,
-- D-100, migration 20260915140100). Signed-in staff read every other column (under RLS as before); the key check and
-- service_role still use the fingerprint. Allow AND deny cases (DEVELOPMENT-GUIDELINES §3).
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select no_plan();

-- Returns 'OK' or the POS error code / SQLSTATE raised by a statement (rolled back on error).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_hint text; v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
  return coalesce(nullif(v_hint, ''), v_state);
end $$;

-- ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, aud, role) values
  ('eb000000-0000-0000-0000-000000000001', 'fingerprint.admin@test.local', 'authenticated', 'authenticated'),
  ('eb000000-0000-0000-0000-000000000002', 'fingerprint.reader@test.local', 'authenticated', 'authenticated');
insert into pos.banks (id, code, name) values ('eb200000-0000-0000-0000-00000000000a', 'FPBA', 'Fingerprint Bank A');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, bank_ids, admin_auth_uid) values
  ('eb100000-0000-0000-0000-000000000001', 'FP-ADM1', 'Fay', 'Admin', 'pos_admin', '{}', null, 'eb000000-0000-0000-0000-000000000001'),
  ('eb100000-0000-0000-0000-000000000002', 'FP-RDR1', 'Rob', 'Reader', 'pos_bank_reader', '{}',
   array['eb200000-0000-0000-0000-00000000000a']::uuid[], 'eb000000-0000-0000-0000-000000000002');
select pos_rpc.set_context('eb100000-0000-0000-0000-000000000001', 'pos_admin', 'pgtap-fingerprint');
select pos_rpc.admin_api_key_create('eb100000-0000-0000-0000-000000000001', 'eb200000-0000-0000-0000-00000000000a',
                                    '{"name": "Fingerprint test"}', repeat('e', 64), 'Ee12');

-- ── Privileges ────────────────────────────────────────────────────────────────────────────────
select ok(not has_column_privilege('authenticated', 'pos.api_keys', 'key_hash', 'select'),
          'signed-in staff have no right to read the fingerprint column');
select ok(not has_table_privilege('authenticated', 'pos.api_keys', 'select'),
          'and no table-wide read right that would include it');
select is((select count(*) from pg_attribute a
            where a.attrelid = 'pos.api_keys'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'key_hash'
              and not has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')), 0::bigint,
          'every other column stays readable');
select ok(not has_column_privilege('anon', 'pos.api_keys', 'label', 'select'), 'anonymous callers read nothing');
select ok(has_column_privilege('service_role', 'pos.api_keys', 'key_hash', 'select'), 'the service role still reads it');

-- ── An admin with the bank in scope ───────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eb000000-0000-0000-0000-000000000001","aal":"aal1","role":"authenticated"}', true);
-- (throws_ok, not pg_temp.err: Postgres adds a hint to "permission denied", which err would return instead of 42501.)
select throws_ok($$select key_hash from pos.api_keys$$, '42501', null, 'an admin cannot read a key''s fingerprint');
select throws_ok($$select * from pos.api_keys$$, '42501', null, 'nor with select *');
select throws_ok($$select 1 from pos.api_keys where key_hash = repeat('e', 64)$$, '42501', null, 'nor test a guess against it');
select ok(exists (select 1 from pos.api_keys k where k.label = 'Fingerprint test' and k.last_four = 'Ee12' and k.active
                   and k.bank_id = 'eb200000-0000-0000-0000-00000000000a'),
          'but reads the key''s other columns (name, last four, status, bank)');

-- ── A bank viewer for that bank ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"eb000000-0000-0000-0000-000000000002","aal":"aal1","role":"authenticated"}', true);
select throws_ok($$select key_hash from pos.api_keys$$, '42501', null, 'a bank viewer cannot read the fingerprint');
select is(pg_temp.err($$select id, label, last_four from pos.api_keys$$), 'OK', 'the other columns can be asked for');
select is((select count(*) from pos.api_keys), 0::bigint, 'and, as before, a bank viewer sees no keys (RLS: admins only)');
set local role postgres;

-- ── The key check is unchanged ────────────────────────────────────────────────────────────────
select is(pos_rpc.bank_key_authorize(repeat('e', 64), 'GET', '/v1/bank/inspections', '10.0.0.1', 'pgtap', 'fp1') ->> 'allowed', 'true',
          'the key check still finds the key by its fingerprint');
select is(pos_rpc.bank_key_authorize(repeat('0', 64), 'GET', '/v1/bank/inspections', '10.0.0.1', 'pgtap', 'fp2') ->> 'allowed', 'false',
          'and still refuses an unknown key');
select ok(not (pos_rpc.admin_api_key_list('eb100000-0000-0000-0000-000000000001', 'eb200000-0000-0000-0000-00000000000a') -> 0 ? 'key_hash'),
          'the admin API''s list still never shows it');

select finish();
rollback;
