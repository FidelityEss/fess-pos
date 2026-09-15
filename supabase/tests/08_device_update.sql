-- POST /v1/device (T2-31): the module updates its own device registration — push token, versions — without a new exchange.
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select no_plan();

insert into pos.pos_users (id, employee_number, first_name, last_name, role) values
  ('d8000000-0000-0000-0000-000000000001', 'TDU01', 'Dudu', 'Device', 'pos_agent'),
  ('d8000000-0000-0000-0000-000000000002', 'TDU02', 'Other', 'Agent', 'pos_agent');
insert into pos.devices (user_id, device_id, platform, module_version, push_provider, push_token, last_seen_at) values
  ('d8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001', 'android', '0.1.0', 'fcm', 'token-one', now() - interval '2 days'),
  ('d8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000002', 'android', '0.1.0', 'fcm', 'token-old', now() - interval '2 days');
update pos.devices set revoked_at = now(), revoke_reason = 'lost' where device_id = 'f8000000-0000-0000-0000-000000000002';

-- ── push token refresh ─────────────────────────────────────────────────────────────────────────
select is(pos_rpc.device_update('d8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001',
                                '{"push_provider": "fcm", "push_token": "token-two"}') ->> 'push_registered',
          'true', 'a refreshed push token is registered');
select is((select push_token from pos.devices where device_id = 'f8000000-0000-0000-0000-000000000001'), 'token-two',
          'the new token replaces the old one');
select ok((select last_seen_at > now() - interval '1 minute' from pos.devices where device_id = 'f8000000-0000-0000-0000-000000000001'),
          'last_seen_at is bumped');

-- ── versions only ──────────────────────────────────────────────────────────────────────────────
select is(pos_rpc.device_update('d8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001',
                                '{"module_version": "0.2.0", "capabilities": {"spec_versions": ["1.0"]}}') ->> 'module_version',
          '0.2.0', 'the module version is updated');
select is((select push_token from pos.devices where device_id = 'f8000000-0000-0000-0000-000000000001'), 'token-two',
          'leaving push_token out keeps the registration');
select is((select capabilities from pos.devices where device_id = 'f8000000-0000-0000-0000-000000000001'),
          '{"spec_versions": ["1.0"]}'::jsonb, 'the capability report is replaced');
select is((select platform from pos.devices where device_id = 'f8000000-0000-0000-0000-000000000001'), 'android',
          'fields that are not sent keep their values');

-- ── unregister push ────────────────────────────────────────────────────────────────────────────
select is(pos_rpc.device_update('d8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001',
                                '{"push_token": null}') ->> 'push_registered',
          'false', 'an explicit null push_token unregisters push');
select ok((select push_token is null and push_provider is null from pos.devices where device_id = 'f8000000-0000-0000-0000-000000000001'),
          'token and provider are both cleared');

-- ── refusals ───────────────────────────────────────────────────────────────────────────────────
select throws_ok($$select pos_rpc.device_update('d8000000-0000-0000-0000-000000000002', 'f8000000-0000-0000-0000-000000000001', '{"module_version": "9.9.9"}')$$,
                 'P0001', null, 'another user cannot update this device');
select throws_ok($$select pos_rpc.device_update('d8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000002', '{"push_token": "x", "push_provider": "fcm"}')$$,
                 'P0001', null, 'a revoked device is refused');
select is((select push_token from pos.devices where device_id = 'f8000000-0000-0000-0000-000000000002'), 'token-old',
          'the revoked device is left untouched');
select is((select module_version from pos.devices where device_id = 'f8000000-0000-0000-0000-000000000001'), '0.2.0',
          'a refused call changes nothing');

-- ── only the POS API (service_role) can call it ────────────────────────────────────────────────
select ok(not has_schema_privilege('authenticated', 'pos_rpc', 'usage'), 'clients cannot reach pos_rpc');
select ok(not has_schema_privilege('anon', 'pos_rpc', 'usage'), 'anonymous callers cannot reach pos_rpc');

select finish();
rollback;
