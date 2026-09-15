-- Bank API keys and the bank read API (T6-06, D-100): creating, listing and switching off keys; who may; the key check,
-- expiry and the per-minute limit; the call record; what a bank can read (its own bank, decided inspections unless the
-- bank widens it, the change cursor). Allow AND deny cases (DEVELOPMENT-GUIDELINES §3).
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select no_plan();

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_hint text; v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
  return coalesce(nullif(v_hint, ''), v_state);
end $$;
create temp table ids (name text primary key, id uuid);
grant all on ids to public;

-- ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, aud, role) values
  ('ea000000-0000-0000-0000-000000000001', 'bankapi.global@test.local', 'authenticated', 'authenticated'),
  ('ea000000-0000-0000-0000-000000000002', 'bankapi.scoped@test.local', 'authenticated', 'authenticated');
insert into pos.banks (id, code, name) values
  ('ea200000-0000-0000-0000-00000000000a', 'KEYBA', 'Key Bank A'),
  ('ea200000-0000-0000-0000-00000000000b', 'KEYBB', 'Key Bank B');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, bank_ids, admin_auth_uid) values
  ('ea100000-0000-0000-0000-000000000001', 'KEY-ADM1', 'Gugu', 'Global', 'pos_admin', '{}', null, 'ea000000-0000-0000-0000-000000000001'),
  ('ea100000-0000-0000-0000-000000000002', 'KEY-ADM2', 'Sipho', 'Scoped', 'pos_admin', '{}', array['ea200000-0000-0000-0000-00000000000b']::uuid[], 'ea000000-0000-0000-0000-000000000002'),
  ('ea100000-0000-0000-0000-000000000003', 'KEY-AG1', 'Ade', 'Agent', 'pos_agent', '{}', null, null);
insert into pos.jobs (id, bank_id, merchant_name, address) values
  ('ea300000-0000-0000-0000-00000000000a', 'ea200000-0000-0000-0000-00000000000a', 'Spaza A', '{"line1": "1 Main Rd"}'),
  ('ea300000-0000-0000-0000-00000000000b', 'ea200000-0000-0000-0000-00000000000b', 'Spaza B', '{"line1": "2 Main Rd"}'),
  ('ea300000-0000-0000-0000-00000000000c', 'ea200000-0000-0000-0000-00000000000a', 'Spaza A2', '{"line1": "3 Main Rd"}');
-- Bank A: one approved, one still under review. Bank B: one approved.
insert into pos.inspections (id, job_id, attempt, user_id, device_id, status, answers, evidence_expected, evidence_verified, answers_hash) values
  ('ea400000-0000-0000-0000-000000000001', 'ea300000-0000-0000-0000-00000000000a', 1, 'ea100000-0000-0000-0000-000000000003', 'ea500000-0000-0000-0000-000000000001', 'submitted', '{"merchant_name": {"v": "Spaza A", "prefilled": true}}', 1, 1, repeat('1', 64)),
  ('ea400000-0000-0000-0000-000000000002', 'ea300000-0000-0000-0000-00000000000c', 1, 'ea100000-0000-0000-0000-000000000003', 'ea500000-0000-0000-0000-000000000001', 'submitted', '{}', 0, 0, null),
  ('ea400000-0000-0000-0000-000000000003', 'ea300000-0000-0000-0000-00000000000b', 1, 'ea100000-0000-0000-0000-000000000003', 'ea500000-0000-0000-0000-000000000001', 'submitted', '{}', 0, 0, null);
update pos.inspections set status = 'approved' where id in ('ea400000-0000-0000-0000-000000000001', 'ea400000-0000-0000-0000-000000000003');
update pos.inspections set status = 'under_review' where id = 'ea400000-0000-0000-0000-000000000002';
insert into pos.reviews (inspection_id, reviewer_id, decision) values
  ('ea400000-0000-0000-0000-000000000001', 'ea100000-0000-0000-0000-000000000001', 'approved');
insert into pos.evidence (id, inspection_id, job_id, type, sha256_client, storage_path, field_key) values
  ('ea600000-0000-0000-0000-000000000001', 'ea400000-0000-0000-0000-000000000001', 'ea300000-0000-0000-0000-00000000000a', 'photo',
   repeat('a', 64), 'bank/ea2/job/ea3/inspection/ea4/ea600000-0000-0000-0000-000000000001.jpg', 'shopfront_photo');
insert into pos.custody_events (subject_type, subject_id, event, source) values
  ('inspection', 'ea400000-0000-0000-0000-000000000001', 'submission_committed', 'server');
select pos_rpc.set_context('ea100000-0000-0000-0000-000000000001', 'pos_admin', 'pgtap-bank-api');

-- ── Settings ──────────────────────────────────────────────────────────────────────────────────
select is(pos_rpc.setting_int('bank_api.rate_limit_per_minute', 1, 6000), 60, '60 requests a minute to start');
select is(pos_rpc.bank_api_statuses('ea200000-0000-0000-0000-00000000000a'), array['approved', 'rejected'], 'by default a bank reads decided inspections');

-- ── Only the POS API reaches the functions ────────────────────────────────────────────────────
set local role authenticated;
select is(pg_temp.err($$select pos_rpc.bank_key_authorize(repeat('0', 64), 'GET', '/v1/bank/inspections', null, null, null)$$), '42501',
          'a signed-in client cannot call the bank API functions');
set local role postgres;
set local role anon;
select is(pg_temp.err($$select pos_rpc.bank_inspection_get('ea200000-0000-0000-0000-00000000000a', array['approved'], 'ea400000-0000-0000-0000-000000000001')$$), '42501',
          'an anonymous caller cannot read inspections through them');
set local role postgres;

-- ── Admin: create, list, switch off ───────────────────────────────────────────────────────────
insert into ids select 'key_a', (pos_rpc.admin_api_key_create('ea100000-0000-0000-0000-000000000001', 'ea200000-0000-0000-0000-00000000000a',
          '{"name": "Nightly import"}', repeat('b', 64), 'Ab12') ->> 'id')::uuid;
select ok((select k.label = 'Nightly import' and k.last_four = 'Ab12' and k.active and k.created_by = 'ea100000-0000-0000-0000-000000000001'
                  and k.expires_at between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months' + interval '1 minute'
             from pos.api_keys k where k.id = (select id from ids where name = 'key_a')),
          'a key is stored with its name, last four, who made it and a 12-month expiry');
select ok(not (pos_rpc.admin_api_key_list('ea100000-0000-0000-0000-000000000001', 'ea200000-0000-0000-0000-00000000000a') -> 0 ? 'key_hash'),
          'the list never shows the fingerprint');
select is(pos_rpc.admin_api_key_list('ea100000-0000-0000-0000-000000000001', 'ea200000-0000-0000-0000-00000000000a') -> 0 ->> 'status', 'active', 'the list shows the status');
select is(pg_temp.err($$select pos_rpc.admin_api_key_create('ea100000-0000-0000-0000-000000000002', 'ea200000-0000-0000-0000-00000000000a', '{"name": "x"}', repeat('c', 64), 'Cc12')$$),
          'POS:FORBIDDEN', 'an admin for another bank cannot make a key for this bank');
select is(pg_temp.err($$select pos_rpc.admin_api_key_list('ea100000-0000-0000-0000-000000000002', 'ea200000-0000-0000-0000-00000000000a')$$),
          'POS:FORBIDDEN', 'nor list its keys');
select is(pg_temp.err($$select pos_rpc.admin_api_key_create('ea100000-0000-0000-0000-000000000003', 'ea200000-0000-0000-0000-00000000000a', '{"name": "x"}', repeat('c', 64), 'Cc12')$$),
          'POS:FORBIDDEN', 'an agent cannot make a key');
select is(pg_temp.err($$select pos_rpc.admin_api_key_create('ea100000-0000-0000-0000-000000000001', 'ea200000-0000-0000-0000-00000000000a', '{"name": "x", "expires_in_months": 25}', repeat('c', 64), 'Cc12')$$),
          'POS:INVALID_REQUEST', 'a key can work for 24 months at most');
select is(pg_temp.err($$select pos_rpc.admin_api_key_create('ea100000-0000-0000-0000-000000000001', 'ea200000-0000-0000-0000-00000000000a', '{}', repeat('c', 64), 'Cc12')$$),
          'POS:INVALID_REQUEST', 'a key needs a name');
select is(pg_temp.err($$select pos_rpc.admin_api_key_create('ea100000-0000-0000-0000-000000000001', 'ea200000-0000-0000-0000-00000000000a', '{"name": "x"}', 'not-a-hash', 'Cc12')$$),
          'POS:INVALID_REQUEST', 'only a SHA-256 fingerprint is accepted');
select is(pg_temp.err($$select pos_rpc.admin_api_key_create('ea100000-0000-0000-0000-000000000001', 'ea200000-0000-0000-0000-00000000000a', '{"name": "dup"}', repeat('b', 64), 'Dd12')$$),
          'POS:ALREADY_EXISTS', 'the same key twice is refused');
select pos_rpc.set_context('ea100000-0000-0000-0000-000000000002', 'pos_admin', 'pgtap-bank-api');   -- as the API does per request
insert into ids select 'key_b', (pos_rpc.admin_api_key_create('ea100000-0000-0000-0000-000000000002', 'ea200000-0000-0000-0000-00000000000b',
          '{"name": "Bank B feed", "expires_in_months": 1, "rate_limit_per_minute": 2}', repeat('d', 64), 'Ee12') ->> 'id')::uuid;
select pos_rpc.set_context('ea100000-0000-0000-0000-000000000001', 'pos_admin', 'pgtap-bank-api');
select ok(exists (select 1 from pos.audit_log a where a.table_name = 'api_keys' and a.row_id = (select id from ids where name = 'key_b')::text
                    and a.actor_id = 'ea100000-0000-0000-0000-000000000002' and not (a.after ? 'key_hash')),
          'making a key is in the activity history, without the fingerprint');

-- ── The key check ─────────────────────────────────────────────────────────────────────────────
select is(pos_rpc.bank_key_authorize(repeat('0', 64), 'GET', '/v1/bank/inspections', '10.0.0.1', 'test', 'r1') ->> 'allowed', 'false', 'an unknown key is refused');
select is(pos_rpc.bank_key_authorize(repeat('b', 64), 'GET', '/v1/bank/inspections', '10.0.0.1', 'test', 'r2') ->> 'bank_id',
          'ea200000-0000-0000-0000-00000000000a', 'a good key is let in for its own bank');
select ok((select last_used_at is not null from pos.api_keys where id = (select id from ids where name = 'key_a')), 'last use is recorded');
select is(pos_rpc.bank_key_authorize(repeat('d', 64), 'GET', '/v1/bank/inspections', null, null, 'r3') ->> 'remaining', '1', 'the limit counts down');
select is(pos_rpc.bank_key_authorize(repeat('d', 64), 'GET', '/v1/bank/inspections', null, null, 'r4') ->> 'allowed', 'true', 'the second call a minute is fine');
select is(pos_rpc.bank_key_authorize(repeat('d', 64), 'GET', '/v1/bank/inspections', null, null, 'r5') ->> 'code', 'RATE_LIMITED', 'the third call a minute is refused');
select is((select status from pos.bank_api_calls where key_id = (select id from ids where name = 'key_b') order by at desc limit 1), 429,
          'the refused call is recorded');
update pos.api_keys set expires_at = now() - interval '1 second' where id = (select id from ids where name = 'key_b');
select is(pos_rpc.bank_key_authorize(repeat('d', 64), 'GET', '/v1/bank/inspections', null, null, 'r6') ->> 'message', 'this API key has expired', 'an expired key is refused');
select is(pos_rpc.admin_api_key_revoke('ea100000-0000-0000-0000-000000000001', (select id from ids where name = 'key_a'), 'moved to a new key') ->> 'status',
          'revoked', 'an admin switches a key off');
select is(pos_rpc.bank_key_authorize(repeat('b', 64), 'GET', '/v1/bank/inspections', null, null, 'r7') ->> 'message', 'this API key has been switched off',
          'a switched-off key is refused');
select is((select status from pos.bank_api_calls where key_id = (select id from ids where name = 'key_a') order by at desc limit 1), 401,
          'and that refusal is recorded');
select is(pg_temp.err(format($$select pos_rpc.admin_api_key_revoke('ea100000-0000-0000-0000-000000000001', %L, 'again')$$, (select id from ids where name = 'key_a'))),
          'POS:CONFLICT', 'switching off twice is refused');
select is(pg_temp.err(format($$select pos_rpc.admin_api_key_revoke('ea100000-0000-0000-0000-000000000001', %L, ' ')$$, (select id from ids where name = 'key_b'))),
          'POS:NOTE_REQUIRED', 'switching off needs a reason');

-- ── The call record ───────────────────────────────────────────────────────────────────────────
select pos_rpc.bank_call_record((select id from ids where name = 'key_b'), 'GET', '/v1/bank/inspections/:id', 'ea400000-0000-0000-0000-000000000003', 200, 1, 'r8', '10.0.0.2', 'curl');
select ok(exists (select 1 from pos.bank_api_calls where request_id = 'r8' and bank_id = 'ea200000-0000-0000-0000-00000000000b' and items = 1),
          'a call is recorded against the key''s bank');
select ok(exists (select 1 from pos.audit_log where table_name = 'bank_api_calls' and after ->> 'request_id' = 'r8'), 'and it is in the activity history');
select throws_ok($$update pos.bank_api_calls set status = 500 where request_id = 'r8'$$, 'P0001', null, 'call records cannot be changed');
select throws_ok($$delete from pos.bank_api_calls where request_id = 'r8'$$, 'P0001', null, 'nor deleted');
select is((select status from pos.bank_api_calls where request_id = 'r8'), 200, 'the record is still there, unchanged');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ea000000-0000-0000-0000-000000000002","aal":"aal1","role":"authenticated"}', true);
select ok(exists (select 1 from pos.bank_api_calls where request_id = 'r8'), 'an admin for the bank reads its call record');
select ok(not exists (select 1 from pos.bank_api_calls where bank_id = 'ea200000-0000-0000-0000-00000000000a'), 'but not another bank''s');
select set_config('request.jwt.claims', '{"token_use":"pos_access","pos_user_id":"ea100000-0000-0000-0000-000000000003","pos_role":"pos_agent","scope":"full","role":"authenticated"}', true);
select ok(not exists (select 1 from pos.bank_api_calls), 'an agent reads no call records');
set local role postgres;

-- ── What a bank reads ─────────────────────────────────────────────────────────────────────────
select is(jsonb_array_length(pos_rpc.bank_inspections_changed('ea200000-0000-0000-0000-00000000000a', array['approved', 'rejected'], null, null, 100) -> 'items'), 1,
          'bank A sees its one decided inspection');
select is(pos_rpc.bank_inspections_changed('ea200000-0000-0000-0000-00000000000a', array['approved', 'rejected'], null, null, 100) -> 'items' -> 0 ->> 'id',
          'ea400000-0000-0000-0000-000000000001', 'the approved one, not the one under review or bank B''s');
select is(pos_rpc.bank_inspections_changed('ea200000-0000-0000-0000-00000000000a', array['approved', 'rejected'], null, null, 100) -> 'items' -> 0 -> 'decision' ->> 'decision',
          'approved', 'with its decision');
insert into ids select 'cursor_at', null;
select is(jsonb_array_length(pos_rpc.bank_inspections_changed('ea200000-0000-0000-0000-00000000000a', array['approved', 'rejected'],
            (pos_rpc.bank_inspections_changed('ea200000-0000-0000-0000-00000000000a', array['approved', 'rejected'], null, null, 100) #>> '{last,changed_at}')::timestamptz,
            (pos_rpc.bank_inspections_changed('ea200000-0000-0000-0000-00000000000a', array['approved', 'rejected'], null, null, 100) #>> '{last,id}')::uuid, 100) -> 'items'), 0,
          'nothing after the last cursor');
update pos.banks set export_settings = '{"api": {"inspection_statuses": ["approved", "rejected", "under_review"]}}' where id = 'ea200000-0000-0000-0000-00000000000a';
select is(pos_rpc.bank_api_statuses('ea200000-0000-0000-0000-00000000000a'), array['approved', 'rejected', 'under_review'], 'a bank can widen what it reads');
select is(jsonb_array_length(pos_rpc.bank_inspections_changed('ea200000-0000-0000-0000-00000000000a', pos_rpc.bank_api_statuses('ea200000-0000-0000-0000-00000000000a'), null, null, 1) -> 'items'), 1,
          'the limit applies');
select is(pos_rpc.bank_inspections_changed('ea200000-0000-0000-0000-00000000000a', pos_rpc.bank_api_statuses('ea200000-0000-0000-0000-00000000000a'), null, null, 1) ->> 'has_more',
          'true', 'and says there is more');
update pos.banks set export_settings = '{"api": {"inspection_statuses": ["in_progress"]}}' where id = 'ea200000-0000-0000-0000-00000000000a';
select is(pg_temp.err($$select pos_rpc.bank_api_statuses('ea200000-0000-0000-0000-00000000000a')$$), 'POS:NOT_READY', 'drafts can never be opened to a bank (fails closed)');
update pos.banks set export_settings = '{}' where id = 'ea200000-0000-0000-0000-00000000000a';

select is(pos_rpc.bank_inspection_get('ea200000-0000-0000-0000-00000000000a', array['approved', 'rejected'], 'ea400000-0000-0000-0000-000000000001') #>> '{answers,merchant_name,v}',
          'Spaza A', 'one inspection comes with its answers');
select is(pos_rpc.bank_inspection_get('ea200000-0000-0000-0000-00000000000a', array['approved', 'rejected'], 'ea400000-0000-0000-0000-000000000001') #>> '{evidence,0,field_key}',
          'shopfront_photo', 'its evidence');
select ok(pos_rpc.bank_inspection_get('ea200000-0000-0000-0000-00000000000a', array['approved', 'rejected'], 'ea400000-0000-0000-0000-000000000001') #> '{custody,events}'
            @> '[{"event": "submission_committed", "source": "server"}]'::jsonb,
          'and a custody summary');
select is(pos_rpc.bank_inspection_get('ea200000-0000-0000-0000-00000000000a', array['approved', 'rejected'], 'ea400000-0000-0000-0000-000000000001') #>> '{inspection,answers_hash}',
          repeat('1', 64), 'with the hashes that prove what was submitted');
select is(pg_temp.err($$select pos_rpc.bank_inspection_get('ea200000-0000-0000-0000-00000000000a', array['approved', 'rejected'], 'ea400000-0000-0000-0000-000000000003')$$),
          'POS:NOT_FOUND', 'another bank''s inspection is not found');
select is(pg_temp.err($$select pos_rpc.bank_inspection_get('ea200000-0000-0000-0000-00000000000a', array['approved', 'rejected'], 'ea400000-0000-0000-0000-000000000002')$$),
          'POS:NOT_FOUND', 'an inspection still under review is not found');

select finish();
rollback;
