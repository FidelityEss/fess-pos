-- "Preview on a phone" links (T3-12, D-101): making a link, who may, the fingerprint and size checks, expiry, opening
-- one, and that only the POS API reaches the functions. Allow AND deny cases (DEVELOPMENT-GUIDELINES §3).
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

-- ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, aud, role) values
  ('eb000000-0000-0000-0000-000000000001', 'preview.global@test.local', 'authenticated', 'authenticated'),
  ('eb000000-0000-0000-0000-000000000002', 'preview.scoped@test.local', 'authenticated', 'authenticated');
insert into pos.banks (id, code, name) values
  ('eb200000-0000-0000-0000-00000000000a', 'PRVBA', 'Preview Bank A'),
  ('eb200000-0000-0000-0000-00000000000b', 'PRVBB', 'Preview Bank B');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, bank_ids, admin_auth_uid) values
  ('eb100000-0000-0000-0000-000000000001', 'PRV-ADM1', 'Gugu', 'Global', 'pos_admin', '{}', null, 'eb000000-0000-0000-0000-000000000001'),
  ('eb100000-0000-0000-0000-000000000002', 'PRV-ADM2', 'Sipho', 'Scoped', 'pos_admin', '{}', array['eb200000-0000-0000-0000-00000000000b']::uuid[], 'eb000000-0000-0000-0000-000000000002'),
  ('eb100000-0000-0000-0000-000000000003', 'PRV-AG1', 'Ade', 'Agent', 'pos_agent', '{}', null, null);
insert into pos.definition_families (id, kind, key, scope, bank_id, title) values
  ('eb300000-0000-0000-0000-00000000000a', 'form', 'preview_test_form', 'bank', 'eb200000-0000-0000-0000-00000000000a', 'Bank A questions'),
  ('eb300000-0000-0000-0000-00000000000b', 'form', 'preview_test_form', 'bank', 'eb200000-0000-0000-0000-00000000000b', 'Bank B questions');
select pos_rpc.set_context('eb100000-0000-0000-0000-000000000001', 'pos_admin', 'pgtap-preview-links');

create function pg_temp.req(p_kind text default 'form') returns jsonb language sql as $$
  select jsonb_build_object('kind', p_kind, 'definition', jsonb_build_object('kind', p_kind, 'family', 'preview_test_form', 'sections', '[]'::jsonb),
                            'bundle', '{}'::jsonb, 'context', jsonb_build_object('today', '2026-09-15'))
$$;

-- ── Settings ──────────────────────────────────────────────────────────────────────────────────
select is(pos_rpc.setting_int('preview.link_minutes', 5, 1440), 30, 'links work for 30 minutes to start');
select ok(pos_rpc.setting('preview.link_templates') ? 'android' and pos_rpc.setting('preview.link_templates') ? 'ios',
          'a link template for each phone platform');

-- ── Only the POS API reaches the functions ────────────────────────────────────────────────────
set local role authenticated;
select is(pg_temp.err($$select pos_rpc.preview_link_open('eb100000-0000-0000-0000-000000000003', repeat('a', 64))$$), '42501',
          'a signed-in client cannot open a link through the function');
select is(pg_temp.err($$select pos_rpc.admin_preview_link_create('eb100000-0000-0000-0000-000000000001', '{}', repeat('a', 64), repeat('b', 64))$$), '42501',
          'nor make one');
set local role postgres;
set local role anon;
select is(pg_temp.err($$select pos_rpc.preview_link_open(null, repeat('a', 64))$$), '42501', 'an anonymous caller cannot either');
set local role postgres;

-- ── Making a link ─────────────────────────────────────────────────────────────────────────────
select ok((pos_rpc.admin_preview_link_create('eb100000-0000-0000-0000-000000000001',
            jsonb_build_object('kind', 'form', 'request', pg_temp.req(), 'family_id', 'eb300000-0000-0000-0000-00000000000a'),
            repeat('1', 64), repeat('2', 64)) -> 'link_templates') ? 'android', 'a global admin makes a link for bank A''s draft');
select ok((select s.kind = 'form' and s.bank_id = 'eb200000-0000-0000-0000-00000000000a' and s.created_by = 'eb100000-0000-0000-0000-000000000001'
                  and s.expires_at between now() + interval '29 minutes' and now() + interval '31 minutes' and s.request = pg_temp.req()
                  and s.request_id = 'pgtap-preview-links'
             from pos.preview_sessions s where s.token_hash = repeat('1', 64)),
          'kept with its request, bank, maker and a 30-minute expiry; only the fingerprint of the token');
select is(pg_temp.err($$select pos_rpc.admin_preview_link_create('eb100000-0000-0000-0000-000000000002',
            jsonb_build_object('kind', 'form', 'request', pg_temp.req(), 'family_id', 'eb300000-0000-0000-0000-00000000000a'), repeat('3', 64), repeat('2', 64))$$),
          'POS:FORBIDDEN', 'an admin for bank B cannot make a link for bank A''s draft');
select is(pg_temp.err($$select pos_rpc.admin_preview_link_create('eb100000-0000-0000-0000-000000000002',
            jsonb_build_object('kind', 'form', 'request', pg_temp.req(), 'family_id', 'eb300000-0000-0000-0000-00000000000b'), repeat('4', 64), repeat('2', 64))$$),
          'OK', 'but can for bank B''s');
select is(pg_temp.err($$select pos_rpc.admin_preview_link_create('eb100000-0000-0000-0000-000000000002',
            jsonb_build_object('kind', 'app', 'request', pg_temp.req('app')), repeat('5', 64), repeat('2', 64))$$),
          'POS:FORBIDDEN', 'nor a global preview (no bank)');
select is(pg_temp.err($$select pos_rpc.admin_preview_link_create('eb100000-0000-0000-0000-000000000001',
            jsonb_build_object('kind', 'app', 'request', pg_temp.req('app')), repeat('6', 64), repeat('2', 64))$$),
          'OK', 'a global admin makes a global one, e.g. App settings, with no family');
select is(pg_temp.err($$select pos_rpc.admin_preview_link_create('eb100000-0000-0000-0000-000000000003',
            jsonb_build_object('kind', 'app', 'request', pg_temp.req('app')), repeat('7', 64), repeat('2', 64))$$),
          'POS:FORBIDDEN', 'an agent cannot make one');
select is(pg_temp.err($$select pos_rpc.admin_preview_link_create('eb100000-0000-0000-0000-000000000001',
            jsonb_build_object('kind', 'flow', 'request', pg_temp.req(), 'family_id', 'eb300000-0000-0000-0000-00000000000a'), repeat('8', 64), repeat('2', 64))$$),
          'POS:INVALID_REQUEST', 'the request must be of the kind named');
select is(pg_temp.err($$select pos_rpc.admin_preview_link_create('eb100000-0000-0000-0000-000000000001',
            jsonb_build_object('kind', 'view', 'request', pg_temp.req('view'), 'family_id', 'eb300000-0000-0000-0000-00000000000a'), repeat('8', 64), repeat('2', 64))$$),
          'POS:INVALID_REQUEST', 'and of the family''s kind');
select is(pg_temp.err($$select pos_rpc.admin_preview_link_create('eb100000-0000-0000-0000-000000000001',
            jsonb_build_object('kind', 'form', 'request', pg_temp.req()), 'not-a-fingerprint', repeat('2', 64))$$),
          'POS:INVALID_REQUEST', 'a token fingerprint is required');
select is(pg_temp.err($$select pos_rpc.admin_preview_link_create('eb100000-0000-0000-0000-000000000001',
            jsonb_build_object('kind', 'form', 'request', pg_temp.req() || jsonb_build_object('bundle', jsonb_build_object('big', repeat('x', 2000001)))),
            repeat('9', 64), repeat('2', 64))$$),
          'POS:INVALID_REQUEST', 'a preview too large for a phone is refused');
select is(pg_temp.err($$select pos_rpc.admin_preview_link_create('eb100000-0000-0000-0000-000000000001',
            jsonb_build_object('kind', 'form', 'request', pg_temp.req()), repeat('1', 64), repeat('2', 64))$$),
          'POS:ALREADY_EXISTS', 'the same token twice is refused');

-- ── Opening a link ────────────────────────────────────────────────────────────────────────────
select is(pos_rpc.preview_link_open('eb100000-0000-0000-0000-000000000003', repeat('1', 64)) -> 'definition' ->> 'family', 'preview_test_form',
          'an agent opens the link and gets the draft');
select ok(pos_rpc.preview_link_open('eb100000-0000-0000-0000-000000000003', repeat('1', 64)) ?& array['kind', 'definition', 'bundle', 'context', 'expires_at'],
          'as a preview request, with when it expires');
select ok((select s.opened_count = 2 and s.last_opened_by = 'eb100000-0000-0000-0000-000000000003' and s.last_opened_at is not null
             from pos.preview_sessions s where s.token_hash = repeat('1', 64)), 'each opening is counted, with who opened it');
select is(pg_temp.err($$select pos_rpc.preview_link_open('eb100000-0000-0000-0000-000000000003', repeat('0', 64))$$), 'POS:NOT_FOUND',
          'an unknown token is not found');
update pos.preview_sessions set expires_at = now() - interval '1 second' where token_hash = repeat('1', 64);
select is(pg_temp.err($$select pos_rpc.preview_link_open('eb100000-0000-0000-0000-000000000003', repeat('1', 64))$$), 'POS:NOT_FOUND',
          'an expired one reads the same: not found');
select is(pg_temp.err($$select pos_rpc.preview_link_open('eb100000-0000-0000-0000-000000000003', 'short')$$), 'POS:NOT_FOUND',
          'nor does anything that is not a fingerprint');

-- ── Reading the table (RLS): admins only ─────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eb000000-0000-0000-0000-000000000001","aal":"aal1","role":"authenticated"}', true);
select ok(exists (select 1 from pos.preview_sessions), 'an admin can see the links');
select set_config('request.jwt.claims', '{"token_use":"pos_access","pos_user_id":"eb100000-0000-0000-0000-000000000003","pos_role":"pos_agent","scope":"full","role":"authenticated"}', true);
select ok(not exists (select 1 from pos.preview_sessions), 'an agent sees none of them');
set local role postgres;

select * from finish();
rollback;
