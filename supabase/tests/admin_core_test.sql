-- pgTAP: admin core functions (20260911102000) — grants, actor re-checks, bank scope, users & deactivation, reference
-- data, remote config + four-eyes, definitions publish/activate, approvals. Allow AND deny cases (DEVELOPMENT-GUIDELINES §3).
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select plan(63);

-- Returns 'OK' or the POS error code ('POS:FORBIDDEN', …) / SQLSTATE raised by a statement (rolled back on error).
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
insert into pos.banks (id, code, name) values
  ('10000000-0000-0000-0000-00000000000a', 'BANKA', 'Bank A'),
  ('10000000-0000-0000-0000-00000000000b', 'BANKB', 'Bank B');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, bank_ids, active) values
  ('a0000000-0000-0000-0000-000000000001', 'ADM-1', 'Gina', 'Global', 'pos_admin', array['approve_definitions', 'review_inspections', 'schedule_jobs'], null, true),
  ('a0000000-0000-0000-0000-000000000002', 'ADM-2', 'Ben', 'Banka', 'pos_admin', '{}', array['10000000-0000-0000-0000-00000000000a']::uuid[], true),
  ('a0000000-0000-0000-0000-000000000003', 'ADM-3', 'Ann', 'Approver', 'pos_admin', array['approve_definitions'], null, true),
  ('a0000000-0000-0000-0000-000000000004', 'ADM-4', 'Ivy', 'Inactive', 'pos_admin', '{}', null, false),
  ('a0000000-0000-0000-0000-000000000005', 'ADM-5', 'Nora', 'Noperm', 'pos_admin', '{}', null, true),
  ('b0000000-0000-0000-0000-000000000001', 'AG-1', 'Ada', 'Agent', 'pos_agent', '{}', array['10000000-0000-0000-0000-00000000000a']::uuid[], true);
insert into pos.pos_sessions (id, user_id, device_id, issuer_key, family_id, refresh_token_hash, scope, expires_at) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'pos_dev',
   'c0000000-0000-0000-0000-000000000001', 'hash-1', 'full', now() + interval '10 days');
select pos_rpc.set_context('a0000000-0000-0000-0000-000000000001', 'pos_admin', 'pgtap-admin-core');

-- ── Grants: no client role may reach pos_rpc ─────────────────────────────────────────────────
select ok(not has_schema_privilege('authenticated', 'pos_rpc', 'usage'), 'authenticated has no USAGE on pos_rpc');
select ok(not has_schema_privilege('anon', 'pos_rpc', 'usage'), 'anon has no USAGE on pos_rpc');
select ok(has_schema_privilege('service_role', 'pos_rpc', 'usage'), 'service_role has USAGE on pos_rpc');
set local role authenticated;
select is(pg_temp.err($$select pos_rpc.admin_bank_create('a0000000-0000-0000-0000-000000000001', '{"code":"XX","name":"x"}')$$),
          '42501', 'authenticated cannot execute admin functions');
set local role postgres;
set local role anon;
select is(pg_temp.err($$select pos_rpc.admin_user_create('a0000000-0000-0000-0000-000000000001', '{}')$$), '42501', 'anon cannot execute admin functions');
set local role postgres;

-- ── Actor re-check ────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err($$select pos_rpc.admin_bank_create('b0000000-0000-0000-0000-000000000001', '{"code":"AGX","name":"x"}')$$),
          'POS:FORBIDDEN', 'an agent actor is refused');
select is(pg_temp.err($$select pos_rpc.admin_bank_create('a0000000-0000-0000-0000-000000000004', '{"code":"INX","name":"x"}')$$),
          'POS:FORBIDDEN', 'an inactive admin is refused');
select is(pg_temp.err($$select pos_rpc.admin_bank_create('a0000000-0000-0000-0000-00000000ffff', '{"code":"UNX","name":"x"}')$$),
          'POS:FORBIDDEN', 'an unknown actor is refused');

-- ── Banks ────────────────────────────────────────────────────────────────────────────────────
select is((pos_rpc.admin_bank_create('a0000000-0000-0000-0000-000000000001', '{"code":"bankc","name":"Bank C","four_eyes_enabled":true}') ->> 'code'),
          'BANKC', 'global admin creates a bank (code upper-cased)');
select is(pg_temp.err($$select pos_rpc.admin_bank_create('a0000000-0000-0000-0000-000000000001', '{"code":"BANKC","name":"dup"}')$$),
          'POS:ALREADY_EXISTS', 'duplicate bank code');
select is(pg_temp.err($$select pos_rpc.admin_bank_create('a0000000-0000-0000-0000-000000000002', '{"code":"BANKD","name":"x"}')$$),
          'POS:FORBIDDEN', 'bank-scoped admin cannot create banks');
select is((pos_rpc.admin_bank_update('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', '{"name":"Bank A Ltd"}') ->> 'name'),
          'Bank A Ltd', 'bank-scoped admin updates own bank');
select is(pg_temp.err($$select pos_rpc.admin_bank_update('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b', '{"name":"x"}')$$),
          'POS:FORBIDDEN', 'bank-scoped admin cannot update another bank');
select is(pg_temp.err($$select pos_rpc.admin_bank_update('a0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-00000000000a', '{"four_eyes_enabled":true}')$$),
          'POS:FORBIDDEN', 'four-eyes switch needs approve_definitions');
select is((pos_rpc.admin_bank_update('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000b', '{"billing_settings":{"appointment_not_secured":{"default":true}}}') #>> '{billing_settings,appointment_not_secured,default}'),
          'true', 'billing settings saved');

-- ── Users ────────────────────────────────────────────────────────────────────────────────────
select is((pos_rpc.admin_user_create('a0000000-0000-0000-0000-000000000002',
            '{"employee_number":"AG-2","first_name":"Bo","last_name":"Two","role":"pos_agent","bank_ids":["10000000-0000-0000-0000-00000000000a"]}') ->> 'role'),
          'pos_agent', 'bank-scoped admin creates an agent in its bank');
select is(pg_temp.err($$select pos_rpc.admin_user_create('a0000000-0000-0000-0000-000000000002',
            '{"employee_number":"AG-3","first_name":"C","last_name":"X","role":"pos_agent","bank_ids":["10000000-0000-0000-0000-00000000000b"]}')$$),
          'POS:FORBIDDEN', 'bank-scoped admin cannot create users in another bank');
select is(pg_temp.err($$select pos_rpc.admin_user_create('a0000000-0000-0000-0000-000000000002',
            '{"employee_number":"ADM-9","first_name":"C","last_name":"X","role":"pos_admin","bank_ids":["10000000-0000-0000-0000-00000000000a"]}')$$),
          'POS:FORBIDDEN', 'bank-scoped admin cannot create admins');
select is(pg_temp.err($$select pos_rpc.admin_user_create('a0000000-0000-0000-0000-000000000001',
            '{"employee_number":"AG-1","first_name":"C","last_name":"X","role":"pos_agent"}')$$),
          'POS:ALREADY_EXISTS', 'duplicate employee number');
select is(pg_temp.err($$select pos_rpc.admin_user_create('a0000000-0000-0000-0000-000000000001',
            '{"employee_number":"AG-4","first_name":"C","last_name":"X","role":"pos_agent","permissions":["review_inspections"]}')$$),
          'POS:INVALID_REQUEST', 'agents cannot hold permissions');
select is(pg_temp.err($$select pos_rpc.admin_user_create('a0000000-0000-0000-0000-000000000001',
            '{"employee_number":"RD-1","first_name":"C","last_name":"X","role":"pos_bank_reader"}')$$),
          'POS:INVALID_REQUEST', 'a bank reader needs a bank');
select is(pg_temp.err($$select pos_rpc.admin_user_update('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '{"permissions":[]}')$$),
          'POS:FORBIDDEN', 'admins cannot change their own permissions');
select is((pos_rpc.admin_user_update('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '{"attributes":{"region":"GP"}}') #>> '{attributes,region}'),
          'GP', 'attributes updated');

select is(pg_temp.err($$select pos_rpc.admin_user_deactivate('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'ingest_only', '')$$),
          'POS:NOTE_REQUIRED', 'deactivation needs a reason');
select is((pos_rpc.admin_user_deactivate('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'ingest_only', 'left the company') ->> 'sessions_affected')::int,
          1, 'ingest_only deactivation downgrades the live session');
select is((select scope::text from pos.pos_sessions where id = 'c0000000-0000-0000-0000-000000000001'), 'ingest_only', 'session scope is ingest_only');
select ok((select revoked_at is null from pos.pos_sessions where id = 'c0000000-0000-0000-0000-000000000001'), 'ingest_only keeps the session (uploads continue)');
select is((pos_rpc.admin_user_deactivate('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'hard_revoke', 'stolen device') ->> 'mode'),
          'hard_revoke', 'hard revoke applied');
select ok((select revoked_at is not null from pos.pos_sessions where id = 'c0000000-0000-0000-0000-000000000001'), 'hard revoke revokes every session');
select ok(exists (select 1 from pos.auth_events where user_id = 'b0000000-0000-0000-0000-000000000001' and event = 'revoke'), 'hard revoke is recorded in auth_events');
select is(pg_temp.err($$select pos_rpc.admin_user_deactivate('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ingest_only', 'x')$$),
          'POS:FORBIDDEN', 'admins cannot deactivate themselves');
select is((pos_rpc.admin_user_reactivate('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'back') ->> 'active')::boolean,
          true, 'reactivation');
-- (row_id / before / after are not asserted: see the report on pos.tg_audit with zero trigger arguments)
select ok(exists (select 1 from pos.audit_log where table_name = 'pos_users' and action = 'UPDATE'
                   and actor_id = 'a0000000-0000-0000-0000-000000000001' and request_id = 'pgtap-admin-core'), 'user changes are audited with the actor');

-- ── Reason codes, MCC, lookup lists, declarations ────────────────────────────────────────────
select is((pos_rpc.admin_reason_create('a0000000-0000-0000-0000-000000000001', '{"category":"cancel","code":"zz_duplicate","label":"Duplicate"}') ->> 'code'),
          'zz_duplicate', 'global reason code created');
select is(pg_temp.err($$select pos_rpc.admin_reason_create('a0000000-0000-0000-0000-000000000002', '{"category":"cancel","code":"zz_other","label":"Other"}')$$),
          'POS:FORBIDDEN', 'bank-scoped admin cannot create global reason codes');
select is((pos_rpc.admin_reason_create('a0000000-0000-0000-0000-000000000002', '{"category":"cancel","code":"zz_other","label":"Other","bank_id":"10000000-0000-0000-0000-00000000000a"}') ->> 'bank_id'),
          '10000000-0000-0000-0000-00000000000a', 'bank-scoped admin creates a bank reason code');
select is(pg_temp.err($$select pos_rpc.admin_reason_create('a0000000-0000-0000-0000-000000000001', '{"category":"nope","code":"x1","label":"x"}')$$),
          'POS:INVALID_REQUEST', 'unknown reason category');
select is((pos_rpc.admin_mcc_create('a0000000-0000-0000-0000-000000000001', '{"code":"0001","description":"Test category"}') ->> 'risk_tier'),
          'standard', 'MCC created with default risk tier');
select is(pg_temp.err($$select pos_rpc.admin_mcc_create('a0000000-0000-0000-0000-000000000001', '{"code":"54","description":"bad"}')$$),
          'POS:INVALID_REQUEST', 'MCC code format enforced');

select is((pos_rpc.admin_lookup_list_create('a0000000-0000-0000-0000-000000000001', '{"key":"zz_provinces","title":"Provinces"}') ->> 'scope'),
          'global', 'global lookup list created');
select is((pos_rpc.admin_lookup_list_publish('a0000000-0000-0000-0000-000000000001', (select id from pos.lookup_lists where key = 'zz_provinces'),
            '[{"value":"GP","label":"Gauteng"}]', repeat('a', 64)) ->> 'version')::int, 1, 'lookup list v1');
select is((pos_rpc.admin_lookup_list_publish('a0000000-0000-0000-0000-000000000001', (select id from pos.lookup_lists where key = 'zz_provinces'),
            '[{"value":"GP","label":"Gauteng"},{"value":"WC","label":"Western Cape"}]', repeat('b', 64)) ->> 'version')::int, 2, 'lookup list v2');
select is(pg_temp.err($$select pos_rpc.admin_lookup_list_publish('a0000000-0000-0000-0000-000000000001', (select id from pos.lookup_lists where key = 'zz_provinces'),
            '[{"value":"GP","label":"a"},{"value":"GP","label":"b"}]', repeat('c', 64))$$), 'POS:VALIDATION_FAILED', 'duplicate item values refused');
select is((pos_rpc.admin_declaration_publish('a0000000-0000-0000-0000-000000000001', 'zz_declaration', 'Declaration', 'I declare.') ->> 'version')::int,
          1, 'declaration v1');
select is((pos_rpc.admin_declaration_publish('a0000000-0000-0000-0000-000000000001', 'zz_declaration', 'Declaration', 'I solemnly declare.') ->> 'hash'),
          pos.sha256_hex('I solemnly declare.'), 'declaration v2 hash = sha256(text)');

-- ── Remote config & four-eyes ────────────────────────────────────────────────────────────────
select is((pos_rpc.admin_config_publish('a0000000-0000-0000-0000-000000000001', 'global', null,
            '{"geofence":{"default_profile":"standalone"}}', '1.0', 'initial', null, array['geofence.default_profile']) ->> 'status'),
          'published', 'global config published without four-eyes');
select is(pg_temp.err($$select pos_rpc.admin_config_publish('a0000000-0000-0000-0000-000000000001', 'global', null,
            '{"geofence":{"default_profile":"standalone"}}', '1.0', 'same', null, '{}')$$), 'POS:CONFLICT', 'unchanged config refused');
select is(pg_temp.err($$select pos_rpc.admin_config_publish('a0000000-0000-0000-0000-000000000001', 'global', null, '{"a":1}', '1.0', '', null, '{}')$$),
          'POS:NOTE_REQUIRED', 'config change needs a reason');
select is(pg_temp.err($$select pos_rpc.admin_config_publish('a0000000-0000-0000-0000-000000000002', 'global', null, '{"a":1}', '1.0', 'x', null, '{}')$$),
          'POS:FORBIDDEN', 'bank-scoped admin cannot change global config');
-- bank C has four-eyes on: an integrity-relevant change becomes an approval request
select is((pos_rpc.admin_config_publish('a0000000-0000-0000-0000-000000000001', 'bank', (select id from pos.banks where code = 'BANKC'),
            '{"integrity":{"block_on_mock":false}}', '1.0', 'pilot', null, array['integrity.block_on_mock']) ->> 'status'),
          'approval_required', 'integrity-relevant change on a four-eyes bank needs approval');
select is(pg_temp.err(format($$select pos_rpc.admin_approval_decide('a0000000-0000-0000-0000-000000000001', %L, 'approved', null)$$,
            (select id from pos.approvals where subject_type = 'remote_config' and decision = 'pending' and requested_by = 'a0000000-0000-0000-0000-000000000001'))), 'POS:FORBIDDEN', 'requester cannot approve own request');
select is(pg_temp.err(format($$select pos_rpc.admin_approval_decide('a0000000-0000-0000-0000-000000000005', %L, 'approved', null)$$,
            (select id from pos.approvals where subject_type = 'remote_config' and decision = 'pending' and requested_by = 'a0000000-0000-0000-0000-000000000001'))), 'POS:FORBIDDEN', 'approver needs approve_definitions');
select ok((pos_rpc.admin_approval_decide('a0000000-0000-0000-0000-000000000003',
            (select id from pos.approvals where subject_type = 'remote_config' and decision = 'pending' and requested_by = 'a0000000-0000-0000-0000-000000000001'), 'approved', 'ok') -> 'executed') is not null,
          'second admin approves and the version is written');
select is((select approved_by from pos.remote_config_versions where layer = 'bank' order by created_at desc limit 1),
          'a0000000-0000-0000-0000-000000000003'::uuid, 'config version records the approver');
select is(pg_temp.err(format($$select pos_rpc.admin_approval_decide('a0000000-0000-0000-0000-000000000003', %L, 'approved', null)$$,
            (select request_ref from pos.approvals where subject_type = 'remote_config' and decision = 'approved' and requested_by = 'a0000000-0000-0000-0000-000000000001'))), 'POS:CONFLICT', 'a request is decided once');

-- ── Definitions ──────────────────────────────────────────────────────────────────────────────
select is((pos_rpc.admin_definition_family_create('a0000000-0000-0000-0000-000000000001', '{"kind":"content","key":"agent_copy","title":"Agent copy"}') ->> 'scope'),
          'global', 'global family created');
select is(pg_temp.err(format($$select pos_rpc.admin_definition_publish('a0000000-0000-0000-0000-000000000001', %L,
            '{"definition":{"kind":"content","spec_version":"1.0"},"definition_hash":"%s","spec_version":"1.0","analysis":{"ok":false},"test_run":{"passed":true}}')$$,
            (select id from pos.definition_families where key = 'agent_copy'), repeat('1', 64))), 'POS:VALIDATION_FAILED', 'failed analysis cannot be published');
select is((pos_rpc.admin_definition_publish('a0000000-0000-0000-0000-000000000001', (select id from pos.definition_families where key = 'agent_copy'),
            jsonb_build_object('definition', '{"kind":"content","spec_version":"1.0","strings":{"a":"b"}}'::jsonb, 'definition_hash', repeat('2', 64),
                               'spec_version', '1.0', 'analysis', '{"ok":true}'::jsonb, 'test_run', '{"passed":true,"results":[]}'::jsonb)) #>> '{version,version}')::int,
          1, 'definition v1 published (global four-eyes off)');
select ok(exists (select 1 from pos.definition_test_runs r join pos.definition_versions v on v.id = r.version_id
                   join pos.definition_families f on f.id = v.family_id where f.key = 'agent_copy'), 'publish records a test run');
select is(pg_temp.err(format($$select pos_rpc.admin_definition_publish('a0000000-0000-0000-0000-000000000001', %L,
            jsonb_build_object('definition', '{"kind":"content","spec_version":"1.0","strings":{"a":"b"}}'::jsonb, 'definition_hash', %L,
                               'spec_version', '1.0', 'analysis', '{"ok":true}'::jsonb, 'test_run', '{"passed":true}'::jsonb, 'base_version_id', %L))$$,
            (select id from pos.definition_families where key = 'agent_copy'), repeat('2', 64),
            (select id from pos.definition_versions where definition_hash = repeat('2', 64)))), 'POS:CONFLICT', 'unchanged definition refused');
select is((pos_rpc.admin_definition_activate('a0000000-0000-0000-0000-000000000001', (select id from pos.definition_families where key = 'agent_copy'),
            (select id from pos.definition_versions where definition_hash = repeat('2', 64)), '{"type":"all"}', null, null, null, 'go live') ->> 'status'),
          'activated', 'activation written');
select is(pos.resolve_definition_version((select id from pos.definition_families where key = 'agent_copy'), 'b0000000-0000-0000-0000-000000000001'),
          (select id from pos.definition_versions where definition_hash = repeat('2', 64)), 'activated version resolves for an agent');
select is(pg_temp.err(format($$select pos_rpc.admin_definition_activate('a0000000-0000-0000-0000-000000000001', %L, %L, '{"type":"percent","percent":0}', null, null, null, 'x')$$,
            (select id from pos.definition_families where key = 'agent_copy'), (select id from pos.definition_versions where definition_hash = repeat('2', 64)))),
          'POS:VALIDATION_FAILED', 'invalid audience refused');

select * from finish();
rollback;
