-- FESS POS — admin write functions, part 3: envelope inbox, alerts, sessions & devices, exports, server epoch, evidence
-- access, admin read RPCs and first-admin bootstrap (docs/12 §5, §9–10, §12; docs/07 §2; B6.4, B7.7, C10.5). Expand-only.

-- ── Envelope inbox (docs/12 §5) ───────────────────────────────────────────────────────────────
-- Envelopes carry no bank, so inbox actions need an all-bank admin (decision recorded in the admin report / docs/09).
create function pos.envelope_summary(p_e pos.ingest_envelopes)
returns jsonb language sql stable set search_path = '' as $$
  select to_jsonb(p_e) - 'payload' - 'wrapper' - 'result';
$$;

create function pos_rpc.envelope_ack_alerts(p_envelope_id uuid, p_actor uuid)
returns void language sql security definer set search_path = '' as $$
  update pos.alerts set acknowledged_by = p_actor, acknowledged_at = now()
   where acknowledged_at is null
     and dedupe_key in ('envelope_rejected:' || p_envelope_id::text, 'envelope_conflict:' || p_envelope_id::text,
                        'ingest_hold:' || p_envelope_id::text, 'envelope_stuck:' || p_envelope_id::text);
$$;

-- Reprocess after a definition or code fix: the envelope goes back to `received` with processing cleared, so the
-- reprocessor (pos_rpc.reprocess_candidates, every cron tick) validates and applies it again. Data is untouched.
create function pos_rpc.admin_envelope_reprocess(p_actor uuid, p_envelope_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.ingest_envelopes;
  v_prev pos.envelope_state;
begin
  perform pos_rpc.admin_require_global(p_actor);
  if coalesce(btrim(p_note), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a note is required'); end if;
  perform pg_advisory_xact_lock(hashtext('pos.ingest:' || p_envelope_id::text));
  select * into v from pos.ingest_envelopes where id = p_envelope_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'envelope not found'); end if;
  if v.state not in ('rejected', 'conflict', 'deferred', 'received') then
    perform pos_rpc.fail('CONFLICT', format('envelope is %s: only rejected, conflict, deferred or held envelopes can be reprocessed', v.state));
  end if;
  v_prev := v.state;
  update pos.ingest_envelopes
     set state = 'received', waiting_on = null, processed_at = null, resolution = 'reprocessed', resolved_by = p_actor,
         resolved_at = now(), resolution_note = p_note
   where id = p_envelope_id returning * into v;
  perform pos_rpc.custody('envelope', p_envelope_id, 'reprocess_requested', 'server', v.device_id, p_envelope_id,
                          jsonb_build_object('previous_state', v_prev, 'by', p_actor, 'note', p_note));
  perform pos_rpc.envelope_ack_alerts(p_envelope_id, p_actor);
  return pos.envelope_summary(v);
end $$;

-- Resolve with a reason (resolution flows back to the device via sync/pull so it can release its copy), or attach to a
-- job (recorded on the job's timeline). The envelope's state and data are unchanged.
create function pos_rpc.admin_envelope_resolve(p_actor uuid, p_envelope_id uuid, p_resolution text, p_note text, p_job_id uuid,
                                               p_reason_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.ingest_envelopes;
  v_job pos.jobs;
begin
  perform pos_rpc.admin_require_global(p_actor);
  if p_resolution not in ('resolved', 'attached') then
    perform pos_rpc.fail('INVALID_REQUEST', 'resolution must be resolved or attached');
  end if;
  if coalesce(btrim(p_note), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a note is required'); end if;
  select * into v from pos.ingest_envelopes where id = p_envelope_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'envelope not found'); end if;
  -- held envelopes (e.g. an unknown type) stay `received` with waiting_on.reprocess until processed or resolved here
  if not (v.state in ('rejected', 'conflict', 'deferred') or (v.state = 'received' and v.waiting_on ? 'reprocess')) then
    perform pos_rpc.fail('CONFLICT', format('envelope is %s: only rejected, conflict, deferred or held envelopes are resolved', v.state));
  end if;
  if v.resolution is not null then perform pos_rpc.fail('CONFLICT', 'envelope already resolved'); end if;
  if p_resolution = 'attached' then
    if p_job_id is null then perform pos_rpc.fail('INVALID_REQUEST', 'job_id is required to attach'); end if;
    select * into v_job from pos.jobs where id = p_job_id for update;
    if not found then perform pos_rpc.fail('NOT_FOUND', 'job not found'); end if;
  end if;
  if p_reason_code is not null then
    perform pos_rpc.require_reason('envelope_resolution', p_reason_code, v_job.bank_id, p_note);
  end if;
  update pos.ingest_envelopes set resolution = p_resolution, resolved_by = p_actor, resolved_at = now(),
                                  resolution_note = coalesce(p_reason_code || ': ', '') || p_note
   where id = p_envelope_id returning * into v;
  if p_resolution = 'attached' then
    perform pos_rpc.job_event(p_job_id, 'envelope_attached', p_actor, 'admin', v_job.status, v_job.status, 'recorded', p_reason_code, p_note,
                              jsonb_build_object('envelope_id', p_envelope_id, 'envelope_type', v.type, 'envelope_state', v.state));
  end if;
  perform pos_rpc.custody('envelope', p_envelope_id, 'resolved', 'server', v.device_id, p_envelope_id,
                          jsonb_build_object('resolution', p_resolution, 'job_id', p_job_id, 'by', p_actor));
  perform pos_rpc.envelope_ack_alerts(p_envelope_id, p_actor);
  return pos.envelope_summary(v);
end $$;

-- ── Alerts ─────────────────────────────────────────────────────────────────────────────────────
create function pos_rpc.admin_alerts_ack(p_actor uuid, p_alert_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v_n integer;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  if cardinality(coalesce(p_alert_ids, '{}')) = 0 then perform pos_rpc.fail('INVALID_REQUEST', 'ids is empty'); end if;
  update pos.alerts a set acknowledged_by = p_actor, acknowledged_at = now()
   where a.id = any (p_alert_ids) and a.acknowledged_at is null
     and (v_actor.bank_ids is null or a.bank_id = any (v_actor.bank_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── Sessions & devices (docs/07 §2) ───────────────────────────────────────────────────────────
create function pos_rpc.admin_session_revoke(p_actor uuid, p_session_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v_s pos.pos_sessions;
  v_u pos.pos_users;
  v_n integer;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  if coalesce(btrim(p_reason), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a reason is required'); end if;
  select * into v_s from pos.pos_sessions where id = p_session_id;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'session not found'); end if;
  select * into v_u from pos.pos_users where id = v_s.user_id;
  if not pos_rpc.admin_can_manage_user(v_actor, v_u.role, v_u.bank_ids) then perform pos_rpc.fail('FORBIDDEN', 'user outside your scope'); end if;
  update pos.pos_sessions set revoked_at = now(), revoke_reason = 'admin: ' || p_reason
   where family_id = v_s.family_id and revoked_at is null;
  get diagnostics v_n = row_count;
  insert into pos.auth_events (user_id, issuer_key, event, device_id, session_id, detail, request_id)
  values (v_s.user_id, v_s.issuer_key, 'revoke', v_s.device_id, v_s.id,
          jsonb_build_object('reason', p_reason, 'by', p_actor, 'family_id', v_s.family_id, 'revoked', v_n),
          nullif(current_setting('pos.request_id', true), ''));
  return v_n;
end $$;

create function pos_rpc.admin_device_revoke(p_actor uuid, p_device_row_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.devices;
  v_u pos.pos_users;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  if coalesce(btrim(p_reason), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a reason is required'); end if;
  select * into v from pos.devices where id = p_device_row_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'device not found'); end if;
  select * into v_u from pos.pos_users where id = v.user_id;
  if not pos_rpc.admin_can_manage_user(v_actor, v_u.role, v_u.bank_ids) then perform pos_rpc.fail('FORBIDDEN', 'user outside your scope'); end if;
  if v.revoked_at is not null then perform pos_rpc.fail('CONFLICT', 'device already revoked'); end if;
  update pos.devices set revoked_at = now(), revoke_reason = p_reason where id = p_device_row_id returning * into v;
  update pos.pos_sessions set revoked_at = now(), revoke_reason = 'device_revoked'
   where user_id = v.user_id and device_id = v.device_id and revoked_at is null;
  update pos.session_tokens set revoked_at = now(), revoke_reason = 'device_revoked'
   where user_id = v.user_id and device_id = v.device_id and used_at is null and revoked_at is null;
  insert into pos.auth_events (user_id, event, device_id, detail, request_id)
  values (v.user_id, 'revoke', v.device_id, jsonb_build_object('reason', p_reason, 'by', p_actor, 'scope', 'device'),
          nullif(current_setting('pos.request_id', true), ''));
  perform pos_rpc.alert('device_revoked', 'warning', format('Device revoked for %s %s: %s', v_u.first_name, v_u.last_name, p_reason),
                        'device', v.device_id, null,
                        jsonb_build_object('pending_items', (select s.pending_total from pos.device_sync_status s
                                                              where s.user_id = v.user_id and s.device_id = v.device_id)),
                        'device_revoked:' || v.id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  return to_jsonb(v) - 'push_token';
end $$;

create function pos_rpc.admin_device_restore(p_actor uuid, p_device_row_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.devices;
  v_u pos.pos_users;
begin
  v_actor := pos_rpc.require_staff(p_actor);
  if coalesce(btrim(p_reason), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a reason is required'); end if;
  select * into v from pos.devices where id = p_device_row_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'device not found'); end if;
  select * into v_u from pos.pos_users where id = v.user_id;
  if not pos_rpc.admin_can_manage_user(v_actor, v_u.role, v_u.bank_ids) then perform pos_rpc.fail('FORBIDDEN', 'user outside your scope'); end if;
  if v.revoked_at is null then perform pos_rpc.fail('CONFLICT', 'device is not revoked'); end if;
  -- revoked sessions stay revoked; the agent signs in again from this device
  update pos.devices set revoked_at = null, revoke_reason = 'restored: ' || p_reason where id = p_device_row_id returning * into v;
  return to_jsonb(v) - 'push_token';
end $$;

-- ── Exports (B6.4, B6.8) — row + queue message in one transaction; the export worker renders it ──
create function pos_rpc.admin_export_request(p_actor uuid, p_type text, p_scope jsonb, p_recipient text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.exports;
  v_bank uuid := nullif(p_scope ->> 'bank_id', '')::uuid;
begin
  v_actor := pos_rpc.require_staff(p_actor, null, v_bank);
  if v_actor.bank_ids is not null and v_bank is null then
    perform pos_rpc.fail('VALIDATION_FAILED', 'choose a bank for this export',
                         jsonb_build_array(jsonb_build_object('path', 'scope.bank_id', 'message', 'required for bank-scoped admins')));
  end if;
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' then
    perform pos_rpc.fail('INVALID_REQUEST', 'scope must be an object');
  end if;
  insert into pos.exports (type, scope, requested_by, recipient, request_id)
  values (p_type::pos.export_type, p_scope, p_actor, nullif(btrim(p_recipient), ''), nullif(current_setting('pos.request_id', true), ''))
  returning * into v;
  perform pos_rpc.enqueue('export', jsonb_build_object('export_id', v.id));
  return to_jsonb(v);
exception when invalid_text_representation then
  perform pos_rpc.fail('INVALID_REQUEST', 'unknown export type'); return null;
end $$;

-- ── Server epoch (docs/12 §12) — break-glass after a restore: devices re-send what they retain ──
create function pos_rpc.admin_server_epoch_rotate(p_actor uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.server_epoch;
begin
  perform pos_rpc.admin_require_global(p_actor);
  if coalesce(btrim(p_reason), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a reason is required (break-glass)'); end if;
  update pos.server_epoch set epoch = gen_random_uuid(), set_at = now(), reason = p_reason where id = 1 returning * into v;
  perform pos_rpc.alert('server_epoch_rotated', 'critical', format('Server epoch rotated: %s', p_reason), 'server_epoch', v.epoch, null,
                        jsonb_build_object('by', p_actor), 'server_epoch:' || v.epoch::text);
  return to_jsonb(v);
end $$;

-- ── Evidence access (signed URL ≤ 15 min is created by the API after this scope check) ──────────
create function pos_rpc.admin_evidence_for_url(p_actor uuid, p_evidence_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v pos.evidence;
  v_bank uuid;
begin
  select * into v from pos.evidence where id = p_evidence_id;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'evidence not found'); end if;
  select bank_id into v_bank from pos.jobs where id = v.job_id;
  perform pos_rpc.require_staff(p_actor, null, v_bank);
  if v.upload_state = 'pending' then perform pos_rpc.fail('NOT_FOUND', 'evidence has not been uploaded yet'); end if;
  return jsonb_build_object('id', v.id, 'bucket', 'evidence', 'storage_path', v.storage_path, 'mime', v.mime, 'upload_state', v.upload_state);
end $$;

-- ── Admin read RPCs (security invoker → RLS decides what the admin sees; exposed through PostgREST `pos`) ──
create function pos.admin_dashboard()
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'jobs_by_status', coalesce((select jsonb_object_agg(s.status, s.n) from (select j.status, count(*) as n from pos.jobs j group by j.status) s), '{}'::jsonb),
    'open_alerts', (select count(*) from pos.alerts a where a.acknowledged_at is null),
    'open_alerts_critical', (select count(*) from pos.alerts a where a.acknowledged_at is null and a.severity = 'critical'),
    'awaiting_review', (select count(*) from pos.inspections i
                         where i.status in ('submitted', 'verifying', 'under_review', 'integrity_failed')
                           and not exists (select 1 from pos.reviews r where r.inspection_id = i.id)),
    'custody', (select jsonb_build_object('devices_with_backlog', count(*) filter (where s.pending_total > 0),
                                          'pending_items', coalesce(sum(s.pending_total), 0),
                                          'oldest_pending_at', min(s.oldest_pending_at),
                                          'battery_restricted', count(*) filter (where s.battery_restricted))
                  from pos.device_sync_status s),
    'incomplete_manifests', (select count(*) from pos.inspections i
                              where i.status in ('submitted', 'verifying') and i.evidence_verified < i.evidence_expected),
    'envelopes_needing_attention', (select count(*) from pos.ingest_envelopes e
                                     where (e.state in ('rejected', 'conflict') and e.resolution is null)
                                        or (e.state in ('received', 'deferred') and e.received_at < now() - interval '1 hour')),
    'pending_approvals', (select count(*) from pos.approvals a
                           where a.decision = 'pending' and a.request_ref is null
                             and not exists (select 1 from pos.approvals d where d.request_ref = a.id)),
    'generated_at', now());
$$;

-- Jobs per agent per scheduled day (B1.7), in the configured local time zone.
create function pos.admin_agent_load(p_from date, p_to date, p_bank_id uuid default null)
returns table (user_id uuid, employee_number text, first_name text, last_name text, day date, jobs integer)
language sql stable set search_path = '' as $$
  with tz as (select coalesce(pos.config_value(array['locale', 'timezone']) #>> '{}', 'Africa/Johannesburg') as name)
  select u.id, u.employee_number, u.first_name, u.last_name, (j.scheduled_start at time zone tz.name)::date, count(*)::integer
    from pos.jobs j
    join pos.pos_users u on u.id = j.assigned_to
    cross join tz
   where j.status in ('assigned', 'accepted', 'in_progress', 'paused', 'returned')
     and j.scheduled_start is not null
     and (j.scheduled_start at time zone tz.name)::date between p_from and p_to
     and (p_bank_id is null or j.bank_id = p_bank_id)
   group by u.id, u.employee_number, u.first_name, u.last_name, (j.scheduled_start at time zone tz.name)::date
   order by 5, 3, 4;
$$;

-- ── First admin (local / fresh environments only) ──────────────────────────────────────────────
-- Refuses as soon as any active admin exists. Called over a direct service connection by
-- apps/fess-pos-admin/scripts/bootstrap-admin.mjs after it creates the Supabase Auth user.
create function pos_rpc.admin_bootstrap(p_employee_number text, p_first_name text, p_last_name text, p_email text, p_auth_uid uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.pos_users;
begin
  perform pg_advisory_xact_lock(hashtext('pos.admin_bootstrap'));
  if exists (select 1 from pos.pos_users u where u.role = 'pos_admin' and u.active) then
    perform pos_rpc.fail('FORBIDDEN', 'an active admin already exists; provision further admins in the admin panel');
  end if;
  perform pos_rpc.set_context(null, 'bootstrap', 'bootstrap:first-admin');
  insert into pos.pos_users (employee_number, first_name, last_name, email, role, permissions, bank_ids, admin_auth_uid)
  values (p_employee_number, p_first_name, p_last_name, lower(p_email), 'pos_admin',
          array['review_inspections', 'approve_definitions', 'schedule_jobs'], null, p_auth_uid)
  returning * into v;
  perform pos_rpc.alert('admin_bootstrapped', 'warning', format('First admin %s %s bootstrapped', p_first_name, p_last_name),
                        'user', v.id, null, '{}'::jsonb, 'admin_bootstrapped:' || v.id::text);
  return to_jsonb(v);
end $$;
