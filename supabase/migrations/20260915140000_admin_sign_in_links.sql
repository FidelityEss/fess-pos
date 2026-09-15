-- FESS POS — a new sign-in link for an admin or bank viewer who has forgotten their password (T2-37 follow-up, D-96,
-- B7.8, docs/07 §2, docs/17 §4.9).
--
-- Two ways to a new password, both through Supabase Auth's own single-use password-reset (recovery) token, landing on the
-- panel's /register page (?token_hash=…&type=recovery), which spends the token only when the new password is submitted:
--   1. "Forgot your password?" on /sign-in: the person asks Supabase Auth directly. Nothing here is involved, and the
--      page answers the same whether or not the address has an account.
--   2. "Send a new sign-in link" on a person's page: an admin asks the POS API, which checks actor and scope here, asks
--      Supabase Auth to email the link and, when the email can't go, makes it for Copy link (like a registration link).
--      Each link sent is recorded in pos.admin_sign_in_links (who, for whom, when, emailed or not) and audited. The
--      token is never stored here: it is read from Supabase Auth only to give the admin the same link as the email.
--
-- Expand-only: one new table and new functions; the note of admin.invite_ttl_hours now mentions sign-in links too.
-- Reverse: drop the functions and the table (nothing depends on them) and restore the note.

-- ── Settings ───────────────────────────────────────────────────────────────────────────────────
update pos.settings
   set note = 'How long a registration link or a sign-in link works, in hours (1–24, D-96). Keep it equal to Supabase Auth '
              '[auth.email] otp_expiry / 3600, which is what really ends both links'
 where key = 'admin.invite_ttl_hours';

-- ── Sign-in links sent by an admin ─────────────────────────────────────────────────────────────
create table pos.admin_sign_in_links (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references pos.pos_users (id),
  email        text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  auth_uid     uuid references auth.users (id) on delete set null,          -- the Supabase Auth account the link resets
  register_url text not null check (register_url ~ '^https?://[^/?#]+/register$'),
  email_sent   boolean not null,                                            -- false: made, but the admin must copy it
  email_error  text check (email_error in ('not_allowed', 'rate_limited', 'failed')),
  expires_at   timestamptz not null,
  sent_by      uuid not null references pos.pos_users (id),
  request_id   text,
  created_at   timestamptz not null default now(),
  check (email_sent = (email_error is null))
);
comment on table pos.admin_sign_in_links is
  'Sign-in (password reset) links an admin sent to an admin or bank viewer (D-96). Append-only; the token lives only in '
  'Supabase Auth.';
create index admin_sign_in_links_user_idx on pos.admin_sign_in_links (user_id, created_at desc);

create trigger append_only before update or delete on pos.admin_sign_in_links for each row execute function pos.tg_append_only();
create trigger no_truncate before truncate on pos.admin_sign_in_links for each statement execute function pos.tg_no_delete();
create trigger audit after insert on pos.admin_sign_in_links for each row execute function pos.tg_audit();

alter table pos.admin_sign_in_links enable row level security;
grant select on pos.admin_sign_in_links to authenticated, service_role;
create policy admin_sign_in_links_read on pos.admin_sign_in_links for select to authenticated using ((select pos.is_admin()));

-- ── Helpers (service_role only, like every pos_rpc function) ──────────────────────────────────
-- The password-reset token Supabase Auth is waiting for (the value its email carries as {{ .TokenHash }}), or null when
-- none is waiting. Returned only to the POS API for Copy link; never stored or logged.
create function pos_rpc.recovery_token_hash(p_auth_uid uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select nullif(u.recovery_token, '') into v from auth.users u where u.id = p_auth_uid;
  if v is null and to_regclass('auth.one_time_tokens') is not null then
    execute 'select t.token_hash from auth.one_time_tokens t where t.user_id = $1 and t.token_type::text = ''recovery_token''
              order by t.created_at desc limit 1' into v using p_auth_uid;
  end if;
  return v;
end $$;

-- Who may be sent a new sign-in link: an active admin or bank viewer who has signed up (chosen a password), within the
-- actor's scope. Called before the API asks Supabase Auth for the link, and again when it is recorded. Returns the
-- address Supabase Auth knows them by, which is where the link goes.
create function pos_rpc.admin_sign_in_link_check(p_actor uuid, p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.pos_users;
  v_state jsonb;
  v_email text;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  select * into v from pos.pos_users where id = p_user_id;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'person not found'); end if;
  if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then
    perform pos_rpc.fail('FORBIDDEN', 'this person is outside the banks you look after');
  end if;
  if v.role = 'pos_agent' then
    perform pos_rpc.fail('CONFLICT', 'agents sign in through the FESS app, not the admin panel', jsonb_build_object('reason', 'agent'));
  end if;
  if not v.active then
    perform pos_rpc.fail('CONFLICT', 'this person is switched off; switch them back on first', jsonb_build_object('reason', 'inactive'));
  end if;
  v_state := pos_rpc.invite_auth_state(v.admin_auth_uid);
  if v.admin_auth_uid is null or not (v_state ->> 'exists')::boolean or not (v_state ->> 'has_password')::boolean then
    perform pos_rpc.fail('CONFLICT', 'this person hasn''t finished signing up yet; send them a registration link instead',
                         jsonb_build_object('reason', 'not_signed_up'));
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v.admin_auth_uid;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+$' then
    perform pos_rpc.fail('CONFLICT', 'this person''s sign-in has no email address', jsonb_build_object('reason', 'no_email'));
  end if;
  return jsonb_build_object('user_id', v.id, 'auth_uid', v.admin_auth_uid, 'email', v_email);
end $$;

-- After Supabase Auth made the link (and emailed it when it could): re-check, record it, and return the token so the
-- admin gets the same link as the email.
create function pos_rpc.admin_sign_in_link_sent(p_actor uuid, p_user_id uuid, p_auth_uid uuid, p_email_sent boolean,
                                                p_email_error text, p_register_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_check jsonb;
  v_row pos.admin_sign_in_links;
begin
  v_check := pos_rpc.admin_sign_in_link_check(p_actor, p_user_id);
  if p_auth_uid is distinct from (v_check ->> 'auth_uid')::uuid then
    perform pos_rpc.fail('CONFLICT', 'this person''s sign-in changed while the link was being made; try again');
  end if;
  insert into pos.admin_sign_in_links (user_id, email, auth_uid, register_url, email_sent, email_error, expires_at, sent_by,
                                       request_id)
  values (p_user_id, v_check ->> 'email', p_auth_uid, p_register_url, coalesce(p_email_sent, false),
          case when coalesce(p_email_sent, false) then null else coalesce(p_email_error, 'failed') end,
          now() + pos_rpc.invite_ttl(), p_actor, nullif(current_setting('pos.request_id', true), ''))
  returning * into v_row;
  return jsonb_build_object('sign_in_link', to_jsonb(v_row), 'token_hash', pos_rpc.recovery_token_hash(p_auth_uid));
end $$;
