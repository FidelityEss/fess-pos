-- pgTAP: admin read contexts (20260911102100) — job form context resolution (bank job_schema overrides global; location
-- types from merged global ⊕ bank config), chargeability fallback order (docs/06 §3, D-43), agent-layer four-eyes scope.
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select plan(10);

create temp table ids (name text primary key, id uuid);

insert into pos.banks (id, code, name, four_eyes_enabled, billing_settings) values
  ('10000000-0000-0000-0000-00000000000c', 'CTXA', 'Context A', false,
   '{"appointment_not_secured":{"default":false,"codes":{"zz_ctx_code":true}}}'),
  ('10000000-0000-0000-0000-00000000000d', 'CTXB', 'Context B', true, '{}');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, bank_ids) values
  ('a0000000-0000-0000-0000-0000000000c1', 'CTX-ADM', 'C', 'Admin', 'pos_admin', array['approve_definitions'], null),
  ('b0000000-0000-0000-0000-0000000000c1', 'CTX-AG', 'C', 'Agent', 'pos_agent', '{}', array['10000000-0000-0000-0000-00000000000d']::uuid[]);
select pos_rpc.set_context('a0000000-0000-0000-0000-0000000000c1', 'pos_admin', 'pgtap-admin-context');

-- bank-specific job schema for bank A, activated for everyone
insert into ids select 'fam', (pos_rpc.admin_definition_family_create('a0000000-0000-0000-0000-0000000000c1',
  '{"kind":"job_schema","key":"zz_ctx_attrs","title":"Bank A attributes","bank_id":"10000000-0000-0000-0000-00000000000c"}') ->> 'id')::uuid;
insert into ids select 'ver', (pos_rpc.admin_definition_publish('a0000000-0000-0000-0000-0000000000c1', (select id from ids where name = 'fam'),
  jsonb_build_object('definition', '{"kind":"job_schema","spec_version":"1.0","attributes":[{"key":"zz_branch","type":"text"}]}'::jsonb,
                     'definition_hash', repeat('d', 64), 'spec_version', '1.0', 'analysis', '{"ok":true}'::jsonb,
                     'test_run', '{"passed":true}'::jsonb)) #>> '{version,id}')::uuid;
select pos_rpc.admin_definition_activate('a0000000-0000-0000-0000-0000000000c1', (select id from ids where name = 'fam'),
  (select id from ids where name = 'ver'), '{"type":"all"}', null, null, null, 'bank schema');

select is((pos.admin_job_form_context('10000000-0000-0000-0000-00000000000c') #>> '{job_schema,version_id}')::uuid,
          (select id from ids where name = 'ver'), 'bank job schema overrides the global one');
select isnt((pos.admin_job_form_context('10000000-0000-0000-0000-00000000000d') #>> '{job_schema,version_id}')::uuid,
            (select id from ids where name = 'ver'), 'another bank does not see bank A''s schema');

-- bank-layer config adds a location type on top of the global profiles
select pos_rpc.admin_config_publish('a0000000-0000-0000-0000-0000000000c1', 'bank', '10000000-0000-0000-0000-00000000000c',
  '{"geofence":{"profiles":{"zz_kiosk":{"radius_m":40}}}}', '1.0', 'kiosks', null, '{}');
select ok((pos.admin_job_form_context('10000000-0000-0000-0000-00000000000c') -> 'location_types') ? 'zz_kiosk', 'bank-layer location type offered');
select ok(not ((pos.admin_job_form_context('10000000-0000-0000-0000-00000000000d') -> 'location_types') ? 'zz_kiosk'), 'not offered to other banks');
select ok((pos.config_merged('10000000-0000-0000-0000-00000000000c') #> '{geofence,profiles,zz_kiosk}') is not null
          and (pos.config_merged('10000000-0000-0000-0000-00000000000c') #> '{geofence,default_profile}') is not null,
          'merged config keeps global keys and adds bank keys');

-- chargeability fallback order: bank per-code > bank category default > reason code flag
select is(pos.billable_for('10000000-0000-0000-0000-00000000000c', 'appointment_not_secured', 'zz_ctx_code', false),
          '{"billable":true,"source":"bank_code"}'::jsonb, 'bank per-code override wins');
select is(pos.billable_for('10000000-0000-0000-0000-00000000000c', 'appointment_not_secured', 'other_code', true),
          '{"billable":false,"source":"bank_default"}'::jsonb, 'bank category default next');
select is(pos.billable_for('10000000-0000-0000-0000-00000000000d', 'appointment_not_secured', 'other_code', true),
          '{"billable":true,"source":"reason_code"}'::jsonb, 'reason code flag last');

-- agent-layer config: four-eyes follows the agent's banks
select ok((pos_rpc.admin_config_scope('a0000000-0000-0000-0000-0000000000c1', 'agent', 'b0000000-0000-0000-0000-0000000000c1') ->> 'four_eyes')::boolean,
          'agent of a four-eyes bank → four-eyes applies to their config layer');
select is((pos_rpc.admin_config_scope('a0000000-0000-0000-0000-0000000000c1', 'agent', 'b0000000-0000-0000-0000-0000000000c1') ->> 'bank_id')::uuid,
          '10000000-0000-0000-0000-00000000000d'::uuid, 'single-bank agent scoped to that bank');

select * from finish();
rollback;
