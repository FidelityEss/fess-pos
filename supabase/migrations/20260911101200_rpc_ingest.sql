-- FESS POS — ingest: land raw, then process (docs/12 §4–7, §15; docs/08 §6).
--   1. pos_rpc.ingest_land   — its own transaction: INSERT … ON CONFLICT (id) DO NOTHING. Durable before anything else.
--   2. the API validates the payload (TS engine, pinned definitions) — never refuses landing
--   3. pos_rpc.ingest_apply  — ONE transaction per envelope: advisory lock → re-check state → typed handler
--                              (domain writes + custody + queue messages) → receipt.
-- Handlers return {status: committed|deferred|duplicate|conflict, result, waiting_on, duplicate_of, error}.
-- A POS-coded failure inside a handler rejects the envelope (data kept); an unexpected error leaves it
-- `received` for the reprocessor and answers `deferred` — agent data is never dropped.

create function pos.array_union(p_a text[], p_b text[]) returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array(select distinct x from unnest(coalesce(p_a, '{}') || coalesce(p_b, '{}')) x where x is not null order by 1), '{}');
$$;

create function pos.ext_for_mime(p_mime text) returns text language sql immutable set search_path = '' as $$
  select case lower(coalesce(p_mime, ''))
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'application/json' then 'json' else 'bin' end;
$$;

-- ── Land ───────────────────────────────────────────────────────────────────────────────────────
create function pos_rpc.ingest_land(p_env jsonb, p_stored_hash text, p_user_id uuid, p_session_id uuid, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := (p_env ->> 'id')::uuid;
  v_row pos.ingest_envelopes;
begin
  insert into pos.ingest_envelopes (id, type, type_version, api_version, payload, payload_hash, stored_hash, wrapper,
                                    device_id, user_id, session_id, module_version, client_type, device_seq,
                                    created_at_device, monotonic_ms, first_request_id, last_request_id)
  values (v_id, p_env ->> 'type', (p_env ->> 'type_version')::integer, coalesce(p_env ->> 'api_version', '1'),
          p_env -> 'payload', p_env ->> 'payload_hash', p_stored_hash, p_env - 'payload',
          (p_env ->> 'device_id')::uuid, p_user_id, p_session_id, p_env ->> 'module_version',
          coalesce((p_env ->> 'client_type')::pos.client_type, 'native'), (p_env ->> 'device_seq')::bigint,
          (p_env ->> 'created_at_device')::timestamptz, (p_env ->> 'monotonic_ms')::bigint, p_request_id, p_request_id)
  on conflict (id) do nothing
  returning * into v_row;

  if found then
    perform pos_rpc.custody('envelope', v_id, 'landed', 'server', v_row.device_id, v_id, jsonb_build_object('type', v_row.type));
    if v_row.payload_hash is distinct from p_stored_hash then
      perform pos_rpc.alert('payload_hash_mismatch', 'warning', 'Device payload_hash differs from the server hash of the landed payload',
                            'envelope', v_id, null, jsonb_build_object('claimed', v_row.payload_hash, 'stored', p_stored_hash),
                            'payload_hash_mismatch:' || v_id::text);
    end if;
    return jsonb_build_object('outcome', 'new', 'state', v_row.state);
  end if;

  select * into v_row from pos.ingest_envelopes where id = v_id for update;
  if v_row.stored_hash = p_stored_hash then
    update pos.ingest_envelopes set attempts = attempts + 1, last_seen_at = now(), last_request_id = p_request_id where id = v_id;
    if v_row.state = 'received' then
      return jsonb_build_object('outcome', 'retry', 'state', v_row.state);
    elsif v_row.state in ('committed', 'duplicate') then
      return jsonb_build_object('outcome', 'duplicate', 'receipt', v_row.result || jsonb_build_object('state', 'duplicate'));
    end if;
    return jsonb_build_object('outcome', 'shortcut', 'receipt', v_row.result);
  end if;

  -- Same id, different payload: keep both, flag, never overwrite (12 §15 layer 2).
  insert into pos.ingest_conflicts (envelope_id, payload, payload_hash, stored_hash, wrapper, device_id, request_id)
  values (v_id, p_env -> 'payload', p_env ->> 'payload_hash', p_stored_hash, p_env - 'payload', (p_env ->> 'device_id')::uuid, p_request_id);
  perform pos_rpc.custody('envelope', v_id, 'conflict', 'server', (p_env ->> 'device_id')::uuid, v_id,
                          jsonb_build_object('stored_hash', p_stored_hash));
  perform pos_rpc.alert('envelope_conflict', 'critical', 'Envelope id re-used with a different payload — both kept',
                        'envelope', v_id, null, jsonb_build_object('device_id', p_env ->> 'device_id'),
                        'envelope_conflict:' || v_id::text);
  return jsonb_build_object('outcome', 'conflict', 'receipt', jsonb_build_object(
    'id', v_id, 'state', 'conflict', 'durable', true, 'stored_hash', p_stored_hash,
    'server_received_at', now(), 'committed_at', null, 'result', null,
    'error', jsonb_build_object('code', 'ENVELOPE_ID_CONFLICT', 'retryable', false,
                                'message', 'This id was already used for a different payload; both are kept for review')));
end $$;

-- ── Receipt bookkeeping ────────────────────────────────────────────────────────────────────────
create function pos_rpc.ingest_finish(p_env pos.ingest_envelopes, p_state pos.envelope_state, p_result jsonb,
                                      p_waiting_on jsonb, p_duplicate_of uuid, p_error jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_receipt jsonb;
begin
  v_receipt := jsonb_build_object(
    'id', p_env.id, 'state', p_state, 'durable', true, 'stored_hash', p_env.stored_hash,
    'server_received_at', p_env.received_at,
    'committed_at', case when p_state in ('committed', 'duplicate') then now() end,
    'result', p_result, 'waiting_on', p_waiting_on, 'error', p_error);
  update pos.ingest_envelopes
     set state = p_state, result = v_receipt, waiting_on = p_waiting_on,
         duplicate_of = coalesce(p_duplicate_of, duplicate_of), error = p_error, processed_at = now()
   where id = p_env.id;
  perform pos_rpc.custody('envelope', p_env.id, p_state::text, 'server', p_env.device_id, p_env.id,
                          coalesce(p_error, '{}'::jsonb) || coalesce(jsonb_build_object('waiting_on', p_waiting_on), '{}'::jsonb));
  if p_state in ('rejected', 'conflict') then
    perform pos_rpc.alert('envelope_' || p_state::text, 'warning',
                          format('%s envelope %s — kept server-side for the envelope inbox', p_env.type, p_state),
                          'envelope', p_env.id, null, jsonb_build_object('type', p_env.type, 'error', p_error),
                          'envelope_' || p_state::text || ':' || p_env.id::text);
  end if;
  return v_receipt;
end $$;

-- Unexpected failure or no handler: the envelope stays `received` (reprocessor retries) and the device is told
-- `deferred` so it stops resending (12 §4).
create function pos_rpc.ingest_hold(p_env pos.ingest_envelopes, p_reason jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update pos.ingest_envelopes set error = p_reason, waiting_on = jsonb_build_object('reprocess', true), processed_at = now()
   where id = p_env.id;
  perform pos_rpc.alert('ingest_hold', 'critical', format('%s envelope held for reprocessing', p_env.type),
                        'envelope', p_env.id, null, p_reason, 'ingest_hold:' || p_env.id::text);
  return jsonb_build_object(
    'id', p_env.id, 'state', 'deferred', 'durable', true, 'stored_hash', p_env.stored_hash,
    'server_received_at', p_env.received_at, 'committed_at', null, 'result', null,
    'waiting_on', jsonb_build_object('reprocess', true), 'error', null);
end $$;

-- ── Shared inspection helpers ──────────────────────────────────────────────────────────────────
create function pos_rpc.check_session_token(p_job_id uuid, p_user_id uuid, p_device_id uuid, p_token text,
                                            p_token_id uuid, p_used_at_device timestamptz, p_inspection_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t pos.session_tokens;
  v_flags text[] := '{}';
begin
  if p_token is null and p_token_id is null then
    return jsonb_build_object('token_id', null, 'flags', array['token_missing']);
  end if;
  if p_token is not null then
    select * into v_t from pos.session_tokens where token_hash = pos.sha256_hex(p_token);
  else
    select * into v_t from pos.session_tokens where id = p_token_id;
    v_flags := v_flags || 'token_unproven'::text;
  end if;
  if v_t.id is null then
    return jsonb_build_object('token_id', null, 'flags', array['token_unknown']);
  end if;
  if v_t.job_id <> p_job_id then v_flags := v_flags || 'token_other_job'::text; end if;
  if v_t.user_id <> p_user_id then v_flags := v_flags || 'token_other_user'::text; end if;
  if v_t.device_id <> p_device_id then v_flags := v_flags || 'token_foreign_device'::text; end if;
  if v_t.revoked_at is not null then v_flags := v_flags || 'token_revoked'::text; end if;
  if v_t.used_at is not null and v_t.used_by_inspection_id is distinct from p_inspection_id then
    v_flags := v_flags || 'token_reused'::text;
  end if;
  if p_used_at_device is not null and not (p_used_at_device between v_t.valid_from and v_t.valid_to) then
    v_flags := v_flags || 'token_expired'::text;
  end if;
  update pos.session_tokens set used_at = now(), used_by_inspection_id = p_inspection_id
   where id = v_t.id and used_at is null;
  return jsonb_build_object('token_id', v_t.id, 'flags', v_flags);
end $$;

-- Flags common to inspection_started and submission (08 §6 conflict rules, 07 §5).
create function pos_rpc.inspection_context_flags(p_job pos.jobs, p_user_id uuid, p_form_version_id uuid, p_client_type text)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_flags text[] := '{}';
  v_family uuid;
  v_active boolean;
begin
  if p_job.status in ('cancelled', 'closed') then v_flags := v_flags || 'submitted_after_cancel'::text; end if;
  if p_job.assigned_to is distinct from p_user_id then v_flags := v_flags || 'submitted_by_unassigned'::text; end if;
  if p_client_type = 'web' then v_flags := v_flags || 'web_client'::text; end if;
  select active into v_active from pos.pos_users where id = p_user_id;
  if not coalesce(v_active, false) then v_flags := v_flags || 'after_deactivation'::text; end if;
  if p_form_version_id is not null then
    select family_id into v_family from pos.definition_versions where id = p_form_version_id;
    if v_family is not null and pos.resolve_definition_version(v_family, p_user_id) is distinct from p_form_version_id then
      v_flags := v_flags || 'non_current_version'::text;
    end if;
  end if;
  return v_flags;
end $$;

create function pos_rpc.recount_evidence(p_inspection_id uuid)
returns pos.inspections language plpgsql security definer set search_path = '' as $$
declare v pos.inspections;
begin
  update pos.inspections i
     set evidence_received = (select count(*) from pos.evidence e where e.inspection_id = i.id and e.in_manifest
                               and e.upload_state in ('uploaded', 'verified', 'quarantined')),
         evidence_verified = (select count(*) from pos.evidence e where e.inspection_id = i.id and e.in_manifest
                               and e.upload_state = 'verified')
   where i.id = p_inspection_id
  returning * into v;
  return v;
end $$;

-- Completeness drives the inspection forward (12 §7, 06 §2): verified → under_review; quarantine → integrity_failed
-- (still reviewable, red banner). The job moves SUBMITTED → UNDER_REVIEW either way.
create function pos_rpc.promote_inspection(p_inspection_id uuid)
returns pos.inspections language plpgsql security definer set search_path = '' as $$
declare
  v pos.inspections;
  v_job pos.jobs;
  v_quarantined integer;
begin
  select * into v from pos.inspections where id = p_inspection_id for update;
  if not found then return null; end if;
  select * into v_job from pos.jobs where id = v.job_id for update;
  select count(*) into v_quarantined from pos.evidence e
   where e.inspection_id = v.id and e.upload_state = 'quarantined';

  if v_quarantined > 0 and v.status in ('submitted', 'verifying', 'under_review') then
    update pos.inspections set status = 'integrity_failed', flags = pos.array_union(flags, array['evidence_quarantined'])
     where id = v.id returning * into v;
    perform pos_rpc.custody('inspection', v.id, 'integrity_failed');
    perform pos_rpc.alert('integrity_failed', 'critical', format('Inspection for %s failed evidence verification', v_job.reference),
                          'inspection', v.id, v_job.bank_id, jsonb_build_object('job_id', v_job.id), 'integrity_failed:' || v.id::text);
    perform pos_rpc.notify_admins(v_job.bank_id, 'review_inspections', 'integrity_failed', 'inspection', v.id,
                                  jsonb_build_object('job_reference', v_job.reference));
    if v_job.status = 'submitted' then
      perform pos_rpc.transition_job(v_job.id, 'under_review', 'system', null, 'integrity_failed', null, null,
                                     jsonb_build_object('inspection_id', v.id));
    end if;
  elsif v.status in ('submitted', 'verifying') and v.evidence_verified >= v.evidence_expected then
    update pos.inspections set status = 'under_review' where id = v.id returning * into v;
    perform pos_rpc.custody('inspection', v.id, 'ready_for_review');
    if v_job.status = 'submitted' then
      perform pos_rpc.transition_job(v_job.id, 'under_review', 'system', null, 'evidence_verified', null, null,
                                     jsonb_build_object('inspection_id', v.id));
    end if;
  elsif v.status = 'submitted' and v.evidence_received >= v.evidence_expected then
    update pos.inspections set status = 'verifying' where id = v.id returning * into v;
  end if;
  return v;
end $$;

-- ── Handlers ───────────────────────────────────────────────────────────────────────────────────
create function pos_rpc.apply_job_event(p_env pos.ingest_envelopes, p_val jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_env.payload;
  v_action text := p ->> 'action';
  v_job pos.jobs;
  v_asg pos.job_assignments;
  v_insp pos.inspections;
  v_rc pos.reason_codes;
  v_reason text := p ->> 'reason_code';
  v_note text := p ->> 'note';
  v_fv uuid := (p ->> 'form_version_id')::uuid;
  v_fa jsonb := p -> 'form_answers';
  v_evt text;
  v_payload jsonb;
begin
  select * into v_job from pos.jobs where id = (p ->> 'job_id')::uuid for update;
  if not found then
    return jsonb_build_object('status', 'deferred', 'waiting_on', jsonb_build_object('job_id', p ->> 'job_id'));
  end if;
  select * into v_asg from pos.job_assignments a
   where a.job_id = v_job.id and a.user_id = p_env.user_id order by a.assigned_at desc limit 1 for update;
  v_evt := case v_action when 'accept' then 'agent_accepted' when 'reject' then 'agent_rejected'
                         when 'unable' then 'agent_unable' when 'pause' then 'inspection_paused'
                         when 'resume' then 'inspection_resumed' end;
  if v_evt is null then
    perform pos_rpc.fail('UNKNOWN_ACTION', format('unknown job_event action %s', v_action));
  end if;
  v_payload := jsonb_build_object('assignment_id', v_asg.id, 'evidence_ids', p -> 'evidence_ids', 'inspection_id', p -> 'inspection_id');

  -- accept / reject answer the live assignment; anything else is recorded as superseded (08 §6)
  if v_action in ('accept', 'reject') then
    if v_asg.id is null or v_asg.response <> 'pending' or v_job.status <> 'assigned'
       or v_job.assigned_to is distinct from p_env.user_id then
      perform pos_rpc.job_event(v_job.id, v_evt, p_env.user_id, 'agent', v_job.status, v_job.status, 'superseded', v_reason,
                                v_note, v_payload || jsonb_build_object('assignment_response', v_asg.response),
                                p_env.id, p_env.device_id, p_env.created_at_device, p_env.monotonic_ms, v_fv, v_fa);
      return jsonb_build_object('status', 'committed', 'result', jsonb_build_object('verdict', 'superseded', 'job_status', v_job.status));
    end if;
    if v_action = 'accept' then
      update pos.job_assignments set response = 'accepted', responded_at = now(), response_envelope_id = p_env.id where id = v_asg.id;
      v_job := pos_rpc.transition_job(v_job.id, 'accepted', 'agent', p_env.user_id, v_evt, null, v_note, v_payload,
                                      p_env.id, p_env.device_id, p_env.created_at_device, p_env.monotonic_ms, v_fv, v_fa);
    else
      v_rc := pos_rpc.require_reason('assignment_reject', v_reason, v_job.bank_id, v_note);
      update pos.job_assignments set response = 'rejected', responded_at = now(), reason_code = v_reason, note = v_note,
                                     response_envelope_id = p_env.id where id = v_asg.id;
      v_job := pos_rpc.transition_job(v_job.id, 'scheduled', 'agent', p_env.user_id, v_evt, v_reason, v_note, v_payload,
                                      p_env.id, p_env.device_id, p_env.created_at_device, p_env.monotonic_ms, v_fv, v_fa);
      update pos.jobs set assigned_to = null, assigned_at = null where id = v_job.id returning * into v_job;
      update pos.session_tokens set revoked_at = now(), revoke_reason = 'assignment_rejected'
       where job_id = v_job.id and user_id = p_env.user_id and used_at is null and revoked_at is null;
      perform pos_rpc.notify_admins(v_job.bank_id, 'schedule_jobs', 'job_rejected_by_agent', 'job', v_job.id,
                                    jsonb_build_object('job_reference', v_job.reference, 'reason_code', v_reason));
      perform pos_rpc.alert('assignment_rejected', 'warning', format('%s rejected by the agent (%s)', v_job.reference, v_reason),
                            'job', v_job.id, v_job.bank_id, jsonb_build_object('reason_code', v_reason), 'assignment_rejected:' || v_asg.id::text);
    end if;
    return jsonb_build_object('status', 'committed', 'result', jsonb_build_object('verdict', 'applied', 'job_status', v_job.status));
  end if;

  if v_action = 'unable' then
    if v_job.assigned_to is distinct from p_env.user_id or not pos_rpc.can_transition(v_job.status, 'unable_to_complete', 'agent') then
      perform pos_rpc.job_event(v_job.id, v_evt, p_env.user_id, 'agent', v_job.status, v_job.status, 'superseded', v_reason,
                                v_note, v_payload, p_env.id, p_env.device_id, p_env.created_at_device, p_env.monotonic_ms, v_fv, v_fa);
      return jsonb_build_object('status', 'committed', 'result', jsonb_build_object('verdict', 'superseded', 'job_status', v_job.status));
    end if;
    v_rc := pos_rpc.require_reason('unable_to_complete', v_reason, v_job.bank_id, v_note);
    if v_rc.requires_photo and jsonb_array_length(coalesce(p -> 'evidence_ids', '[]'::jsonb)) = 0 then
      v_payload := v_payload || jsonb_build_object('flags', jsonb_build_array('photo_missing'));
    end if;
    select * into v_insp from pos.inspections i
     where i.job_id = v_job.id and i.user_id = p_env.user_id and i.status in ('in_progress', 'paused')
     order by i.attempt desc limit 1 for update;
    if found then
      update pos.inspections set status = 'abandoned', unable_reason_code = v_reason, unable_answers = v_fa where id = v_insp.id;
      perform pos_rpc.custody('inspection', v_insp.id, 'abandoned', 'server', p_env.device_id, p_env.id);
    end if;
    if v_asg.response = 'pending' then
      update pos.job_assignments set response = 'accepted', responded_at = now(), response_envelope_id = p_env.id where id = v_asg.id;
    end if;
    v_job := pos_rpc.transition_job(v_job.id, 'unable_to_complete', 'agent', p_env.user_id, v_evt, v_reason, v_note,
                                    v_payload || jsonb_build_object('billable', v_rc.billable),
                                    p_env.id, p_env.device_id, p_env.created_at_device, p_env.monotonic_ms, v_fv, v_fa);
    update pos.session_tokens set revoked_at = now(), revoke_reason = 'unable_to_complete'
     where job_id = v_job.id and used_at is null and revoked_at is null;
    perform pos_rpc.alert('unable_to_complete', 'info', format('%s marked unable to complete (%s)', v_job.reference, v_reason),
                          'job', v_job.id, v_job.bank_id, jsonb_build_object('reason_code', v_reason), 'unable:' || p_env.id::text);
    return jsonb_build_object('status', 'committed', 'result', jsonb_build_object('verdict', 'applied', 'job_status', v_job.status));
  end if;

  -- pause / resume (geofence exit / re-entry, 07 §7)
  select * into v_insp from pos.inspections where id = (p ->> 'inspection_id')::uuid for update;
  if not found then
    return jsonb_build_object('status', 'deferred', 'waiting_on', jsonb_build_object('inspection_id', p ->> 'inspection_id'));
  end if;
  if v_action = 'pause' and v_insp.status = 'in_progress' then
    update pos.inspections set status = 'paused' where id = v_insp.id;
    if v_job.status = 'in_progress' then
      v_job := pos_rpc.transition_job(v_job.id, 'paused', 'system', p_env.user_id, v_evt, null, v_note, v_payload,
                                      p_env.id, p_env.device_id, p_env.created_at_device, p_env.monotonic_ms);
    end if;
  elsif v_action = 'resume' and v_insp.status = 'paused' then
    update pos.inspections set status = 'in_progress' where id = v_insp.id;
    if v_job.status = 'paused' then
      v_job := pos_rpc.transition_job(v_job.id, 'in_progress', 'agent', p_env.user_id, v_evt, null, v_note, v_payload,
                                      p_env.id, p_env.device_id, p_env.created_at_device, p_env.monotonic_ms);
    end if;
  else
    perform pos_rpc.job_event(v_job.id, v_evt, p_env.user_id, 'agent', v_job.status, v_job.status, 'recorded', null,
                              v_note, v_payload || jsonb_build_object('inspection_status', v_insp.status),
                              p_env.id, p_env.device_id, p_env.created_at_device, p_env.monotonic_ms);
  end if;
  return jsonb_build_object('status', 'committed', 'result', jsonb_build_object('verdict', 'applied', 'job_status', v_job.status));
end $$;

create function pos_rpc.apply_inspection_started(p_env pos.ingest_envelopes, p_val jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_env.payload;
  v_id uuid := (p ->> 'inspection_id')::uuid;
  v_job pos.jobs;
  v_existing pos.inspections;
  v_tok jsonb;
  v_flags text[];
  v_asg pos.job_assignments;
begin
  select * into v_job from pos.jobs where id = (p ->> 'job_id')::uuid for update;
  if not found then
    return jsonb_build_object('status', 'deferred', 'waiting_on', jsonb_build_object('job_id', p ->> 'job_id'));
  end if;

  select * into v_existing from pos.inspections where id = v_id;
  if found then  -- business duplicate (e.g. a submission already created it, or a re-send under a new envelope id)
    return jsonb_build_object('status', 'duplicate', 'duplicate_of', v_existing.started_envelope_id,
                              'result', jsonb_build_object('inspection_id', v_id, 'inspection_status', v_existing.status));
  end if;
  if exists (select 1 from pos.inspections i where i.job_id = v_job.id and i.attempt = (p ->> 'attempt')::integer) then
    return jsonb_build_object('status', 'conflict', 'error', jsonb_build_object(
      'code', 'ATTEMPT_CONFLICT', 'retryable', false, 'message', 'another inspection already holds this attempt number'));
  end if;

  v_tok := pos_rpc.check_session_token(v_job.id, p_env.user_id, p_env.device_id, p ->> 'session_token',
                                       (p ->> 'session_token_id')::uuid, (p ->> 'started_at_device')::timestamptz, v_id);
  v_flags := pos.array_union(
    pos_rpc.inspection_context_flags(v_job, p_env.user_id, (p ->> 'form_version_id')::uuid, p_env.client_type::text),
    array(select jsonb_array_elements_text(v_tok -> 'flags')));
  if coalesce((p #>> '{geofence_result,override}')::boolean, false) then
    v_flags := pos.array_union(v_flags, array['geofence_override']);
  end if;

  insert into pos.inspections (id, job_id, attempt, user_id, device_id, client_type, session_token_id,
                               form_version_id, definition_hash, flow_version_id, flow_hash, job_schema_version_id,
                               config_version_id, context_snapshot, status, started_at_device, started_at_server,
                               clock_offset_ms, geofence_result, integrity, flags, started_envelope_id)
  values (v_id, v_job.id, (p ->> 'attempt')::integer, p_env.user_id, p_env.device_id, p_env.client_type,
          (v_tok ->> 'token_id')::uuid, (p ->> 'form_version_id')::uuid, p ->> 'definition_hash',
          (p ->> 'flow_version_id')::uuid, p ->> 'flow_hash', (p ->> 'job_schema_version_id')::uuid,
          (p ->> 'config_version_id')::uuid, p -> 'context_snapshot', 'in_progress',
          (p ->> 'started_at_device')::timestamptz, now(), (p ->> 'clock_offset_ms')::integer,
          p -> 'geofence_result', p -> 'integrity', v_flags, p_env.id);
  perform pos_rpc.custody('inspection', v_id, 'started', 'server', p_env.device_id, p_env.id,
                          jsonb_build_object('attempt', p ->> 'attempt', 'flags', to_jsonb(v_flags)));

  -- starting implies acceptance (the accept event may still be in flight, 12 §5 order tolerance)
  select * into v_asg from pos.job_assignments a
   where a.job_id = v_job.id and a.user_id = p_env.user_id and a.response = 'pending' for update;
  if found then
    update pos.job_assignments set response = 'accepted', responded_at = now(), response_envelope_id = p_env.id where id = v_asg.id;
  end if;

  if v_job.assigned_to = p_env.user_id and pos_rpc.can_transition(v_job.status, 'in_progress', 'agent') then
    v_job := pos_rpc.transition_job(v_job.id, 'in_progress', 'agent', p_env.user_id, 'inspection_started', null, null,
                                    jsonb_build_object('inspection_id', v_id, 'flags', to_jsonb(v_flags)),
                                    p_env.id, p_env.device_id, p_env.created_at_device, p_env.monotonic_ms);
  else
    perform pos_rpc.job_event(v_job.id, 'inspection_started', p_env.user_id, 'agent', v_job.status, v_job.status, 'recorded',
                              null, null, jsonb_build_object('inspection_id', v_id, 'flags', to_jsonb(v_flags)),
                              p_env.id, p_env.device_id, p_env.created_at_device, p_env.monotonic_ms);
  end if;
  return jsonb_build_object('status', 'committed', 'result',
    jsonb_build_object('inspection_id', v_id, 'inspection_status', 'in_progress', 'job_status', v_job.status, 'flags', to_jsonb(v_flags)));
end $$;

create function pos_rpc.apply_inspection_snapshot(p_env pos.ingest_envelopes, p_val jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_env.payload;
  v pos.inspections;
begin
  select * into v from pos.inspections where id = (p ->> 'inspection_id')::uuid for update;
  if not found then
    return jsonb_build_object('status', 'deferred', 'waiting_on', jsonb_build_object('inspection_id', p ->> 'inspection_id'));
  end if;
  if v.status not in ('in_progress', 'paused') then
    return jsonb_build_object('status', 'committed', 'result', jsonb_build_object('applied', false, 'reason', 'inspection_sealed'));
  end if;
  -- last-writer-wins by device_seq, not arrival order (12 §15 layer 4)
  if v.snapshot_device_seq is null or coalesce(p_env.device_seq, 0) > v.snapshot_device_seq then
    update pos.inspections set snapshot_answers = p -> 'answers', snapshot_device_seq = p_env.device_seq where id = v.id;
    return jsonb_build_object('status', 'committed', 'result', jsonb_build_object('applied', true));
  end if;
  return jsonb_build_object('status', 'committed', 'result', jsonb_build_object('applied', false, 'reason', 'stale_device_seq'));
end $$;

create function pos_rpc.apply_evidence_meta(p_env pos.ingest_envelopes, p_val jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_env.payload;
  v_eid uuid := (p ->> 'evidence_id')::uuid;
  v_insp pos.inspections;
  v_job pos.jobs;
  v_ev pos.evidence;
  v_path text;
  v_in_manifest boolean;
  v_flags text[] := '{}';
begin
  select * into v_insp from pos.inspections where id = (p ->> 'inspection_id')::uuid;
  if not found then
    return jsonb_build_object('status', 'deferred', 'waiting_on', jsonb_build_object('inspection_id', p ->> 'inspection_id'));
  end if;
  select * into v_job from pos.jobs where id = v_insp.job_id;

  select * into v_ev from pos.evidence where id = v_eid;
  if found then
    if v_ev.sha256_client = p ->> 'sha256' then
      return jsonb_build_object('status', 'duplicate', 'duplicate_of', v_ev.envelope_id,
                                'result', jsonb_build_object('evidence_id', v_eid, 'upload_state', v_ev.upload_state));
    end if;
    update pos.inspections set flags = pos.array_union(flags, array['evidence_conflict']) where id = v_insp.id;
    return jsonb_build_object('status', 'conflict', 'error', jsonb_build_object(
      'code', 'EVIDENCE_CONFLICT', 'retryable', false, 'message', 'evidence id already recorded with a different hash'));
  end if;

  -- server-derived path (03 §4); never taken from the device
  v_path := format('bank/%s/job/%s/inspection/%s/%s.%s', v_job.bank_id, v_job.id, v_insp.id, v_eid, pos.ext_for_mime(p ->> 'mime'));
  v_in_manifest := coalesce(v_insp.manifest -> 'items' @> jsonb_build_array(jsonb_build_object('evidence_id', v_eid::text)), false);
  if v_insp.status not in ('in_progress', 'paused') and not v_in_manifest then
    v_flags := v_flags || 'unexpected_evidence'::text;
  end if;
  if exists (select 1 from pos.evidence e where e.inspection_id = v_insp.id and e.sha256_client = p ->> 'sha256') then
    v_flags := v_flags || 'duplicate_evidence_hash'::text;   -- flagged, not rejected (05 §8)
  end if;

  insert into pos.evidence (id, inspection_id, job_id, field_key, category, type, sha256_client, storage_path, bytes, mime,
                            width, height, captured_at_device, captured_at_monotonic_ms, gnss_time, location, accuracy_m,
                            is_mocked, session_token_id, in_manifest, meta, envelope_id)
  values (v_eid, v_insp.id, v_job.id, p ->> 'field_key', p ->> 'category', (p ->> 'type')::pos.evidence_type, p ->> 'sha256',
          v_path, (p ->> 'bytes')::bigint, p ->> 'mime', (p ->> 'width')::integer, (p ->> 'height')::integer,
          (p ->> 'captured_at_device')::timestamptz, (p ->> 'captured_at_monotonic_ms')::bigint, (p ->> 'gnss_time')::timestamptz,
          case when p ? 'location' and p -> 'location' <> 'null'::jsonb then
            extensions.st_setsrid(extensions.st_makepoint((p #>> '{location,lng}')::float8, (p #>> '{location,lat}')::float8), 4326)::extensions.geography end,
          (p ->> 'accuracy_m')::numeric, (p ->> 'is_mocked')::boolean, (p ->> 'session_token_id')::uuid, v_in_manifest,
          coalesce(p -> 'meta', '{}'::jsonb), p_env.id);
  if cardinality(v_flags) > 0 then
    update pos.inspections set flags = pos.array_union(flags, v_flags) where id = v_insp.id;
  end if;
  if coalesce((p ->> 'is_mocked')::boolean, false) then
    update pos.inspections set flags = pos.array_union(flags, array['evidence_mock_location']) where id = v_insp.id;
  end if;
  perform pos_rpc.custody('evidence', v_eid, 'meta_committed', 'server', p_env.device_id, p_env.id,
                          jsonb_build_object('field_key', p ->> 'field_key', 'flags', to_jsonb(v_flags)));
  return jsonb_build_object('status', 'committed', 'result',
    jsonb_build_object('evidence_id', v_eid, 'upload_state', 'pending', 'flags', to_jsonb(v_flags)));
end $$;

create function pos_rpc.apply_evidence_uploaded(p_env pos.ingest_envelopes, p_val jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_env.payload;
  v_ev pos.evidence;
begin
  select * into v_ev from pos.evidence where id = (p ->> 'evidence_id')::uuid for update;
  if not found then
    return jsonb_build_object('status', 'deferred', 'waiting_on', jsonb_build_object('evidence_id', p ->> 'evidence_id'));
  end if;
  if v_ev.upload_state = 'pending' then
    update pos.evidence set upload_state = 'uploaded', uploaded_at = now() where id = v_ev.id returning * into v_ev;
    perform pos_rpc.enqueue('verify_evidence', jsonb_build_object('evidence_id', v_ev.id));  -- same transaction (12 §6)
    perform pos_rpc.custody('evidence', v_ev.id, 'uploaded', 'server', p_env.device_id, p_env.id);
    perform pos_rpc.recount_evidence(v_ev.inspection_id);
    perform pos_rpc.promote_inspection(v_ev.inspection_id);
  end if;
  return jsonb_build_object('status', 'committed', 'result',
    jsonb_build_object('evidence_id', v_ev.id, 'upload_state', v_ev.upload_state));
end $$;

create function pos_rpc.apply_traces_batch(p_env pos.ingest_envelopes, p_val jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_env.payload;
  v_insp pos.inspections;
  v_n integer;
begin
  select * into v_insp from pos.inspections where id = (p ->> 'inspection_id')::uuid;
  if not found then
    return jsonb_build_object('status', 'deferred', 'waiting_on', jsonb_build_object('inspection_id', p ->> 'inspection_id'));
  end if;
  insert into pos.location_traces (fix_id, inspection_id, ts_device, ts_monotonic_ms, gnss_ts, location, accuracy_m, speed,
                                   is_mocked, inside_fence, event, envelope_id)
  select (f ->> 'fix_id')::uuid, v_insp.id, (f ->> 'ts_device')::timestamptz, (f ->> 'ts_monotonic_ms')::bigint,
         (f ->> 'gnss_ts')::timestamptz,
         extensions.st_setsrid(extensions.st_makepoint((f ->> 'lng')::float8, (f ->> 'lat')::float8), 4326)::extensions.geography,
         (f ->> 'accuracy_m')::numeric, (f ->> 'speed')::numeric, (f ->> 'is_mocked')::boolean,
         (f ->> 'inside_fence')::boolean, coalesce((f ->> 'event')::pos.trace_event, 'fix'), p_env.id
    from jsonb_array_elements(coalesce(p -> 'fixes', '[]'::jsonb)) f
  on conflict (fix_id) do nothing;
  get diagnostics v_n = row_count;
  if exists (select 1 from jsonb_array_elements(coalesce(p -> 'fixes', '[]'::jsonb)) f where (f ->> 'is_mocked')::boolean) then
    update pos.inspections set flags = pos.array_union(flags, array['trace_mock_location']) where id = v_insp.id;
  end if;
  return jsonb_build_object('status', 'committed', 'result',
    jsonb_build_object('inserted', v_n, 'received', jsonb_array_length(coalesce(p -> 'fixes', '[]'::jsonb))));
end $$;

create function pos_rpc.apply_submission(p_env pos.ingest_envelopes, p_val jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_env.payload;
  v_id uuid := (p ->> 'inspection_id')::uuid;
  v_job pos.jobs;
  v_insp pos.inspections;
  v_tok jsonb;
  v_flags text[];
  v_items jsonb := coalesce(p #> '{manifest,items}', '[]'::jsonb);
  v_expected integer;
  v_mismatch integer;
  v_asg pos.job_assignments;
  v_fv uuid := (p #>> '{definition_refs,form,version_id}')::uuid;
begin
  select * into v_job from pos.jobs where id = (p ->> 'job_id')::uuid for update;
  if not found then
    return jsonb_build_object('status', 'deferred', 'waiting_on', jsonb_build_object('job_id', p ->> 'job_id'));
  end if;
  v_expected := jsonb_array_length(v_items);

  select * into v_insp from pos.inspections where id = v_id for update;
  if found and v_insp.status not in ('in_progress', 'paused') then
    -- one committed submission per inspection (12 §15 layer 3)
    if v_insp.submission_hash is not distinct from p ->> 'submission_hash' and v_insp.answers_hash is not distinct from p ->> 'answers_hash' then
      return jsonb_build_object('status', 'duplicate', 'duplicate_of', v_insp.submission_envelope_id,
                                'result', jsonb_build_object('inspection_id', v_id, 'inspection_status', v_insp.status,
                                                             'evidence_expected', v_insp.evidence_expected,
                                                             'evidence_verified', v_insp.evidence_verified));
    end if;
    update pos.inspections set flags = pos.array_union(flags, array['conflicting_submission']) where id = v_id;
    return jsonb_build_object('status', 'conflict', 'error', jsonb_build_object(
      'code', 'SUBMISSION_CONFLICT', 'retryable', false,
      'message', 'a different submission was already committed for this inspection; both are kept for review'));
  end if;
  if not found and exists (select 1 from pos.inspections i where i.job_id = v_job.id and i.attempt = (p ->> 'attempt')::integer) then
    return jsonb_build_object('status', 'conflict', 'error', jsonb_build_object(
      'code', 'ATTEMPT_CONFLICT', 'retryable', false, 'message', 'another inspection already holds this attempt number'));
  end if;

  v_flags := pos_rpc.inspection_context_flags(v_job, p_env.user_id, v_fv, p_env.client_type::text);
  if v_insp.id is null or v_insp.session_token_id is null then
    v_tok := pos_rpc.check_session_token(v_job.id, p_env.user_id, p_env.device_id, p ->> 'session_token',
                                         (p ->> 'session_token_id')::uuid, (p ->> 'started_at_device')::timestamptz, v_id);
    v_flags := pos.array_union(v_flags, array(select jsonb_array_elements_text(v_tok -> 'flags')));
  elsif v_insp.session_token_id is distinct from (p ->> 'session_token_id')::uuid then
    v_flags := pos.array_union(v_flags, array['token_mismatch']);
  end if;
  if coalesce((p #>> '{geofence,override}')::boolean, false) then v_flags := pos.array_union(v_flags, array['geofence_override']); end if;
  if coalesce((p_val #>> '{computed,submission_hash_matches}')::boolean, true) = false then
    v_flags := pos.array_union(v_flags, array['submission_hash_mismatch']);
  end if;
  if coalesce((p_val #>> '{computed,answers_hash_matches}')::boolean, true) = false then
    v_flags := pos.array_union(v_flags, array['answers_hash_mismatch']);
  end if;
  if coalesce((p #>> '{integrity,mock_location}')::boolean, false) then v_flags := pos.array_union(v_flags, array['mock_location']); end if;
  if coalesce((p #>> '{integrity,rooted}')::boolean, false) then v_flags := pos.array_union(v_flags, array['device_rooted']); end if;
  if abs(coalesce((p ->> 'clock_offset_ms')::bigint, 0)) > 300000 then v_flags := pos.array_union(v_flags, array['clock_drift']); end if;

  if v_insp.id is null then
    insert into pos.inspections (id, job_id, attempt, user_id, device_id, client_type, session_token_id,
                                 form_version_id, definition_hash, flow_version_id, flow_hash, job_schema_version_id,
                                 config_version_id, context_snapshot, status, started_at_device, started_at_server,
                                 submitted_at_device, submitted_at_server, clock_offset_ms, answers, answers_hash,
                                 submission_hash, manifest, evidence_expected, geofence_result, integrity, diagnostics,
                                 flags, submission_envelope_id)
    values (v_id, v_job.id, (p ->> 'attempt')::integer, p_env.user_id, p_env.device_id, p_env.client_type,
            (v_tok ->> 'token_id')::uuid, v_fv, p #>> '{definition_refs,form,hash}',
            (p #>> '{definition_refs,flow,version_id}')::uuid, p #>> '{definition_refs,flow,hash}',
            (p #>> '{definition_refs,job_schema,version_id}')::uuid, (p ->> 'config_version_id')::uuid,
            p -> 'context_snapshot', 'submitted', (p ->> 'started_at_device')::timestamptz, now(),
            (p ->> 'submitted_at_device')::timestamptz, now(), (p ->> 'clock_offset_ms')::integer, p -> 'answers',
            p ->> 'answers_hash', p ->> 'submission_hash', p -> 'manifest', v_expected, p -> 'geofence',
            p -> 'integrity', p -> 'diagnostics', v_flags, p_env.id)
    returning * into v_insp;
  else
    update pos.inspections
       set status = 'submitted', answers = p -> 'answers', answers_hash = p ->> 'answers_hash',
           submission_hash = p ->> 'submission_hash', manifest = p -> 'manifest', evidence_expected = v_expected,
           submitted_at_device = (p ->> 'submitted_at_device')::timestamptz, submitted_at_server = now(),
           geofence_result = coalesce(p -> 'geofence', geofence_result), integrity = coalesce(p -> 'integrity', integrity),
           diagnostics = p -> 'diagnostics', context_snapshot = coalesce(p -> 'context_snapshot', context_snapshot),
           form_version_id = coalesce(v_fv, form_version_id),
           definition_hash = coalesce(p #>> '{definition_refs,form,hash}', definition_hash),
           flags = pos.array_union(flags, v_flags), submission_envelope_id = p_env.id
     where id = v_id
    returning * into v_insp;
  end if;

  -- manifest ↔ landed evidence (12 §7)
  update pos.evidence e set in_manifest = true
   where e.inspection_id = v_id and e.id in (select (i ->> 'evidence_id')::uuid from jsonb_array_elements(v_items) i);
  select count(*) into v_mismatch
    from jsonb_array_elements(v_items) i join pos.evidence e on e.id = (i ->> 'evidence_id')::uuid
   where e.sha256_client <> i ->> 'sha256';
  if v_mismatch > 0 then
    update pos.inspections set flags = pos.array_union(flags, array['manifest_hash_mismatch']) where id = v_id;
  end if;
  if exists (select 1 from pos.evidence e where e.inspection_id = v_id and not e.in_manifest and e.type <> 'unable_photo') then
    update pos.inspections set flags = pos.array_union(flags, array['unexpected_evidence']) where id = v_id;
  end if;

  select * into v_asg from pos.job_assignments a
   where a.job_id = v_job.id and a.user_id = p_env.user_id and a.response = 'pending' for update;
  if found then
    update pos.job_assignments set response = 'accepted', responded_at = now(), response_envelope_id = p_env.id where id = v_asg.id;
  end if;

  if v_job.assigned_to = p_env.user_id and pos_rpc.can_transition(v_job.status, 'submitted', 'agent') then
    v_job := pos_rpc.transition_job(v_job.id, 'submitted', 'agent', p_env.user_id, 'inspection_submitted', null, null,
                                    jsonb_build_object('inspection_id', v_id, 'evidence_expected', v_expected, 'flags', to_jsonb(v_flags)),
                                    p_env.id, p_env.device_id, p_env.created_at_device, p_env.monotonic_ms);
  else
    perform pos_rpc.job_event(v_job.id, 'inspection_submitted', p_env.user_id, 'agent', v_job.status, v_job.status, 'recorded',
                              null, null, jsonb_build_object('inspection_id', v_id, 'flags', to_jsonb(v_flags)),
                              p_env.id, p_env.device_id, p_env.created_at_device, p_env.monotonic_ms);
    if 'submitted_after_cancel' = any (v_flags) or 'submitted_by_unassigned' = any (v_flags) then
      perform pos_rpc.alert('submission_out_of_state', 'warning',
                            format('Submission for %s arrived while the job is %s — kept and flagged', v_job.reference, v_job.status),
                            'inspection', v_id, v_job.bank_id, jsonb_build_object('flags', to_jsonb(v_flags)), 'out_of_state:' || v_id::text);
    end if;
  end if;
  perform pos_rpc.custody('inspection', v_id, 'submission_committed', 'server', p_env.device_id, p_env.id,
                          jsonb_build_object('evidence_expected', v_expected, 'flags', to_jsonb(v_flags)));

  perform pos_rpc.recount_evidence(v_id);
  v_insp := pos_rpc.promote_inspection(v_id);
  return jsonb_build_object('status', 'committed', 'result', jsonb_build_object(
    'inspection_id', v_id, 'inspection_status', v_insp.status, 'job_status', v_job.status,
    'evidence_expected', v_insp.evidence_expected, 'evidence_received', v_insp.evidence_received,
    'evidence_verified', v_insp.evidence_verified, 'flags', to_jsonb(v_insp.flags)));
end $$;

create function pos_rpc.apply_form_submission(p_env pos.ingest_envelopes, p_val jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_env.payload;
  v_id uuid := coalesce((p ->> 'form_submission_id')::uuid, p_env.id);
  v_existing pos.form_submissions;
  v_flags text[] := '{}';
begin
  if not exists (select 1 from pos.definition_versions where id = (p ->> 'form_version_id')::uuid) then
    perform pos_rpc.fail('UNKNOWN_FORM_VERSION', 'form version not found');
  end if;
  select * into v_existing from pos.form_submissions where id = v_id;
  if found then
    return jsonb_build_object('status', 'duplicate', 'duplicate_of', v_existing.envelope_id, 'result', jsonb_build_object('id', v_id));
  end if;
  if exists (select 1 from pos.form_submissions f
              where f.user_id = p_env.user_id and f.subject_id is not distinct from (p ->> 'subject_id')::uuid
                and f.answers_hash = p ->> 'answers_hash' and f.submitted_at_server > now() - interval '10 minutes') then
    v_flags := v_flags || 'probable_duplicate'::text;
  end if;
  insert into pos.form_submissions (id, form_version_id, definition_hash, subject_type, subject_id, user_id, device_id,
                                    answers, answers_hash, flags, submitted_at_device, envelope_id)
  values (v_id, (p ->> 'form_version_id')::uuid, p ->> 'definition_hash', coalesce((p ->> 'subject_type')::pos.subject_type, 'none'),
          (p ->> 'subject_id')::uuid, p_env.user_id, p_env.device_id, p -> 'answers', p ->> 'answers_hash', v_flags,
          (p ->> 'submitted_at_device')::timestamptz, p_env.id);
  return jsonb_build_object('status', 'committed', 'result', jsonb_build_object('id', v_id, 'flags', to_jsonb(v_flags)));
end $$;

create function pos_rpc.apply_custody_batch(p_env pos.ingest_envelopes, p_val jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into pos.custody_events (subject_type, subject_id, event, source, at_device, monotonic_ms, device_id, envelope_id, detail, request_id)
  select (e ->> 'subject_type')::pos.custody_subject, (e ->> 'subject_id')::uuid, e ->> 'event', 'device',
         (e ->> 'at_device')::timestamptz, (e ->> 'monotonic_ms')::bigint, p_env.device_id, p_env.id,
         coalesce(e -> 'detail', '{}'::jsonb), nullif(current_setting('pos.request_id', true), '')
    from jsonb_array_elements(coalesce(p_env.payload -> 'events', '[]'::jsonb)) e;
  get diagnostics v_n = row_count;
  return jsonb_build_object('status', 'committed', 'result', jsonb_build_object('recorded', v_n));
end $$;

create function pos_rpc.apply_sync_report(p_env pos.ingest_envelopes, p_val jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_env.payload;
  v_report uuid;
  v_total integer;
begin
  select coalesce(sum(value::text::integer), 0) into v_total from jsonb_each(coalesce(p -> 'pending', '{}'::jsonb));
  insert into pos.device_sync_reports (envelope_id, device_id, user_id, device_seq, reported_at_device, pending, oldest_pending_at,
                                       last_success_at, free_storage_mb, battery_restricted, module_version, config_version_id, capabilities)
  values (p_env.id, p_env.device_id, p_env.user_id, p_env.device_seq, coalesce((p ->> 'reported_at_device')::timestamptz, p_env.created_at_device),
          coalesce(p -> 'pending', '{}'::jsonb), (p ->> 'oldest_pending_at')::timestamptz, (p ->> 'last_success_at')::timestamptz,
          (p ->> 'free_storage_mb')::integer, (p ->> 'battery_restricted')::boolean, coalesce(p ->> 'module_version', p_env.module_version),
          (p ->> 'config_version_id')::uuid, coalesce(p -> 'capabilities', '{}'::jsonb))
  returning id into v_report;

  -- projection, last-writer-wins by device_seq (12 §15 layer 4)
  insert into pos.device_sync_status (device_id, user_id, last_report_id, last_device_seq, reported_at_device, received_at, pending,
                                      pending_total, oldest_pending_at, last_success_at, free_storage_mb, battery_restricted,
                                      module_version, config_version_id)
  values (p_env.device_id, p_env.user_id, v_report, p_env.device_seq, coalesce((p ->> 'reported_at_device')::timestamptz, p_env.created_at_device),
          now(), coalesce(p -> 'pending', '{}'::jsonb), v_total, (p ->> 'oldest_pending_at')::timestamptz,
          (p ->> 'last_success_at')::timestamptz, (p ->> 'free_storage_mb')::integer, (p ->> 'battery_restricted')::boolean,
          coalesce(p ->> 'module_version', p_env.module_version), (p ->> 'config_version_id')::uuid)
  on conflict (user_id, device_id) do update
     set last_report_id = excluded.last_report_id, last_device_seq = excluded.last_device_seq,
         reported_at_device = excluded.reported_at_device, received_at = excluded.received_at, pending = excluded.pending,
         pending_total = excluded.pending_total, oldest_pending_at = excluded.oldest_pending_at,
         last_success_at = excluded.last_success_at, free_storage_mb = excluded.free_storage_mb,
         battery_restricted = excluded.battery_restricted, module_version = excluded.module_version,
         config_version_id = excluded.config_version_id
   where pos.device_sync_status.last_device_seq is null or excluded.last_device_seq > pos.device_sync_status.last_device_seq;

  update pos.devices set last_seen_at = now(), module_version = coalesce(p ->> 'module_version', module_version),
                         capabilities = coalesce(p -> 'capabilities', capabilities)
   where user_id = p_env.user_id and device_id = p_env.device_id;

  if (p ->> 'oldest_pending_at')::timestamptz < now() - interval '24 hours' then
    perform pos_rpc.alert('device_backlog', 'critical', 'Device has items pending for more than 24 h', 'device', p_env.device_id, null,
                          jsonb_build_object('user_id', p_env.user_id, 'pending', p -> 'pending'), 'device_backlog:' || p_env.device_id::text);
  end if;
  return jsonb_build_object('status', 'committed', 'result', jsonb_build_object('report_id', v_report));
end $$;

create function pos_rpc.apply_client_error(p_env pos.ingest_envelopes, p_val jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into pos.client_error_reports (envelope_id, about_envelope_id, device_id, user_id, code, detail, at)
  select p_env.id, (e ->> 'about_envelope_id')::uuid, p_env.device_id, p_env.user_id, coalesce(e ->> 'code', 'unknown'),
         coalesce(e -> 'detail', '{}'::jsonb), (e ->> 'at')::timestamptz
    from jsonb_array_elements(coalesce(p_env.payload -> 'errors', '[]'::jsonb)) e;
  get diagnostics v_n = row_count;
  perform pos_rpc.alert('client_error', 'warning', format('Device reported %s client error(s)', v_n), 'device', p_env.device_id, null,
                        jsonb_build_object('envelope_id', p_env.id), 'client_error:' || p_env.device_id::text);
  return jsonb_build_object('status', 'committed', 'result', jsonb_build_object('recorded', v_n));
end $$;

-- ── Apply dispatcher ───────────────────────────────────────────────────────────────────────────
-- p_validation: {ok, errors[], computed{…}} from the API's TS validation. ok=false → rejected (kept, 12 §5).
create function pos_rpc.ingest_apply(p_envelope_id uuid, p_validation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_env pos.ingest_envelopes;
  v_res jsonb;
  v_msg text;
  v_hint text;
  v_detail text;
  v_state text;
begin
  perform pg_advisory_xact_lock(hashtext('pos.ingest:' || p_envelope_id::text));
  select * into v_env from pos.ingest_envelopes where id = p_envelope_id for update;
  if not found then
    perform pos_rpc.fail('NOT_FOUND', 'envelope has not been landed');
  end if;
  if v_env.state in ('committed', 'duplicate', 'rejected', 'conflict') then
    return v_env.result;
  end if;
  perform pos_rpc.set_context(v_env.user_id, 'pos_agent', coalesce(nullif(current_setting('pos.request_id', true), ''), v_env.last_request_id));

  if coalesce((p_validation ->> 'ok')::boolean, true) = false then
    return pos_rpc.ingest_finish(v_env, 'rejected', null, null, null, jsonb_build_object(
      'code', 'VALIDATION_FAILED', 'retryable', false, 'message', 'payload failed validation; kept server-side for review',
      'details', p_validation -> 'errors'));
  end if;

  begin
    v_res := case v_env.type
      when 'job_event'           then pos_rpc.apply_job_event(v_env, p_validation)
      when 'inspection_started'  then pos_rpc.apply_inspection_started(v_env, p_validation)
      when 'inspection_snapshot' then pos_rpc.apply_inspection_snapshot(v_env, p_validation)
      when 'evidence_meta'       then pos_rpc.apply_evidence_meta(v_env, p_validation)
      when 'evidence_uploaded'   then pos_rpc.apply_evidence_uploaded(v_env, p_validation)
      when 'traces_batch'        then pos_rpc.apply_traces_batch(v_env, p_validation)
      when 'submission'          then pos_rpc.apply_submission(v_env, p_validation)
      when 'form_submission'     then pos_rpc.apply_form_submission(v_env, p_validation)
      when 'custody_batch'       then pos_rpc.apply_custody_batch(v_env, p_validation)
      when 'sync_report'         then pos_rpc.apply_sync_report(v_env, p_validation)
      when 'client_error'        then pos_rpc.apply_client_error(v_env, p_validation)
      else null end;
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint, v_detail = pg_exception_detail;
      if v_hint like 'POS:%' then
        return pos_rpc.ingest_finish(v_env, 'rejected', null, null, null, jsonb_build_object(
          'code', substr(v_hint, 5), 'retryable', false, 'message', v_msg,
          'details', case when coalesce(v_detail, '') = '' then null else v_detail::jsonb end));
      end if;
      return pos_rpc.ingest_hold(v_env, jsonb_build_object('code', 'GUARD_VIOLATION', 'message', v_msg));
    when others then
      get stacked diagnostics v_msg = message_text;
      return pos_rpc.ingest_hold(v_env, jsonb_build_object('code', 'APPLY_ERROR', 'sqlstate', sqlstate, 'message', v_msg));
  end;

  if v_res is null then  -- no handler for this type/version: hold and alert, never refuse (13 §3)
    return pos_rpc.ingest_hold(v_env, jsonb_build_object('code', 'NO_HANDLER', 'type', v_env.type, 'type_version', v_env.type_version));
  end if;

  v_state := v_res ->> 'status';
  return pos_rpc.ingest_finish(v_env, v_state::pos.envelope_state, v_res -> 'result',
                               case when v_state = 'deferred' then v_res -> 'waiting_on' end,
                               (v_res ->> 'duplicate_of')::uuid, v_res -> 'error');
end $$;

-- Reprocessor candidates (12 §5): `received` for > 2 min, or `deferred` whose dependency now exists.
create function pos_rpc.reprocess_candidates(p_limit integer default 100)
returns table (envelope_id uuid) language sql stable security definer set search_path = '' as $$
  select e.id from pos.ingest_envelopes e
   where (e.state = 'received' and e.received_at < now() - interval '2 minutes'
          and (e.processed_at is null or e.processed_at < now() - interval '5 minutes'))   -- held ones back off
      or (e.state = 'deferred' and (
            (e.waiting_on ? 'job_id' and exists (select 1 from pos.jobs j where j.id = (e.waiting_on ->> 'job_id')::uuid))
         or (e.waiting_on ? 'inspection_id' and exists (select 1 from pos.inspections i where i.id = (e.waiting_on ->> 'inspection_id')::uuid))
         or (e.waiting_on ? 'evidence_id' and exists (select 1 from pos.evidence v where v.id = (e.waiting_on ->> 'evidence_id')::uuid))))
   order by e.received_at
   limit p_limit;
$$;

-- A deferred envelope becomes processable again: the reprocessor re-opens it before re-applying.
create function pos_rpc.reopen_deferred(p_envelope_id uuid)
returns void language sql security definer set search_path = '' as $$
  update pos.ingest_envelopes set state = 'received' where id = p_envelope_id and state = 'deferred';
$$;

-- Envelope payload for (re)validation by a worker.
create function pos_rpc.envelope_get(p_envelope_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(e) from pos.ingest_envelopes e where e.id = p_envelope_id;
$$;
