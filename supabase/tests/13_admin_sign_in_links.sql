-- A new sign-in link for someone who has forgotten their password (T2-37 follow-up, D-96, migration 20260915140000):
-- who may send one to whom, what is recorded, the token read back for Copy link, the record kept unchanged, and who
-- reads the record. Allow AND deny cases (DEVELOPMENT-GUIDELINES §3).
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

-- ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
-- Signed up (a password, address confirmed); 21 and 25 have a reset token waiting, 22 only in auth.one_time_tokens.
insert into auth.users (id, email, aud, role, encrypted_password, email_confirmed_at, recovery_token) values
  ('ec000000-0000-0000-0000-000000000001', 'gina.signin@test.local', 'authenticated', 'authenticated', 'x', now(), ''),
  ('ec000000-0000-0000-0000-000000000002', 'ben.signin@test.local', 'authenticated', 'authenticated', 'x', now(), ''),
  ('ec000000-0000-0000-0000-000000000021', 'Vera.Viewer@Test.Local', 'authenticated', 'authenticated', 'x', now(), 'rtok-21'),
  ('ec000000-0000-0000-0000-000000000022', 'otto.other@test.local', 'authenticated', 'authenticated', 'x', now(), ''),
  ('ec000000-0000-0000-0000-000000000024', 'ivy.inactive@test.local', 'authenticated', 'authenticated', 'x', now(), ''),
  ('ec000000-0000-0000-0000-000000000025', 'rita.reader@test.local', 'authenticated', 'authenticated', 'x', now(), 'rtok-25');
-- Invited, not signed up: no password, not confirmed.
insert into auth.users (id, email, aud, role, encrypted_password, confirmation_token, invited_at) values
  ('ec000000-0000-0000-0000-000000000023', 'nina.new@test.local', 'authenticated', 'authenticated', '', 'ctok-23', now());
insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to) values
  (gen_random_uuid(), 'ec000000-0000-0000-0000-000000000022', 'recovery_token', 'ott-22', 'otto.other@test.local');
insert into pos.banks (id, code, name) values
  ('ec200000-0000-0000-0000-00000000000a', 'SIGBA', 'Sign-in Bank A'),
  ('ec200000-0000-0000-0000-00000000000b', 'SIGBB', 'Sign-in Bank B');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, bank_ids, admin_auth_uid, active) values
  ('ec100000-0000-0000-0000-000000000001', 'SIG-ADM1', 'Gina', 'Global', 'pos_admin', '{}', null, 'ec000000-0000-0000-0000-000000000001', true),
  ('ec100000-0000-0000-0000-000000000002', 'SIG-ADM2', 'Ben', 'Banka', 'pos_admin', '{}', array['ec200000-0000-0000-0000-00000000000a']::uuid[], 'ec000000-0000-0000-0000-000000000002', true),
  ('ec100000-0000-0000-0000-000000000021', 'SIG-RDR1', 'Vera', 'Viewer', 'pos_bank_reader', '{}', array['ec200000-0000-0000-0000-00000000000a']::uuid[], 'ec000000-0000-0000-0000-000000000021', true),
  ('ec100000-0000-0000-0000-000000000022', 'SIG-RDR2', 'Otto', 'Other', 'pos_bank_reader', '{}', array['ec200000-0000-0000-0000-00000000000b']::uuid[], 'ec000000-0000-0000-0000-000000000022', true),
  ('ec100000-0000-0000-0000-000000000023', 'SIG-ADM3', 'Nina', 'New', 'pos_admin', '{}', null, 'ec000000-0000-0000-0000-000000000023', true),
  ('ec100000-0000-0000-0000-000000000024', 'SIG-RDR4', 'Ivy', 'Inactive', 'pos_bank_reader', '{}', array['ec200000-0000-0000-0000-00000000000a']::uuid[], 'ec000000-0000-0000-0000-000000000024', false),
  ('ec100000-0000-0000-0000-000000000025', 'SIG-RDR5', 'Rita', 'Reader', 'pos_bank_reader', '{}', array['ec200000-0000-0000-0000-00000000000a']::uuid[], 'ec000000-0000-0000-0000-000000000025', true),
  ('ec100000-0000-0000-0000-000000000026', 'SIG-OLD', 'Olga', 'Oldhand', 'pos_admin', '{}', null, null, true),
  ('ec100000-0000-0000-0000-000000000031', 'SIG-AG1', 'Ade', 'Agent', 'pos_agent', '{}', array['ec200000-0000-0000-0000-00000000000a']::uuid[], null, true);
select pos_rpc.set_context('ec100000-0000-0000-0000-000000000001', 'pos_admin', 'pgtap-sign-in-links');
-- The 24-hour default, whatever this project runs today (rolled back at the end).
update pos.settings set value = '24'::jsonb where key = 'admin.invite_ttl_hours';

-- ── Only the POS API reaches the functions ────────────────────────────────────────────────────
set local role authenticated;
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_check('ec100000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000021')$$),
          '42501', 'a signed-in client cannot call the sign-in link functions');
set local role postgres;
set local role anon;
select is(pg_temp.err($$select pos_rpc.recovery_token_hash('ec000000-0000-0000-0000-000000000021')$$), '42501',
          'an anonymous caller cannot read a reset token');
set local role postgres;

-- ── Who may be sent a link, by whom ───────────────────────────────────────────────────────────
select is(pos_rpc.admin_sign_in_link_check('ec100000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000021'),
          jsonb_build_object('user_id', 'ec100000-0000-0000-0000-000000000021', 'auth_uid', 'ec000000-0000-0000-0000-000000000021',
                             'email', 'vera.viewer@test.local'),
          'a global admin may send a signed-up bank viewer a link, to the address they sign in with (lower-cased)');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_check('ec100000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000002')$$),
          'OK', 'and another admin');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_check('ec100000-0000-0000-0000-000000000002', 'ec100000-0000-0000-0000-000000000021')$$),
          'OK', 'a bank-scoped admin may send one to a bank viewer of their bank');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_check('ec100000-0000-0000-0000-000000000002', 'ec100000-0000-0000-0000-000000000022')$$),
          'POS:FORBIDDEN', 'but not to a bank viewer of another bank');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_check('ec100000-0000-0000-0000-000000000002', 'ec100000-0000-0000-0000-000000000001')$$),
          'POS:FORBIDDEN', 'nor to a global admin');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_check('ec100000-0000-0000-0000-000000000021', 'ec100000-0000-0000-0000-000000000025')$$),
          'POS:FORBIDDEN', 'a bank viewer cannot send links');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_check('ec100000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000031')$$),
          'POS:CONFLICT', 'agents get no sign-in link (they use the FESS app)');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_check('ec100000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000023')$$),
          'POS:CONFLICT', 'someone who hasn''t chosen a password yet gets their registration link instead');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_check('ec100000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000026')$$),
          'POS:CONFLICT', 'someone with no sign-in at all too');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_check('ec100000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000024')$$),
          'POS:CONFLICT', 'a switched-off person gets no link');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_check('ec100000-0000-0000-0000-000000000001', gen_random_uuid())$$),
          'POS:NOT_FOUND', 'an unknown person is not found');

-- ── Recording a link, and the token for Copy link ─────────────────────────────────────────────
select is(pos_rpc.admin_sign_in_link_sent('ec100000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000021',
            'ec000000-0000-0000-0000-000000000021', false, 'not_allowed', 'https://admin.test/register') ->> 'token_hash',
          'rtok-21', 'the waiting reset token comes back, so Copy link gives the emailed link');
select ok((select l.email = 'vera.viewer@test.local' and l.sent_by = 'ec100000-0000-0000-0000-000000000001' and not l.email_sent
                  and l.email_error = 'not_allowed' and l.request_id = 'pgtap-sign-in-links'
                  and l.expires_at between now() + interval '24 hours' - interval '1 minute' and now() + interval '24 hours' + interval '1 minute'
             from pos.admin_sign_in_links l where l.user_id = 'ec100000-0000-0000-0000-000000000021'),
          'the link is recorded: for whom, by whom, not emailed and why, and a 24-hour expiry');
select ok(exists (select 1 from pos.audit_log a where a.table_name = 'admin_sign_in_links'
                   and a.actor_id = 'ec100000-0000-0000-0000-000000000001'), 'it is in the activity history');
select is(pos_rpc.admin_sign_in_link_sent('ec100000-0000-0000-0000-000000000002', 'ec100000-0000-0000-0000-000000000025',
            'ec000000-0000-0000-0000-000000000025', true, null, 'https://admin.test/register') -> 'sign_in_link' ->> 'email_error',
          null, 'an emailed link records no email problem');
select is(pos_rpc.recovery_token_hash('ec000000-0000-0000-0000-000000000022'), 'ott-22',
          'the token is also found where newer Supabase Auth keeps it (auth.one_time_tokens)');
select is(pos_rpc.recovery_token_hash('ec000000-0000-0000-0000-000000000002'), null, 'no token waiting: null');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_sent('ec100000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000021',
            'ec000000-0000-0000-0000-000000000022', true, null, 'https://admin.test/register')$$),
          'POS:CONFLICT', 'a link for a different sign-in than the person''s is refused');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_sent('ec100000-0000-0000-0000-000000000002', 'ec100000-0000-0000-0000-000000000022',
            'ec000000-0000-0000-0000-000000000022', true, null, 'https://admin.test/register')$$),
          'POS:FORBIDDEN', 'recording re-checks the scope');
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_sent('ec100000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000021',
            'ec000000-0000-0000-0000-000000000021', true, null, 'https://admin.test/somewhere-else')$$),
          '23514', 'the link must open the panel''s /register page');
update pos.settings set value = '0'::jsonb where key = 'admin.invite_ttl_hours';
select is(pg_temp.err($$select pos_rpc.admin_sign_in_link_sent('ec100000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000021',
            'ec000000-0000-0000-0000-000000000021', true, null, 'https://admin.test/register')$$),
          'POS:NOT_READY', 'an unset link lifetime stops it (fails closed)');
update pos.settings set value = '24'::jsonb where key = 'admin.invite_ttl_hours';

-- ── The record is kept as it was ──────────────────────────────────────────────────────────────
select throws_ok($$update pos.admin_sign_in_links set email_sent = true, email_error = null$$, 'P0001', null, 'a sign-in link record cannot be changed');
select throws_ok($$delete from pos.admin_sign_in_links$$, 'P0001', null, 'nor deleted');
select is((select count(*) from pos.admin_sign_in_links where not email_sent), 1::bigint, 'the record is still there, unchanged');

-- ── Who reads the records ─────────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ec000000-0000-0000-0000-000000000001","aal":"aal1","role":"authenticated"}', true);
select is((select count(*) from pos.admin_sign_in_links), 2::bigint, 'an admin reads the sign-in links sent');
select set_config('request.jwt.claims', '{"sub":"ec000000-0000-0000-0000-000000000025","aal":"aal1","role":"authenticated"}', true);
select is((select count(*) from pos.admin_sign_in_links), 0::bigint, 'a bank viewer reads none, not even their own');
select set_config('request.jwt.claims', '{"token_use":"pos_access","pos_user_id":"ec100000-0000-0000-0000-000000000031","pos_role":"pos_agent","scope":"full","role":"authenticated"}', true);
select is((select count(*) from pos.admin_sign_in_links), 0::bigint, 'an agent reads none');
select throws_ok($$insert into pos.admin_sign_in_links (user_id, email, register_url, email_sent, expires_at, sent_by)
                    values ('ec100000-0000-0000-0000-000000000021', 'x@test.local', 'https://a.test/register', true, now(),
                            'ec100000-0000-0000-0000-000000000001')$$,
                 '42501', null, 'nobody writes them directly');
set local role postgres;

select finish();
rollback;
