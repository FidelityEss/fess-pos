-- pgTAP: admin ops functions (20260911102200) — envelope inbox, alerts, sessions/devices, exports, server epoch, evidence
-- access, admin read RPCs under RLS (allow + deny), first-admin bootstrap.
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select plan(35);

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
insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-000000000001', 'gina@example.test'),
  ('f0000000-0000-0000-0000-000000000002', 'ben@example.test');
insert into pos.banks (id, code, name) values
  ('10000000-0000-0000-0000-00000000000a', 'BANKA', 'Bank A'),
  ('10000000-0000-0000-0000-00000000000b', 'BANKB', 'Bank B');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, bank_ids, active, admin_auth_uid) values
  ('a0000000-0000-0000-0000-000000000001', 'ADM-1', 'Gina', 'Global', 'pos_admin', array['approve_definitions', 'review_inspections', 'schedule_jobs'], null, true, 'f0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002', 'ADM-2', 'Ben', 'Banka', 'pos_admin', '{}', array['10000000-0000-0000-0000-00000000000a']::uuid[], true, 'f0000000-0000-0000-0000-000000000002');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, bank_ids) values
  ('b0000000-0000-0000-0000-000000000001', 'AG-1', 'Ada', 'One', 'pos_agent', array['10000000-0000-0000-0000-00000000000a']::uuid[]),
  ('b0000000-0000-0000-0000-000000000002', 'AG-2', 'Bob', 'Two', 'pos_agent', array['10000000-0000-0000-0000-00000000000b']::uuid[]);
insert into pos.devices (id, user_id, device_id) values
  ('dd000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001');
insert into pos.pos_sessions (id, user_id, device_id, issuer_key, family_id, refresh_token_hash, scope, expires_at, rotated_at) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'pos_dev',
   'c0000000-0000-0000-0000-000000000001', 'h1', 'full', now() + interval '9 days', now()),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'pos_dev',
   'c0000000-0000-0000-0000-000000000001', 'h2', 'full', now() + interval '10 days', null),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'pos_dev',
   'c0000000-0000-0000-0000-000000000003', 'h3', 'full', now() + interval '10 days', null);
select pos_rpc.set_context('a0000000-0000-0000-0000-000000000001', 'pos_admin', 'pgtap-admin-ops');
insert into ids select 'jA', (pos_rpc.admin_job_create('a0000000-0000-0000-0000-000000000001',
  '{"bank_id":"10000000-0000-0000-0000-00000000000a","merchant_name":"A","address":{"line1":"1"}}') ->> 'id')::uuid;
insert into ids select 'jB', (pos_rpc.admin_job_create('a0000000-0000-0000-0000-000000000001',
  '{"bank_id":"10000000-0000-0000-0000-00000000000b","merchant_name":"B","address":{"line1":"2"}}') ->> 'id')::uuid;
insert into pos.ingest_envelopes (id, type, type_version, api_version, payload, payload_hash, stored_hash, wrapper, device_id, user_id, state) values
  ('ee000000-0000-0000-0000-000000000001', 'submission', 1, '1', '{}', repeat('a', 64), repeat('a', 64), '{}',
   'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'rejected'),
  ('ee000000-0000-0000-0000-000000000002', 'evidence_meta', 1, '1', '{}', repeat('b', 64), repeat('b', 64), '{}',
   'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'conflict');

-- ── Envelope inbox ────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err($$select pos_rpc.admin_envelope_reprocess('a0000000-0000-0000-0000-000000000002', 'ee000000-0000-0000-0000-000000000001', 'fixed')$$),
          'POS:FORBIDDEN', 'bank-scoped admin cannot act on the inbox');
select is(pg_temp.err($$select pos_rpc.admin_envelope_reprocess('a0000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000001', '')$$),
          'POS:NOTE_REQUIRED', 'reprocess needs a note');
select is((pos_rpc.admin_envelope_reprocess('a0000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000001', 'definition fixed') ->> 'state'),
          'received', 'reprocess reopens the envelope');
select ok(exists (select 1 from pos_rpc.reprocess_candidates(100) where envelope_id = 'ee000000-0000-0000-0000-000000000001') or
          (select received_at > now() - interval '2 minutes' from pos.ingest_envelopes where id = 'ee000000-0000-0000-0000-000000000001'),
          'reopened envelope is picked up by the reprocessor');
select is((select payload_hash from pos.ingest_envelopes where id = 'ee000000-0000-0000-0000-000000000001'), repeat('a', 64), 'landed data untouched');
select ok(exists (select 1 from pos.custody_events where subject_id = 'ee000000-0000-0000-0000-000000000001' and event = 'reprocess_requested'), 'custody: reprocess requested');
select is(pg_temp.err($$select pos_rpc.admin_envelope_resolve('a0000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000001', 'resolved', 'x', null, null)$$),
          'POS:CONFLICT', 'a received envelope is not resolved');
select is(pg_temp.err($$select pos_rpc.admin_envelope_resolve('a0000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000002', 'attached', 'x', null, null)$$),
          'POS:INVALID_REQUEST', 'attach needs a job');
select is((pos_rpc.admin_envelope_resolve('a0000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000002', 'attached', 'belongs to A',
          (select id from ids where name = 'jA'), null) ->> 'resolution'), 'attached', 'attached to a job');
select ok(exists (select 1 from pos.job_events where job_id = (select id from ids where name = 'jA') and type = 'envelope_attached'), 'attachment on the job timeline');
select is((select state::text from pos.ingest_envelopes where id = 'ee000000-0000-0000-0000-000000000002'), 'conflict', 'state unchanged by resolution');

-- ── Alerts ────────────────────────────────────────────────────────────────────────────────────
insert into ids select 'alA', pos_rpc.alert('t', 'warning', 'bank A', null, null, '10000000-0000-0000-0000-00000000000a', '{}', 'tA');
insert into ids select 'alB', pos_rpc.alert('t', 'warning', 'bank B', null, null, '10000000-0000-0000-0000-00000000000b', '{}', 'tB');
insert into ids select 'alG', pos_rpc.alert('t', 'warning', 'global', null, null, null, '{}', 'tG');
select is(pos_rpc.admin_alerts_ack('a0000000-0000-0000-0000-000000000002', array(select id from ids where name like 'al%')), 1, 'bank-scoped admin acknowledges only its bank''s alerts');
select is(pos_rpc.admin_alerts_ack('a0000000-0000-0000-0000-000000000001', array(select id from ids where name like 'al%')), 2, 'global admin acknowledges the rest');

-- ── Sessions & devices ────────────────────────────────────────────────────────────────────────
select is(pg_temp.err($$select pos_rpc.admin_session_revoke('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003', 'x')$$),
          'POS:FORBIDDEN', 'cannot revoke sessions of users outside scope');
select is(pos_rpc.admin_session_revoke('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'lost phone'), 2,
          'revoking a session revokes its whole rotation family');
select is((pos_rpc.admin_device_revoke('a0000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', 'stolen') ->> 'revoke_reason'),
          'stolen', 'device revoked');
select is(pg_temp.err($$select pos_rpc.admin_device_revoke('a0000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', 'again')$$),
          'POS:CONFLICT', 'already revoked');
select ok((pos_rpc.admin_device_restore('a0000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', 'recovered') ->> 'revoked_at') is null,
          'device restored');

-- ── Exports & epoch ──────────────────────────────────────────────────────────────────────────
select is(pg_temp.err($$select pos_rpc.admin_export_request('a0000000-0000-0000-0000-000000000002', 'csv', '{}', null)$$),
          'POS:VALIDATION_FAILED', 'bank-scoped admin must choose a bank');
select is(pg_temp.err($$select pos_rpc.admin_export_request('a0000000-0000-0000-0000-000000000002', 'csv', '{"bank_id":"10000000-0000-0000-0000-00000000000b"}', null)$$),
          'POS:FORBIDDEN', 'export of another bank refused');
select is((pos_rpc.admin_export_request('a0000000-0000-0000-0000-000000000002', 'billing_csv', '{"bank_id":"10000000-0000-0000-0000-00000000000a"}', null) ->> 'status'),
          'queued', 'export queued');
select ok((select count(*) > 0 from pgmq.q_export), 'export message enqueued in the same transaction');
select is(pg_temp.err($$select pos_rpc.admin_server_epoch_rotate('a0000000-0000-0000-0000-000000000002', 'restore')$$), 'POS:FORBIDDEN', 'epoch rotation needs a global admin');
insert into ids select 'epoch', epoch from pos.server_epoch;
select isnt((pos_rpc.admin_server_epoch_rotate('a0000000-0000-0000-0000-000000000001', 'PITR restore drill') ->> 'epoch')::uuid,
            (select id from ids where name = 'epoch'), 'epoch rotated');

-- ── Evidence URL scope check ─────────────────────────────────────────────────────────────────
insert into pos.inspections (id, job_id, attempt, user_id, device_id, status)
values ('e1000000-0000-0000-0000-00000000000b', (select id from ids where name = 'jB'), 1, 'b0000000-0000-0000-0000-000000000002',
        'd0000000-0000-0000-0000-000000000002', 'in_progress');
insert into pos.evidence (id, inspection_id, job_id, type, sha256_client, storage_path, upload_state)
values ('e2000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', (select id from ids where name = 'jB'), 'photo',
        repeat('c', 64), 'bank/b/job/x/inspection/y/e.jpg', 'pending');
select is(pg_temp.err($$select pos_rpc.admin_evidence_for_url('a0000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-00000000000b')$$),
          'POS:NOT_FOUND', 'no URL before upload');
update pos.evidence set upload_state = 'uploaded' where id = 'e2000000-0000-0000-0000-00000000000b';
select is((pos_rpc.admin_evidence_for_url('a0000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-00000000000b') ->> 'storage_path'),
          'bank/b/job/x/inspection/y/e.jpg', 'global admin gets the path');
select is(pg_temp.err($$select pos_rpc.admin_evidence_for_url('a0000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-00000000000b')$$),
          'POS:FORBIDDEN', 'evidence of another bank refused');

-- ── Read RPCs under RLS (allow + deny) ───────────────────────────────────────────────────────
-- expected counts taken before switching role (the local DB may hold other data besides these fixtures)
create temp table expected as
  select count(*) filter (where status = 'pending')::int as all_pending,
         count(*) filter (where status = 'pending' and bank_id = '10000000-0000-0000-0000-00000000000a')::int as bank_a_pending
    from pos.jobs;
grant select on expected to public;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000001","aal":"aal2","role":"authenticated"}', true);
select is((pos.admin_dashboard() #>> '{jobs_by_status,pending}')::int, (select all_pending from expected), 'global admin (aal2) sees every bank''s jobs');
select ok((pos.admin_job_form_context('10000000-0000-0000-0000-00000000000a') -> 'location_types') is not null, 'job form context readable');
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000002","aal":"aal2","role":"authenticated"}', true);
select is((pos.admin_dashboard() #>> '{jobs_by_status,pending}')::int, (select bank_a_pending from expected), 'bank-scoped admin sees only its bank');
-- admin.require_mfa both ways (off since D-96): on, a password-only (aal1) session sees nothing; off, it is an admin.
set local role postgres;
update pos.settings set value = 'true'::jsonb where key = 'admin.require_mfa';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000001","aal":"aal1","role":"authenticated"}', true);
select is(pos.admin_dashboard() -> 'jobs_by_status', '{}'::jsonb, 'with admin.require_mfa on, an admin without a second step (aal1) sees nothing');
set local role postgres;
update pos.settings set value = 'false'::jsonb where key = 'admin.require_mfa';
set local role authenticated;
select is((pos.admin_dashboard() #>> '{jobs_by_status,pending}')::int, (select all_pending from expected),
          'with admin.require_mfa off (D-96), a password-only admin sees the dashboard');
select set_config('request.jwt.claims', '{"token_use":"pos_access","pos_user_id":"b0000000-0000-0000-0000-000000000001","pos_role":"pos_agent","scope":"full","role":"authenticated"}', true);
select is(pos.admin_dashboard() -> 'jobs_by_status', '{}'::jsonb, 'an agent sees no admin dashboard data');
select is((select count(*)::int from pos.admin_agent_load(current_date - 1, current_date + 30)), 0, 'agent sees no load data');
set local role postgres;
select set_config('request.jwt.claims', '', true);

-- ── Bootstrap ────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err($$select pos_rpc.admin_bootstrap('ADM-9', 'X', 'Y', 'x@example.test', null)$$), 'POS:FORBIDDEN', 'bootstrap refused once an admin exists');

select * from finish();
rollback;
