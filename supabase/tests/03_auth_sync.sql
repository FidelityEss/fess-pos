-- Module sessions (D-32, docs/07 §2), sync prepare/read (docs/08 §2), config resolution, public verify.
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select no_plan();

insert into pos.banks (id, code, name) values ('b0000000-0000-0000-0000-000000000001', 'TBANKA', 'Test Bank A');
insert into pos.pos_users (id, employee_number, first_name, last_name, role) values
  ('d0000000-0000-0000-0000-000000000001', 'TG001', 'Gugu', 'Agent', 'pos_agent'),
  ('d0000000-0000-0000-0000-000000000002', 'TG002', 'Thabo', 'Agent', 'pos_agent');
-- (seed/10_reference.sql already provides both, pos_dev active and fess_auth_api inactive; kept for a seedless DB)
insert into pos.trusted_issuers (key, type, title, active, primary_issuer) values ('pos_dev', 'dev_stub', 'Stand-in', true, true)
on conflict (key) do nothing;
insert into pos.trusted_issuers (key, type, title, active, primary_issuer) values ('fess_auth_api', 'introspection', 'FESS', false, true)
on conflict (key) do nothing;
insert into pos.jobs (id, bank_id, merchant_name, address) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Spaza One', '{"line1": "1 Main Rd"}');
update pos.jobs set status = 'scheduled', scheduled_start = now() + interval '1 hour', scheduled_end = now() + interval '3 hours'
 where id = 'e0000000-0000-0000-0000-000000000001';
update pos.jobs set status = 'assigned', assigned_to = 'd0000000-0000-0000-0000-000000000001', assigned_at = now()
 where id = 'e0000000-0000-0000-0000-000000000001';
insert into pos.job_assignments (job_id, user_id) values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001');

-- ── exchange ───────────────────────────────────────────────────────────────────────────────────
create temp table t_ex as
  select pos_rpc.auth_exchange('pos_dev', 'dev:TG001', 'TG001', '{"first_name": "Gugu"}',
                               '{"device_id": "f0000000-0000-0000-0000-000000000001", "model": "Tecno"}',
                               '{"employee_number": "TG001", "first_name": "Gugu"}', 'refresh-hash-1') as r;
select ok((select r ->> 'session_id' from t_ex) is not null, 'exchange by the issuer-verified employee number creates a session');
select is((select r ->> 'scope' from t_ex), 'full', 'new sessions are full scope');
select is((select linked_via::text from pos.external_identities where subject = 'dev:TG001'), 'issuer_lookup', 'identity link recorded');
select is((select count(*) from pos.devices where device_id = 'f0000000-0000-0000-0000-000000000001'), 1::bigint, 'device registered');

select is(pos_rpc.auth_exchange('pos_dev', 'dev:TG001', 'SOMEONE-ELSE', '{}', '{"device_id": "f0000000-0000-0000-0000-000000000001"}',
                                '{"employee_number": "TG999"}', 'refresh-hash-x') #>> '{user,employee_number}',
          'TG001', 'an existing link wins over any claimed employee number; host profile never authorises');
select isnt_empty($$select 1 from pos.auth_events where event = 'exchange' and profile_mismatch ? 'employee_number'$$,
                  'profile mismatch with the verified identity is flagged');

select is(pos_rpc.auth_exchange('pos_dev', 'dev:NOPE', 'NOPE', '{}', '{"device_id": "f0000000-0000-0000-0000-000000000005"}', null, 'h5')
            #>> '{error,code}', 'UNKNOWN_IDENTITY', 'unknown identity is refused');
select isnt_empty($$select 1 from pos.auth_events where event = 'link_request'$$, 'a link request is recorded for admins');
select throws_ok($$select pos_rpc.auth_exchange('fess_auth_api', 's', 'TG001', '{}', '{"device_id": "f0000000-0000-0000-0000-000000000001"}', null, 'h6')$$,
                 'P0001', null, 'an inactive issuer is refused (FESS issuers stay inactive until configured by humans)');

-- ── refresh rotation and reuse detection ───────────────────────────────────────────────────────
create temp table t_rf as select pos_rpc.auth_refresh('refresh-hash-1', 'refresh-hash-2', 'f0000000-0000-0000-0000-000000000001') as r;
select isnt((select r ->> 'session_id' from t_rf), (select r ->> 'session_id' from t_ex), 'refresh issues a new session row');
select ok((select rotated_at is not null from pos.pos_sessions where refresh_token_hash = 'refresh-hash-1'), 'old refresh token marked rotated');
select throws_ok($$select pos_rpc.auth_refresh('refresh-hash-2', 'refresh-hash-3', 'f0000000-0000-0000-0000-000000000002')$$,
                 'P0001', null, 'refresh is device-bound');
select is(pos_rpc.auth_refresh('refresh-hash-1', 'refresh-hash-4', 'f0000000-0000-0000-0000-000000000001') #>> '{error,code}',
          'SESSION_REVOKED', 'presenting a rotated refresh token is reuse');
select is((select count(*) from pos.pos_sessions s
            where s.family_id = (select (r ->> 'family_id')::uuid from t_ex) and s.revoked_at is null), 0::bigint,
          'reuse revokes the whole session family');
select isnt_empty($$select 1 from pos.alerts where kind = 'refresh_reuse'$$, 'reuse raises an alert');

-- ── deactivation downgrades to ingest_only (D-35); sign-out likewise ───────────────────────────
create temp table t_ex2 as
  select pos_rpc.auth_exchange('pos_dev', 'dev:TG001', 'TG001', '{}', '{"device_id": "f0000000-0000-0000-0000-000000000001"}', null, 'rh-a') as r;
update pos.pos_users set active = false where id = 'd0000000-0000-0000-0000-000000000001';
select is(pos_rpc.auth_refresh('rh-a', 'rh-b', 'f0000000-0000-0000-0000-000000000001') ->> 'scope', 'ingest_only',
          'a deactivated agent keeps uploading under ingest_only');
select is(pos_rpc.auth_exchange('pos_dev', 'dev:TG001', 'TG001', '{}', '{"device_id": "f0000000-0000-0000-0000-000000000001"}', null, 'rh-c')
            #>> '{error,code}', 'ACCOUNT_INACTIVE', 'a deactivated agent cannot start a new session');
update pos.pos_users set active = true where id = 'd0000000-0000-0000-0000-000000000001';
select is(pos_rpc.auth_signout((select id from pos.pos_sessions where refresh_token_hash = 'rh-b')) ->> 'scope', 'ingest_only',
          'sign-out drops the family to ingest_only');
select is(pos_rpc.auth_session_state((select id from pos.pos_sessions where refresh_token_hash = 'rh-b')) ->> 'scope', 'ingest_only',
          'session state reports the downgrade');

-- ── sync prepare: per-device secrets, handed out once ──────────────────────────────────────────
create temp table t_p1 as
  select pos_rpc.sync_prepare('d0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', '{}', false, '{}') as r;
select is(jsonb_array_length((select r -> 'session_tokens' from t_p1)), 1, 'a session token is issued for the assigned job');
select ok((select r #>> '{agent_card,token}' from t_p1) is not null, 'an agent-card token is issued');
select is(jsonb_array_length((select r -> 'job_cards' from t_p1)), 1, 'a job-card token is issued');
select ok(exists (select 1 from pos.session_tokens where job_id = 'e0000000-0000-0000-0000-000000000001'
                   and token_hash = pos.sha256_hex((select r #>> '{session_tokens,0,token}' from t_p1))),
          'only the token hash is stored');
select is(jsonb_array_length(pos_rpc.sync_prepare('d0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
            array['e0000000-0000-0000-0000-000000000001']::uuid[], true, array['e0000000-0000-0000-0000-000000000001']::uuid[]) -> 'session_tokens'),
          0, 'no new token when the device already holds one');
select is(jsonb_array_length(pos_rpc.sync_prepare('d0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
            '{}', true, array['e0000000-0000-0000-0000-000000000001']::uuid[]) -> 'session_tokens'),
          1, 'a device that lost its token gets a new one');
select is((select count(*) from pos.session_tokens where revoke_reason = 'reissued' and job_id = 'e0000000-0000-0000-0000-000000000001'),
          1::bigint, 'the lost token is revoked');

-- ── sync read under RLS ────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', jsonb_build_object('sub', 'd0000000-0000-0000-0000-000000000001', 'role', 'authenticated',
  'token_use', 'pos_access', 'pos_user_id', 'd0000000-0000-0000-0000-000000000001', 'pos_role', 'pos_agent', 'scope', 'full')::text, true);
set local role authenticated;
create temp table t_read as select pos.sync_read('{}', '{}', 50) as r;
select is(jsonb_array_length((select r #> '{jobs,items}' from t_read)), 1, 'pull returns the agent''s job');
select is((select r #>> '{jobs,items,0,assigned_to_me}' from t_read), 'true', 'job marked as assigned to me');
select is((select r #>> '{jobs,items,0,bank,code}' from t_read), 'TBANKA', 'job carries its bank');
select ok((select r ->> 'server_epoch' from t_read) is not null, 'pull carries the server epoch');
select is((select r #>> '{agent_totals,active}' from t_read), '1', 'agent totals count the active job');
select is(jsonb_array_length(pos.sync_read(jsonb_build_object('jobs', (select r #>> '{jobs,next_cursor}' from t_read)), '{}', 50) #> '{jobs,items}'),
          0, 'the jobs cursor advances');
set local role postgres;
select set_config('request.jwt.claims', jsonb_build_object('sub', 'd0000000-0000-0000-0000-000000000001', 'role', 'authenticated',
  'token_use', 'pos_access', 'pos_user_id', 'd0000000-0000-0000-0000-000000000001', 'pos_role', 'pos_agent', 'scope', 'ingest_only')::text, true);
set local role authenticated;
select throws_ok($$select pos.sync_read('{}', '{}', 50)$$, 'P0001', null, 'ingest_only sessions cannot pull');
set local role postgres;

-- ── remote config resolution (docs/13 §5) ──────────────────────────────────────────────────────
-- a new global version on top of whatever the seed published (the latest version of each layer is the one in force)
insert into pos.remote_config_versions (layer, subject_id, version, values, schema_version, reason)
select 'global', null, coalesce(max(version), 0) + 1, '{"a": 1, "b": {"c": 1}}', '1.0', 'test'
  from pos.remote_config_versions where layer = 'global';
insert into pos.remote_config_versions (layer, subject_id, version, values, schema_version, reason) values
  ('agent', 'd0000000-0000-0000-0000-000000000001', 1, '{"b": {"d": 2}}', '1.0', 'test');
select is(pos_rpc.resolve_config('d0000000-0000-0000-0000-000000000001', null, null) -> 'values', '{"a": 1, "b": {"c": 1, "d": 2}}'::jsonb,
          'layers deep-merge, most specific wins');
select is(pos_rpc.resolve_config('d0000000-0000-0000-0000-000000000001', null, null) ->> 'config_version_id',
          pos_rpc.resolve_config('d0000000-0000-0000-0000-000000000001', null, null) ->> 'config_version_id',
          'identical resolved config reuses one snapshot id');

-- ── public verification (docs/07 §10) ──────────────────────────────────────────────────────────
select is(pos_rpc.public_verify(pos.sha256_hex((select r #>> '{agent_card,token}' from t_p1))) ->> 'status', 'valid', 'agent card verifies');
select is(pos_rpc.public_verify(pos.sha256_hex((select r #>> '{agent_card,token}' from t_p1))) #>> '{agent,employee_number_masked}', '••001',
          'employee number is masked');
select is(pos_rpc.public_verify(pos.sha256_hex('not-a-token')) ->> 'status', 'invalid', 'unknown token is invalid');
select is(pos_rpc.public_verify(pos.sha256_hex((select r #>> '{job_cards,0,token}' from t_p1))) #>> '{job,reference}',
          (select reference from pos.jobs where id = 'e0000000-0000-0000-0000-000000000001'), 'job card shows the job reference');
update pos.pos_users set active = false where id = 'd0000000-0000-0000-0000-000000000001';
select is(pos_rpc.public_verify(pos.sha256_hex((select r #>> '{agent_card,token}' from t_p1))) ->> 'status', 'invalid',
          'deactivating the agent invalidates their card immediately');

select * from finish();
rollback;
