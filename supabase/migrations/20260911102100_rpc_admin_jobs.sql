-- FESS POS — admin write functions, part 2: jobs, appointment scheduling, allocation, review decisions, amendments
-- (docs/06 §1–3, §5; docs/05 §4–5; B1, B6.1–3, B6.8). Expand-only.
--
-- Every job status change goes through pos_rpc.transition_job (actor kinds admin | scheduler | reviewer, checked against
-- pos.job_transitions); timeline via pos_rpc.job_event; notifications per the matrix in docs/06 §5.

-- Admins close terminal jobs after export / acknowledgement (docs/06 §2 "after export/ack or immediately"). The existing
-- rows allow only `system`; these add the same edges for `admin`. Insert-only (the table is append-only).
insert into pos.job_transitions (from_status, to_status, actor, note) values
  ('approved', 'closed', 'admin', 'closed by an admin after export / acknowledgement'),
  ('rejected', 'closed', 'admin', 'closed by an admin after export / acknowledgement'),
  ('unable_to_complete', 'closed', 'admin', 'closed by an admin (a follow-up job may be created with parent_job_id)'),
  ('appointment_not_secured', 'closed', 'admin', 'closed by an admin after export / acknowledgement'),
  ('cancelled', 'closed', 'admin', 'closed by an admin')
on conflict do nothing;

-- ── Read helpers (security invoker: RLS applies to admins reading through PostgREST; the API runs them as service_role) ─
-- Resolved remote config for a bank without writing a snapshot: latest global ⊕ latest bank layer in effect now.
create function pos.config_merged(p_bank_id uuid default null)
returns jsonb language sql stable set search_path = '' as $$
  select pos.jsonb_deep_merge(
           coalesce((select r.values from pos.remote_config_versions r
                      where r.layer = 'global' and r.effective_from <= now() order by r.version desc limit 1), '{}'::jsonb),
           coalesce((select r.values from pos.remote_config_versions r
                      where r.layer = 'bank' and r.subject_id = p_bank_id and p_bank_id is not null and r.effective_from <= now()
                      order by r.version desc limit 1), '{}'::jsonb));
$$;

-- What the job form needs for a bank: the active job_schema (bank family overrides global; activation audience "all"),
-- the location types (keys of geofence.profiles) and the default (geofence.default_profile, else 'standalone').
create function pos.admin_job_form_context(p_bank_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_cfg jsonb := pos.config_merged(p_bank_id);
  v_family pos.definition_families;
  v_version_id uuid;
  v_def jsonb;
  v_types jsonb;
  v_default text;
begin
  select f.* into v_family from pos.definition_families f
   where f.kind = 'job_schema' and (f.bank_id = p_bank_id or f.bank_id is null)
     and pos.resolve_definition_version(f.id, null) is not null
   order by (f.bank_id is null), f.key limit 1;
  if v_family.id is not null then
    v_version_id := pos.resolve_definition_version(v_family.id, null);
    select v.definition into v_def from pos.definition_versions v where v.id = v_version_id;
  end if;
  v_default := coalesce(v_cfg #>> '{geofence,default_profile}', 'standalone');
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_types
    from jsonb_object_keys(case when jsonb_typeof(v_cfg #> '{geofence,profiles}') = 'object' then v_cfg #> '{geofence,profiles}' else '{}'::jsonb end) k;
  if jsonb_array_length(v_types) = 0 then v_types := jsonb_build_array(v_default); end if;
  return jsonb_build_object(
    'job_schema', case when v_version_id is null then null
                       else jsonb_build_object('family_id', v_family.id, 'key', v_family.key, 'version_id', v_version_id, 'definition', v_def) end,
    'location_types', v_types,
    'default_location_type', v_default,
    'profiles', coalesce(v_cfg #> '{geofence,profiles}', '{}'::jsonb));
end $$;

-- Job + its pinned job schema (for attribute validation on update).
create function pos_rpc.admin_job_context(p_actor uuid, p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v pos.jobs;
begin
  select * into v from pos.jobs where id = p_job_id;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'job not found'); end if;
  perform pos_rpc.require_staff(p_actor, null, v.bank_id);
  return jsonb_build_object(
    'job', pos.job_json(v),
    'job_schema', (select jsonb_build_object('version_id', dv.id, 'definition', dv.definition)
                     from pos.definition_versions dv where dv.id = v.job_schema_version_id),
    'form_context', pos.admin_job_form_context(v.bank_id));
end $$;

create function pos_rpc.admin_job_create_context(p_actor uuid, p_bank_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform pos_rpc.admin_require_bank(p_actor, p_bank_id);
  if p_bank_id is null then perform pos_rpc.fail('INVALID_REQUEST', 'bank_id is required'); end if;
  return pos.admin_job_form_context(p_bank_id);
end $$;

-- ── Internal helpers ───────────────────────────────────────────────────────────────────────────
create function pos_rpc.admin_job_lock(p_actor uuid, p_job_id uuid, p_permission text default null)
returns pos.jobs language plpgsql security definer set search_path = '' as $$
declare v pos.jobs;
begin
  select * into v from pos.jobs where id = p_job_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'job not found', jsonb_build_object('job_id', p_job_id)); end if;
  perform pos_rpc.require_staff(p_actor, p_permission, v.bank_id);
  return v;
end $$;

-- Unused inspection tokens (and optionally job-card tokens) for a job are revoked; the next sync reissues what applies.
create function pos_rpc.job_revoke_tokens(p_job_id uuid, p_reason text, p_cards boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update pos.session_tokens set revoked_at = now(), revoke_reason = p_reason
   where job_id = p_job_id and used_at is null and revoked_at is null;
  get diagnostics v_n = row_count;
  if p_cards then
    update pos.agent_card_tokens set revoked_at = now(), revoke_reason = p_reason
     where job_id = p_job_id and revoked_at is null;
  end if;
  return v_n;
end $$;

-- Chargeability (docs/06 §3, D-43): banks.billing_settings {<category>: {codes: {<code>: bool}, default: bool}} overrides
-- the reason code's own `billable` flag.
create function pos.billable_for(p_bank_id uuid, p_category text, p_code text, p_reason_billable boolean)
returns jsonb language sql stable set search_path = '' as $$
  select case
    when jsonb_typeof(b.billing_settings #> array[p_category, 'codes', p_code]) = 'boolean'
      then jsonb_build_object('billable', (b.billing_settings #>> array[p_category, 'codes', p_code])::boolean, 'source', 'bank_code')
    when jsonb_typeof(b.billing_settings #> array[p_category, 'default']) = 'boolean'
      then jsonb_build_object('billable', (b.billing_settings #>> array[p_category, 'default'])::boolean, 'source', 'bank_default')
    else jsonb_build_object('billable', coalesce(p_reason_billable, false), 'source', 'reason_code') end
  from (select 1) one left join pos.banks b on b.id = p_bank_id;
$$;

-- Validated location / core job fields from p_input (shared by create and update).
create function pos_rpc.admin_job_location(p_input jsonb)
returns extensions.geography language plpgsql immutable set search_path = '' as $$
declare
  v_lat double precision;
  v_lng double precision;
begin
  if not (p_input ? 'location') or jsonb_typeof(p_input -> 'location') = 'null' then return null; end if;
  if jsonb_typeof(p_input #> '{location,lat}') <> 'number' or jsonb_typeof(p_input #> '{location,lng}') <> 'number' then
    perform pos_rpc.fail('INVALID_REQUEST', 'location needs numeric lat and lng', jsonb_build_object('path', 'location'));
  end if;
  v_lat := (p_input #>> '{location,lat}')::double precision;
  v_lng := (p_input #>> '{location,lng}')::double precision;
  if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    perform pos_rpc.fail('INVALID_REQUEST', 'location out of range', jsonb_build_object('path', 'location'));
  end if;
  return extensions.st_setsrid(extensions.st_makepoint(v_lng, v_lat), 4326)::extensions.geography;
end $$;

-- Bank-supplied coordinates may be kept in address.bank_coordinates; > 250 m from the pin flags the job (B1.2).
create function pos.job_location_flags(p_flags text[], p_address jsonb, p_location extensions.geography)
returns text[] language plpgsql immutable set search_path = '' as $$
declare
  v_bank extensions.geography;
  v_flags text[] := array(select f from unnest(coalesce(p_flags, '{}')) f where f <> 'location_mismatch');
begin
  if p_location is null or jsonb_typeof(p_address #> '{bank_coordinates,lat}') <> 'number'
     or jsonb_typeof(p_address #> '{bank_coordinates,lng}') <> 'number' then
    return v_flags;
  end if;
  v_bank := extensions.st_setsrid(extensions.st_makepoint((p_address #>> '{bank_coordinates,lng}')::double precision,
                                                          (p_address #>> '{bank_coordinates,lat}')::double precision), 4326)::extensions.geography;
  if extensions.st_distance(v_bank, p_location) > 250 then
    v_flags := v_flags || 'location_mismatch'::text;
  end if;
  return v_flags;
end $$;

create function pos_rpc.admin_job_check_refs(p_bank_id uuid, p_input jsonb, p_form jsonb)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_parent pos.jobs;
begin
  if p_input ? 'address' and jsonb_typeof(p_input -> 'address') <> 'object' then
    perform pos_rpc.fail('INVALID_REQUEST', 'address must be an object', jsonb_build_object('path', 'address'));
  end if;
  if nullif(p_input ->> 'mcc_code', '') is not null
     and not exists (select 1 from pos.mcc_codes m where m.code = p_input ->> 'mcc_code' and m.active) then
    perform pos_rpc.fail('VALIDATION_FAILED', 'unknown or inactive MCC code',
                         jsonb_build_array(jsonb_build_object('path', 'mcc_code', 'message', 'unknown or inactive MCC code')));
  end if;
  if nullif(p_input ->> 'location_type', '') is not null and not ((p_form -> 'location_types') ? (p_input ->> 'location_type')) then
    perform pos_rpc.fail('VALIDATION_FAILED', 'unknown location type',
                         jsonb_build_array(jsonb_build_object('path', 'location_type', 'message',
                                                              'must be one of ' || (p_form ->> 'location_types'))));
  end if;
  if nullif(p_input ->> 'location_source', '') is not null and not (p_input ->> 'location_source' in ('geocoded', 'pinned', 'bank_supplied')) then
    perform pos_rpc.fail('INVALID_REQUEST', 'unknown location source', jsonb_build_object('path', 'location_source'));
  end if;
  if nullif(p_input ->> 'parent_job_id', '') is not null then
    select * into v_parent from pos.jobs where id = (p_input ->> 'parent_job_id')::uuid;
    if not found or v_parent.bank_id <> p_bank_id then
      perform pos_rpc.fail('VALIDATION_FAILED', 'parent job not found in this bank',
                           jsonb_build_array(jsonb_build_object('path', 'parent_job_id', 'message', 'not found in this bank')));
    end if;
  end if;
  if p_input ? 'contact' and jsonb_typeof(p_input -> 'contact') not in ('object', 'null') then
    perform pos_rpc.fail('INVALID_REQUEST', 'contact must be an object', jsonb_build_object('path', 'contact'));
  end if;
  if p_input ? 'attributes' and jsonb_typeof(p_input -> 'attributes') <> 'object' then
    perform pos_rpc.fail('INVALID_REQUEST', 'attributes must be an object', jsonb_build_object('path', 'attributes'));
  end if;
end $$;

-- ── Jobs: create / update (B1.1–2, B1.4, B1.8) ────────────────────────────────────────────────
-- p_input.expected_job_schema_version_id: the version the API validated `attributes` against (race check).
create function pos_rpc.admin_job_create(p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_bank uuid := (p_input ->> 'bank_id')::uuid;
  v_form jsonb;
  v_schema_version uuid;
  v_location extensions.geography;
  v_address jsonb;
  v pos.jobs;
begin
  if v_bank is null then perform pos_rpc.fail('INVALID_REQUEST', 'bank_id is required', jsonb_build_object('path', 'bank_id')); end if;
  perform pos_rpc.admin_require_bank(p_actor, v_bank);
  if not (select b.active from pos.banks b where b.id = v_bank) then
    perform pos_rpc.fail('CONFLICT', 'bank is inactive');
  end if;
  v_form := pos.admin_job_form_context(v_bank);
  v_schema_version := (v_form #>> '{job_schema,version_id}')::uuid;
  if p_input ? 'expected_job_schema_version_id'
     and (p_input ->> 'expected_job_schema_version_id') is distinct from v_schema_version::text then
    perform pos_rpc.fail('CONFLICT', 'the bank''s job schema changed while validating — retry',
                         jsonb_build_object('job_schema_version_id', v_schema_version));
  end if;
  if jsonb_typeof(p_input -> 'address') <> 'object' then
    perform pos_rpc.fail('INVALID_REQUEST', 'address is required', jsonb_build_object('path', 'address'));
  end if;
  perform pos_rpc.admin_job_check_refs(v_bank, p_input, v_form);
  v_location := pos_rpc.admin_job_location(p_input);
  v_address := p_input -> 'address';

  insert into pos.jobs (bank_id, external_ref, merchant_name, trading_name, address, location, location_source, location_type,
                        mcc_code, contact, notes, attributes, job_schema_version_id, geofence_radius_m, gps_accuracy_max_m,
                        parent_job_id, flags, created_by, request_id)
  values (v_bank, pos_rpc.in_text(p_input, 'external_ref', false, 120), pos_rpc.in_text(p_input, 'merchant_name', true, 300),
          pos_rpc.in_text(p_input, 'trading_name', false, 300), v_address, v_location,
          case when v_location is null then null
               else coalesce(nullif(p_input ->> 'location_source', ''), 'pinned')::pos.location_source end,
          coalesce(nullif(p_input ->> 'location_type', ''), v_form ->> 'default_location_type'),
          nullif(p_input ->> 'mcc_code', ''), nullif(p_input -> 'contact', 'null'::jsonb),
          pos_rpc.in_text(p_input, 'notes', false, 5000), pos_rpc.in_object(p_input, 'attributes'), v_schema_version,
          (p_input ->> 'geofence_radius_m')::integer, (p_input ->> 'gps_accuracy_max_m')::integer,
          nullif(p_input ->> 'parent_job_id', '')::uuid, pos.job_location_flags('{}', v_address, v_location), p_actor,
          nullif(current_setting('pos.request_id', true), ''))
  returning * into v;
  perform pos_rpc.job_event(v.id, 'job_created', p_actor, 'admin', null, 'pending', 'applied', null, null,
                            jsonb_build_object('reference', v.reference, 'parent_job_id', v.parent_job_id,
                                               'job_schema_version_id', v_schema_version, 'location_type', v.location_type));
  return pos.job_json(v);
exception when check_violation then
  perform pos_rpc.fail('VALIDATION_FAILED', 'job fields failed validation (radius 25–500 m, accuracy 5–200 m, location type snake_case)',
                       jsonb_build_array(jsonb_build_object('path', 'job', 'message', sqlerrm)));
  return null;
end $$;

-- Core fields change only while PENDING / SCHEDULED; location_type until IN_PROGRESS (logged). Attributes are validated by
-- the API against the job's pinned job_schema version.
create function pos_rpc.admin_job_update(p_actor uuid, p_job_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old pos.jobs;
  v pos.jobs;
  v_form jsonb;
  v_core text[] := array['merchant_name', 'trading_name', 'external_ref', 'address', 'location', 'location_source', 'mcc_code',
                         'contact', 'notes', 'attributes', 'geofence_radius_m', 'gps_accuracy_max_m', 'parent_job_id'];
  v_touching text[];
  v_changed text[];
  v_location extensions.geography;
begin
  v_old := pos_rpc.admin_job_lock(p_actor, p_job_id);
  v_form := pos.admin_job_form_context(v_old.bank_id);
  select coalesce(array_agg(k), '{}') into v_touching from unnest(v_core) k where p_input ? k;
  if cardinality(v_touching) > 0 and v_old.status not in ('pending', 'scheduled') then
    perform pos_rpc.fail('CONFLICT', format('job %s is %s: core fields can only change while pending or scheduled', v_old.reference, v_old.status),
                         jsonb_build_object('fields', to_jsonb(v_touching)));
  end if;
  if nullif(p_input ->> 'parent_job_id', '')::uuid = p_job_id then
    perform pos_rpc.fail('VALIDATION_FAILED', 'a job cannot be its own parent',
                         jsonb_build_array(jsonb_build_object('path', 'parent_job_id', 'message', 'cannot reference itself')));
  end if;
  if p_input ? 'location_type' and v_old.status not in ('pending', 'scheduled', 'assigned', 'accepted') then
    perform pos_rpc.fail('CONFLICT', format('job %s is %s: the location type can only change before the inspection starts', v_old.reference, v_old.status));
  end if;
  perform pos_rpc.admin_job_check_refs(v_old.bank_id, p_input, v_form);
  v_location := case when p_input ? 'location' then pos_rpc.admin_job_location(p_input) else v_old.location end;

  update pos.jobs set
    merchant_name = case when p_input ? 'merchant_name' then pos_rpc.in_text(p_input, 'merchant_name', true, 300) else merchant_name end,
    trading_name = case when p_input ? 'trading_name' then pos_rpc.in_text(p_input, 'trading_name', false, 300) else trading_name end,
    external_ref = case when p_input ? 'external_ref' then pos_rpc.in_text(p_input, 'external_ref', false, 120) else external_ref end,
    address = case when p_input ? 'address' then p_input -> 'address' else address end,
    location = v_location,
    location_source = case when v_location is null then null
                           when p_input ? 'location_source' or p_input ? 'location'
                             then coalesce(nullif(p_input ->> 'location_source', ''), 'pinned')::pos.location_source
                           else location_source end,
    location_type = coalesce(nullif(p_input ->> 'location_type', ''), location_type),
    mcc_code = case when p_input ? 'mcc_code' then nullif(p_input ->> 'mcc_code', '') else mcc_code end,
    contact = case when p_input ? 'contact' then nullif(p_input -> 'contact', 'null'::jsonb) else contact end,
    notes = case when p_input ? 'notes' then pos_rpc.in_text(p_input, 'notes', false, 5000) else notes end,
    attributes = case when p_input ? 'attributes' then pos_rpc.in_object(p_input, 'attributes') else attributes end,
    geofence_radius_m = case when p_input ? 'geofence_radius_m' then (p_input ->> 'geofence_radius_m')::integer else geofence_radius_m end,
    gps_accuracy_max_m = case when p_input ? 'gps_accuracy_max_m' then (p_input ->> 'gps_accuracy_max_m')::integer else gps_accuracy_max_m end,
    parent_job_id = case when p_input ? 'parent_job_id' then nullif(p_input ->> 'parent_job_id', '')::uuid else parent_job_id end,
    request_id = nullif(current_setting('pos.request_id', true), '')
  where id = p_job_id
  returning * into v;
  update pos.jobs set flags = pos.job_location_flags(v.flags, v.address, v.location)
   where id = p_job_id and flags is distinct from pos.job_location_flags(v.flags, v.address, v.location);
  select * into v from pos.jobs where id = p_job_id;   -- re-read (the flag update may have matched no row)

  select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
    from jsonb_each(to_jsonb(v)) n
   where n.key not in ('updated_at', 'request_id', 'flags', 'location_type') and n.value is distinct from (to_jsonb(v_old) -> n.key);
  if cardinality(v_changed) > 0 then
    perform pos_rpc.job_event(v.id, 'job_updated', p_actor, 'admin', v.status, v.status, 'recorded', null, null,
                              jsonb_build_object('changed', to_jsonb(v_changed)));
  end if;
  if v.location_type is distinct from v_old.location_type then
    perform pos_rpc.job_event(v.id, 'location_type_changed', p_actor, 'admin', v.status, v.status, 'recorded', null, null,
                              jsonb_build_object('from', v_old.location_type, 'to', v.location_type));
    if v.assigned_to is not null then
      perform pos_rpc.notify_agent(v.assigned_to, 'job_updated', v.id, true, false);
    end if;
  end if;
  return pos.job_json(v);
exception when check_violation then
  perform pos_rpc.fail('VALIDATION_FAILED', 'job fields failed validation (radius 25–500 m, accuracy 5–200 m, location type snake_case)',
                       jsonb_build_array(jsonb_build_object('path', 'job', 'message', sqlerrm)));
  return null;
end $$;

-- ── Appointment scheduling (docs/06 §1a, B1.9–10) — scheduler = admin with schedule_jobs ───────
create function pos_rpc.admin_job_contact_attempt(p_actor uuid, p_job_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job pos.jobs;
  v pos.appointment_attempts;
begin
  v_job := pos_rpc.admin_job_lock(p_actor, p_job_id, 'schedule_jobs');
  if v_job.status not in ('pending', 'scheduled', 'assigned', 'accepted') then
    perform pos_rpc.fail('CONFLICT', format('job %s is %s: contact attempts are logged before the visit', v_job.reference, v_job.status));
  end if;
  if (p_input ->> 'attempted_at')::timestamptz > now() + interval '5 minutes' then
    perform pos_rpc.fail('VALIDATION_FAILED', 'attempted_at cannot be in the future',
                         jsonb_build_array(jsonb_build_object('path', 'attempted_at', 'message', 'in the future')));
  end if;
  insert into pos.appointment_attempts (job_id, attempted_by, attempted_at, channel, outcome, proposed_start, proposed_end,
                                        contact_name, note, request_id)
  values (p_job_id, p_actor, coalesce((p_input ->> 'attempted_at')::timestamptz, now()),
          pos_rpc.in_text(p_input, 'channel', true)::pos.contact_channel, pos_rpc.in_text(p_input, 'outcome', true)::pos.contact_outcome,
          (p_input ->> 'proposed_start')::timestamptz, (p_input ->> 'proposed_end')::timestamptz,
          pos_rpc.in_text(p_input, 'contact_name', false, 200), pos_rpc.in_text(p_input, 'note', false, 2000),
          nullif(current_setting('pos.request_id', true), ''))
  returning * into v;
  perform pos_rpc.job_event(p_job_id, 'contact_attempt', p_actor, 'scheduler', v_job.status, v_job.status, 'recorded', null, v.note,
                            jsonb_build_object('attempt_id', v.id, 'channel', v.channel, 'outcome', v.outcome));
  return to_jsonb(v);
exception when invalid_text_representation then
  perform pos_rpc.fail('INVALID_REQUEST', 'unknown channel or outcome'); return null;
end $$;

-- Confirm (PENDING → SCHEDULED) or reschedule (SCHEDULED / ASSIGNED / ACCEPTED: logged, agent notified, unused session
-- tokens revoked so the next pull reissues them for the new window).
create function pos_rpc.admin_job_schedule(p_actor uuid, p_job_id uuid, p_start timestamptz, p_end timestamptz,
                                           p_onsite_contact jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job pos.jobs;
  v_old pos.jobs;
begin
  v_job := pos_rpc.admin_job_lock(p_actor, p_job_id, 'schedule_jobs');
  v_old := v_job;
  if p_start is null or p_end is null or p_end <= p_start then
    perform pos_rpc.fail('VALIDATION_FAILED', 'the visit window needs a start before its end',
                         jsonb_build_array(jsonb_build_object('path', 'scheduled_end', 'message', 'must be after the start')));
  end if;
  if p_end <= now() then
    perform pos_rpc.fail('VALIDATION_FAILED', 'the visit window has already ended',
                         jsonb_build_array(jsonb_build_object('path', 'scheduled_end', 'message', 'in the past')));
  end if;
  if p_onsite_contact is null or jsonb_typeof(p_onsite_contact) <> 'object' or coalesce(btrim(p_onsite_contact ->> 'name'), '') = '' then
    perform pos_rpc.fail('VALIDATION_FAILED', 'the on-site contact needs a name',
                         jsonb_build_array(jsonb_build_object('path', 'onsite_contact.name', 'message', 'required')));
  end if;

  if v_job.status = 'pending' then
    if not exists (select 1 from pos.appointment_attempts a where a.job_id = p_job_id) then
      perform pos_rpc.fail('CONFLICT', 'log at least one contact attempt before confirming the appointment');
    end if;
    update pos.jobs set scheduled_start = p_start, scheduled_end = p_end, onsite_contact = p_onsite_contact,
                        appointment_confirmed_by = p_actor, appointment_confirmed_at = now(),
                        request_id = nullif(current_setting('pos.request_id', true), '')
     where id = p_job_id;
    v_job := pos_rpc.transition_job(p_job_id, 'scheduled', 'scheduler', p_actor, 'appointment_confirmed', null, p_note,
                                    jsonb_build_object('scheduled_start', p_start, 'scheduled_end', p_end, 'onsite_contact', p_onsite_contact));
  elsif v_job.status in ('scheduled', 'assigned', 'accepted') then
    update pos.jobs set scheduled_start = p_start, scheduled_end = p_end, onsite_contact = p_onsite_contact,
                        appointment_confirmed_by = p_actor, appointment_confirmed_at = now(),
                        request_id = nullif(current_setting('pos.request_id', true), '')
     where id = p_job_id returning * into v_job;
    perform pos_rpc.job_event(p_job_id, 'appointment_rescheduled', p_actor, 'scheduler', v_job.status, v_job.status, 'recorded', null, p_note,
                              jsonb_build_object('from', jsonb_build_object('start', v_old.scheduled_start, 'end', v_old.scheduled_end),
                                                 'to', jsonb_build_object('start', p_start, 'end', p_end),
                                                 'onsite_contact', p_onsite_contact));
    if v_job.assigned_to is not null then
      perform pos_rpc.job_revoke_tokens(p_job_id, 'rescheduled', false);
      perform pos_rpc.notify_agent(v_job.assigned_to, 'job_rescheduled', p_job_id, true, true,
                                   jsonb_build_object('job_reference', v_job.reference));
    end if;
  else
    perform pos_rpc.fail('INVALID_TRANSITION', format('job %s is %s: it can no longer be scheduled', v_job.reference, v_job.status),
                         jsonb_build_object('from', v_job.status));
  end if;
  return pos.job_json(v_job);
end $$;

-- SCHEDULED → PENDING: the appointment fell through (reason category `unschedule`).
create function pos_rpc.admin_job_unschedule(p_actor uuid, p_job_id uuid, p_reason_code text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job pos.jobs;
begin
  v_job := pos_rpc.admin_job_lock(p_actor, p_job_id, 'schedule_jobs');
  perform pos_rpc.require_reason('unschedule', p_reason_code, v_job.bank_id, p_note);
  v_job := pos_rpc.transition_job(p_job_id, 'pending', 'scheduler', p_actor, 'appointment_unscheduled', p_reason_code, p_note,
                                  jsonb_build_object('previous_window', jsonb_build_object('start', v_job.scheduled_start, 'end', v_job.scheduled_end),
                                                     'previous_onsite_contact', v_job.onsite_contact));
  update pos.jobs set scheduled_start = null, scheduled_end = null, appointment_confirmed_by = null, appointment_confirmed_at = null
   where id = p_job_id returning * into v_job;
  return pos.job_json(v_job);
end $$;

-- PENDING → APPOINTMENT_NOT_SECURED (never dispatches anyone; chargeable per reason code + bank contract).
create function pos_rpc.admin_job_not_secured(p_actor uuid, p_job_id uuid, p_reason_code text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job pos.jobs;
  v_rc pos.reason_codes;
  v_billable jsonb;
  v_attempts integer;
begin
  v_job := pos_rpc.admin_job_lock(p_actor, p_job_id, 'schedule_jobs');
  v_rc := pos_rpc.require_reason('appointment_not_secured', p_reason_code, v_job.bank_id, p_note);
  select count(*) into v_attempts from pos.appointment_attempts a where a.job_id = p_job_id;
  if v_attempts = 0 then
    perform pos_rpc.fail('CONFLICT', 'log the contact attempts before closing the job as not secured');
  end if;
  v_billable := pos.billable_for(v_job.bank_id, 'appointment_not_secured', p_reason_code, v_rc.billable);
  v_job := pos_rpc.transition_job(p_job_id, 'appointment_not_secured', 'scheduler', p_actor, 'appointment_not_secured', p_reason_code,
                                  p_note, v_billable || jsonb_build_object('contact_attempts', v_attempts));
  return jsonb_build_object('job', pos.job_json(v_job), 'billable', v_billable -> 'billable', 'billable_source', v_billable -> 'source');
end $$;

-- ── Allocation (docs/06 §2: only SCHEDULED; agent active, role agent, bank allowed; B1.3, B1.7) ──
create function pos_rpc.admin_job_allocate(p_actor uuid, p_job_id uuid, p_agent_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job pos.jobs;
  v_agent pos.pos_users;
  v_asg pos.job_assignments;
  v_conflicts jsonb;
begin
  v_job := pos_rpc.admin_job_lock(p_actor, p_job_id);
  if v_job.status <> 'scheduled' then
    perform pos_rpc.fail('INVALID_TRANSITION', format('job %s is %s: only scheduled jobs (appointment confirmed) can be allocated',
                                                      v_job.reference, v_job.status), jsonb_build_object('from', v_job.status));
  end if;
  select * into v_agent from pos.pos_users where id = p_agent_id;
  if not found or v_agent.role <> 'pos_agent' then perform pos_rpc.fail('VALIDATION_FAILED', 'not a POS agent',
                                                                         jsonb_build_array(jsonb_build_object('path', 'agent_id', 'message', 'not a POS agent'))); end if;
  if not v_agent.active then perform pos_rpc.fail('VALIDATION_FAILED', 'agent is inactive',
                                                  jsonb_build_array(jsonb_build_object('path', 'agent_id', 'message', 'inactive'))); end if;
  if v_agent.bank_ids is not null and not (v_job.bank_id = any (v_agent.bank_ids)) then
    perform pos_rpc.fail('VALIDATION_FAILED', 'agent is not allowed to work for this bank',
                         jsonb_build_array(jsonb_build_object('path', 'agent_id', 'message', 'bank not allowed for this agent')));
  end if;
  insert into pos.job_assignments (job_id, user_id, assigned_by, note)
  values (p_job_id, p_agent_id, p_actor, p_note) returning * into v_asg;
  v_job := pos_rpc.transition_job(p_job_id, 'assigned', 'admin', p_actor, 'job_allocated', null, p_note,
                                  jsonb_build_object('assignment_id', v_asg.id, 'agent_id', p_agent_id));
  update pos.jobs set assigned_to = p_agent_id, assigned_at = v_asg.assigned_at where id = p_job_id returning * into v_job;
  perform pos_rpc.notify_agent(p_agent_id, 'job_assigned', p_job_id, true, true, jsonb_build_object('job_reference', v_job.reference));

  -- B1.7: overlapping windows already on this agent (shown, not blocking)
  select coalesce(jsonb_agg(jsonb_build_object('job_id', j.id, 'reference', j.reference, 'scheduled_start', j.scheduled_start,
                                               'scheduled_end', j.scheduled_end)), '[]'::jsonb)
    into v_conflicts
    from pos.jobs j
   where j.assigned_to = p_agent_id and j.id <> p_job_id and j.status in ('assigned', 'accepted', 'in_progress', 'paused', 'returned')
     and j.scheduled_start < v_job.scheduled_end and j.scheduled_end > v_job.scheduled_start;
  return pos.job_json(v_job) || jsonb_build_object('assignment_id', v_asg.id, 'agent_conflicts', v_conflicts);
exception when unique_violation then
  perform pos_rpc.fail('CONFLICT', 'this job already has a live assignment'); return null;
end $$;

-- ASSIGNED / ACCEPTED → SCHEDULED by an admin (reason category `reassign`).
create function pos_rpc.admin_job_revoke(p_actor uuid, p_job_id uuid, p_reason_code text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job pos.jobs;
  v_asg pos.job_assignments;
  v_agent uuid;
begin
  v_job := pos_rpc.admin_job_lock(p_actor, p_job_id);
  if v_job.status not in ('assigned', 'accepted') then
    perform pos_rpc.fail('INVALID_TRANSITION', format('job %s is %s: only assigned or accepted jobs can be revoked', v_job.reference, v_job.status),
                         jsonb_build_object('from', v_job.status));
  end if;
  perform pos_rpc.require_reason('reassign', p_reason_code, v_job.bank_id, p_note);
  v_agent := v_job.assigned_to;
  update pos.job_assignments set response = 'revoked', responded_at = now(), reason_code = p_reason_code, note = p_note
   where job_id = p_job_id and response in ('pending', 'accepted')
  returning * into v_asg;
  v_job := pos_rpc.transition_job(p_job_id, 'scheduled', 'admin', p_actor, 'assignment_revoked', p_reason_code, p_note,
                                  jsonb_build_object('assignment_id', v_asg.id, 'agent_id', v_agent));
  update pos.jobs set assigned_to = null, assigned_at = null where id = p_job_id returning * into v_job;
  perform pos_rpc.job_revoke_tokens(p_job_id, 'assignment_revoked', true);
  if v_agent is not null then
    perform pos_rpc.notify_agent(v_agent, 'job_revoked', p_job_id, true, false);   -- content-free sync hint
  end if;
  return pos.job_json(v_job);
end $$;

-- Revoke + allocate in one transaction.
create function pos_rpc.admin_job_reassign(p_actor uuid, p_job_id uuid, p_agent_id uuid, p_reason_code text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job pos.jobs;
begin
  v_job := pos_rpc.admin_job_lock(p_actor, p_job_id);
  if v_job.assigned_to = p_agent_id then
    perform pos_rpc.fail('CONFLICT', 'the job is already assigned to this agent');
  end if;
  perform pos_rpc.admin_job_revoke(p_actor, p_job_id, p_reason_code, p_note);
  return pos_rpc.admin_job_allocate(p_actor, p_job_id, p_agent_id, p_note);
end $$;

-- Any pre-close state → CANCELLED (reason category `cancel`); live assignment revoked, open tokens revoked, agent notified.
create function pos_rpc.admin_job_cancel(p_actor uuid, p_job_id uuid, p_reason_code text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job pos.jobs;
  v_from pos.job_status;
begin
  v_job := pos_rpc.admin_job_lock(p_actor, p_job_id);
  v_from := v_job.status;
  perform pos_rpc.require_reason('cancel', p_reason_code, v_job.bank_id, p_note);
  update pos.job_assignments set response = 'revoked', responded_at = now(), reason_code = p_reason_code, note = p_note
   where job_id = p_job_id and response in ('pending', 'accepted');
  v_job := pos_rpc.transition_job(p_job_id, 'cancelled', 'admin', p_actor, 'job_cancelled', p_reason_code, p_note,
                                  jsonb_build_object('agent_id', v_job.assigned_to));
  perform pos_rpc.job_revoke_tokens(p_job_id, 'job_cancelled', true);
  if v_job.assigned_to is not null then
    perform pos_rpc.notify_agent(v_job.assigned_to, 'job_cancelled', p_job_id, true, true, jsonb_build_object('job_reference', v_job.reference));
  end if;
  if v_from in ('in_progress', 'paused') then
    perform pos_rpc.alert('cancelled_in_progress', 'warning',
                          format('%s cancelled while the inspection was in progress — a later submission is kept and flagged', v_job.reference),
                          'job', p_job_id, v_job.bank_id, jsonb_build_object('reason_code', p_reason_code), 'cancelled_in_progress:' || p_job_id::text);
  end if;
  return pos.job_json(v_job);
end $$;

create function pos_rpc.admin_job_close(p_actor uuid, p_job_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job pos.jobs;
begin
  v_job := pos_rpc.admin_job_lock(p_actor, p_job_id);
  v_job := pos_rpc.transition_job(p_job_id, 'closed', 'admin', p_actor, 'job_closed', null, p_note, '{}'::jsonb);
  return pos.job_json(v_job);
end $$;

-- ── Review (docs/06 §2, B6.2–3, docs/07 §7 point 6) ──────────────────────────────────────────
create function pos_rpc.admin_review_decide(p_actor uuid, p_inspection_id uuid, p_decision text, p_reason_code text, p_note text,
                                            p_override_acknowledged boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_insp pos.inspections;
  v_job pos.jobs;
  v_decision pos.review_decision;
  v_review pos.reviews;
  v_latest integer;
  v_target pos.job_status;
begin
  select * into v_insp from pos.inspections where id = p_inspection_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'inspection not found'); end if;
  select * into v_job from pos.jobs where id = v_insp.job_id for update;
  perform pos_rpc.require_staff(p_actor, 'review_inspections', v_job.bank_id);
  begin
    v_decision := p_decision::pos.review_decision;
  exception when invalid_text_representation then
    perform pos_rpc.fail('INVALID_REQUEST', 'decision must be approved, returned or rejected');
  end;
  if v_insp.status not in ('submitted', 'verifying', 'under_review', 'integrity_failed') then
    perform pos_rpc.fail('CONFLICT', format('inspection is %s: nothing to review', v_insp.status));
  end if;
  if exists (select 1 from pos.reviews r where r.inspection_id = p_inspection_id) then
    perform pos_rpc.fail('ALREADY_EXISTS', 'this inspection has already been reviewed');
  end if;

  if v_decision = 'approved' then
    if v_insp.status <> 'integrity_failed' and v_insp.evidence_verified < v_insp.evidence_expected then
      perform pos_rpc.fail('CONFLICT', format('evidence outstanding: %s of %s manifest items verified', v_insp.evidence_verified, v_insp.evidence_expected),
                           jsonb_build_object('evidence_expected', v_insp.evidence_expected, 'evidence_verified', v_insp.evidence_verified));
    end if;
    if 'geofence_override' = any (v_insp.flags) and not coalesce(p_override_acknowledged, false) then
      perform pos_rpc.fail('VALIDATION_FAILED', 'acknowledge the geofence override before approving',
                           jsonb_build_array(jsonb_build_object('path', 'override_acknowledged', 'message', 'required: the inspection used a geofence override')));
    end if;
  elsif v_decision = 'returned' then
    perform pos_rpc.require_reason('review_return', p_reason_code, v_job.bank_id, p_note);
    if coalesce(btrim(p_note), '') = '' then
      perform pos_rpc.fail('NOTE_REQUIRED', 'returning an inspection needs a note for the agent');
    end if;
  else
    perform pos_rpc.require_reason('review_reject', p_reason_code, v_job.bank_id, p_note);
  end if;

  insert into pos.reviews (inspection_id, reviewer_id, decision, reason_code, note, override_acknowledged, request_id)
  values (p_inspection_id, p_actor, v_decision, case when v_decision = 'approved' then null else p_reason_code end, p_note,
          coalesce(p_override_acknowledged, false), nullif(current_setting('pos.request_id', true), ''))
  returning * into v_review;
  update pos.inspections set status = v_decision::text::pos.inspection_status where id = p_inspection_id returning * into v_insp;
  perform pos_rpc.custody('inspection', p_inspection_id, 'reviewed', 'server', null, null,
                          jsonb_build_object('decision', v_decision, 'review_id', v_review.id, 'reviewer_id', p_actor));

  v_target := v_decision::text::pos.job_status;
  select max(i.attempt) into v_latest from pos.inspections i where i.job_id = v_job.id;
  if v_insp.attempt = v_latest and pos_rpc.can_transition(v_job.status, v_target, 'reviewer') then
    v_job := pos_rpc.transition_job(v_job.id, v_target, 'reviewer', p_actor, 'review_' || v_decision::text, p_reason_code, p_note,
                                    jsonb_build_object('inspection_id', p_inspection_id, 'attempt', v_insp.attempt, 'review_id', v_review.id,
                                                       'override_acknowledged', v_review.override_acknowledged));
    if v_decision = 'returned' then
      perform pos_rpc.notify_agent(v_insp.user_id, 'job_returned', v_job.id, true, true,
                                   jsonb_build_object('job_reference', v_job.reference, 'note', p_note, 'reason_code', p_reason_code));
    else
      perform pos_rpc.notify_agent(v_insp.user_id, 'job_' || v_decision::text, v_job.id, true, false);
    end if;
  else
    perform pos_rpc.job_event(v_job.id, 'review_' || v_decision::text, p_actor, 'reviewer', v_job.status, v_job.status, 'recorded',
                              p_reason_code, p_note, jsonb_build_object('inspection_id', p_inspection_id, 'attempt', v_insp.attempt,
                                                                        'review_id', v_review.id, 'job_status_unchanged', true));
  end if;
  return jsonb_build_object('review', to_jsonb(v_review), 'inspection_status', v_insp.status, 'job_status', v_job.status);
end $$;

-- Amendments (B6.1; D-24 provisional): a new immutable row; the original answers are never touched. old_value is the
-- value in force before this amendment (latest amendment of that field, else the submitted answer entry).
create function pos_rpc.admin_amendment_create(p_actor uuid, p_inspection_id uuid, p_field_key text, p_new_value jsonb, p_justification text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_insp pos.inspections;
  v_bank uuid;
  v_old jsonb;
  v pos.amendments;
begin
  select * into v_insp from pos.inspections where id = p_inspection_id;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'inspection not found'); end if;
  select bank_id into v_bank from pos.jobs where id = v_insp.job_id;
  perform pos_rpc.require_staff(p_actor, 'review_inspections', v_bank);
  if v_insp.status in ('in_progress', 'paused') then
    perform pos_rpc.fail('CONFLICT', 'only submitted inspections can be amended');
  end if;
  if p_field_key is null or p_field_key !~ '^[a-z][a-z0-9_]*(\[[0-9]+\]\.[a-z][a-z0-9_]*)?$' then
    perform pos_rpc.fail('INVALID_REQUEST', 'field_key must be a field key', jsonb_build_object('path', 'field_key'));
  end if;
  if coalesce(btrim(p_justification), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a justification is required'); end if;
  select a.new_value into v_old from pos.amendments a
   where a.inspection_id = p_inspection_id and a.field_key = p_field_key order by a.created_at desc limit 1;
  if not found then v_old := coalesce(v_insp.answers, '{}'::jsonb) -> p_field_key; end if;
  if v_old is not distinct from p_new_value then perform pos_rpc.fail('CONFLICT', 'the new value equals the current value'); end if;
  insert into pos.amendments (inspection_id, author_id, field_key, old_value, new_value, justification)
  values (p_inspection_id, p_actor, p_field_key, v_old, p_new_value, p_justification) returning * into v;
  perform pos_rpc.custody('inspection', p_inspection_id, 'amended', 'server', null, null,
                          jsonb_build_object('amendment_id', v.id, 'field_key', p_field_key, 'author_id', p_actor));
  perform pos_rpc.job_event(v_insp.job_id, 'inspection_amended', p_actor, 'reviewer', null, null, 'recorded', null, p_justification,
                            jsonb_build_object('inspection_id', p_inspection_id, 'amendment_id', v.id, 'field_key', p_field_key));
  return to_jsonb(v);
end $$;
