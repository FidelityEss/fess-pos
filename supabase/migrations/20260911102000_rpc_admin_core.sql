-- FESS POS — admin write functions, part 1: helpers, banks, users, identity, reference data, remote config,
-- module releases, definitions studio and four-eyes approvals (docs/03 §4–5, docs/04 §7 & §9, docs/05, docs/07 §2 & §6,
-- docs/13 §3–6). Expand-only: new functions, no changes to existing objects. Reversible by dropping these functions.
--
-- Conventions (DEVELOPMENT-GUIDELINES §2, docs/05 §0):
--   * pos_rpc.admin_*(p_actor uuid, …) — SECURITY DEFINER, search_path = '', fully-qualified names, executable only by
--     service_role (no client role has USAGE on pos_rpc). The POS API authenticated the caller; every function re-checks
--     the actor with pos_rpc.require_staff() and the bank scope of what it touches.
--   * Inputs are typed parameters or one jsonb `p_input` validated here (the API validated it with Zod first — this is the
--     second check). Patch semantics for updates: only keys present in p_input change.
--   * Rows are never deleted (deactivate / revoke / supersede); immutable tables get new rows. Every change is audited by
--     the triggers of 20260911100700, attributed through pos_rpc.set_context() which the API calls first.
--   * Four-eyes (D-31): when required, publish / activation / integrity-relevant config create a pending `approvals`
--     request carrying the frozen candidate and return {status:'approval_required'}; pos_rpc.admin_approval_decide executes it.
--   * Global reference data (banks, MCC codes, trusted issuers, global reason codes / lookup lists / definition families,
--     declarations, global remote config, module releases, server epoch) needs an admin with all-bank scope (bank_ids null).

-- ── Helpers ────────────────────────────────────────────────────────────────────────────────────
-- Admin with all-bank scope (bank_ids is null), optionally holding a permission.
create function pos_rpc.admin_require_global(p_actor uuid, p_permission text default null)
returns pos.pos_users language plpgsql stable security definer set search_path = '' as $$
declare v_user pos.pos_users;
begin
  v_user := pos_rpc.require_staff(p_actor, p_permission, null);
  if v_user.bank_ids is not null then
    perform pos_rpc.fail('FORBIDDEN', 'this action needs an admin with access to all banks');
  end if;
  return v_user;
end $$;

-- Admin in scope for a bank; null bank = global object → all-bank scope required.
create function pos_rpc.admin_require_bank(p_actor uuid, p_bank_id uuid, p_permission text default null)
returns pos.pos_users language plpgsql stable security definer set search_path = '' as $$
begin
  if p_bank_id is null then
    return pos_rpc.admin_require_global(p_actor, p_permission);
  end if;
  if not exists (select 1 from pos.banks b where b.id = p_bank_id) then
    perform pos_rpc.fail('NOT_FOUND', 'bank not found', jsonb_build_object('bank_id', p_bank_id));
  end if;
  return pos_rpc.require_staff(p_actor, p_permission, p_bank_id);
end $$;

-- May this admin manage this user? Global admins: anyone. Bank-scoped admins: agents / bank readers whose banks are a
-- non-empty subset of their own (never admins, never all-bank users).
create function pos_rpc.admin_can_manage_user(p_actor pos.pos_users, p_role pos.pos_role, p_bank_ids uuid[])
returns boolean language sql immutable set search_path = '' as $$
  select p_actor.bank_ids is null
         or (p_role <> 'pos_admin' and p_bank_ids is not null and cardinality(p_bank_ids) > 0
             and p_bank_ids <@ p_actor.bank_ids);
$$;

-- jsonb helpers for p_input validation.
create function pos_rpc.in_text(p_input jsonb, p_key text, p_required boolean default false, p_max integer default 2000)
returns text language plpgsql immutable set search_path = '' as $$
declare v text;
begin
  if p_input ? p_key and jsonb_typeof(p_input -> p_key) not in ('string', 'null') then
    perform pos_rpc.fail('INVALID_REQUEST', format('%s must be a string', p_key), jsonb_build_object('path', p_key));
  end if;
  v := nullif(btrim(p_input ->> p_key), '');
  if p_required and v is null then
    perform pos_rpc.fail('INVALID_REQUEST', format('%s is required', p_key), jsonb_build_object('path', p_key));
  end if;
  if v is not null and length(v) > p_max then
    perform pos_rpc.fail('INVALID_REQUEST', format('%s is longer than %s characters', p_key, p_max), jsonb_build_object('path', p_key));
  end if;
  return v;
end $$;

create function pos_rpc.in_object(p_input jsonb, p_key text, p_default jsonb default '{}'::jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if not (p_input ? p_key) or jsonb_typeof(p_input -> p_key) = 'null' then return p_default; end if;
  if jsonb_typeof(p_input -> p_key) <> 'object' then
    perform pos_rpc.fail('INVALID_REQUEST', format('%s must be an object', p_key), jsonb_build_object('path', p_key));
  end if;
  return p_input -> p_key;
end $$;

create function pos_rpc.in_bool(p_input jsonb, p_key text, p_default boolean)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if not (p_input ? p_key) or jsonb_typeof(p_input -> p_key) = 'null' then return p_default; end if;
  if jsonb_typeof(p_input -> p_key) <> 'boolean' then
    perform pos_rpc.fail('INVALID_REQUEST', format('%s must be a boolean', p_key), jsonb_build_object('path', p_key));
  end if;
  return (p_input ->> p_key)::boolean;
end $$;

create function pos_rpc.in_uuid_array(p_input jsonb, p_key text)
returns uuid[] language plpgsql immutable set search_path = '' as $$
begin
  if not (p_input ? p_key) or jsonb_typeof(p_input -> p_key) = 'null' then return null; end if;
  if jsonb_typeof(p_input -> p_key) <> 'array' then
    perform pos_rpc.fail('INVALID_REQUEST', format('%s must be an array or null', p_key), jsonb_build_object('path', p_key));
  end if;
  return pos.uuid_array(p_input -> p_key);
exception when invalid_text_representation then
  perform pos_rpc.fail('INVALID_REQUEST', format('%s must contain uuids', p_key), jsonb_build_object('path', p_key));
  return null;
end $$;

-- Four-eyes predicate (D-31): the bank's flag, or the global remote-config key governance.four_eyes_global.
create function pos_rpc.four_eyes_required(p_bank_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select b.four_eyes_enabled from pos.banks b where b.id = p_bank_id), false)
         or coalesce((pos.config_value(array['governance', 'four_eyes_global'], 'false'::jsonb))::text::boolean, false);
$$;

-- Create a pending four-eyes request (append-only; the decision is a second row referencing it).
create function pos_rpc.approval_request(p_actor uuid, p_subject_type text, p_subject_ref uuid, p_payload jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into pos.approvals (subject_type, subject_ref, payload, requested_by, decision, note)
  values (p_subject_type, p_subject_ref, p_payload, p_actor, 'pending', p_note)
  returning id into v_id;
  perform pos_rpc.alert('approval_requested', 'info', format('Four-eyes approval requested (%s)', replace(p_subject_type, '_', ' ')),
                        'approval', v_id, nullif(p_payload ->> 'bank_id', '')::uuid,
                        jsonb_build_object('subject_type', p_subject_type, 'requested_by', p_actor), 'approval:' || v_id::text);
  perform pos_rpc.notify_admins(nullif(p_payload ->> 'bank_id', '')::uuid, 'approve_definitions', 'approval_requested',
                                'approval', v_id, jsonb_build_object('subject_type', p_subject_type));
  return v_id;
end $$;

-- Row serialisers used in API responses.
create function pos.job_json(p_job pos.jobs)
returns jsonb language sql stable set search_path = '' as $$
  select (to_jsonb(p_job) - 'location') || jsonb_build_object('location', pos.geo_json(p_job.location));
$$;

-- ── Banks (docs/05 §1, B7.3) ──────────────────────────────────────────────────────────────────
create function pos_rpc.admin_bank_create(p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.banks;
begin
  perform pos_rpc.admin_require_global(p_actor);
  insert into pos.banks (code, name, active, contacts, export_settings, billing_settings, four_eyes_enabled, request_id)
  values (upper(pos_rpc.in_text(p_input, 'code', true, 16)), pos_rpc.in_text(p_input, 'name', true, 200),
          pos_rpc.in_bool(p_input, 'active', true),
          coalesce(case when jsonb_typeof(p_input -> 'contacts') = 'array' then p_input -> 'contacts' end, '[]'::jsonb),
          pos_rpc.in_object(p_input, 'export_settings'), pos_rpc.in_object(p_input, 'billing_settings'),
          pos_rpc.in_bool(p_input, 'four_eyes_enabled', false), nullif(current_setting('pos.request_id', true), ''))
  returning * into v;
  return to_jsonb(v);
exception when unique_violation then
  perform pos_rpc.fail('ALREADY_EXISTS', 'a bank with this code already exists', jsonb_build_object('code', p_input ->> 'code'));
  return null;
end $$;

create function pos_rpc.admin_bank_update(p_actor uuid, p_bank_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.banks;
  v_actor pos.pos_users;
begin
  v_actor := pos_rpc.admin_require_bank(p_actor, p_bank_id);
  select * into v from pos.banks where id = p_bank_id for update;
  -- Switching four-eyes off defeats four-eyes: only an all-bank admin who may approve definitions can change it.
  if p_input ? 'four_eyes_enabled' and pos_rpc.in_bool(p_input, 'four_eyes_enabled', v.four_eyes_enabled) <> v.four_eyes_enabled
     and (v_actor.bank_ids is not null or not ('approve_definitions' = any (v_actor.permissions))) then
    perform pos_rpc.fail('FORBIDDEN', 'changing four-eyes needs an all-bank admin with approve_definitions');
  end if;
  if p_input ? 'contacts' and jsonb_typeof(p_input -> 'contacts') <> 'array' then
    perform pos_rpc.fail('INVALID_REQUEST', 'contacts must be an array', jsonb_build_object('path', 'contacts'));
  end if;
  update pos.banks set
    name = case when p_input ? 'name' then pos_rpc.in_text(p_input, 'name', true, 200) else name end,
    active = pos_rpc.in_bool(p_input, 'active', active),
    contacts = case when p_input ? 'contacts' then p_input -> 'contacts' else contacts end,
    export_settings = case when p_input ? 'export_settings' then pos_rpc.in_object(p_input, 'export_settings') else export_settings end,
    billing_settings = case when p_input ? 'billing_settings' then pos_rpc.in_object(p_input, 'billing_settings') else billing_settings end,
    four_eyes_enabled = pos_rpc.in_bool(p_input, 'four_eyes_enabled', four_eyes_enabled),
    request_id = nullif(current_setting('pos.request_id', true), '')
  where id = p_bank_id
  returning * into v;
  return to_jsonb(v);
end $$;

-- ── Users (docs/05 §2, B7.1, D-35) ────────────────────────────────────────────────────────────
create function pos_rpc.admin_user_check_input(p_role pos.pos_role, p_permissions text[], p_bank_ids uuid[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_role <> 'pos_admin' and cardinality(coalesce(p_permissions, '{}')) > 0 then
    perform pos_rpc.fail('INVALID_REQUEST', 'only admins hold permissions', jsonb_build_object('path', 'permissions'));
  end if;
  if not (coalesce(p_permissions, '{}') <@ array['review_inspections', 'approve_definitions', 'schedule_jobs']::text[]) then
    perform pos_rpc.fail('INVALID_REQUEST', 'unknown permission', jsonb_build_object('path', 'permissions'));
  end if;
  if p_role = 'pos_bank_reader' and cardinality(coalesce(p_bank_ids, '{}')) = 0 then
    perform pos_rpc.fail('INVALID_REQUEST', 'a bank reader needs at least one bank', jsonb_build_object('path', 'bank_ids'));
  end if;
  if p_bank_ids is not null and exists (select 1 from unnest(p_bank_ids) b where not exists (select 1 from pos.banks x where x.id = b)) then
    perform pos_rpc.fail('INVALID_REQUEST', 'unknown bank in bank_ids', jsonb_build_object('path', 'bank_ids'));
  end if;
end $$;

create function pos_rpc.admin_user_create(p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.pos_users;
  v_role pos.pos_role;
  v_perms text[];
  v_banks uuid[];
begin
  v_actor := pos_rpc.require_staff(p_actor);
  begin
    v_role := pos_rpc.in_text(p_input, 'role', true)::pos.pos_role;
  exception when invalid_text_representation then
    perform pos_rpc.fail('INVALID_REQUEST', 'unknown role', jsonb_build_object('path', 'role'));
  end;
  v_perms := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_input -> 'permissions') = 'array'
                                                                  then p_input -> 'permissions' else '[]'::jsonb end)), '{}');
  v_banks := pos_rpc.in_uuid_array(p_input, 'bank_ids');
  perform pos_rpc.admin_user_check_input(v_role, v_perms, v_banks);
  if not pos_rpc.admin_can_manage_user(v_actor, v_role, v_banks) then
    perform pos_rpc.fail('FORBIDDEN', 'you can only create agents and bank readers within your banks');
  end if;
  insert into pos.pos_users (employee_number, first_name, last_name, email, phone, role, permissions, bank_ids, attributes,
                             created_by, request_id)
  values (pos_rpc.in_text(p_input, 'employee_number', true, 32), pos_rpc.in_text(p_input, 'first_name', true, 120),
          pos_rpc.in_text(p_input, 'last_name', true, 120), lower(pos_rpc.in_text(p_input, 'email', false, 320)),
          pos_rpc.in_text(p_input, 'phone', false, 40), v_role, v_perms, v_banks, pos_rpc.in_object(p_input, 'attributes'),
          p_actor, nullif(current_setting('pos.request_id', true), ''))
  returning * into v;
  return to_jsonb(v);
exception
  when unique_violation then
    perform pos_rpc.fail('ALREADY_EXISTS', 'a user with this employee number already exists',
                         jsonb_build_object('employee_number', p_input ->> 'employee_number'));
    return null;
  when check_violation then
    perform pos_rpc.fail('INVALID_REQUEST', 'user fields failed validation (employee number format, permissions)');
    return null;
end $$;

create function pos_rpc.admin_user_update(p_actor uuid, p_user_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.pos_users;
  v_role pos.pos_role;
  v_perms text[];
  v_banks uuid[];
begin
  v_actor := pos_rpc.require_staff(p_actor);
  select * into v from pos.pos_users where id = p_user_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'user not found'); end if;
  if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then
    perform pos_rpc.fail('FORBIDDEN', 'user outside your scope');
  end if;
  if p_user_id = p_actor and (p_input ? 'role' or p_input ? 'permissions' or p_input ? 'bank_ids') then
    perform pos_rpc.fail('FORBIDDEN', 'you cannot change your own role, permissions or banks');
  end if;
  begin
    v_role := coalesce(pos_rpc.in_text(p_input, 'role')::pos.pos_role, v.role);
  exception when invalid_text_representation then
    perform pos_rpc.fail('INVALID_REQUEST', 'unknown role', jsonb_build_object('path', 'role'));
  end;
  v_perms := case when p_input ? 'permissions'
                  then coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_input -> 'permissions') = 'array'
                                                                            then p_input -> 'permissions' else '[]'::jsonb end)), '{}')
                  else v.permissions end;
  if v_role <> 'pos_admin' and not (p_input ? 'permissions') then v_perms := '{}'; end if;
  v_banks := case when p_input ? 'bank_ids' then pos_rpc.in_uuid_array(p_input, 'bank_ids') else v.bank_ids end;
  perform pos_rpc.admin_user_check_input(v_role, v_perms, v_banks);
  if not pos_rpc.admin_can_manage_user(v_actor, v_role, v_banks) then
    perform pos_rpc.fail('FORBIDDEN', 'the resulting role or banks are outside your scope');
  end if;
  if v_role = 'pos_agent' and v.admin_auth_uid is not null then
    perform pos_rpc.fail('CONFLICT', 'this user has an admin login; agents never sign in with Supabase Auth');
  end if;
  update pos.pos_users set
    first_name = case when p_input ? 'first_name' then pos_rpc.in_text(p_input, 'first_name', true, 120) else first_name end,
    last_name = case when p_input ? 'last_name' then pos_rpc.in_text(p_input, 'last_name', true, 120) else last_name end,
    email = case when p_input ? 'email' then lower(pos_rpc.in_text(p_input, 'email', false, 320)) else email end,
    phone = case when p_input ? 'phone' then pos_rpc.in_text(p_input, 'phone', false, 40) else phone end,
    role = v_role, permissions = v_perms, bank_ids = v_banks,
    attributes = case when p_input ? 'attributes' then pos_rpc.in_object(p_input, 'attributes') else attributes end,
    request_id = nullif(current_setting('pos.request_id', true), '')
  where id = p_user_id
  returning * into v;
  return to_jsonb(v);
end $$;

-- Deactivation (D-35). ingest_only (default): sessions downgrade so captured work still uploads (flagged
-- after_deactivation); new work stops: unused inspection tokens and card tokens are revoked. hard_revoke (stolen device):
-- every session revoked, reason required; the response carries the pending count from the last device sync reports.
create function pos_rpc.admin_user_deactivate(p_actor uuid, p_user_id uuid, p_mode text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.pos_users;
  v_mode text := coalesce(nullif(p_mode, ''), 'ingest_only');
  v_sessions integer := 0;
  v_pending integer;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  if v_mode not in ('ingest_only', 'hard_revoke') then
    perform pos_rpc.fail('INVALID_REQUEST', 'mode must be ingest_only or hard_revoke', jsonb_build_object('path', 'mode'));
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    perform pos_rpc.fail('NOTE_REQUIRED', 'a reason is required to deactivate a user');
  end if;
  if p_user_id = p_actor then perform pos_rpc.fail('FORBIDDEN', 'you cannot deactivate yourself'); end if;
  select * into v from pos.pos_users where id = p_user_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'user not found'); end if;
  if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then
    perform pos_rpc.fail('FORBIDDEN', 'user outside your scope');
  end if;
  if not v.active and v_mode = 'ingest_only' then
    perform pos_rpc.fail('CONFLICT', 'user is already inactive');
  end if;

  update pos.pos_users set active = false, deactivated_at = coalesce(deactivated_at, now()),
                          deactivated_reason = p_reason, request_id = nullif(current_setting('pos.request_id', true), '')
   where id = p_user_id returning * into v;

  if v_mode = 'ingest_only' then
    with s as (
      update pos.pos_sessions set scope = 'ingest_only'
       where user_id = p_user_id and revoked_at is null and scope = 'full' and expires_at > now()
      returning id, device_id, issuer_key)
    insert into pos.auth_events (user_id, issuer_key, event, device_id, session_id, detail, request_id)
    select p_user_id, s.issuer_key, 'downgrade', s.device_id, s.id,
           jsonb_build_object('reason', 'deactivated', 'by', p_actor), nullif(current_setting('pos.request_id', true), '')
      from s;
    get diagnostics v_sessions = row_count;
  else
    with s as (
      update pos.pos_sessions set revoked_at = now(), revoke_reason = 'hard_revoke'
       where user_id = p_user_id and revoked_at is null
      returning id, device_id, issuer_key)
    insert into pos.auth_events (user_id, issuer_key, event, device_id, session_id, detail, request_id)
    select p_user_id, s.issuer_key, 'revoke', s.device_id, s.id,
           jsonb_build_object('reason', p_reason, 'mode', 'hard_revoke', 'by', p_actor), nullif(current_setting('pos.request_id', true), '')
      from s;
    get diagnostics v_sessions = row_count;
  end if;

  update pos.session_tokens set revoked_at = now(), revoke_reason = 'user_deactivated'
   where user_id = p_user_id and used_at is null and revoked_at is null;
  update pos.agent_card_tokens set revoked_at = now(), revoke_reason = 'user_deactivated'   -- 07 §10: cards invalid at once
   where user_id = p_user_id and revoked_at is null;

  select coalesce(sum(s.pending_total), 0) into v_pending from pos.device_sync_status s where s.user_id = p_user_id;
  if v_mode = 'hard_revoke' then
    perform pos_rpc.alert('user_hard_revoked', 'critical',
                          format('%s %s hard-revoked; %s item(s) were pending on their devices at last sync', v.first_name, v.last_name, v_pending),
                          'user', v.id, null, jsonb_build_object('reason', p_reason, 'pending_items', v_pending, 'by', p_actor),
                          'user_hard_revoked:' || v.id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  end if;
  if exists (select 1 from pos.jobs j where j.assigned_to = p_user_id and j.status in ('assigned', 'accepted', 'in_progress', 'paused', 'returned')) then
    perform pos_rpc.alert('deactivated_with_jobs', 'warning', format('%s %s was deactivated with live jobs — reassign them', v.first_name, v.last_name),
                          'user', v.id, null, '{}'::jsonb, 'deactivated_with_jobs:' || v.id::text);
  end if;
  return jsonb_build_object('user', to_jsonb(v), 'mode', v_mode, 'sessions_affected', v_sessions, 'pending_items', v_pending);
end $$;

create function pos_rpc.admin_user_reactivate(p_actor uuid, p_user_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.pos_users;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  if coalesce(btrim(p_reason), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a reason is required'); end if;
  select * into v from pos.pos_users where id = p_user_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'user not found'); end if;
  if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then perform pos_rpc.fail('FORBIDDEN', 'user outside your scope'); end if;
  if v.active then perform pos_rpc.fail('CONFLICT', 'user is already active'); end if;
  -- Sessions stay as they are: a downgraded or revoked session never regains scope; the agent signs in again.
  update pos.pos_users set active = true, deactivated_at = null, deactivated_reason = null,
                          request_id = nullif(current_setting('pos.request_id', true), '')
   where id = p_user_id returning * into v;
  return to_jsonb(v) || jsonb_build_object('reactivation_reason', p_reason);
end $$;

-- Link the Supabase Auth user created by the API (admins / bank readers only; agents never use Supabase Auth).
create function pos_rpc.admin_user_link_auth(p_actor uuid, p_user_id uuid, p_auth_uid uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.pos_users;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  select * into v from pos.pos_users where id = p_user_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'user not found'); end if;
  if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then perform pos_rpc.fail('FORBIDDEN', 'user outside your scope'); end if;
  if v.role = 'pos_agent' then perform pos_rpc.fail('CONFLICT', 'agents never sign in with Supabase Auth'); end if;
  if v.admin_auth_uid is not null then perform pos_rpc.fail('ALREADY_EXISTS', 'this user already has an admin login'); end if;
  if not exists (select 1 from auth.users u where u.id = p_auth_uid) then
    perform pos_rpc.fail('NOT_FOUND', 'auth user not found');
  end if;
  update pos.pos_users set admin_auth_uid = p_auth_uid, request_id = nullif(current_setting('pos.request_id', true), '')
   where id = p_user_id returning * into v;
  return to_jsonb(v);
exception when unique_violation then
  perform pos_rpc.fail('ALREADY_EXISTS', 'this auth user is linked to another POS user');
  return null;
end $$;

-- Read-only check before the API creates a Supabase Auth user (so nothing is created for a user it may not manage).
create function pos_rpc.admin_user_for_login(p_actor uuid, p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.pos_users;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  select * into v from pos.pos_users where id = p_user_id;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'user not found'); end if;
  if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then perform pos_rpc.fail('FORBIDDEN', 'user outside your scope'); end if;
  if v.role = 'pos_agent' then perform pos_rpc.fail('CONFLICT', 'agents never sign in with Supabase Auth'); end if;
  if v.admin_auth_uid is not null then perform pos_rpc.fail('ALREADY_EXISTS', 'this user already has an admin login'); end if;
  if not v.active then perform pos_rpc.fail('CONFLICT', 'user is inactive'); end if;
  return jsonb_build_object('id', v.id, 'role', v.role, 'email', v.email, 'first_name', v.first_name, 'last_name', v.last_name);
end $$;

-- Scope check + row (e.g. before the API stores a profile photo, so nothing is uploaded for a user it may not manage).
create function pos_rpc.admin_user_get(p_actor uuid, p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.pos_users;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  select * into v from pos.pos_users where id = p_user_id;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'user not found'); end if;
  if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then perform pos_rpc.fail('FORBIDDEN', 'user outside your scope'); end if;
  return to_jsonb(v);
end $$;

create function pos_rpc.admin_user_set_photo(p_actor uuid, p_user_id uuid, p_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.pos_users;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  select * into v from pos.pos_users where id = p_user_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'user not found'); end if;
  if not pos_rpc.admin_can_manage_user(v_actor, v.role, v.bank_ids) then perform pos_rpc.fail('FORBIDDEN', 'user outside your scope'); end if;
  if p_path is null or p_path !~ ('^users/' || p_user_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    perform pos_rpc.fail('INVALID_REQUEST', 'photo path must be server-derived');
  end if;
  -- the previous object stays in storage (never overwritten or deleted; retention handles it)
  update pos.pos_users set photo_path = p_path, request_id = nullif(current_setting('pos.request_id', true), '')
   where id = p_user_id returning * into v;
  return to_jsonb(v);
end $$;

create function pos_rpc.admin_user_photo_path(p_actor uuid, p_user_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v pos.pos_users;
begin
  perform pos_rpc.require_staff(p_actor);
  select * into v from pos.pos_users where id = p_user_id;
  if not found or v.photo_path is null then perform pos_rpc.fail('NOT_FOUND', 'no photo'); end if;
  return v.photo_path;
end $$;

-- ── Trusted issuers & identity links (docs/07 §2, B7.6) ───────────────────────────────────────
create function pos_rpc.admin_issuer_create(p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.trusted_issuers;
begin
  perform pos_rpc.admin_require_global(p_actor);
  insert into pos.trusted_issuers (key, type, title, issuer, audience, jwks_url, introspection_url, request_template,
                                   subject_claim, employee_number_source, secret_name, primary_issuer, active)
  values (pos_rpc.in_text(p_input, 'key', true, 64), pos_rpc.in_text(p_input, 'type', true)::pos.issuer_type,
          pos_rpc.in_text(p_input, 'title', true, 200), pos_rpc.in_text(p_input, 'issuer'), pos_rpc.in_text(p_input, 'audience'),
          pos_rpc.in_text(p_input, 'jwks_url'), pos_rpc.in_text(p_input, 'introspection_url'),
          pos_rpc.in_object(p_input, 'request_template'), pos_rpc.in_text(p_input, 'subject_claim'),
          pos_rpc.in_object(p_input, 'employee_number_source'), pos_rpc.in_text(p_input, 'secret_name', false, 128),
          pos_rpc.in_bool(p_input, 'primary_issuer', false), pos_rpc.in_bool(p_input, 'active', false))
  returning * into v;
  return to_jsonb(v);
exception
  when unique_violation then
    perform pos_rpc.fail('ALREADY_EXISTS', 'an issuer with this key already exists'); return null;
  when invalid_text_representation then
    perform pos_rpc.fail('INVALID_REQUEST', 'unknown issuer type', jsonb_build_object('path', 'type')); return null;
  when check_violation then
    perform pos_rpc.fail('INVALID_REQUEST', 'issuer key must be snake_case'); return null;
end $$;

create function pos_rpc.admin_issuer_update(p_actor uuid, p_issuer_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.trusted_issuers;
begin
  perform pos_rpc.admin_require_global(p_actor);
  select * into v from pos.trusted_issuers where id = p_issuer_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'issuer not found'); end if;
  update pos.trusted_issuers set
    type = case when p_input ? 'type' then pos_rpc.in_text(p_input, 'type', true)::pos.issuer_type else type end,
    title = case when p_input ? 'title' then pos_rpc.in_text(p_input, 'title', true, 200) else title end,
    issuer = case when p_input ? 'issuer' then pos_rpc.in_text(p_input, 'issuer') else issuer end,
    audience = case when p_input ? 'audience' then pos_rpc.in_text(p_input, 'audience') else audience end,
    jwks_url = case when p_input ? 'jwks_url' then pos_rpc.in_text(p_input, 'jwks_url') else jwks_url end,
    introspection_url = case when p_input ? 'introspection_url' then pos_rpc.in_text(p_input, 'introspection_url') else introspection_url end,
    request_template = case when p_input ? 'request_template' then pos_rpc.in_object(p_input, 'request_template') else request_template end,
    subject_claim = case when p_input ? 'subject_claim' then pos_rpc.in_text(p_input, 'subject_claim') else subject_claim end,
    employee_number_source = case when p_input ? 'employee_number_source' then pos_rpc.in_object(p_input, 'employee_number_source') else employee_number_source end,
    secret_name = case when p_input ? 'secret_name' then pos_rpc.in_text(p_input, 'secret_name', false, 128) else secret_name end,
    primary_issuer = pos_rpc.in_bool(p_input, 'primary_issuer', primary_issuer),
    active = pos_rpc.in_bool(p_input, 'active', active)
  where id = p_issuer_id
  returning * into v;
  return to_jsonb(v);
exception when invalid_text_representation then
  perform pos_rpc.fail('INVALID_REQUEST', 'unknown issuer type', jsonb_build_object('path', 'type')); return null;
end $$;

create function pos_rpc.admin_issuer_set_active(p_actor uuid, p_issuer_id uuid, p_active boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.trusted_issuers;
begin
  perform pos_rpc.admin_require_global(p_actor);
  if coalesce(btrim(p_reason), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a reason is required'); end if;
  update pos.trusted_issuers set active = p_active where id = p_issuer_id returning * into v;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'issuer not found'); end if;
  perform pos_rpc.alert('issuer_' || case when p_active then 'activated' else 'deactivated' end, 'warning',
                        format('Trusted issuer %s %s: %s', v.key, case when p_active then 'activated' else 'deactivated' end, p_reason),
                        'issuer', v.id, null, jsonb_build_object('by', p_actor, 'reason', p_reason),
                        'issuer_active:' || v.id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  return to_jsonb(v);
end $$;

-- Admin-created identity link (edge cases, link requests). A revoked link for the same (issuer, subject) is re-pointed.
create function pos_rpc.admin_identity_link(p_actor uuid, p_user_id uuid, p_issuer_key text, p_subject text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v_user pos.pos_users;
  v pos.external_identities;
begin
  v_actor := pos_rpc.admin_require_global(p_actor);
  select * into v_user from pos.pos_users where id = p_user_id;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'user not found'); end if;
  if not exists (select 1 from pos.trusted_issuers i where i.key = p_issuer_key) then
    perform pos_rpc.fail('NOT_FOUND', 'issuer not found');
  end if;
  if coalesce(btrim(p_subject), '') = '' then perform pos_rpc.fail('INVALID_REQUEST', 'subject is required'); end if;
  select * into v from pos.external_identities where issuer_key = p_issuer_key and subject = p_subject for update;
  if found and v.revoked_at is null then
    perform pos_rpc.fail('ALREADY_EXISTS', 'this identity is already linked', jsonb_build_object('user_id', v.user_id));
  elsif found then
    update pos.external_identities set user_id = p_user_id, linked_via = 'admin', linked_by = p_actor, linked_at = now(), revoked_at = null
     where id = v.id returning * into v;
  else
    insert into pos.external_identities (user_id, issuer_key, subject, linked_via, linked_by)
    values (p_user_id, p_issuer_key, p_subject, 'admin', p_actor) returning * into v;
  end if;
  update pos.alerts set acknowledged_by = p_actor, acknowledged_at = now()
   where dedupe_key = 'link_request:' || p_issuer_key || ':' || p_subject and acknowledged_at is null;
  return to_jsonb(v);
end $$;

create function pos_rpc.admin_identity_revoke(p_actor uuid, p_link_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.external_identities;
begin
  perform pos_rpc.admin_require_global(p_actor);
  if coalesce(btrim(p_reason), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a reason is required'); end if;
  select * into v from pos.external_identities where id = p_link_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'identity link not found'); end if;
  if v.revoked_at is not null then perform pos_rpc.fail('CONFLICT', 'already revoked'); end if;
  update pos.external_identities set revoked_at = now() where id = p_link_id returning * into v;
  insert into pos.auth_events (user_id, issuer_key, event, detail, request_id)
  values (v.user_id, v.issuer_key, 'revoke', jsonb_build_object('identity_link', v.id, 'reason', p_reason, 'by', p_actor),
          nullif(current_setting('pos.request_id', true), ''));
  return to_jsonb(v);
end $$;

-- ── Reason codes (docs/06 §3) ─────────────────────────────────────────────────────────────────
create function pos_rpc.admin_reason_create(p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.reason_codes;
  v_bank uuid := nullif(p_input ->> 'bank_id', '')::uuid;
begin
  perform pos_rpc.admin_require_bank(p_actor, v_bank);
  insert into pos.reason_codes (category, code, label, description, requires_note, requires_photo, billable, bank_id, sort_order, request_id)
  values (pos_rpc.in_text(p_input, 'category', true)::pos.reason_category, pos_rpc.in_text(p_input, 'code', true, 64),
          pos_rpc.in_text(p_input, 'label', true, 200), pos_rpc.in_text(p_input, 'description'),
          pos_rpc.in_bool(p_input, 'requires_note', false), pos_rpc.in_bool(p_input, 'requires_photo', false),
          pos_rpc.in_bool(p_input, 'billable', false), v_bank, coalesce((p_input ->> 'sort_order')::integer, 0),
          nullif(current_setting('pos.request_id', true), ''))
  returning * into v;
  return to_jsonb(v);
exception
  when unique_violation then perform pos_rpc.fail('ALREADY_EXISTS', 'this reason code already exists for that category and bank'); return null;
  when invalid_text_representation then perform pos_rpc.fail('INVALID_REQUEST', 'unknown reason category', jsonb_build_object('path', 'category')); return null;
  when check_violation then perform pos_rpc.fail('INVALID_REQUEST', 'reason code must be snake_case', jsonb_build_object('path', 'code')); return null;
end $$;

create function pos_rpc.admin_reason_update(p_actor uuid, p_reason_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.reason_codes;
begin
  select * into v from pos.reason_codes where id = p_reason_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'reason code not found'); end if;
  perform pos_rpc.admin_require_bank(p_actor, v.bank_id);
  update pos.reason_codes set
    label = case when p_input ? 'label' then pos_rpc.in_text(p_input, 'label', true, 200) else label end,
    description = case when p_input ? 'description' then pos_rpc.in_text(p_input, 'description') else description end,
    requires_note = pos_rpc.in_bool(p_input, 'requires_note', requires_note),
    requires_photo = pos_rpc.in_bool(p_input, 'requires_photo', requires_photo),
    billable = pos_rpc.in_bool(p_input, 'billable', billable),
    sort_order = coalesce((p_input ->> 'sort_order')::integer, sort_order),
    active = pos_rpc.in_bool(p_input, 'active', active),
    request_id = nullif(current_setting('pos.request_id', true), '')
  where id = p_reason_id
  returning * into v;
  return to_jsonb(v);
end $$;

-- ── MCC codes ─────────────────────────────────────────────────────────────────────────────────
create function pos_rpc.admin_mcc_create(p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.mcc_codes;
begin
  perform pos_rpc.admin_require_global(p_actor);
  insert into pos.mcc_codes (code, description, risk_tier)
  values (pos_rpc.in_text(p_input, 'code', true, 4), pos_rpc.in_text(p_input, 'description', true, 300),
          coalesce(pos_rpc.in_text(p_input, 'risk_tier'), 'standard'))
  returning * into v;
  return to_jsonb(v);
exception
  when unique_violation then perform pos_rpc.fail('ALREADY_EXISTS', 'this MCC code already exists'); return null;
  when check_violation then perform pos_rpc.fail('INVALID_REQUEST', 'MCC code must be 4 digits and risk tier low|standard|elevated|high'); return null;
end $$;

create function pos_rpc.admin_mcc_update(p_actor uuid, p_code text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.mcc_codes;
begin
  perform pos_rpc.admin_require_global(p_actor);
  update pos.mcc_codes set
    description = case when p_input ? 'description' then pos_rpc.in_text(p_input, 'description', true, 300) else description end,
    risk_tier = coalesce(pos_rpc.in_text(p_input, 'risk_tier'), risk_tier),
    active = pos_rpc.in_bool(p_input, 'active', active)
  where code = p_code
  returning * into v;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'MCC code not found'); end if;
  return to_jsonb(v);
exception when check_violation then
  perform pos_rpc.fail('INVALID_REQUEST', 'risk tier must be low|standard|elevated|high'); return null;
end $$;

-- ── Lookup lists (immutable versions) ─────────────────────────────────────────────────────────
create function pos_rpc.admin_lookup_list_create(p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.lookup_lists;
  v_bank uuid := nullif(p_input ->> 'bank_id', '')::uuid;
begin
  perform pos_rpc.admin_require_bank(p_actor, v_bank);
  insert into pos.lookup_lists (key, scope, bank_id, title)
  values (pos_rpc.in_text(p_input, 'key', true, 64), case when v_bank is null then 'global' else 'bank' end::pos.scope_kind,
          v_bank, pos_rpc.in_text(p_input, 'title', true, 200))
  returning * into v;
  return to_jsonb(v);
exception
  when unique_violation then perform pos_rpc.fail('ALREADY_EXISTS', 'a lookup list with this key already exists for that scope'); return null;
  when check_violation then perform pos_rpc.fail('INVALID_REQUEST', 'list key must be snake_case', jsonb_build_object('path', 'key')); return null;
end $$;

create function pos_rpc.admin_lookup_list_update(p_actor uuid, p_list_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.lookup_lists;
begin
  select * into v from pos.lookup_lists where id = p_list_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'lookup list not found'); end if;
  perform pos_rpc.admin_require_bank(p_actor, v.bank_id);
  update pos.lookup_lists set title = coalesce(pos_rpc.in_text(p_input, 'title', false, 200), title)
   where id = p_list_id returning * into v;
  return to_jsonb(v);
end $$;

-- p_hash = sha256(JCS(items)) computed by the API with the engine (one canonicalisation implementation).
create function pos_rpc.admin_lookup_list_publish(p_actor uuid, p_list_id uuid, p_items jsonb, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_list pos.lookup_lists;
  v pos.lookup_list_versions;
  v_next integer;
begin
  select * into v_list from pos.lookup_lists where id = p_list_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'lookup list not found'); end if;
  perform pos_rpc.admin_require_bank(p_actor, v_list.bank_id);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform pos_rpc.fail('VALIDATION_FAILED', 'items must be a non-empty array', jsonb_build_array(jsonb_build_object('path', 'items', 'message', 'non-empty array required')));
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i
              where jsonb_typeof(i) <> 'object' or jsonb_typeof(i -> 'value') <> 'string' or jsonb_typeof(i -> 'label') <> 'string') then
    perform pos_rpc.fail('VALIDATION_FAILED', 'every item needs a string value and label',
                         jsonb_build_array(jsonb_build_object('path', 'items', 'message', 'every item needs value and label strings')));
  end if;
  if (select count(distinct i ->> 'value') from jsonb_array_elements(p_items) i) <> jsonb_array_length(p_items) then
    perform pos_rpc.fail('VALIDATION_FAILED', 'item values must be unique',
                         jsonb_build_array(jsonb_build_object('path', 'items', 'message', 'duplicate value')));
  end if;
  if p_hash !~ '^[0-9a-f]{64}$' then perform pos_rpc.fail('INVALID_REQUEST', 'hash must be sha256 hex'); end if;
  if exists (select 1 from pos.lookup_list_versions x where x.list_id = p_list_id and x.hash = p_hash
               and x.version = (select max(y.version) from pos.lookup_list_versions y where y.list_id = p_list_id)) then
    perform pos_rpc.fail('CONFLICT', 'no change since the current version');
  end if;
  select coalesce(max(version), 0) + 1 into v_next from pos.lookup_list_versions where list_id = p_list_id;
  insert into pos.lookup_list_versions (list_id, version, items, hash, published_by)
  values (p_list_id, v_next, p_items, p_hash, p_actor) returning * into v;
  update pos.lookup_lists set updated_at = now() where id = p_list_id;   -- touch for audit / sync ordering
  return to_jsonb(v);
end $$;

-- ── Declarations (versioned legal text; hash = sha256 of the UTF-8 text) ──────────────────────
create function pos_rpc.admin_declaration_publish(p_actor uuid, p_key text, p_title text, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.declarations;
  v_next integer;
  v_hash text;
begin
  perform pos_rpc.admin_require_global(p_actor);
  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_text), '') = '' then
    perform pos_rpc.fail('INVALID_REQUEST', 'title and text are required');
  end if;
  perform pg_advisory_xact_lock(hashtext('pos.declarations:' || p_key));
  v_hash := pos.sha256_hex(p_text);
  if exists (select 1 from pos.declarations d where d.key = p_key and d.hash = v_hash and d.title = p_title
               and d.version = (select max(x.version) from pos.declarations x where x.key = p_key)) then
    perform pos_rpc.fail('CONFLICT', 'no change since the current version');
  end if;
  select coalesce(max(version), 0) + 1 into v_next from pos.declarations where key = p_key;
  insert into pos.declarations (key, version, title, text, hash, published_by)
  values (p_key, v_next, p_title, p_text, v_hash, p_actor) returning * into v;
  return to_jsonb(v);
exception when check_violation then
  perform pos_rpc.fail('INVALID_REQUEST', 'declaration key must be snake_case'); return null;
end $$;

-- ── Remote config (docs/13 §5) ────────────────────────────────────────────────────────────────
-- Latest values of one layer/subject (the API diffs integrity-relevant keys against it).
create function pos_rpc.admin_config_current(p_actor uuid, p_layer text, p_subject_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v pos.remote_config_versions;
begin
  perform pos_rpc.require_staff(p_actor);
  select * into v from pos.remote_config_versions r
   where r.layer = p_layer::pos.config_layer and r.subject_id is not distinct from p_subject_id
   order by r.version desc limit 1;
  return case when v.id is null then null else to_jsonb(v) end;
end $$;

-- Scope of a config layer subject → bank for four-eyes and the actor check.
create function pos_rpc.admin_config_scope(p_actor uuid, p_layer pos.config_layer, p_subject_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v_user pos.pos_users;
  v_banks uuid[];
begin
  if p_layer = 'global' then
    if p_subject_id is not null then perform pos_rpc.fail('INVALID_REQUEST', 'the global layer has no subject'); end if;
    perform pos_rpc.admin_require_global(p_actor);
    return jsonb_build_object('bank_id', null, 'four_eyes', pos_rpc.four_eyes_required(null));
  end if;
  if p_subject_id is null then perform pos_rpc.fail('INVALID_REQUEST', format('the %s layer needs subject_id', p_layer)); end if;
  if p_layer = 'bank' then
    perform pos_rpc.admin_require_bank(p_actor, p_subject_id);
    return jsonb_build_object('bank_id', p_subject_id, 'four_eyes', pos_rpc.four_eyes_required(p_subject_id));
  end if;
  if p_layer = 'agent' then
    select * into v_user from pos.pos_users where id = p_subject_id;
  else
    select u.* into v_user from pos.devices d join pos.pos_users u on u.id = d.user_id where d.device_id = p_subject_id
     order by d.last_seen_at desc limit 1;
  end if;
  if v_user.id is null then perform pos_rpc.fail('NOT_FOUND', format('%s not found', p_layer)); end if;
  v_actor := pos_rpc.require_staff(p_actor);
  if not pos_rpc.admin_can_manage_user(v_actor, v_user.role, v_user.bank_ids) then
    perform pos_rpc.fail('FORBIDDEN', 'subject outside your scope');
  end if;
  v_banks := coalesce(v_user.bank_ids, '{}');
  return jsonb_build_object('bank_id', case when cardinality(v_banks) = 1 then v_banks[1] end,
                            'four_eyes', pos_rpc.four_eyes_required(null)
                                         or exists (select 1 from pos.banks b where b.id = any (v_banks) and b.four_eyes_enabled));
end $$;

create function pos_rpc.config_insert_version(p_actor uuid, p_approver uuid, p_layer pos.config_layer, p_subject_id uuid,
                                              p_values jsonb, p_schema_version text, p_reason text, p_effective_from timestamptz)
returns pos.remote_config_versions language plpgsql security definer set search_path = '' as $$
declare
  v pos.remote_config_versions;
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext('pos.remote_config:' || p_layer::text || ':' || coalesce(p_subject_id::text, '')));
  select coalesce(max(version), 0) + 1 into v_next from pos.remote_config_versions
   where layer = p_layer and subject_id is not distinct from p_subject_id;
  insert into pos.remote_config_versions (layer, subject_id, version, values, schema_version, effective_from, set_by, approved_by, reason)
  values (p_layer, p_subject_id, v_next, p_values, coalesce(nullif(p_schema_version, ''), '1.0'),
          coalesce(p_effective_from, now()), p_actor, p_approver, p_reason)
  returning * into v;
  return v;
end $$;

-- p_integrity_paths: dotted paths the typed config contract marks integrity_relevant (computed by the API for the old
-- and new values). If any of them changes and four-eyes applies → approval request with the frozen candidate.
create function pos_rpc.admin_config_publish(p_actor uuid, p_layer text, p_subject_id uuid, p_values jsonb, p_schema_version text,
                                             p_reason text, p_effective_from timestamptz, p_integrity_paths text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_layer pos.config_layer;
  v_scope jsonb;
  v_prev pos.remote_config_versions;
  v_changed text[];
  v pos.remote_config_versions;
  v_approval uuid;
  v_paths text[] := pos.array_union(p_integrity_paths, array['governance.four_eyes_global']);
begin
  begin
    v_layer := p_layer::pos.config_layer;
  exception when invalid_text_representation then
    perform pos_rpc.fail('INVALID_REQUEST', 'unknown config layer', jsonb_build_object('path', 'layer'));
  end;
  v_scope := pos_rpc.admin_config_scope(p_actor, v_layer, p_subject_id);
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    perform pos_rpc.fail('VALIDATION_FAILED', 'values must be an object', jsonb_build_array(jsonb_build_object('path', 'values', 'message', 'object required')));
  end if;
  if coalesce(btrim(p_reason), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a reason is required for every config change'); end if;

  select * into v_prev from pos.remote_config_versions r
   where r.layer = v_layer and r.subject_id is not distinct from p_subject_id order by r.version desc limit 1;
  if v_prev.id is not null and v_prev.values = p_values then
    perform pos_rpc.fail('CONFLICT', 'no change since the current version');
  end if;
  select coalesce(array_agg(p order by p), '{}') into v_changed
    from unnest(v_paths) p
   where (coalesce(v_prev.values, '{}'::jsonb) #> string_to_array(p, '.')) is distinct from (p_values #> string_to_array(p, '.'));

  if cardinality(v_changed) > 0 and (v_scope ->> 'four_eyes')::boolean then
    v_approval := pos_rpc.approval_request(p_actor, 'remote_config', v_prev.id, jsonb_build_object(
      'layer', v_layer, 'subject_id', p_subject_id, 'values', p_values, 'schema_version', coalesce(nullif(p_schema_version, ''), '1.0'),
      'reason', p_reason, 'effective_from', p_effective_from, 'changed_integrity_keys', to_jsonb(v_changed),
      'base_version_id', v_prev.id, 'base_version', v_prev.version, 'bank_id', v_scope ->> 'bank_id'), p_reason);
    return jsonb_build_object('status', 'approval_required', 'approval_id', v_approval, 'changed_integrity_keys', to_jsonb(v_changed));
  end if;

  v := pos_rpc.config_insert_version(p_actor, null, v_layer, p_subject_id, p_values, p_schema_version, p_reason, p_effective_from);
  return jsonb_build_object('status', 'published', 'version', to_jsonb(v), 'changed_integrity_keys', to_jsonb(v_changed));
end $$;

-- ── Module releases (docs/13 §3, B7.4) ────────────────────────────────────────────────────────
create function pos_rpc.admin_release_create(p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.module_releases;
begin
  perform pos_rpc.admin_require_global(p_actor);
  insert into pos.module_releases (version, released_at, status, api_versions, spec_range, components, page_types, notes)
  values (pos_rpc.in_text(p_input, 'version', true, 64), coalesce((p_input ->> 'released_at')::timestamptz, now()),
          coalesce(pos_rpc.in_text(p_input, 'status'), 'supported')::pos.release_status,
          coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_input -> 'api_versions') = 'array'
                                                                then p_input -> 'api_versions' end)), array['1']),
          pos_rpc.in_text(p_input, 'spec_range', true, 64), pos_rpc.in_object(p_input, 'components'),
          pos_rpc.in_object(p_input, 'page_types'), pos_rpc.in_text(p_input, 'notes', false, 5000))
  returning * into v;
  return to_jsonb(v);
exception
  when unique_violation then perform pos_rpc.fail('ALREADY_EXISTS', 'this release version already exists'); return null;
  when check_violation then perform pos_rpc.fail('INVALID_REQUEST', 'version must be semver'); return null;
  when invalid_text_representation then perform pos_rpc.fail('INVALID_REQUEST', 'unknown release status'); return null;
end $$;

create function pos_rpc.admin_release_update(p_actor uuid, p_release_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.module_releases;
begin
  perform pos_rpc.admin_require_global(p_actor);
  update pos.module_releases set
    status = coalesce(pos_rpc.in_text(p_input, 'status')::pos.release_status, status),
    notes = case when p_input ? 'notes' then pos_rpc.in_text(p_input, 'notes', false, 5000) else notes end,
    api_versions = case when jsonb_typeof(p_input -> 'api_versions') = 'array'
                        then array(select jsonb_array_elements_text(p_input -> 'api_versions')) else api_versions end,
    spec_range = coalesce(pos_rpc.in_text(p_input, 'spec_range', false, 64), spec_range),
    components = case when p_input ? 'components' then pos_rpc.in_object(p_input, 'components') else components end,
    page_types = case when p_input ? 'page_types' then pos_rpc.in_object(p_input, 'page_types') else page_types end
  where id = p_release_id
  returning * into v;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'release not found'); end if;
  return to_jsonb(v);
exception when invalid_text_representation then
  perform pos_rpc.fail('INVALID_REQUEST', 'unknown release status'); return null;
end $$;

-- ── Definitions studio (docs/04 §7, §9) ───────────────────────────────────────────────────────
create function pos_rpc.admin_definition_family_create(p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.definition_families;
  v_bank uuid := nullif(p_input ->> 'bank_id', '')::uuid;
begin
  perform pos_rpc.admin_require_bank(p_actor, v_bank);
  insert into pos.definition_families (kind, key, scope, bank_id, title, description, created_by)
  values (pos_rpc.in_text(p_input, 'kind', true)::pos.definition_kind, pos_rpc.in_text(p_input, 'key', true, 64),
          case when v_bank is null then 'global' else 'bank' end::pos.scope_kind, v_bank,
          pos_rpc.in_text(p_input, 'title', true, 200), pos_rpc.in_text(p_input, 'description', false, 2000), p_actor)
  returning * into v;
  return to_jsonb(v);
exception
  when unique_violation then perform pos_rpc.fail('ALREADY_EXISTS', 'a family with this kind and key already exists for that scope'); return null;
  when invalid_text_representation then perform pos_rpc.fail('INVALID_REQUEST', 'unknown definition kind', jsonb_build_object('path', 'kind')); return null;
  when check_violation then perform pos_rpc.fail('INVALID_REQUEST', 'family key must be snake_case', jsonb_build_object('path', 'key')); return null;
end $$;

create function pos_rpc.admin_definition_family_update(p_actor uuid, p_family_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.definition_families;
begin
  select * into v from pos.definition_families where id = p_family_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'definition family not found'); end if;
  perform pos_rpc.admin_require_bank(p_actor, v.bank_id);
  update pos.definition_families set
    title = coalesce(pos_rpc.in_text(p_input, 'title', false, 200), title),
    description = case when p_input ? 'description' then pos_rpc.in_text(p_input, 'description', false, 2000) else description end
  where id = p_family_id returning * into v;
  return to_jsonb(v);
end $$;

-- Everything the API needs to analyse / publish a family: family, draft, latest version, active test cases, and the
-- names cross-references may use (lookup lists, reason code categories, declarations, related forms/flows/views).
create function pos_rpc.admin_definition_context(p_actor uuid, p_family_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_f pos.definition_families;
  v_latest pos.definition_versions;
  v_draft pos.definition_drafts;
begin
  select * into v_f from pos.definition_families where id = p_family_id;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'definition family not found'); end if;
  perform pos_rpc.admin_require_bank(p_actor, v_f.bank_id);
  select * into v_latest from pos.definition_versions v where v.family_id = p_family_id order by v.version desc limit 1;
  select * into v_draft from pos.definition_drafts d where d.family_id = p_family_id;
  return jsonb_build_object(
    'family', to_jsonb(v_f),
    'draft', case when v_draft.id is null then null else to_jsonb(v_draft) end,
    'latest', case when v_latest.id is null then null
                   else jsonb_build_object('id', v_latest.id, 'version', v_latest.version, 'definition', v_latest.definition,
                                           'definition_hash', v_latest.definition_hash) end,
    'test_cases', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'context', t.context, 'steps', t.steps,
                                                                 'expectations', t.expectations) order by t.created_at)
                              from pos.definition_test_cases t where t.family_id = p_family_id and t.archived_at is null), '[]'::jsonb),
    'lookup_lists', coalesce((select jsonb_agg(distinct l.key) from pos.lookup_lists l
                               where l.bank_id is null or l.bank_id = v_f.bank_id), '[]'::jsonb),
    'reason_code_categories', coalesce((select jsonb_agg(distinct r.category) from pos.reason_codes r
                                         where r.active and (r.bank_id is null or r.bank_id = v_f.bank_id)), '[]'::jsonb),
    'declarations', coalesce((select jsonb_agg(distinct d.key) from pos.declarations d), '[]'::jsonb),
    -- latest version of every related family visible in this scope (bank family overrides global), for cross-refs
    'related', coalesce((
      select jsonb_agg(jsonb_build_object('kind', x.kind, 'key', x.key, 'definition', x.definition))
        from (select distinct on (f.kind, f.key) f.kind, f.key, lv.definition
                from pos.definition_families f
                join lateral (select v.definition from pos.definition_versions v where v.family_id = f.id order by v.version desc limit 1) lv on true
               where (f.bank_id is null or f.bank_id = v_f.bank_id) and f.kind in ('form', 'flow', 'view') and f.id <> v_f.id
               order by f.kind, f.key, (f.bank_id is null)) x), '[]'::jsonb));
end $$;

create function pos_rpc.definition_insert_version(p_family pos.definition_families, p_candidate jsonb, p_publisher uuid, p_approver uuid)
returns pos.definition_versions language plpgsql security definer set search_path = '' as $$
declare
  v_latest pos.definition_versions;
  v pos.definition_versions;
begin
  select * into v_latest from pos.definition_versions where family_id = p_family.id order by version desc limit 1;
  if (p_candidate ->> 'base_version_id') is distinct from v_latest.id::text then
    perform pos_rpc.fail('CONFLICT', 'the family has a newer version than the one this candidate was built on — analyse and publish again',
                         jsonb_build_object('current_version', v_latest.version));
  end if;
  insert into pos.definition_versions (family_id, version, spec_version, definition, definition_hash, requires, changelog, breaking,
                                       analysis, previous_version_id, published_by, approved_by)
  values (p_family.id, coalesce(v_latest.version, 0) + 1, p_candidate ->> 'spec_version', p_candidate -> 'definition',
          p_candidate ->> 'definition_hash', coalesce(p_candidate -> 'requires', '{}'::jsonb),
          coalesce(p_candidate -> 'changelog', '{}'::jsonb), coalesce((p_candidate ->> 'breaking')::boolean, false),
          coalesce(p_candidate -> 'analysis', '{}'::jsonb), v_latest.id, p_publisher, p_approver)
  returning * into v;
  insert into pos.definition_test_runs (version_id, results, passed)
  values (v.id, coalesce(p_candidate #> '{test_run,results}', '[]'::jsonb), coalesce((p_candidate #>> '{test_run,passed}')::boolean, true));
  update pos.definition_families set updated_at = now() where id = p_family.id;
  return v;
end $$;

-- p_candidate (built by the API with the engine): {definition, definition_hash, spec_version, requires, changelog, breaking,
-- analysis, test_run:{passed, results}, base_version_id}. The API refuses candidates whose analysis or tests failed; this
-- function re-checks the flags so a failed candidate can never be published.
create function pos_rpc.admin_definition_publish(p_actor uuid, p_family_id uuid, p_candidate jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_f pos.definition_families;
  v_latest pos.definition_versions;
  v pos.definition_versions;
  v_approval uuid;
begin
  select * into v_f from pos.definition_families where id = p_family_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'definition family not found'); end if;
  perform pos_rpc.admin_require_bank(p_actor, v_f.bank_id);
  if jsonb_typeof(p_candidate -> 'definition') <> 'object' or coalesce(p_candidate ->> 'definition_hash', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_candidate ->> 'spec_version', '') !~ '^[0-9]+\.[0-9]+$' then
    perform pos_rpc.fail('INVALID_REQUEST', 'candidate needs definition, definition_hash and spec_version');
  end if;
  if (p_candidate #>> '{definition,kind}') is distinct from v_f.kind::text then
    perform pos_rpc.fail('VALIDATION_FAILED', format('definition kind must be %s', v_f.kind),
                         jsonb_build_array(jsonb_build_object('path', '/kind', 'message', 'kind does not match the family')));
  end if;
  if coalesce((p_candidate #>> '{analysis,ok}')::boolean, false) = false then
    perform pos_rpc.fail('VALIDATION_FAILED', 'static analysis failed', p_candidate -> 'analysis');
  end if;
  if coalesce((p_candidate #>> '{test_run,passed}')::boolean, false) = false then
    perform pos_rpc.fail('VALIDATION_FAILED', 'test cases failed', p_candidate -> 'test_run');
  end if;
  select * into v_latest from pos.definition_versions where family_id = p_family_id order by version desc limit 1;
  if v_latest.definition_hash = p_candidate ->> 'definition_hash' then
    perform pos_rpc.fail('CONFLICT', format('no change since version %s', v_latest.version));
  end if;
  if (p_candidate ->> 'base_version_id') is distinct from v_latest.id::text then
    perform pos_rpc.fail('CONFLICT', 'the family has a newer version than the one this candidate was built on — analyse and publish again');
  end if;

  if pos_rpc.four_eyes_required(v_f.bank_id) then
    v_approval := pos_rpc.approval_request(p_actor, 'definition_publish', p_family_id,
                    p_candidate || jsonb_build_object('family_id', p_family_id, 'bank_id', v_f.bank_id, 'kind', v_f.kind, 'key', v_f.key),
                    nullif(p_candidate ->> 'note', ''));
    return jsonb_build_object('status', 'approval_required', 'approval_id', v_approval);
  end if;
  v := pos_rpc.definition_insert_version(v_f, p_candidate, p_actor, null);
  return jsonb_build_object('status', 'published', 'version', to_jsonb(v) - 'definition');
end $$;

create function pos_rpc.admin_check_audience(p_audience jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_audience is null or jsonb_typeof(p_audience) <> 'object' or not (p_audience ->> 'type' in ('all', 'agents', 'percent', 'attribute')) then
    perform pos_rpc.fail('VALIDATION_FAILED', 'audience type must be all, agents, percent or attribute',
                         jsonb_build_array(jsonb_build_object('path', 'audience.type', 'message', 'unknown audience type')));
  end if;
  if p_audience ->> 'type' = 'agents' and (jsonb_typeof(p_audience -> 'user_ids') <> 'array' or jsonb_array_length(p_audience -> 'user_ids') = 0) then
    perform pos_rpc.fail('VALIDATION_FAILED', 'agents audience needs user_ids',
                         jsonb_build_array(jsonb_build_object('path', 'audience.user_ids', 'message', 'non-empty array required')));
  end if;
  if p_audience ->> 'type' = 'percent' and not coalesce((p_audience ->> 'percent')::numeric between 1 and 100, false) then
    perform pos_rpc.fail('VALIDATION_FAILED', 'percent must be 1–100',
                         jsonb_build_array(jsonb_build_object('path', 'audience.percent', 'message', '1–100')));
  end if;
  if p_audience ->> 'type' = 'attribute' and (coalesce(p_audience ->> 'key', '') = '' or jsonb_typeof(p_audience -> 'values') <> 'array') then
    perform pos_rpc.fail('VALIDATION_FAILED', 'attribute audience needs key and values',
                         jsonb_build_array(jsonb_build_object('path', 'audience', 'message', 'key and values required')));
  end if;
end $$;

create function pos_rpc.activation_insert(p_family_id uuid, p_payload jsonb, p_activator uuid, p_approver uuid)
returns pos.definition_activations language plpgsql security definer set search_path = '' as $$
declare v pos.definition_activations;
begin
  insert into pos.definition_activations (family_id, version_id, audience, policy, effective_from, effective_to, activated_by, approved_by, reason)
  values (p_family_id, (p_payload ->> 'version_id')::uuid, p_payload -> 'audience',
          coalesce(p_payload -> 'policy', '{"incompatible":"fallback_version"}'::jsonb),
          greatest(coalesce((p_payload ->> 'effective_from')::timestamptz, now()), now()),
          (p_payload ->> 'effective_to')::timestamptz, p_activator, p_approver, p_payload ->> 'reason')
  returning * into v;
  update pos.definition_families set updated_at = now() where id = p_family_id;
  return v;
exception when check_violation then
  perform pos_rpc.fail('VALIDATION_FAILED', 'effective_to must be after effective_from',
                       jsonb_build_array(jsonb_build_object('path', 'effective_to', 'message', 'must be after effective_from')));
  return null;
end $$;

-- Append-only activation (rollback = activate the previous version). Four-eyes likewise.
create function pos_rpc.admin_definition_activate(p_actor uuid, p_family_id uuid, p_version_id uuid, p_audience jsonb, p_policy jsonb,
                                                  p_effective_from timestamptz, p_effective_to timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_f pos.definition_families;
  v_ver pos.definition_versions;
  v_payload jsonb;
  v pos.definition_activations;
  v_approval uuid;
begin
  select * into v_f from pos.definition_families where id = p_family_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'definition family not found'); end if;
  perform pos_rpc.admin_require_bank(p_actor, v_f.bank_id);
  select * into v_ver from pos.definition_versions where id = p_version_id;
  if not found or v_ver.family_id <> p_family_id then perform pos_rpc.fail('NOT_FOUND', 'version not found in this family'); end if;
  perform pos_rpc.admin_check_audience(p_audience);
  if coalesce(btrim(p_reason), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a reason is required for every activation'); end if;
  if p_policy is not null and (jsonb_typeof(p_policy) <> 'object'
       or not coalesce(p_policy ->> 'incompatible', 'fallback_version') in ('block', 'fallback_version', 'field_fallback')) then
    perform pos_rpc.fail('VALIDATION_FAILED', 'policy.incompatible must be block, fallback_version or field_fallback',
                         jsonb_build_array(jsonb_build_object('path', 'policy.incompatible', 'message', 'unknown policy')));
  end if;
  v_payload := jsonb_build_object('family_id', p_family_id, 'version_id', p_version_id, 'version', v_ver.version, 'audience', p_audience,
                                  'policy', p_policy, 'effective_from', p_effective_from, 'effective_to', p_effective_to,
                                  'reason', p_reason, 'bank_id', v_f.bank_id, 'kind', v_f.kind, 'key', v_f.key);
  if pos_rpc.four_eyes_required(v_f.bank_id) then
    v_approval := pos_rpc.approval_request(p_actor, 'definition_activation', p_version_id, v_payload, p_reason);
    return jsonb_build_object('status', 'approval_required', 'approval_id', v_approval);
  end if;
  v := pos_rpc.activation_insert(p_family_id, v_payload, p_actor, null);
  return jsonb_build_object('status', 'activated', 'activation', to_jsonb(v));
end $$;

-- Test cases (docs/04 §9): recorded scenarios re-run on every publish.
create function pos_rpc.admin_test_case_create(p_actor uuid, p_family_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_f pos.definition_families;
  v pos.definition_test_cases;
begin
  select * into v_f from pos.definition_families where id = p_family_id;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'definition family not found'); end if;
  perform pos_rpc.admin_require_bank(p_actor, v_f.bank_id);
  if p_input ? 'steps' and jsonb_typeof(p_input -> 'steps') <> 'array' then
    perform pos_rpc.fail('INVALID_REQUEST', 'steps must be an array', jsonb_build_object('path', 'steps'));
  end if;
  insert into pos.definition_test_cases (family_id, name, context, steps, expectations, created_by)
  values (p_family_id, pos_rpc.in_text(p_input, 'name', true, 200), pos_rpc.in_object(p_input, 'context'),
          coalesce(p_input -> 'steps', '[]'::jsonb), pos_rpc.in_object(p_input, 'expectations'), p_actor)
  returning * into v;
  return to_jsonb(v);
end $$;

create function pos_rpc.admin_test_case_update(p_actor uuid, p_test_case_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.definition_test_cases;
  v_bank uuid;
begin
  select * into v from pos.definition_test_cases where id = p_test_case_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'test case not found'); end if;
  select bank_id into v_bank from pos.definition_families where id = v.family_id;
  perform pos_rpc.admin_require_bank(p_actor, v_bank);
  if v.archived_at is not null then perform pos_rpc.fail('CONFLICT', 'test case is archived'); end if;
  if p_input ? 'steps' and jsonb_typeof(p_input -> 'steps') <> 'array' then
    perform pos_rpc.fail('INVALID_REQUEST', 'steps must be an array', jsonb_build_object('path', 'steps'));
  end if;
  update pos.definition_test_cases set
    name = coalesce(pos_rpc.in_text(p_input, 'name', false, 200), name),
    context = case when p_input ? 'context' then pos_rpc.in_object(p_input, 'context') else context end,
    steps = case when p_input ? 'steps' then p_input -> 'steps' else steps end,
    expectations = case when p_input ? 'expectations' then pos_rpc.in_object(p_input, 'expectations') else expectations end
  where id = p_test_case_id returning * into v;
  return to_jsonb(v);
end $$;

create function pos_rpc.admin_test_case_archive(p_actor uuid, p_test_case_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.definition_test_cases;
  v_bank uuid;
begin
  select * into v from pos.definition_test_cases where id = p_test_case_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'test case not found'); end if;
  select bank_id into v_bank from pos.definition_families where id = v.family_id;
  perform pos_rpc.admin_require_bank(p_actor, v_bank);
  update pos.definition_test_cases set archived_at = coalesce(archived_at, now()) where id = p_test_case_id returning * into v;
  return to_jsonb(v);
end $$;

-- ── Four-eyes decisions (D-31) ────────────────────────────────────────────────────────────────
-- Approver: approve_definitions, in scope of the request's bank, never the requester. The requester may withdraw.
-- Approving executes the frozen candidate in the same transaction (publish / activation / config version).
create function pos_rpc.admin_approval_decide(p_actor uuid, p_approval_id uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_req pos.approvals;
  v_decision pos.approval_decision;
  v_bank uuid;
  v_row pos.approvals;
  v_f pos.definition_families;
  v_executed jsonb;
  v_prev pos.remote_config_versions;
  v_cfg pos.remote_config_versions;
  v_ver pos.definition_versions;
  v_act pos.definition_activations;
begin
  begin
    v_decision := p_decision::pos.approval_decision;
  exception when invalid_text_representation then
    perform pos_rpc.fail('INVALID_REQUEST', 'decision must be approved, rejected or withdrawn');
  end;
  if v_decision = 'pending' then perform pos_rpc.fail('INVALID_REQUEST', 'decision must be approved, rejected or withdrawn'); end if;
  select * into v_req from pos.approvals where id = p_approval_id for update;
  if not found or v_req.decision <> 'pending' or v_req.request_ref is not null then
    perform pos_rpc.fail('NOT_FOUND', 'approval request not found');
  end if;
  if exists (select 1 from pos.approvals a where a.request_ref = p_approval_id) then
    perform pos_rpc.fail('CONFLICT', 'this request has already been decided');
  end if;
  v_bank := nullif(v_req.payload ->> 'bank_id', '')::uuid;

  if v_decision = 'withdrawn' then
    if v_req.requested_by is distinct from p_actor then perform pos_rpc.fail('FORBIDDEN', 'only the requester can withdraw'); end if;
    perform pos_rpc.require_staff(p_actor);
  else
    if v_bank is null then perform pos_rpc.admin_require_global(p_actor, 'approve_definitions');
    else perform pos_rpc.require_staff(p_actor, 'approve_definitions', v_bank); end if;
    if v_req.requested_by = p_actor then perform pos_rpc.fail('FORBIDDEN', 'you cannot decide your own request (four-eyes)'); end if;
    if v_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then
      perform pos_rpc.fail('NOTE_REQUIRED', 'a note is required to reject a request');
    end if;
  end if;

  insert into pos.approvals (subject_type, subject_ref, request_ref, payload, requested_by, approved_by, decision, note)
  values (v_req.subject_type, v_req.subject_ref, v_req.id, '{}'::jsonb, v_req.requested_by,
          case when v_decision = 'withdrawn' then null else p_actor end, v_decision, p_note)
  returning * into v_row;

  if v_decision = 'approved' then
    if v_req.subject_type = 'definition_publish' then
      select * into v_f from pos.definition_families where id = (v_req.payload ->> 'family_id')::uuid for update;
      v_ver := pos_rpc.definition_insert_version(v_f, v_req.payload, v_req.requested_by, p_actor);
      v_executed := jsonb_build_object('version', to_jsonb(v_ver) - 'definition');
    elsif v_req.subject_type = 'definition_activation' then
      v_act := pos_rpc.activation_insert((v_req.payload ->> 'family_id')::uuid, v_req.payload, v_req.requested_by, p_actor);
      v_executed := jsonb_build_object('activation', to_jsonb(v_act));
    elsif v_req.subject_type = 'remote_config' then
      select * into v_prev from pos.remote_config_versions r
       where r.layer = (v_req.payload ->> 'layer')::pos.config_layer
         and r.subject_id is not distinct from nullif(v_req.payload ->> 'subject_id', '')::uuid
       order by r.version desc limit 1;
      if v_prev.id::text is distinct from (v_req.payload ->> 'base_version_id') then
        perform pos_rpc.fail('CONFLICT', 'the config layer changed since this request was made — request again');
      end if;
      v_cfg := pos_rpc.config_insert_version(v_req.requested_by, p_actor, (v_req.payload ->> 'layer')::pos.config_layer,
                                             nullif(v_req.payload ->> 'subject_id', '')::uuid, v_req.payload -> 'values',
                                             v_req.payload ->> 'schema_version', v_req.payload ->> 'reason',
                                             (v_req.payload ->> 'effective_from')::timestamptz);
      v_executed := jsonb_build_object('version', to_jsonb(v_cfg));
    end if;
  end if;
  update pos.alerts set acknowledged_by = p_actor, acknowledged_at = now()
   where dedupe_key = 'approval:' || p_approval_id::text and acknowledged_at is null;
  return jsonb_build_object('decision_id', v_row.id, 'request_id', v_req.id, 'decision', v_decision, 'executed', v_executed);
end $$;
