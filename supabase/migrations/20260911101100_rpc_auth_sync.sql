-- FESS POS — module sessions (D-32) and sync/pull (docs/07 §2–3, §10; docs/08 §2).
-- The POS API verifies the host token with the trusted issuer (config) and passes the verified subject and
-- employee number here. Refresh tokens are opaque; only their SHA-256 is stored. Access tokens are signed by
-- the API and never stored.

-- ── Exchange: verified host identity → POS session ─────────────────────────────────────────────
create function pos_rpc.auth_exchange(p_issuer_key text, p_subject text, p_employee_number text,
                                      p_verified jsonb, p_device jsonb, p_profile jsonb,
                                      p_refresh_hash text, p_ip text default null, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_issuer pos.trusted_issuers;
  v_user pos.pos_users;
  v_link pos.external_identities;
  v_device_id uuid := (p_device ->> 'device_id')::uuid;
  v_device pos.devices;
  v_new_device boolean := false;
  v_session pos.pos_sessions;
  v_ttl_days integer := coalesce((pos.config_value(array['auth', 'refresh_token_ttl_days'], '30'::jsonb))::text::integer, 30);
  v_mismatch jsonb := '{}'::jsonb;
begin
  if v_device_id is null then
    perform pos_rpc.fail('INVALID_REQUEST', 'device.device_id is required');
  end if;

  select * into v_issuer from pos.trusted_issuers where key = p_issuer_key;
  if not found or not v_issuer.active or not v_issuer.primary_issuer then
    perform pos_rpc.fail('ISSUER_NOT_ACCEPTED', format('issuer %s is not an active primary issuer', p_issuer_key));
  end if;

  -- Binding: an existing link, else the issuer's verified employee number (never the host profile, 07 §2).
  select * into v_link from pos.external_identities
   where issuer_key = p_issuer_key and subject = p_subject and revoked_at is null;
  if found then
    select * into v_user from pos.pos_users where id = v_link.user_id;
  elsif p_employee_number is not null then
    select * into v_user from pos.pos_users where employee_number = p_employee_number;
    if found then
      insert into pos.external_identities (user_id, issuer_key, subject, linked_via)
      values (v_user.id, p_issuer_key, p_subject, 'issuer_lookup');
    end if;
  end if;

  if v_user.id is null then
    insert into pos.auth_events (issuer_key, event, device_id, ip, user_agent, detail)
    values (p_issuer_key, 'link_request', v_device_id, p_ip, p_user_agent,
            jsonb_build_object('subject', p_subject, 'employee_number', p_employee_number, 'verified', p_verified));
    perform pos_rpc.alert('link_request', 'info', 'Sign-in by an identity with no POS user — link or provision it',
                          'identity', null, null,
                          jsonb_build_object('issuer_key', p_issuer_key, 'employee_number', p_employee_number),
                          'link_request:' || p_issuer_key || ':' || p_subject);
    -- returned, not raised: the link request and alert above must commit (the API turns this into a 403)
    return jsonb_build_object('error', jsonb_build_object('code', 'UNKNOWN_IDENTITY', 'message', 'this identity is not linked to a POS user'));
  end if;

  if not v_user.active then
    insert into pos.auth_events (user_id, issuer_key, event, device_id, ip, user_agent, detail)
    values (v_user.id, p_issuer_key, 'exchange_refused', v_device_id, p_ip, p_user_agent, jsonb_build_object('reason', 'inactive'));
    return jsonb_build_object('error', jsonb_build_object('code', 'ACCOUNT_INACTIVE', 'message', 'POS access has been removed for this user'));
  end if;
  if v_user.role = 'pos_bank_reader' then
    perform pos_rpc.fail('FORBIDDEN', 'bank readers do not use the module');
  end if;

  -- Device registration / revocation (07 §2 device binding).
  select * into v_device from pos.devices where user_id = v_user.id and device_id = v_device_id;
  if found and v_device.revoked_at is not null then
    insert into pos.auth_events (user_id, issuer_key, event, device_id, ip, user_agent, detail)
    values (v_user.id, p_issuer_key, 'exchange_refused', v_device_id, p_ip, p_user_agent, jsonb_build_object('reason', 'device_revoked'));
    return jsonb_build_object('error', jsonb_build_object('code', 'DEVICE_REVOKED', 'message', 'this device has been revoked'));
  end if;
  if not found then
    v_new_device := true;
    insert into pos.devices (user_id, device_id, client_type, platform, model, os_version, host_app_version,
                             module_version, capabilities, push_provider, push_token)
    values (v_user.id, v_device_id, coalesce((p_device ->> 'client_type')::pos.client_type, 'native'),
            p_device ->> 'platform', p_device ->> 'model', p_device ->> 'os_version', p_device ->> 'host_app_version',
            p_device ->> 'module_version', coalesce(p_device -> 'capabilities', '{}'::jsonb),
            p_device ->> 'push_provider', p_device ->> 'push_token')
    returning * into v_device;
  else
    update pos.devices
       set client_type = coalesce((p_device ->> 'client_type')::pos.client_type, client_type),
           platform = coalesce(p_device ->> 'platform', platform), model = coalesce(p_device ->> 'model', model),
           os_version = coalesce(p_device ->> 'os_version', os_version),
           host_app_version = coalesce(p_device ->> 'host_app_version', host_app_version),
           module_version = coalesce(p_device ->> 'module_version', module_version),
           capabilities = coalesce(p_device -> 'capabilities', capabilities),
           push_provider = coalesce(p_device ->> 'push_provider', push_provider),
           push_token = coalesce(p_device ->> 'push_token', push_token),
           last_seen_at = now()
     where id = v_device.id
    returning * into v_device;
  end if;

  -- Same physical device used by another employee within 24 h → flag (07 §5).
  if exists (select 1 from pos.devices d where d.device_id = v_device_id and d.user_id <> v_user.id
              and d.last_seen_at > now() - interval '24 hours') then
    perform pos_rpc.alert('shared_device', 'warning', 'Device used by more than one employee within 24 h',
                          'device', v_device_id, null, jsonb_build_object('user_id', v_user.id),
                          'shared_device:' || v_device_id::text || ':' || to_char(now(), 'YYYY-MM-DD'));
  end if;
  if v_new_device then
    perform pos_rpc.alert('new_device', 'info', 'Sign-in from a new device', 'device', v_device_id, null,
                          jsonb_build_object('user_id', v_user.id, 'model', p_device ->> 'model'),
                          'new_device:' || v_user.id::text || ':' || v_device_id::text);
  end if;

  -- Profile is display/audit only; disagreement with the verified identity is flagged (07 §2).
  if p_profile ? 'employee_number' and p_profile ->> 'employee_number' is distinct from v_user.employee_number then
    v_mismatch := v_mismatch || jsonb_build_object('employee_number', jsonb_build_object('profile', p_profile ->> 'employee_number', 'verified', v_user.employee_number));
  end if;
  if p_verified ? 'first_name' and p_profile ? 'first_name'
     and lower(p_profile ->> 'first_name') is distinct from lower(p_verified ->> 'first_name') then
    v_mismatch := v_mismatch || jsonb_build_object('first_name', true);
  end if;
  if p_verified ? 'last_name' and p_profile ? 'last_name'
     and lower(p_profile ->> 'last_name') is distinct from lower(p_verified ->> 'last_name') then
    v_mismatch := v_mismatch || jsonb_build_object('last_name', true);
  end if;
  update pos.pos_users set profile_snapshot = p_profile where id = v_user.id and p_profile is not null;

  insert into pos.pos_sessions (id, user_id, device_id, issuer_key, family_id, refresh_token_hash, scope, expires_at)
  select s.id, v_user.id, v_device_id, p_issuer_key, s.id, p_refresh_hash, 'full', now() + make_interval(days => v_ttl_days)
    from (select gen_random_uuid() as id) s
  returning * into v_session;

  insert into pos.auth_events (user_id, issuer_key, event, device_id, session_id, ip, user_agent, profile_mismatch, detail)
  values (v_user.id, p_issuer_key, 'exchange', v_device_id, v_session.id, p_ip, p_user_agent,
          nullif(v_mismatch, '{}'::jsonb), jsonb_build_object('new_device', v_new_device));

  return jsonb_build_object(
    'session_id', v_session.id, 'family_id', v_session.family_id, 'scope', v_session.scope,
    'refresh_expires_at', v_session.expires_at, 'device_id', v_device_id,
    'profile_mismatch', nullif(v_mismatch, '{}'::jsonb),
    'user', jsonb_build_object('id', v_user.id, 'employee_number', v_user.employee_number, 'first_name', v_user.first_name,
                               'last_name', v_user.last_name, 'role', v_user.role, 'active', v_user.active));
end $$;

-- ── Refresh: rotate, detect reuse, downgrade inactive users to ingest_only (D-35) ───────────────
create function pos_rpc.auth_refresh(p_refresh_hash text, p_new_refresh_hash text, p_device_id uuid,
                                     p_ip text default null, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old pos.pos_sessions;
  v_new pos.pos_sessions;
  v_user pos.pos_users;
  v_device pos.devices;
  v_scope pos.session_scope;
  v_ttl_days integer := coalesce((pos.config_value(array['auth', 'refresh_token_ttl_days'], '30'::jsonb))::text::integer, 30);
begin
  select * into v_old from pos.pos_sessions where refresh_token_hash = p_refresh_hash for update;
  if not found then
    perform pos_rpc.fail('INVALID_REFRESH', 'unknown refresh token');
  end if;

  if v_old.rotated_at is not null then
    -- A rotated token presented again: the family is compromised (07 §2). Revoke everything in it.
    update pos.pos_sessions set revoked_at = now(), revoke_reason = 'reuse_detected'
     where family_id = v_old.family_id and revoked_at is null;
    insert into pos.auth_events (user_id, issuer_key, event, device_id, session_id, ip, user_agent)
    values (v_old.user_id, v_old.issuer_key, 'reuse_detected', p_device_id, v_old.id, p_ip, p_user_agent);
    perform pos_rpc.alert('refresh_reuse', 'critical', 'Refresh token reuse detected — session family revoked',
                          'session', v_old.family_id, null, jsonb_build_object('user_id', v_old.user_id),
                          'refresh_reuse:' || v_old.family_id::text);
    -- returned, not raised: the family revocation above must commit
    return jsonb_build_object('error', jsonb_build_object('code', 'SESSION_REVOKED', 'message', 'session revoked'));
  end if;
  if v_old.revoked_at is not null then
    perform pos_rpc.fail('SESSION_REVOKED', 'session revoked', jsonb_build_object('reason', v_old.revoke_reason));
  end if;
  if v_old.expires_at <= now() then
    perform pos_rpc.fail('SESSION_EXPIRED', 'refresh token expired; sign in again');
  end if;
  if v_old.device_id <> p_device_id then
    perform pos_rpc.fail('DEVICE_MISMATCH', 'refresh token is bound to another device');
  end if;

  select * into v_device from pos.devices where user_id = v_old.user_id and device_id = p_device_id;
  if found and v_device.revoked_at is not null then
    update pos.pos_sessions set revoked_at = now(), revoke_reason = 'device_revoked'
     where family_id = v_old.family_id and revoked_at is null;
    return jsonb_build_object('error', jsonb_build_object('code', 'SESSION_REVOKED', 'message', 'device revoked'));
  end if;
  update pos.devices set last_seen_at = now() where id = v_device.id;

  select * into v_user from pos.pos_users where id = v_old.user_id;
  v_scope := case when v_user.active then v_old.scope else 'ingest_only' end;

  update pos.pos_sessions set rotated_at = now(), last_used_at = now() where id = v_old.id;
  insert into pos.pos_sessions (user_id, device_id, issuer_key, family_id, refresh_token_hash, scope, expires_at, rotated_from)
  values (v_old.user_id, p_device_id, v_old.issuer_key, v_old.family_id, p_new_refresh_hash, v_scope,
          now() + make_interval(days => v_ttl_days), v_old.id)
  returning * into v_new;

  insert into pos.auth_events (user_id, issuer_key, event, device_id, session_id, ip, user_agent, detail)
  values (v_user.id, v_old.issuer_key, (case when v_scope <> v_old.scope then 'downgrade' else 'refresh' end)::pos.auth_event_type,
          p_device_id, v_new.id, p_ip, p_user_agent, jsonb_build_object('scope', v_scope));

  return jsonb_build_object(
    'session_id', v_new.id, 'family_id', v_new.family_id, 'scope', v_new.scope,
    'refresh_expires_at', v_new.expires_at, 'device_id', p_device_id,
    'user', jsonb_build_object('id', v_user.id, 'employee_number', v_user.employee_number, 'first_name', v_user.first_name,
                               'last_name', v_user.last_name, 'role', v_user.role, 'active', v_user.active));
end $$;

-- Is this session (from a verified access token) still usable? Hard revocation takes effect immediately.
create function pos_rpc.auth_session_state(p_session_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('exists', s.id is not null, 'revoked', s.revoked_at is not null,
                            'scope', s.scope, 'user_active', u.active, 'user_id', s.user_id, 'device_id', s.device_id)
    from (select 1) one
    left join pos.pos_sessions s on s.id = p_session_id
    left join pos.pos_users u on u.id = s.user_id;
$$;

-- Sign-out: UI access ends, the outbox keeps draining under ingest_only (03 §3, D-21).
create function pos_rpc.auth_signout(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s pos.pos_sessions;
begin
  select * into v_s from pos.pos_sessions where id = p_session_id;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'session not found'); end if;
  update pos.pos_sessions set scope = 'ingest_only'
   where family_id = v_s.family_id and revoked_at is null and scope = 'full';
  insert into pos.auth_events (user_id, issuer_key, event, device_id, session_id, detail)
  values (v_s.user_id, v_s.issuer_key, 'downgrade', v_s.device_id, v_s.id, jsonb_build_object('reason', 'sign_out'));
  return jsonb_build_object('scope', 'ingest_only');
end $$;

-- ── Sync prepare (service_role): per-device secrets the pull hands out exactly once ────────────
-- Session tokens for live jobs lacking one on this device (07 §3), agent-card and job-card tokens (07 §10),
-- resolved remote config per bank. A token the device reports missing is re-issued (the previous one revoked).
create function pos_rpc.sync_prepare(p_user_id uuid, p_device_id uuid, p_have_token_job_ids uuid[],
                                     p_have_agent_card boolean, p_have_job_card_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user pos.pos_users;
  v_job record;
  v_token text;
  v_tokens jsonb := '[]'::jsonb;
  v_job_cards jsonb := '[]'::jsonb;
  v_agent_card jsonb;
  v_pad interval := make_interval(hours => coalesce((pos.config_value(array['session_tokens', 'window_padding_h'], '24'::jsonb))::text::integer, 24));
  v_card_ttl interval := make_interval(hours => coalesce((pos.config_value(array['agent_card', 'token_ttl_h'], '24'::jsonb))::text::integer, 24));
  v_live pos.session_tokens;
  v_id uuid;
  v_valid_from timestamptz;
  v_valid_to timestamptz;
  v_config jsonb;
  v_by_bank jsonb := '{}'::jsonb;
  v_bank uuid;
begin
  select * into v_user from pos.pos_users where id = p_user_id;
  if not found or not v_user.active or v_user.role <> 'pos_agent' then
    perform pos_rpc.fail('FORBIDDEN', 'not an active agent');
  end if;
  update pos.devices set last_seen_at = now() where user_id = p_user_id and device_id = p_device_id;

  for v_job in
    select j.* from pos.jobs j
     where j.assigned_to = p_user_id and j.status in ('assigned', 'accepted', 'in_progress', 'paused', 'returned')
  loop
    v_valid_from := coalesce(v_job.scheduled_start, now()) - v_pad;
    v_valid_to := coalesce(v_job.scheduled_end, now() + interval '48 hours') + v_pad;

    -- inspection session token
    select * into v_live from pos.session_tokens t
     where t.job_id = v_job.id and t.user_id = p_user_id and t.device_id = p_device_id
       and t.used_at is null and t.revoked_at is null and t.valid_to > now()
     order by t.issued_at desc limit 1;
    if not found or not (v_job.id = any (coalesce(p_have_token_job_ids, '{}'))) then
      if found then
        update pos.session_tokens set revoked_at = now(), revoke_reason = 'reissued' where id = v_live.id;
      end if;
      if v_job.status <> 'in_progress' and v_job.status <> 'paused' then  -- a started inspection already holds its token
        v_token := pos.random_token_hex(32);
        insert into pos.session_tokens (job_id, user_id, device_id, token_hash, valid_from, valid_to)
        values (v_job.id, p_user_id, p_device_id, pos.sha256_hex(v_token), v_valid_from, v_valid_to)
        returning id into v_id;
        v_tokens := v_tokens || jsonb_build_object('job_id', v_job.id, 'token_id', v_id, 'token', v_token,
                                                   'valid_from', v_valid_from, 'valid_to', v_valid_to);
      end if;
    end if;

    -- job authorisation card token (expires with the job window)
    if not (v_job.id = any (coalesce(p_have_job_card_ids, '{}'))) then
      v_token := pos.random_token_hex(16);
      insert into pos.agent_card_tokens (user_id, job_id, token_hash, valid_from, valid_to)
      values (p_user_id, v_job.id, pos.sha256_hex(v_token), now(), greatest(v_valid_to, now() + interval '1 hour'))
      returning id into v_id;
      v_job_cards := v_job_cards || jsonb_build_object('job_id', v_job.id, 'token', v_token, 'valid_to', greatest(v_valid_to, now() + interval '1 hour'));
    end if;
  end loop;

  -- agent authorisation card token: rotated while online, valid offline until expiry (07 §10)
  if not coalesce(p_have_agent_card, false)
     or not exists (select 1 from pos.agent_card_tokens c where c.user_id = p_user_id and c.job_id is null
                     and c.revoked_at is null and c.valid_to > now() + v_card_ttl / 4) then
    v_token := pos.random_token_hex(16);
    insert into pos.agent_card_tokens (user_id, token_hash, valid_from, valid_to)
    values (p_user_id, pos.sha256_hex(v_token), now(), now() + v_card_ttl);
    v_agent_card := jsonb_build_object('token', v_token, 'valid_to', now() + v_card_ttl);
  end if;

  -- resolved remote config: default (no bank) + one per bank of live jobs
  v_config := pos_rpc.resolve_config(p_user_id, p_device_id, null);
  for v_bank in select distinct j.bank_id from pos.jobs j
                 where j.assigned_to = p_user_id and j.status not in ('closed', 'cancelled', 'approved', 'rejected') loop
    v_by_bank := v_by_bank || jsonb_build_object(v_bank::text, pos_rpc.resolve_config(p_user_id, p_device_id, v_bank));
  end loop;

  return jsonb_build_object('session_tokens', v_tokens, 'job_cards', v_job_cards, 'agent_card', v_agent_card,
                            'config', jsonb_build_object('default', v_config, 'by_bank', v_by_bank));
end $$;

-- ── Sync read (SECURITY INVOKER — runs as `authenticated` with the agent's claims, so RLS applies) ─
-- Cursors are "<timestamptz>|<uuid>" keyset positions; `have` lists what the device already caches.
create function pos.cursor_ts(p_cursor text) returns timestamptz language sql immutable set search_path = '' as $$
  select coalesce(nullif(split_part(coalesce(p_cursor, ''), '|', 1), '')::timestamptz, '-infinity'::timestamptz);
$$;
create function pos.cursor_id(p_cursor text) returns uuid language sql immutable set search_path = '' as $$
  select coalesce(nullif(split_part(coalesce(p_cursor, ''), '|', 2), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid);
$$;

create function pos.uuid_array(p_json jsonb) returns uuid[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(coalesce(p_json, '[]'::jsonb)) x;
$$;

create function pos.geo_json(p_geo extensions.geography) returns jsonb language sql immutable set search_path = '' as $$
  select case when p_geo is null then null
              else jsonb_build_object('lat', round(extensions.st_y(p_geo::extensions.geometry)::numeric, 7),
                                      'lng', round(extensions.st_x(p_geo::extensions.geometry)::numeric, 7)) end;
$$;

create function pos.sync_read(p_cursors jsonb, p_have jsonb, p_limit integer default 200)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_me uuid := pos.agent_full_id();
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_tz text := coalesce(pos.config_value(array['locale', 'timezone']) #>> '{}', 'Africa/Johannesburg');
  c_jobs text := p_cursors ->> 'jobs';
  c_reviews text := p_cursors ->> 'reviews';
  c_evidence text := p_cursors ->> 'evidence';
  c_envelopes text := p_cursors ->> 'envelopes';
  v_have_defs uuid[] := pos.uuid_array(p_have -> 'definition_version_ids');
  v_pinned uuid[] := pos.uuid_array(p_have -> 'pinned_version_ids');
  v_have_lookups uuid[] := pos.uuid_array(p_have -> 'lookup_version_ids');
  v_have_decls uuid[] := pos.uuid_array(p_have -> 'declaration_ids');
  v_bank_ids uuid[];
  v_jobs jsonb; v_jobs_n integer; v_jobs_next text;
  v_def_manifest jsonb; v_def_bodies jsonb;
  v_lookup_manifest jsonb; v_lookup_bodies jsonb;
  v_decl_manifest jsonb; v_decl_bodies jsonb;
  v_reason_items jsonb; v_reason_hash text;
  v_reviews jsonb; v_reviews_n integer; v_reviews_next text;
  v_evidence jsonb; v_evidence_n integer; v_evidence_next text;
  v_envs jsonb; v_envs_n integer; v_envs_next text;
  v_totals jsonb;
  v_me_row jsonb;
begin
  if v_me is null then
    raise exception 'sync/pull requires a full-scope agent session' using errcode = 'P0001', hint = 'POS:FORBIDDEN';
  end if;

  -- Jobs (RLS: jobs ever assigned to me), keyset on (updated_at, id)
  select coalesce(jsonb_agg(x.obj order by x.updated_at, x.id), '[]'::jsonb), count(*),
         (array_agg(x.updated_at::text || '|' || x.id::text order by x.updated_at desc, x.id desc))[1]
    into v_jobs, v_jobs_n, v_jobs_next
    from (
      select j.updated_at, j.id, jsonb_build_object(
        'id', j.id, 'reference', j.reference, 'status', j.status, 'updated_at', j.updated_at,
        'bank', (select jsonb_build_object('id', b.id, 'code', b.code, 'name', b.name) from pos.banks b where b.id = j.bank_id),
        'external_ref', j.external_ref, 'merchant_name', j.merchant_name, 'trading_name', j.trading_name,
        'address', j.address, 'location', pos.geo_json(j.location), 'location_source', j.location_source,
        'location_type', j.location_type,
        'mcc', (select jsonb_build_object('code', m.code, 'description', m.description) from pos.mcc_codes m where m.code = j.mcc_code),
        'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end,
        'onsite_contact', j.onsite_contact, 'contact', j.contact, 'notes', j.notes, 'attributes', j.attributes,
        'job_schema_version_id', j.job_schema_version_id, 'geofence_radius_m', j.geofence_radius_m,
        'gps_accuracy_max_m', j.gps_accuracy_max_m, 'parent_job_id', j.parent_job_id,
        'assigned_to_me', j.assigned_to is not distinct from v_me,
        'assignment', (select jsonb_build_object('id', a.id, 'response', a.response, 'assigned_at', a.assigned_at)
                         from pos.job_assignments a where a.job_id = j.id and a.user_id = v_me
                        order by a.assigned_at desc limit 1),
        'attempts', (select coalesce(max(i.attempt), 0) from pos.inspections i where i.job_id = j.id),
        'latest_review', (select jsonb_build_object('decision', r.decision, 'reason_code', r.reason_code, 'note', r.note,
                                                    'decided_at', r.decided_at)
                            from pos.reviews r join pos.inspections i on i.id = r.inspection_id
                           where i.job_id = j.id and i.user_id = v_me order by r.decided_at desc limit 1)
      ) as obj
        from pos.jobs j
       where (j.updated_at, j.id) > (pos.cursor_ts(c_jobs), pos.cursor_id(c_jobs))
       order by j.updated_at, j.id
       limit v_limit) x;

  -- Banks whose definitions/lists the device needs: banks of jobs that are still live for me
  select coalesce(array_agg(distinct j.bank_id), '{}') into v_bank_ids
    from pos.jobs j where j.assigned_to = v_me and j.status not in ('closed', 'cancelled', 'approved', 'rejected');

  -- Definitions of all kinds resolved for me: default context + one per bank (bank family overrides global)
  with ctx as (select null::uuid as bank_id union all select unnest(v_bank_ids)),
       res as (select c.bank_id as context_bank_id, r.* from ctx c cross join lateral pos.resolve_definitions(v_me, c.bank_id) r)
  select coalesce(jsonb_agg(jsonb_build_object(
           'context_bank_id', res.context_bank_id, 'kind', res.kind, 'key', res.key, 'family_id', res.family_id,
           'family_bank_id', res.bank_id, 'version_id', res.version_id, 'version', v.version,
           'spec_version', v.spec_version, 'definition_hash', v.definition_hash)), '[]'::jsonb)
    into v_def_manifest
    from res join pos.definition_versions v on v.id = res.version_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'family_id', v.family_id, 'kind', f.kind, 'key', f.key, 'bank_id', f.bank_id, 'version', v.version,
           'spec_version', v.spec_version, 'definition', v.definition, 'definition_hash', v.definition_hash,
           'requires', v.requires)), '[]'::jsonb)
    into v_def_bodies
    from pos.definition_versions v join pos.definition_families f on f.id = v.family_id
   where (v.id in (select (e ->> 'version_id')::uuid from jsonb_array_elements(v_def_manifest) e) or v.id = any (v_pinned))
     and not (v.id = any (v_have_defs));

  -- Lookup lists (latest version per list) and declarations (latest per key)
  select coalesce(jsonb_agg(jsonb_build_object('list_id', l.id, 'key', l.key, 'bank_id', l.bank_id, 'version_id', lv.id,
                                               'version', lv.version, 'hash', lv.hash)), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('version_id', lv.id, 'list_id', l.id, 'key', l.key, 'bank_id', l.bank_id,
                                               'version', lv.version, 'hash', lv.hash, 'items', lv.items))
                    filter (where not (lv.id = any (v_have_lookups))), '[]'::jsonb)
    into v_lookup_manifest, v_lookup_bodies
    from pos.lookup_lists l
    cross join lateral (select * from pos.lookup_list_versions x where x.list_id = l.id order by x.version desc limit 1) lv
   where l.bank_id is null or l.bank_id = any (v_bank_ids);

  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'key', d.key, 'version', d.version, 'hash', d.hash)), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'key', d.key, 'version', d.version, 'title', d.title,
                                               'text', d.text, 'hash', d.hash))
                    filter (where not (d.id = any (v_have_decls))), '[]'::jsonb)
    into v_decl_manifest, v_decl_bodies
    from (select distinct on (x.key) x.* from pos.declarations x order by x.key, x.version desc) d;

  -- Reason codes: sent whole when their hash changes (small list)
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'category', r.category, 'code', r.code, 'label', r.label,
                                               'description', r.description, 'requires_note', r.requires_note,
                                               'requires_photo', r.requires_photo, 'bank_id', r.bank_id,
                                               'sort_order', r.sort_order)
                            order by r.category, r.sort_order, r.code), '[]'::jsonb)
    into v_reason_items
    from pos.reason_codes r
   where r.active and (r.bank_id is null or r.bank_id = any (v_bank_ids));
  v_reason_hash := pos.sha256_hex(v_reason_items::text);

  -- Review outcomes for my inspections
  select coalesce(jsonb_agg(x.obj order by x.decided_at, x.id), '[]'::jsonb), count(*),
         (array_agg(x.decided_at::text || '|' || x.id::text order by x.decided_at desc, x.id desc))[1]
    into v_reviews, v_reviews_n, v_reviews_next
    from (select r.decided_at, r.id,
                 jsonb_build_object('id', r.id, 'inspection_id', r.inspection_id, 'job_id', i.job_id, 'attempt', i.attempt,
                                    'decision', r.decision, 'reason_code', r.reason_code, 'note', r.note,
                                    'decided_at', r.decided_at) as obj
            from pos.reviews r join pos.inspections i on i.id = r.inspection_id
           where i.user_id = v_me and (r.decided_at, r.id) > (pos.cursor_ts(c_reviews), pos.cursor_id(c_reviews))
           order by r.decided_at, r.id limit v_limit) x;

  -- Evidence status changes (drives local byte deletion on `verified`, 08 §4)
  select coalesce(jsonb_agg(x.obj order by x.updated_at, x.id), '[]'::jsonb), count(*),
         (array_agg(x.updated_at::text || '|' || x.id::text order by x.updated_at desc, x.id desc))[1]
    into v_evidence, v_evidence_n, v_evidence_next
    from (select e.updated_at, e.id,
                 jsonb_build_object('id', e.id, 'inspection_id', e.inspection_id, 'upload_state', e.upload_state,
                                    'replica_state', e.replica_state, 'verified_at', e.verified_at,
                                    'sha256_server', e.sha256_server) as obj
            from pos.evidence e
           where (e.updated_at, e.id) > (pos.cursor_ts(c_evidence), pos.cursor_id(c_evidence))
           order by e.updated_at, e.id limit v_limit) x;

  -- Envelope outcomes and admin resolutions (releases needs_attention items, 08 §6)
  select coalesce(jsonb_agg(x.obj order by x.updated_at, x.id), '[]'::jsonb), count(*),
         (array_agg(x.updated_at::text || '|' || x.id::text order by x.updated_at desc, x.id desc))[1]
    into v_envs, v_envs_n, v_envs_next
    from (select e.updated_at, e.id,
                 jsonb_build_object('id', e.id, 'state', e.state, 'receipt', e.result, 'resolution', e.resolution,
                                    'resolved_at', e.resolved_at, 'resolution_note', e.resolution_note) as obj
            from pos.ingest_envelopes e
           where e.user_id = v_me and e.state <> 'received'
             and (e.updated_at, e.id) > (pos.cursor_ts(c_envelopes), pos.cursor_id(c_envelopes))
           order by e.updated_at, e.id limit v_limit) x;

  -- Agent totals for home tiles (04 §3.6)
  select jsonb_build_object(
           'active', count(*) filter (where j.assigned_to = v_me and j.status in ('assigned', 'accepted', 'in_progress', 'paused', 'returned')),
           'due_today', count(*) filter (where j.assigned_to = v_me and j.status in ('assigned', 'accepted', 'returned')
                                           and (j.scheduled_start at time zone v_tz)::date = (now() at time zone v_tz)::date),
           'awaiting_review', count(*) filter (where j.status in ('submitted', 'under_review')
                                                 and exists (select 1 from pos.inspections i where i.job_id = j.id and i.user_id = v_me)),
           'completed_this_month', count(*) filter (where j.status in ('approved', 'closed')
                                                      and j.status_changed_at >= date_trunc('month', now() at time zone v_tz) at time zone v_tz
                                                      and exists (select 1 from pos.inspections i where i.job_id = j.id and i.user_id = v_me and i.status = 'approved')),
           'returned', count(*) filter (where j.assigned_to = v_me and j.status = 'returned'))
    into v_totals
    from pos.jobs j;

  select jsonb_build_object('id', u.id, 'employee_number', u.employee_number, 'first_name', u.first_name,
                            'last_name', u.last_name, 'role', u.role, 'attributes', u.attributes, 'has_photo', u.photo_path is not null)
    into v_me_row
    from pos.pos_users u where u.id = v_me;

  return jsonb_build_object(
    'server_time', now(),
    'server_epoch', (select e.epoch from pos.server_epoch e where e.id = 1),
    'me', v_me_row,
    'jobs', jsonb_build_object('items', v_jobs, 'next_cursor', coalesce(v_jobs_next, c_jobs), 'has_more', v_jobs_n >= v_limit),
    'definitions', jsonb_build_object('manifest', v_def_manifest, 'bodies', v_def_bodies),
    'lookup_lists', jsonb_build_object('manifest', v_lookup_manifest, 'bodies', v_lookup_bodies),
    'declarations', jsonb_build_object('manifest', v_decl_manifest, 'bodies', v_decl_bodies),
    'reason_codes', jsonb_build_object('hash', v_reason_hash,
                                       'items', case when v_reason_hash = p_have ->> 'reason_codes_hash' then null else v_reason_items end),
    'reviews', jsonb_build_object('items', v_reviews, 'next_cursor', coalesce(v_reviews_next, c_reviews), 'has_more', v_reviews_n >= v_limit),
    'evidence', jsonb_build_object('items', v_evidence, 'next_cursor', coalesce(v_evidence_next, c_evidence), 'has_more', v_evidence_n >= v_limit),
    'envelopes', jsonb_build_object('items', v_envs, 'next_cursor', coalesce(v_envs_next, c_envelopes), 'has_more', v_envs_n >= v_limit),
    'agent_totals', v_totals,
    'commands', '[]'::jsonb);
end $$;
