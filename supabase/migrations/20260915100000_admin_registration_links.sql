-- FESS POS — admin sign-up by a one-time registration link; the authenticator-app step switched off
-- (T2-37, D-96, R-51, B7.8, docs/07 §2, docs/17 §4.9).
--
-- An admin adds a person on People and sends them a registration link. The POS API asks Supabase Auth to invite the
-- address: the email goes out through Supabase Auth, and when it can't be sent the link is still made so the admin can
-- copy it. The link is Supabase Auth's own single-use invite token. This table records who was invited, by whom, when the
-- link stops working and what happened to it. The token is never stored here: Copy link reads it from Supabase Auth when
-- asked, so copying gives the same link as the email and cancels nothing.
--
-- admin.require_mfa becomes false (D-96): admins sign in with email and password. The setting and every check behind it
-- stay (pos.current_staff() below in 20260911100800, _shared/auth.ts), so a second step can come back as configuration.
-- On production this migration arrives only with the next promotion, which needs Lebogang's approval (instructions §11).
--
-- Expand-only: one new table, new functions, one new setting and one changed setting. Reverse: set admin.require_mfa back
-- to true. The table and functions can then be dropped; nothing else depends on them.

-- ── Settings ───────────────────────────────────────────────────────────────────────────────────
update pos.settings
   set value = 'false'::jsonb,
       note = 'true: admins need a second sign-in step (aal2) for every read under RLS and every admin API call. '
              'false since D-96 (2026-09-15): email and password only. Set true to require a second step again'
 where key = 'admin.require_mfa';

insert into pos.settings (key, value, note) values
  ('admin.invite_ttl_hours', '24'::jsonb,
   'How long a registration link works, in hours (1–24, D-96). Keep it equal to Supabase Auth [auth.email] otp_expiry / 3600, '
   'which is what really ends the link')
on conflict (key) do nothing;

-- ── Registration links ─────────────────────────────────────────────────────────────────────────
create table pos.admin_invitations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references pos.pos_users (id),
  email          text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  auth_uid       uuid references auth.users (id) on delete set null,        -- the Supabase Auth account the link signs in to
  register_url   text not null check (register_url ~ '^https?://[^/?#]+/register$'),
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  email_sent     boolean not null,                                          -- false: made, but the admin must copy it
  email_error    text check (email_error in ('not_allowed', 'rate_limited', 'failed')),
  send_count     integer not null default 1 check (send_count >= 1),
  last_sent_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  link_copies    integer not null default 0 check (link_copies >= 0),
  last_copied_at timestamptz,
  invited_by     uuid not null references pos.pos_users (id),
  accepted_at    timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   uuid references pos.pos_users (id),
  cancel_reason  text,
  request_id     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((status = 'accepted') = (accepted_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
comment on table pos.admin_invitations is
  'Registration links for admins and bank viewers (D-96). The token lives only in Supabase Auth; nothing secret is kept here.';
create unique index admin_invitations_one_pending on pos.admin_invitations (user_id) where status = 'pending';
create index admin_invitations_status_idx on pos.admin_invitations (status, last_sent_at desc);

create trigger no_delete before delete on pos.admin_invitations for each row execute function pos.tg_no_delete();
create trigger no_truncate before truncate on pos.admin_invitations for each statement execute function pos.tg_no_delete();
create trigger touch_updated_at before update on pos.admin_invitations for each row execute function pos.tg_touch_updated_at();
create trigger audit after insert or update or delete on pos.admin_invitations for each row execute function pos.tg_audit();

alter table pos.admin_invitations enable row level security;
grant select on pos.admin_invitations to authenticated, service_role;
create policy admin_invitations_read on pos.admin_invitations for select to authenticated using ((select pos.is_admin()));

-- ── Helpers (service_role only, like every pos_rpc function) ──────────────────────────────────
-- How long a new link works. Fails closed: a missing or out-of-range setting stops the invite (DEVELOPMENT-GUIDELINES §2).
create function pos_rpc.invite_ttl()
returns interval language plpgsql stable security definer set search_path = '' as $$
declare v integer;
begin
  select case when jsonb_typeof(s.value) = 'number' and (s.value)::text ~ '^[0-9]{1,3}$' then (s.value)::text::integer end
    into v from pos.settings s where s.key = 'admin.invite_ttl_hours';
  if v is null or v < 1 or v > 24 then
    perform pos_rpc.fail('NOT_READY', 'admin.invite_ttl_hours must be set to a whole number of hours from 1 to 24');
  end if;
  return make_interval(hours => v);
end $$;

-- Supabase Auth's view of an invited account. has_password = the person finished signing up; confirmed = the link was
-- opened (Supabase Auth confirms the address when the invite token is used).
create function pos_rpc.invite_auth_state(p_auth_uid uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('exists', true, 'confirmed', u.email_confirmed_at is not null,
                               'has_password', coalesce(u.encrypted_password, '') <> '', 'last_sign_in_at', u.last_sign_in_at)
       from auth.users u where u.id = p_auth_uid),
    jsonb_build_object('exists', false, 'confirmed', false, 'has_password', false, 'last_sign_in_at', null));
$$;

-- The invite token Supabase Auth is waiting for (the same value its email carries as {{ .TokenHash }}), or null once the
-- link has been used. Returned only to the POS API for Copy link; never stored or logged.
create function pos_rpc.invite_token_hash(p_auth_uid uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select nullif(u.confirmation_token, '') into v from auth.users u where u.id = p_auth_uid and u.email_confirmed_at is null;
  if v is null and to_regclass('auth.one_time_tokens') is not null
     and exists (select 1 from auth.users u where u.id = p_auth_uid and u.email_confirmed_at is null) then
    execute 'select t.token_hash from auth.one_time_tokens t where t.user_id = $1 and t.token_type::text = ''confirmation_token''
              order by t.created_at desc limit 1' into v using p_auth_uid;
  end if;
  return v;
end $$;

-- Who may be invited. Called before the API asks Supabase Auth to create an account (so nothing is created for someone
-- this admin may not add), and again inside admin_invitation_create. Input: {email, user_id} for someone already on
-- People, or {email, person: {first_name, last_name, role, permissions, bank_ids, employee_number?, phone?, attributes?}}.
create function pos_rpc.admin_invitation_check(p_actor uuid, p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.pos_users;
  v_email text;
  v_user_id uuid;
  v_person jsonb;
  v_role pos.pos_role;
  v_perms text[];
  v_banks uuid[];
begin
  v_actor := pos_rpc.require_staff(p_actor);
  v_email := lower(pos_rpc.in_text(p_input, 'email', true, 320));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform pos_rpc.fail('INVALID_REQUEST', 'the email address is not valid', jsonb_build_object('path', 'email'));
  end if;
  if (p_input ? 'user_id') = (p_input ? 'person') then
    perform pos_rpc.fail('INVALID_REQUEST', 'give either user_id (someone already on People) or person (someone new)');
  end if;
  if p_input ? 'user_id' then
    begin
      v_user_id := (p_input ->> 'user_id')::uuid;
    exception when invalid_text_representation then
      perform pos_rpc.fail('INVALID_REQUEST', 'user_id must be a uuid', jsonb_build_object('path', 'user_id'));
    end;
  end if;
  -- One email, one sign-in: refuse an address someone else already signs in with.
  if exists (select 1 from auth.users au join pos.pos_users pu on pu.admin_auth_uid = au.id
              where lower(au.email) = v_email and pu.id is distinct from v_user_id) then
    perform pos_rpc.fail('ALREADY_EXISTS', 'someone else already signs in with this email address', jsonb_build_object('path', 'email'));
  end if;

  if v_user_id is not null then
    select * into v from pos.pos_users where id = v_user_id;
    if not found then perform pos_rpc.fail('NOT_FOUND', 'person not found'); end if;
    if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then
      perform pos_rpc.fail('FORBIDDEN', 'this person is outside the banks you look after');
    end if;
    if v.role = 'pos_agent' then
      perform pos_rpc.fail('CONFLICT', 'agents sign in through the FESS app, not the admin panel');
    end if;
    if not v.active then perform pos_rpc.fail('CONFLICT', 'this person is switched off; switch them back on first'); end if;
    if v.admin_auth_uid is not null then
      if exists (select 1 from pos.admin_invitations i where i.user_id = v.id and i.status = 'pending') then
        perform pos_rpc.fail('ALREADY_EXISTS', 'this person already has a registration link waiting; resend it instead');
      end if;
      perform pos_rpc.fail('ALREADY_EXISTS', 'this person can already sign in');
    end if;
    return jsonb_build_object('mode', 'existing', 'user_id', v.id, 'email', v_email);
  end if;

  v_person := pos_rpc.in_object(p_input, 'person', null);
  if v_person is null then perform pos_rpc.fail('INVALID_REQUEST', 'person is required', jsonb_build_object('path', 'person')); end if;
  begin
    v_role := pos_rpc.in_text(v_person, 'role', true)::pos.pos_role;
  exception when invalid_text_representation then
    perform pos_rpc.fail('INVALID_REQUEST', 'unknown role', jsonb_build_object('path', 'person.role'));
  end;
  if v_role = 'pos_agent' then
    perform pos_rpc.fail('INVALID_REQUEST', 'agents sign in through the FESS app; add them without a registration link',
                         jsonb_build_object('path', 'person.role'));
  end if;
  v_perms := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(v_person -> 'permissions') = 'array'
                                                                  then v_person -> 'permissions' else '[]'::jsonb end)), '{}');
  v_banks := pos_rpc.in_uuid_array(v_person, 'bank_ids');
  perform pos_rpc.admin_user_check_input(v_role, v_perms, v_banks);
  if not pos_rpc.admin_can_manage_user(v_actor, v_role, v_banks) then
    perform pos_rpc.fail('FORBIDDEN', 'you can only add bank viewers for your own banks');
  end if;
  perform pos_rpc.in_text(v_person, 'first_name', true, 120);
  perform pos_rpc.in_text(v_person, 'last_name', true, 120);
  if nullif(btrim(v_person ->> 'employee_number'), '') is not null
     and exists (select 1 from pos.pos_users u where u.employee_number = btrim(v_person ->> 'employee_number')) then
    perform pos_rpc.fail('ALREADY_EXISTS', 'someone already has this employee number', jsonb_build_object('path', 'person.employee_number'));
  end if;
  return jsonb_build_object('mode', 'new', 'email', v_email);
end $$;

-- After Supabase Auth made the account (p_auth_uid): add the person when new, link the account, record the link. One
-- transaction; the API removes the Auth account again if this fails. Returns the invitation, the person and the token.
create function pos_rpc.admin_invitation_create(p_actor uuid, p_input jsonb, p_auth_uid uuid, p_email_sent boolean,
                                                p_email_error text, p_register_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_check jsonb;
  v_person jsonb;
  v_user_id uuid;
  v_inv pos.admin_invitations;
begin
  v_check := pos_rpc.admin_invitation_check(p_actor, p_input);
  if p_auth_uid is null then perform pos_rpc.fail('INVALID_REQUEST', 'auth account missing'); end if;
  if v_check ->> 'mode' = 'new' then
    v_person := p_input -> 'person';
    -- Admins are not bound to a FESS identity, so an employee number is optional for them; one is made up if missing.
    if nullif(btrim(v_person ->> 'employee_number'), '') is null then
      v_person := v_person || jsonb_build_object('employee_number', 'STAFF-' || upper(pos.random_token_hex(4)));
    end if;
    v_user_id := (pos_rpc.admin_user_create(p_actor, v_person || jsonb_build_object('email', v_check ->> 'email')) ->> 'id')::uuid;
  else
    v_user_id := (v_check ->> 'user_id')::uuid;
    update pos.pos_users set email = v_check ->> 'email', request_id = nullif(current_setting('pos.request_id', true), '')
     where id = v_user_id and email is null;
  end if;
  perform pos_rpc.admin_user_link_auth(p_actor, v_user_id, p_auth_uid);
  insert into pos.admin_invitations (user_id, email, auth_uid, register_url, email_sent, email_error, expires_at, invited_by,
                                     request_id)
  values (v_user_id, v_check ->> 'email', p_auth_uid, p_register_url, coalesce(p_email_sent, false),
          case when coalesce(p_email_sent, false) then null else coalesce(p_email_error, 'failed') end,
          now() + pos_rpc.invite_ttl(), p_actor, nullif(current_setting('pos.request_id', true), ''))
  returning * into v_inv;
  return jsonb_build_object('invitation', to_jsonb(v_inv),
                            'user', (select to_jsonb(u) from pos.pos_users u where u.id = v_user_id),
                            'token_hash', pos_rpc.invite_token_hash(p_auth_uid));
end $$;

-- Read-only: one link and the state of its Auth account, after the scope check (used before Resend and Cancel).
create function pos_rpc.admin_invitation_get(p_actor uuid, p_invitation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v_inv pos.admin_invitations;
  v pos.pos_users;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  select * into v_inv from pos.admin_invitations where id = p_invitation_id;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'registration link not found'); end if;
  select * into v from pos.pos_users where id = v_inv.user_id;
  if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then
    perform pos_rpc.fail('FORBIDDEN', 'this person is outside the banks you look after');
  end if;
  return to_jsonb(v_inv) || jsonb_build_object('auth', pos_rpc.invite_auth_state(v_inv.auth_uid), 'user_active', v.active,
                                               'user_auth_uid', v.admin_auth_uid);
end $$;

-- Resend: Supabase Auth made a new token (the earlier link stops working) and, when the old account had to be replaced,
-- a new account. Records it and starts a fresh expiry.
create function pos_rpc.admin_invitation_resent(p_actor uuid, p_invitation_id uuid, p_auth_uid uuid, p_email_sent boolean,
                                                p_email_error text, p_register_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v_inv pos.admin_invitations;
  v pos.pos_users;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  select * into v_inv from pos.admin_invitations where id = p_invitation_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'registration link not found'); end if;
  select * into v from pos.pos_users where id = v_inv.user_id for update;
  if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then
    perform pos_rpc.fail('FORBIDDEN', 'this person is outside the banks you look after');
  end if;
  if v_inv.status <> 'pending' then
    perform pos_rpc.fail('CONFLICT', format('this registration link was %s', v_inv.status), jsonb_build_object('reason', v_inv.status));
  end if;
  if not v.active then perform pos_rpc.fail('CONFLICT', 'this person is switched off; switch them back on first'); end if;
  if not exists (select 1 from auth.users u where u.id = p_auth_uid) then perform pos_rpc.fail('NOT_FOUND', 'auth account not found'); end if;
  if (pos_rpc.invite_auth_state(p_auth_uid) ->> 'has_password')::boolean then
    perform pos_rpc.fail('CONFLICT', 'this person has already signed up', jsonb_build_object('reason', 'accepted'));
  end if;
  if v.admin_auth_uid is distinct from p_auth_uid then
    if v.admin_auth_uid is not null and v.admin_auth_uid is distinct from v_inv.auth_uid then
      perform pos_rpc.fail('CONFLICT', 'this person is linked to a different sign-in');
    end if;
    update pos.pos_users set admin_auth_uid = p_auth_uid, request_id = nullif(current_setting('pos.request_id', true), '')
     where id = v.id;
  end if;
  update pos.admin_invitations
     set auth_uid = p_auth_uid, register_url = p_register_url, email_sent = coalesce(p_email_sent, false),
         email_error = case when coalesce(p_email_sent, false) then null else coalesce(p_email_error, 'failed') end,
         send_count = send_count + 1, last_sent_at = now(), expires_at = now() + pos_rpc.invite_ttl(),
         request_id = nullif(current_setting('pos.request_id', true), '')
   where id = p_invitation_id
  returning * into v_inv;
  return jsonb_build_object('invitation', to_jsonb(v_inv), 'token_hash', pos_rpc.invite_token_hash(p_auth_uid));
end $$;

-- Copy link: the link that is waiting (the one in the email), without making a new one. Counted, so the activity history
-- shows who copied it and when.
create function pos_rpc.admin_invitation_link(p_actor uuid, p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v_inv pos.admin_invitations;
  v pos.pos_users;
  v_token text;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  select * into v_inv from pos.admin_invitations where id = p_invitation_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'registration link not found'); end if;
  select * into v from pos.pos_users where id = v_inv.user_id;
  if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then
    perform pos_rpc.fail('FORBIDDEN', 'this person is outside the banks you look after');
  end if;
  if v_inv.status <> 'pending' then
    perform pos_rpc.fail('CONFLICT', format('this registration link was %s', v_inv.status), jsonb_build_object('reason', v_inv.status));
  end if;
  if v_inv.expires_at <= now() then
    perform pos_rpc.fail('CONFLICT', 'this registration link has expired; send a new one', jsonb_build_object('reason', 'expired'));
  end if;
  v_token := pos_rpc.invite_token_hash(v_inv.auth_uid);
  if v_token is null then
    perform pos_rpc.fail('CONFLICT', 'this registration link has already been used; send a new one', jsonb_build_object('reason', 'used'));
  end if;
  update pos.admin_invitations set link_copies = link_copies + 1, last_copied_at = now(),
                                   request_id = nullif(current_setting('pos.request_id', true), '')
   where id = p_invitation_id returning * into v_inv;
  return jsonb_build_object('invitation', to_jsonb(v_inv), 'token_hash', v_token);
end $$;

-- Cancel: the link stops giving access at once (the person is unlinked here); the API then removes the unused Auth account
-- (remove_auth_uid), which makes the link itself stop working. Repeating a cancel only repeats that removal.
create function pos_rpc.admin_invitation_cancel(p_actor uuid, p_invitation_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v_inv pos.admin_invitations;
  v pos.pos_users;
  v_state jsonb;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  select * into v_inv from pos.admin_invitations where id = p_invitation_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'registration link not found'); end if;
  select * into v from pos.pos_users where id = v_inv.user_id for update;
  if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then
    perform pos_rpc.fail('FORBIDDEN', 'this person is outside the banks you look after');
  end if;
  v_state := pos_rpc.invite_auth_state(v_inv.auth_uid);
  if v_inv.status = 'accepted' or (v_state ->> 'has_password')::boolean then
    perform pos_rpc.fail('CONFLICT', 'this person has already signed up; switch them off instead', jsonb_build_object('reason', 'accepted'));
  end if;
  if v_inv.status = 'pending' then
    update pos.admin_invitations
       set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor, cancel_reason = nullif(btrim(p_reason), ''),
           request_id = nullif(current_setting('pos.request_id', true), '')
     where id = p_invitation_id returning * into v_inv;
    update pos.pos_users set admin_auth_uid = null, request_id = nullif(current_setting('pos.request_id', true), '')
     where id = v.id and admin_auth_uid = v_inv.auth_uid;
  end if;
  return jsonb_build_object('invitation', to_jsonb(v_inv),
                            'remove_auth_uid', case when (v_state ->> 'exists')::boolean then v_inv.auth_uid end);
end $$;

-- The registration page calls this once the person has chosen a password. p_actor is the new person themself (an admin
-- or a bank viewer). Idempotent; the People list also works it out from Supabase Auth if this call never arrives.
create function pos_rpc.admin_invitation_accept(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.pos_users;
  v_inv pos.admin_invitations;
begin
  select * into v from pos.pos_users where id = p_actor;
  if not found or not v.active or v.role not in ('pos_admin', 'pos_bank_reader') or v.admin_auth_uid is null then
    perform pos_rpc.fail('FORBIDDEN', 'not an active admin or bank viewer');
  end if;
  update pos.admin_invitations i
     set status = 'accepted', accepted_at = now(), request_id = nullif(current_setting('pos.request_id', true), '')
   where i.user_id = p_actor and i.status = 'pending' and i.auth_uid = v.admin_auth_uid
     and (pos_rpc.invite_auth_state(i.auth_uid) ->> 'has_password')::boolean
  returning * into v_inv;
  return jsonb_build_object('accepted', v_inv.id is not null, 'invitation_id', v_inv.id);
end $$;

-- ── Read helper for the admin panel (PostgREST, like pos.admin_dashboard) ─────────────────────
-- Links still waiting: sent, and the person hasn't chosen a password yet. Optionally for one person. Admins only.
create function pos.admin_invitations_waiting(p_user_id uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'last_sent_at' desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id', i.id, 'user_id', i.user_id, 'email', i.email,
               'first_name', u.first_name, 'last_name', u.last_name, 'role', u.role, 'bank_ids', u.bank_ids,
               'email_sent', i.email_sent, 'email_error', i.email_error, 'send_count', i.send_count,
               'last_sent_at', i.last_sent_at, 'expires_at', i.expires_at, 'expired', i.expires_at <= now(),
               'opened', au.email_confirmed_at is not null, 'link_copies', i.link_copies,
               'invited_by', i.invited_by, 'invited_by_name', btrim(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, '')),
               'created_at', i.created_at,
               'can_manage', pos_rpc.admin_can_manage_user(pos.current_staff(), u.role, u.bank_ids)) as x
        from pos.admin_invitations i
        join pos.pos_users u on u.id = i.user_id
        left join pos.pos_users b on b.id = i.invited_by
        left join auth.users au on au.id = i.auth_uid
       where i.status = 'pending'
         and pos.is_admin()
         and (p_user_id is null or i.user_id = p_user_id)
         and coalesce(au.encrypted_password, '') = ''
    ) q;
$$;
grant execute on function pos.admin_invitations_waiting(uuid) to authenticated, service_role;
