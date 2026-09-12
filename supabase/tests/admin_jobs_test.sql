-- pgTAP: admin job functions (20260911102100) — create/update, appointment scheduling, allocation, revoke/reassign,
-- cancel/close, not-secured billing, review decisions and amendments. Allow AND deny cases.
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select plan(62);

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
insert into pos.banks (id, code, name) values
  ('10000000-0000-0000-0000-00000000000a', 'BANKA', 'Bank A'),
  ('10000000-0000-0000-0000-00000000000b', 'BANKB', 'Bank B');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, bank_ids, active) values
  ('a0000000-0000-0000-0000-000000000001', 'ADM-1', 'Gina', 'Global', 'pos_admin', array['approve_definitions', 'review_inspections', 'schedule_jobs'], null, true),
  ('a0000000-0000-0000-0000-000000000002', 'ADM-2', 'Ben', 'Banka', 'pos_admin', '{}', array['10000000-0000-0000-0000-00000000000a']::uuid[], true),
  ('b0000000-0000-0000-0000-000000000001', 'AG-1', 'Ada', 'One', 'pos_agent', '{}', array['10000000-0000-0000-0000-00000000000a']::uuid[], true),
  ('b0000000-0000-0000-0000-000000000002', 'AG-2', 'Bob', 'Two', 'pos_agent', '{}', array['10000000-0000-0000-0000-00000000000b']::uuid[], true),
  ('b0000000-0000-0000-0000-000000000003', 'AG-3', 'Cy', 'Three', 'pos_agent', '{}', null, false),
  ('b0000000-0000-0000-0000-000000000004', 'AG-4', 'Di', 'Four', 'pos_agent', '{}', null, true);
insert into pos.reason_codes (category, code, label, requires_note, billable) values
  ('cancel', 'zz_duplicate', 'Duplicate', false, false),
  ('reassign', 'zz_agent_unavailable', 'Agent unavailable', false, false),
  ('unschedule', 'zz_rescheduled', 'Merchant rescheduled', false, false),
  ('appointment_not_secured', 'zz_unreachable', 'Unreachable', true, true),
  ('appointment_not_secured', 'zz_declined', 'Declined', false, false),
  ('review_return', 'zz_photos', 'Photos insufficient', false, false),
  ('review_reject', 'zz_unverified', 'Unable to verify', false, false);
insert into pos.mcc_codes (code, description) values ('5411', 'Grocery') on conflict do nothing;
select pos_rpc.set_context('a0000000-0000-0000-0000-000000000001', 'pos_admin', 'pgtap-admin-jobs');
select pos_rpc.admin_config_publish('a0000000-0000-0000-0000-000000000001', 'global', null,
  '{"geofence":{"default_profile":"standalone","profiles":{"standalone":{"radius_m":75},"shopping_centre":{"radius_m":250}}}}',
  '1.0', 'fixture', null, '{}');

-- ── Create / update ───────────────────────────────────────────────────────────────────────────
insert into ids select 'j1', (pos_rpc.admin_job_create('a0000000-0000-0000-0000-000000000002',
  '{"bank_id":"10000000-0000-0000-0000-00000000000a","merchant_name":"Joe Spaza","address":{"line1":"1 Main Rd"},
    "location":{"lat":-26.1,"lng":28.05},"mcc_code":"5411"}') ->> 'id')::uuid;
select is((select status::text from pos.jobs where id = (select id from ids where name = 'j1')), 'pending', 'job created in PENDING');
select ok((select reference ~ '^POS-[0-9]{4}-[0-9]{6}$' from pos.jobs where id = (select id from ids where name = 'j1')), 'reference generated server-side');
select is((select location_type from pos.jobs where id = (select id from ids where name = 'j1')), 'standalone', 'default location type from config');
select ok(exists (select 1 from pos.job_events where job_id = (select id from ids where name = 'j1') and type = 'job_created'), 'creation on the timeline');
select is(pg_temp.err($$select pos_rpc.admin_job_create('a0000000-0000-0000-0000-000000000002',
  '{"bank_id":"10000000-0000-0000-0000-00000000000b","merchant_name":"X","address":{"line1":"x"}}')$$), 'POS:FORBIDDEN', 'bank outside scope refused');
select is(pg_temp.err($$select pos_rpc.admin_job_create('a0000000-0000-0000-0000-000000000001',
  '{"bank_id":"10000000-0000-0000-0000-00000000000a","merchant_name":"X","address":{"line1":"x"},"mcc_code":"9999"}')$$), 'POS:VALIDATION_FAILED', 'unknown MCC refused');
select is(pg_temp.err($$select pos_rpc.admin_job_create('a0000000-0000-0000-0000-000000000001',
  '{"bank_id":"10000000-0000-0000-0000-00000000000a","merchant_name":"X","address":{"line1":"x"},"location_type":"farm"}')$$), 'POS:VALIDATION_FAILED', 'unknown location type refused');
select is(pg_temp.err($$select pos_rpc.admin_job_create('a0000000-0000-0000-0000-000000000001',
  '{"bank_id":"10000000-0000-0000-0000-00000000000a","merchant_name":"X","address":{"line1":"x"},"expected_job_schema_version_id":"00000000-0000-0000-0000-000000000001"}')$$),
  'POS:CONFLICT', 'job schema race detected');
select ok((pos_rpc.admin_job_create('a0000000-0000-0000-0000-000000000001',
  '{"bank_id":"10000000-0000-0000-0000-00000000000a","merchant_name":"Far","address":{"line1":"x","bank_coordinates":{"lat":-26.2,"lng":28.05}},
    "location":{"lat":-26.1,"lng":28.05}}') -> 'flags') ? 'location_mismatch', 'pin > 250 m from bank coordinates is flagged');
select is((pos_rpc.admin_job_update('a0000000-0000-0000-0000-000000000002', (select id from ids where name = 'j1'), '{"merchant_name":"Joe''s Spaza"}') ->> 'merchant_name'),
          'Joe''s Spaza', 'core fields editable while pending');
select ok(exists (select 1 from pos.job_events where job_id = (select id from ids where name = 'j1') and type = 'job_updated'), 'update logged');
select is(pg_temp.err(format($$select pos_rpc.admin_job_update('a0000000-0000-0000-0000-000000000001', %L, jsonb_build_object('parent_job_id', %L))$$,
          (select id from ids where name = 'j1'), (select id from ids where name = 'j1'))), 'POS:VALIDATION_FAILED', 'a job cannot be its own parent');

-- ── Scheduling (06 §1a) ──────────────────────────────────────────────────────────────────────
select is(pg_temp.err(format($$select pos_rpc.admin_job_contact_attempt('a0000000-0000-0000-0000-000000000002', %L, '{"channel":"phone","outcome":"no_answer"}')$$,
          (select id from ids where name = 'j1'))), 'POS:FORBIDDEN', 'contact attempts need schedule_jobs');
select is(pg_temp.err(format($$select pos_rpc.admin_job_schedule('a0000000-0000-0000-0000-000000000001', %L, now() + interval '1 day', now() + interval '1 day 2 hours', '{"name":"Joe"}', null)$$,
          (select id from ids where name = 'j1'))), 'POS:CONFLICT', 'confirming needs a contact attempt first');
select is(pg_temp.err(format($$select pos_rpc.admin_job_allocate('a0000000-0000-0000-0000-000000000001', %L, 'b0000000-0000-0000-0000-000000000001', null)$$,
          (select id from ids where name = 'j1'))), 'POS:INVALID_TRANSITION', 'pending jobs cannot be allocated');
select is((pos_rpc.admin_job_contact_attempt('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j1'),
          '{"channel":"phone","outcome":"confirmed","contact_name":"Joe"}') ->> 'outcome'), 'confirmed', 'contact attempt logged');
select is(pg_temp.err(format($$select pos_rpc.admin_job_schedule('a0000000-0000-0000-0000-000000000001', %L, now() + interval '2 hours', now() + interval '1 hour', '{"name":"Joe"}', null)$$,
          (select id from ids where name = 'j1'))), 'POS:VALIDATION_FAILED', 'window end must follow start');
select is((pos_rpc.admin_job_schedule('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j1'),
          now() + interval '1 day', now() + interval '1 day 2 hours', '{"name":"Joe","phone":"0820000000"}', 'confirmed by phone') ->> 'status'),
          'scheduled', 'appointment confirmed → SCHEDULED');

-- ── Allocation ───────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err(format($$select pos_rpc.admin_job_allocate('a0000000-0000-0000-0000-000000000001', %L, 'b0000000-0000-0000-0000-000000000002', null)$$,
          (select id from ids where name = 'j1'))), 'POS:VALIDATION_FAILED', 'agent not allowed for this bank');
select is(pg_temp.err(format($$select pos_rpc.admin_job_allocate('a0000000-0000-0000-0000-000000000001', %L, 'b0000000-0000-0000-0000-000000000003', null)$$,
          (select id from ids where name = 'j1'))), 'POS:VALIDATION_FAILED', 'inactive agent refused');
select is(pg_temp.err(format($$select pos_rpc.admin_job_allocate('a0000000-0000-0000-0000-000000000001', %L, 'a0000000-0000-0000-0000-000000000002', null)$$,
          (select id from ids where name = 'j1'))), 'POS:VALIDATION_FAILED', 'admins are not agents');
select is((pos_rpc.admin_job_allocate('a0000000-0000-0000-0000-000000000002', (select id from ids where name = 'j1'), 'b0000000-0000-0000-0000-000000000001', 'go') ->> 'status'),
          'assigned', 'allocated → ASSIGNED');
select is((select assigned_to from pos.jobs where id = (select id from ids where name = 'j1')), 'b0000000-0000-0000-0000-000000000001'::uuid, 'assigned_to set');
select is((select response::text from pos.job_assignments where job_id = (select id from ids where name = 'j1')), 'pending', 'assignment row pending');
select is((select count(*)::int from pos.notifications where recipient_user_id = 'b0000000-0000-0000-0000-000000000001' and template_key like 'notify.job_assigned.%'),
          2, 'agent notified by push + email');
select is(pg_temp.err(format($$select pos_rpc.admin_job_update('a0000000-0000-0000-0000-000000000001', %L, '{"notes":"x"}')$$,
          (select id from ids where name = 'j1'))), 'POS:CONFLICT', 'core fields locked once assigned');
select is((pos_rpc.admin_job_update('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j1'), '{"location_type":"shopping_centre"}') ->> 'location_type'),
          'shopping_centre', 'location type still changeable before the visit');
select ok(exists (select 1 from pos.job_events where job_id = (select id from ids where name = 'j1') and type = 'location_type_changed'), 'location type change logged');

-- reschedule while assigned: tokens revoked, agent told
insert into pos.session_tokens (job_id, user_id, device_id, token_hash, valid_from, valid_to)
values ((select id from ids where name = 'j1'), 'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'tok-1', now(), now() + interval '3 days');
select is((pos_rpc.admin_job_schedule('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j1'),
          now() + interval '2 days', now() + interval '2 days 1 hour', '{"name":"Joe"}', 'merchant asked') ->> 'status'), 'assigned', 'reschedule keeps the status');
select ok((select revoked_at is not null from pos.session_tokens where token_hash = 'tok-1'), 'unused session token revoked on reschedule');
select ok(exists (select 1 from pos.notifications where recipient_user_id = 'b0000000-0000-0000-0000-000000000001' and template_key = 'notify.job_rescheduled.email'),
          'agent notified of the new window');

-- ── Revoke / reassign / cancel / close ───────────────────────────────────────────────────────
select is(pg_temp.err(format($$select pos_rpc.admin_job_revoke('a0000000-0000-0000-0000-000000000001', %L, null, null)$$,
          (select id from ids where name = 'j1'))), 'POS:INVALID_REASON', 'revoke needs a reassign reason');
select is((pos_rpc.admin_job_revoke('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j1'), 'zz_agent_unavailable', null) ->> 'status'),
          'scheduled', 'revoked → SCHEDULED');
select ok((select assigned_to is null from pos.jobs where id = (select id from ids where name = 'j1')), 'assigned_to cleared');
select is((select response::text from pos.job_assignments where job_id = (select id from ids where name = 'j1')), 'revoked', 'assignment revoked');
select pos_rpc.admin_job_allocate('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j1'), 'b0000000-0000-0000-0000-000000000001', null);
select is(pg_temp.err(format($$select pos_rpc.admin_job_reassign('a0000000-0000-0000-0000-000000000001', %L, 'b0000000-0000-0000-0000-000000000001', 'zz_agent_unavailable', null)$$,
          (select id from ids where name = 'j1'))), 'POS:CONFLICT', 'reassign to the same agent refused');
select is((pos_rpc.admin_job_reassign('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j1'), 'b0000000-0000-0000-0000-000000000004', 'zz_agent_unavailable', 'swap') ->> 'assigned_to'),
          'b0000000-0000-0000-0000-000000000004', 'reassigned atomically');
select is((select count(*)::int from pos.job_assignments where job_id = (select id from ids where name = 'j1') and response in ('pending', 'accepted')),
          1, 'one live assignment');
select is((pos_rpc.admin_job_cancel('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j1'), 'zz_duplicate', null) ->> 'status'),
          'cancelled', 'cancelled with reason');
select ok(exists (select 1 from pos.notifications where recipient_user_id = 'b0000000-0000-0000-0000-000000000004' and template_key = 'notify.job_cancelled.email'),
          'agent notified of cancellation');
select is(pg_temp.err(format($$select pos_rpc.admin_job_cancel('a0000000-0000-0000-0000-000000000001', %L, 'zz_duplicate', null)$$,
          (select id from ids where name = 'j1'))), 'POS:INVALID_TRANSITION', 'cannot cancel twice');
select is((pos_rpc.admin_job_close('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j1'), 'done') ->> 'status'), 'closed', 'closed by admin');

-- ── Unschedule & not secured ─────────────────────────────────────────────────────────────────
insert into ids select 'j2', (pos_rpc.admin_job_create('a0000000-0000-0000-0000-000000000001',
  '{"bank_id":"10000000-0000-0000-0000-00000000000a","merchant_name":"Two","address":{"line1":"2 Main Rd"}}') ->> 'id')::uuid;
select pos_rpc.admin_job_contact_attempt('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j2'), '{"channel":"email","outcome":"confirmed"}');
select pos_rpc.admin_job_schedule('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j2'), now() + interval '1 day', now() + interval '1 day 1 hour', '{"name":"M"}', null);
select is((pos_rpc.admin_job_unschedule('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j2'), 'zz_rescheduled', null) ->> 'status'),
          'pending', 'unscheduled → PENDING');
select ok((select scheduled_start is null and appointment_confirmed_at is null from pos.jobs where id = (select id from ids where name = 'j2')), 'confirmation cleared');
select is(pg_temp.err(format($$select pos_rpc.admin_job_not_secured('a0000000-0000-0000-0000-000000000001', %L, 'zz_unreachable', null)$$,
          (select id from ids where name = 'j2'))), 'POS:NOTE_REQUIRED', 'reason requires a note');
select is((pos_rpc.admin_job_not_secured('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j2'), 'zz_unreachable', 'five calls') ->> 'billable')::boolean,
          true, 'billable from the reason code');
select is((select status::text from pos.jobs where id = (select id from ids where name = 'j2')), 'appointment_not_secured', 'closed as not secured, nobody dispatched');
update pos.banks set billing_settings = '{"appointment_not_secured":{"codes":{"zz_declined":true}}}' where code = 'BANKB';
insert into ids select 'j3', (pos_rpc.admin_job_create('a0000000-0000-0000-0000-000000000001',
  '{"bank_id":"10000000-0000-0000-0000-00000000000b","merchant_name":"Three","address":{"line1":"3 Main Rd"}}') ->> 'id')::uuid;
select is(pg_temp.err(format($$select pos_rpc.admin_job_not_secured('a0000000-0000-0000-0000-000000000001', %L, 'zz_declined', null)$$,
          (select id from ids where name = 'j3'))), 'POS:CONFLICT', 'not secured needs logged contact attempts');
select pos_rpc.admin_job_contact_attempt('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j3'), '{"channel":"phone","outcome":"declined"}');
select is((pos_rpc.admin_job_not_secured('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j3'), 'zz_declined', null) ->> 'billable_source'),
          'bank_code', 'bank contract overrides the reason code');

-- ── Review ───────────────────────────────────────────────────────────────────────────────────
insert into ids select 'j4', (pos_rpc.admin_job_create('a0000000-0000-0000-0000-000000000001',
  '{"bank_id":"10000000-0000-0000-0000-00000000000a","merchant_name":"Four","address":{"line1":"4 Main Rd"}}') ->> 'id')::uuid;
select pos_rpc.admin_job_contact_attempt('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j4'), '{"channel":"phone","outcome":"confirmed"}');
select pos_rpc.admin_job_schedule('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j4'), now() + interval '1 day', now() + interval '1 day 1 hour', '{"name":"M"}', null);
select pos_rpc.admin_job_allocate('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j4'), 'b0000000-0000-0000-0000-000000000001', null);
update pos.jobs set status = 'accepted' where id = (select id from ids where name = 'j4');
update pos.jobs set status = 'in_progress' where id = (select id from ids where name = 'j4');
update pos.jobs set status = 'submitted' where id = (select id from ids where name = 'j4');
insert into pos.inspections (id, job_id, attempt, user_id, device_id, status, answers, evidence_expected, evidence_verified, flags)
values ('e1000000-0000-0000-0000-000000000004', (select id from ids where name = 'j4'), 1, 'b0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-000000000001', 'submitted', '{"merchant_name":{"v":"Four"}}', 1, 0, array['geofence_override']);
select is(pg_temp.err($$select pos_rpc.admin_review_decide('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000004', 'approved', null, null, true)$$),
          'POS:FORBIDDEN', 'reviewing needs review_inspections');
select is(pg_temp.err($$select pos_rpc.admin_review_decide('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', 'approved', null, null, true)$$),
          'POS:CONFLICT', 'approval blocked while evidence is outstanding');
update pos.inspections set evidence_verified = 1 where id = 'e1000000-0000-0000-0000-000000000004';
select is(pg_temp.err($$select pos_rpc.admin_review_decide('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', 'approved', null, null, false)$$),
          'POS:VALIDATION_FAILED', 'geofence override must be acknowledged');
select is((pos_rpc.admin_review_decide('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', 'approved', null, 'good', true) ->> 'job_status'),
          'approved', 'approved → job APPROVED');
select ok((select override_acknowledged from pos.reviews where inspection_id = 'e1000000-0000-0000-0000-000000000004'), 'review row with acknowledgement');
select ok(exists (select 1 from pos.custody_events where subject_id = 'e1000000-0000-0000-0000-000000000004' and event = 'reviewed'), 'custody: reviewed');
select is(pg_temp.err($$select pos_rpc.admin_review_decide('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', 'rejected', 'zz_unverified', null, false)$$),
          'POS:CONFLICT', 'a decided inspection cannot be decided again');

select is((pos_rpc.admin_amendment_create('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', 'merchant_name', '{"v":"Four Ltd"}', 'typo') -> 'old_value'),
          '{"v":"Four"}'::jsonb, 'amendment keeps the original value');
select is((pos_rpc.admin_amendment_create('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', 'merchant_name', '{"v":"Four (Pty) Ltd"}', 'registered name') -> 'old_value'),
          '{"v":"Four Ltd"}'::jsonb, 'second amendment chains from the first');
select is((select answers from pos.inspections where id = 'e1000000-0000-0000-0000-000000000004'), '{"merchant_name":{"v":"Four"}}'::jsonb, 'original answers untouched');

-- return for rework
insert into ids select 'j5', (pos_rpc.admin_job_create('a0000000-0000-0000-0000-000000000001',
  '{"bank_id":"10000000-0000-0000-0000-00000000000a","merchant_name":"Five","address":{"line1":"5 Main Rd"}}') ->> 'id')::uuid;
select pos_rpc.admin_job_contact_attempt('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j5'), '{"channel":"phone","outcome":"confirmed"}');
select pos_rpc.admin_job_schedule('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j5'), now() + interval '1 day', now() + interval '1 day 1 hour', '{"name":"M"}', null);
select pos_rpc.admin_job_allocate('a0000000-0000-0000-0000-000000000001', (select id from ids where name = 'j5'), 'b0000000-0000-0000-0000-000000000001', null);
update pos.jobs set status = 'accepted' where id = (select id from ids where name = 'j5');
update pos.jobs set status = 'submitted' where id = (select id from ids where name = 'j5');
update pos.jobs set status = 'under_review' where id = (select id from ids where name = 'j5');
insert into pos.inspections (id, job_id, attempt, user_id, device_id, status, answers)
values ('e1000000-0000-0000-0000-000000000005', (select id from ids where name = 'j5'), 1, 'b0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-000000000001', 'submitted', '{}');
select is(pg_temp.err($$select pos_rpc.admin_review_decide('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000005', 'returned', 'zz_photos', null, false)$$),
          'POS:NOTE_REQUIRED', 'return needs a note for the agent');
select is((pos_rpc.admin_review_decide('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000005', 'returned', 'zz_photos', 'retake the shopfront', false) ->> 'job_status'),
          'returned', 'returned → job RETURNED');
select is((select payload ->> 'note' from pos.notifications where template_key = 'notify.job_returned.email' order by created_at desc limit 1),
          'retake the shopfront', 'agent email carries the reviewer note');

select * from finish();
rollback;
