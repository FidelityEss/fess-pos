-- Registration links for admins (T2-37, D-96): who may invite whom, linking the Auth account, Copy link, resend, cancel,
-- accept, the People list helper, and admin.require_mfa switched off with the check behind it still working when it is
-- switched back on. Allow AND deny cases (DEVELOPMENT-GUIDELINES §3).
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select no_plan();

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
create temp table ids (name text primary key, id uuid);
grant all on ids to public;

-- ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, aud, role, encrypted_password, email_confirmed_at) values
  ('e9000000-0000-0000-0000-000000000001', 'gina.invite@test.local', 'authenticated', 'authenticated', 'x', now()),
  ('e9000000-0000-0000-0000-000000000002', 'ben.invite@test.local', 'authenticated', 'authenticated', 'x', now());
-- Invited accounts as Supabase Auth leaves them: no password, not confirmed, a token waiting.
insert into auth.users (id, email, aud, role, encrypted_password, confirmation_token, confirmation_sent_at, invited_at) values
  ('e9000000-0000-0000-0000-000000000011', 'new.admin@test.local', 'authenticated', 'authenticated', '', 'tokhash-11', now(), now()),
  ('e9000000-0000-0000-0000-000000000012', 'old.admin@test.local', 'authenticated', 'authenticated', '', 'tokhash-12', now(), now()),
  ('e9000000-0000-0000-0000-000000000013', 'viewer.invite@test.local', 'authenticated', 'authenticated', '', 'tokhash-13', now(), now()),
  ('e9000000-0000-0000-0000-000000000014', 'new.admin@test.local.replaced', 'authenticated', 'authenticated', '', 'tokhash-14', now(), now());
insert into pos.banks (id, code, name) values
  ('e9200000-0000-0000-0000-00000000000a', 'INVBA', 'Invite Bank A'),
  ('e9200000-0000-0000-0000-00000000000b', 'INVBB', 'Invite Bank B');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, bank_ids, admin_auth_uid, email) values
  ('e9100000-0000-0000-0000-000000000001', 'INV-ADM1', 'Gina', 'Global', 'pos_admin', array['approve_definitions', 'review_inspections', 'schedule_jobs'], null, 'e9000000-0000-0000-0000-000000000001', 'gina.invite@test.local'),
  ('e9100000-0000-0000-0000-000000000002', 'INV-ADM2', 'Ben', 'Banka', 'pos_admin', '{}', array['e9200000-0000-0000-0000-00000000000a']::uuid[], 'e9000000-0000-0000-0000-000000000002', 'ben.invite@test.local'),
  ('e9100000-0000-0000-0000-000000000003', 'INV-ADM3', 'Olga', 'Oldhand', 'pos_admin', '{}', null, null, null),
  ('e9100000-0000-0000-0000-000000000004', 'INV-AG1', 'Ade', 'Agent', 'pos_agent', '{}', array['e9200000-0000-0000-0000-00000000000a']::uuid[], null, null);
select pos_rpc.set_context('e9100000-0000-0000-0000-000000000001', 'pos_admin', 'pgtap-invitations');

-- ── Settings (D-96) ──────────────────────────────────────────────────────────────────────────
select is((select value from pos.settings where key = 'admin.require_mfa'), 'false'::jsonb, 'admin.require_mfa is off (D-96)');
select ok((select jsonb_typeof(value) = 'number' and value::text::int between 1 and 24 from pos.settings where key = 'admin.invite_ttl_hours'),
          'a registration-link lifetime of 1 to 24 hours is set (24; QA runs 1 until its Auth config is pushed)');
-- The rest of this file expects the 24-hour default, whatever this project runs today (rolled back at the end).
update pos.settings set value = '24'::jsonb where key = 'admin.invite_ttl_hours';

-- ── Only the POS API reaches the functions ────────────────────────────────────────────────────
set local role authenticated;
select is(pg_temp.err($$select pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000001', '{}')$$), '42501',
          'a signed-in client cannot call the invitation functions');
set local role postgres;
set local role anon;
select is(pg_temp.err($$select pos_rpc.admin_invitation_link('e9100000-0000-0000-0000-000000000001', gen_random_uuid())$$), '42501',
          'an anonymous caller cannot copy a link');
set local role postgres;

-- ── Who may be invited ───────────────────────────────────────────────────────────────────────
select is(pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000001',
            '{"email":"New.Admin@Test.local","person":{"first_name":"Nomsa","last_name":"New","role":"pos_admin","permissions":["schedule_jobs"],"bank_ids":null}}') ->> 'mode',
          'new', 'an all-bank admin may invite a new administrator');
select is(pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000001',
            '{"email":"New.Admin@Test.local","person":{"first_name":"Nomsa","last_name":"New","role":"pos_admin","bank_ids":null}}') ->> 'email',
          'new.admin@test.local', 'the email is kept in lower case');
select is(pg_temp.err($$select pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000002',
            '{"email":"x@test.local","person":{"first_name":"A","last_name":"B","role":"pos_admin","bank_ids":["e9200000-0000-0000-0000-00000000000a"]}}')$$),
          'POS:FORBIDDEN', 'a bank-scoped admin cannot invite an administrator');
select is(pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000002',
            '{"email":"viewer.invite@test.local","person":{"first_name":"Vuyo","last_name":"Viewer","role":"pos_bank_reader","bank_ids":["e9200000-0000-0000-0000-00000000000a"]}}') ->> 'mode',
          'new', 'a bank-scoped admin may invite a bank viewer for their own bank');
select is(pg_temp.err($$select pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000002',
            '{"email":"v2@test.local","person":{"first_name":"V","last_name":"Two","role":"pos_bank_reader","bank_ids":["e9200000-0000-0000-0000-00000000000b"]}}')$$),
          'POS:FORBIDDEN', 'a bank-scoped admin cannot invite a viewer for another bank');
select is(pg_temp.err($$select pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000001',
            '{"email":"ag@test.local","person":{"first_name":"A","last_name":"G","role":"pos_agent","bank_ids":null}}')$$),
          'POS:INVALID_REQUEST', 'agents are never invited to the admin panel');
select is(pg_temp.err($$select pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000001',
            '{"email":"r@test.local","person":{"first_name":"R","last_name":"R","role":"pos_bank_reader","bank_ids":null}}')$$),
          'POS:INVALID_REQUEST', 'a bank viewer needs a bank');
select is(pg_temp.err($$select pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000001',
            '{"email":"not-an-email","user_id":"e9100000-0000-0000-0000-000000000003"}')$$),
          'POS:INVALID_REQUEST', 'an invalid email is refused');
select is(pg_temp.err($$select pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000001',
            '{"email":"a@test.local","user_id":"e9100000-0000-0000-0000-000000000003","person":{}}')$$),
          'POS:INVALID_REQUEST', 'user_id and person together are refused');
select is(pg_temp.err($$select pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000001',
            '{"email":"ag@test.local","user_id":"e9100000-0000-0000-0000-000000000004"}')$$),
          'POS:CONFLICT', 'an existing agent cannot be given an admin sign-in');
select is(pg_temp.err($$select pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000001',
            '{"email":"GINA.invite@test.local","user_id":"e9100000-0000-0000-0000-000000000003"}')$$),
          'POS:ALREADY_EXISTS', 'an email someone else signs in with is refused');
select is(pg_temp.err($$select pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000001',
            '{"email":"ben2@test.local","user_id":"e9100000-0000-0000-0000-000000000002"}')$$),
          'POS:ALREADY_EXISTS', 'someone who can already sign in is not invited again');
select is(pg_temp.err($$select pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000004', '{"email":"a@test.local","user_id":"e9100000-0000-0000-0000-000000000003"}')$$),
          'POS:FORBIDDEN', 'an agent actor is refused');

-- ── A new person: added, linked, link recorded ────────────────────────────────────────────────
insert into ids select 'inv_new', (r -> 'invitation' ->> 'id')::uuid
  from (select pos_rpc.admin_invitation_create('e9100000-0000-0000-0000-000000000001',
          '{"email":"new.admin@test.local","person":{"first_name":"Nomsa","last_name":"New","role":"pos_admin","permissions":["schedule_jobs"],"bank_ids":null}}',
          'e9000000-0000-0000-0000-000000000011', false, 'not_allowed', 'https://admin.test/register') as r) s;
insert into ids select 'user_new', user_id from pos.admin_invitations where id = (select id from ids where name = 'inv_new');
select is((select status from pos.admin_invitations where id = (select id from ids where name = 'inv_new')), 'pending', 'the link is waiting');
select is((select admin_auth_uid from pos.pos_users where id = (select id from ids where name = 'user_new')),
          'e9000000-0000-0000-0000-000000000011'::uuid, 'the person is linked to the invited Auth account');
select ok((select employee_number like 'STAFF-%' and role = 'pos_admin' and permissions = array['schedule_jobs'] and email = 'new.admin@test.local'
             from pos.pos_users where id = (select id from ids where name = 'user_new')),
          'the new person is added with their role, permissions, email and a made-up employee number');
select ok((select not email_sent and email_error = 'not_allowed' and invited_by = 'e9100000-0000-0000-0000-000000000001'
                  and expires_at between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute'
             from pos.admin_invitations where id = (select id from ids where name = 'inv_new')),
          'not emailed, who invited them and a 24-hour expiry are recorded');
select ok(exists (select 1 from pos.audit_log a where a.table_name = 'admin_invitations' and a.action = 'INSERT'
                    and a.row_id = (select id from ids where name = 'inv_new')::text and a.actor_id = 'e9100000-0000-0000-0000-000000000001'),
          'the invitation is in the activity history with who sent it');
select is(pg_temp.err($$select pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000001',
            format('{"email":"z@test.local","user_id":"%s"}', (select id from ids where name = 'user_new'))::jsonb)$$),
          'POS:ALREADY_EXISTS', 'a second link for someone with one waiting is refused (resend instead)');
select is(pg_temp.err($$select pos_rpc.admin_invitation_create('e9100000-0000-0000-0000-000000000001',
            '{"email":"olga@test.local","user_id":"e9100000-0000-0000-0000-000000000003"}', 'e9000000-0000-0000-0000-000000000012', true, null, 'javascript:alert(1)')$$),
          '23514', 'a registration address that is not an http(s) /register page is refused');

-- ── Someone already on People ─────────────────────────────────────────────────────────────────
insert into ids select 'inv_old', (pos_rpc.admin_invitation_create('e9100000-0000-0000-0000-000000000001',
          '{"email":"old.admin@test.local","user_id":"e9100000-0000-0000-0000-000000000003"}',
          'e9000000-0000-0000-0000-000000000012', true, 'failed', 'http://localhost:3001/register') -> 'invitation' ->> 'id')::uuid;
select ok((select email_sent and email_error is null from pos.admin_invitations where id = (select id from ids where name = 'inv_old')),
          'an emailed link records no email problem');
select ok((select email = 'old.admin@test.local' and admin_auth_uid = 'e9000000-0000-0000-0000-000000000012'
             from pos.pos_users where id = 'e9100000-0000-0000-0000-000000000003'),
          'an existing person is linked and gets the invited email when they had none');

-- ── Copy link: the same token as the email, counted ───────────────────────────────────────────
select is(pos_rpc.admin_invitation_link('e9100000-0000-0000-0000-000000000001', (select id from ids where name = 'inv_new')) ->> 'token_hash',
          'tokhash-11', 'Copy link returns the token Supabase Auth is waiting for');
select is((select link_copies from pos.admin_invitations where id = (select id from ids where name = 'inv_new')), 1, 'the copy is counted');
select is((select confirmation_token from auth.users where id = 'e9000000-0000-0000-0000-000000000011'), 'tokhash-11', 'the emailed token still works after copying');
select is(pg_temp.err(format($$select pos_rpc.admin_invitation_link('e9100000-0000-0000-0000-000000000002', %L)$$, (select id from ids where name = 'inv_new'))),
          'POS:FORBIDDEN', 'a bank-scoped admin cannot copy an administrator''s link');
update pos.admin_invitations set expires_at = now() - interval '1 minute' where id = (select id from ids where name = 'inv_new');
select is(pg_temp.err(format($$select pos_rpc.admin_invitation_link('e9100000-0000-0000-0000-000000000001', %L)$$, (select id from ids where name = 'inv_new'))),
          'POS:CONFLICT', 'an expired link cannot be copied');
update pos.admin_invitations set expires_at = now() + interval '1 hour' where id = (select id from ids where name = 'inv_new');
update auth.users set email_confirmed_at = now(), confirmation_token = '' where id = 'e9000000-0000-0000-0000-000000000011';
select is(pg_temp.err(format($$select pos_rpc.admin_invitation_link('e9100000-0000-0000-0000-000000000001', %L)$$, (select id from ids where name = 'inv_new'))),
          'POS:CONFLICT', 'a link that was already opened cannot be copied');

-- ── Resend (here with a replacement Auth account) ─────────────────────────────────────────────
select is(pos_rpc.admin_invitation_resent('e9100000-0000-0000-0000-000000000001', (select id from ids where name = 'inv_new'),
            'e9000000-0000-0000-0000-000000000014', true, null, 'https://admin.test/register') ->> 'token_hash',
          'tokhash-14', 'resend returns the new token');
select ok((select send_count = 2 and auth_uid = 'e9000000-0000-0000-0000-000000000014' and email_sent and email_error is null
                  and expires_at > now() + interval '23 hours'
             from pos.admin_invitations where id = (select id from ids where name = 'inv_new')),
          'resend counts, records the new account and restarts the 24 hours');
select is((select admin_auth_uid from pos.pos_users where id = (select id from ids where name = 'user_new')),
          'e9000000-0000-0000-0000-000000000014'::uuid, 'the person follows the replacement account');
select is(pg_temp.err(format($$select pos_rpc.admin_invitation_resent('e9100000-0000-0000-0000-000000000002', %L, 'e9000000-0000-0000-0000-000000000014', true, null, 'https://admin.test/register')$$, (select id from ids where name = 'inv_new'))),
          'POS:FORBIDDEN', 'a bank-scoped admin cannot resend an administrator''s link');

-- ── Cancel ────────────────────────────────────────────────────────────────────────────────────
select is(pos_rpc.admin_invitation_cancel('e9100000-0000-0000-0000-000000000001', (select id from ids where name = 'inv_old'), 'Wrong person') ->> 'remove_auth_uid',
          'e9000000-0000-0000-0000-000000000012', 'cancel asks the API to remove the unused Auth account');
select ok((select status = 'cancelled' and cancelled_by = 'e9100000-0000-0000-0000-000000000001' and cancel_reason = 'Wrong person'
             from pos.admin_invitations where id = (select id from ids where name = 'inv_old')),
          'the cancel is recorded with who and why');
select is((select admin_auth_uid from pos.pos_users where id = 'e9100000-0000-0000-0000-000000000003'), null,
          'the person is unlinked at once, so the link gives no access');
select is(pos_rpc.admin_invitation_cancel('e9100000-0000-0000-0000-000000000001', (select id from ids where name = 'inv_old'), null) -> 'invitation' ->> 'status',
          'cancelled', 'cancelling again changes nothing');
select is(pg_temp.err(format($$select pos_rpc.admin_invitation_link('e9100000-0000-0000-0000-000000000001', %L)$$, (select id from ids where name = 'inv_old'))),
          'POS:CONFLICT', 'a cancelled link cannot be copied');
select is(pg_temp.err(format($$select pos_rpc.admin_invitation_resent('e9100000-0000-0000-0000-000000000001', %L, 'e9000000-0000-0000-0000-000000000012', true, null, 'https://admin.test/register')$$, (select id from ids where name = 'inv_old'))),
          'POS:CONFLICT', 'a cancelled link cannot be resent');
select is(pos_rpc.admin_invitation_check('e9100000-0000-0000-0000-000000000001', '{"email":"olga.new@test.local","user_id":"e9100000-0000-0000-0000-000000000003"}') ->> 'mode',
          'existing', 'after a cancel the person can be invited again');

-- ── A bank viewer, by a bank-scoped admin; the People list helper ─────────────────────────────
insert into ids select 'inv_viewer', (pos_rpc.admin_invitation_create('e9100000-0000-0000-0000-000000000002',
          '{"email":"viewer.invite@test.local","person":{"first_name":"Vuyo","last_name":"Viewer","role":"pos_bank_reader","bank_ids":["e9200000-0000-0000-0000-00000000000a"]}}',
          'e9000000-0000-0000-0000-000000000013', false, 'rate_limited', 'https://admin.test/register') -> 'invitation' ->> 'id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000002","aal":"aal1","role":"authenticated"}', true);
select ok(pos.admin_invitations_waiting() @> jsonb_build_array(jsonb_build_object('id', (select id from ids where name = 'inv_viewer'), 'can_manage', true, 'email_error', 'rate_limited')),
          'a bank-scoped admin (password only) sees the viewer they invited, and may manage it');
select ok(pos.admin_invitations_waiting() @> jsonb_build_array(jsonb_build_object('id', (select id from ids where name = 'inv_new'), 'can_manage', false)),
          'they see other waiting links, marked as not theirs to manage');
select is(jsonb_array_length(pos.admin_invitations_waiting((select id from ids where name = 'user_new'))), 1, 'filtered to one person');
select ok(not (pos.admin_invitations_waiting()::text like '%' || (select id from ids where name = 'inv_old')::text || '%'), 'cancelled links are not listed');
select ok(not (pos.admin_invitations_waiting()::text like '%tokhash%'), 'the list never carries a token');
select ok(exists (select 1 from pos.admin_invitations), 'admins can read the invitations table under RLS');
select set_config('request.jwt.claims', '{"token_use":"pos_access","pos_user_id":"e9100000-0000-0000-0000-000000000004","pos_role":"pos_agent","scope":"full","role":"authenticated"}', true);
select is(pos.admin_invitations_waiting(), '[]'::jsonb, 'an agent sees no registration links');
select ok(not exists (select 1 from pos.admin_invitations), 'an agent cannot read the invitations table');
set local role postgres;

-- ── Accept ────────────────────────────────────────────────────────────────────────────────────
select is(pos_rpc.admin_invitation_accept((select id from ids where name = 'user_new')) ->> 'accepted', 'false',
          'no password chosen yet: not accepted');
update auth.users set encrypted_password = 'bcrypt-hash', email_confirmed_at = now(), confirmation_token = '' where id = 'e9000000-0000-0000-0000-000000000014';
select is(pos_rpc.admin_invitation_accept((select id from ids where name = 'user_new')) ->> 'accepted', 'true',
          'once the password is chosen the link is accepted');
select ok((select status = 'accepted' and accepted_at is not null from pos.admin_invitations where id = (select id from ids where name = 'inv_new')),
          'accepted is recorded');
select is(pos_rpc.admin_invitation_accept((select id from ids where name = 'user_new')) ->> 'accepted', 'false', 'accepting again changes nothing');
select is(pg_temp.err(format($$select pos_rpc.admin_invitation_cancel('e9100000-0000-0000-0000-000000000001', %L, null)$$, (select id from ids where name = 'inv_new'))),
          'POS:CONFLICT', 'someone who signed up is switched off, not cancelled');
select is(pg_temp.err($$select pos_rpc.admin_invitation_accept('e9100000-0000-0000-0000-000000000004')$$), 'POS:FORBIDDEN', 'an agent cannot accept');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000001","aal":"aal1","role":"authenticated"}', true);
select ok(not (pos.admin_invitations_waiting()::text like '%' || (select id from ids where name = 'inv_new')::text || '%'), 'someone who signed up leaves the waiting list');
set local role postgres;

-- ── admin.require_mfa: off now, and the check behind it still works when switched on ─────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000001","aal":"aal1","role":"authenticated"}', true);
select is((pos.current_staff()).id, 'e9100000-0000-0000-0000-000000000001'::uuid, 'with the setting off, a password-only session is an admin');
set local role postgres;
update pos.settings set value = 'true'::jsonb where key = 'admin.require_mfa';
set local role authenticated;
select is((pos.current_staff()).id, null, 'with the setting on, a password-only session reads nothing');
select set_config('request.jwt.claims', '{"sub":"e9000000-0000-0000-0000-000000000001","aal":"aal2","role":"authenticated"}', true);
select is((pos.current_staff()).id, 'e9100000-0000-0000-0000-000000000001'::uuid, 'with the setting on, a second-step session is an admin');
set local role postgres;

-- ── Never deleted ─────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err($$delete from pos.admin_invitations$$), 'P0001', 'registration links are never deleted');
update pos.settings set value = '"a day"'::jsonb where key = 'admin.invite_ttl_hours';
select is(pg_temp.err($$select pos_rpc.invite_ttl()$$), 'POS:NOT_READY', 'a broken expiry setting stops new links (fails closed)');
update pos.settings set value = '48'::jsonb where key = 'admin.invite_ttl_hours';
select is(pg_temp.err($$select pos_rpc.invite_ttl()$$), 'POS:NOT_READY', 'an expiry longer than Supabase Auth allows is refused');

select finish();
rollback;
