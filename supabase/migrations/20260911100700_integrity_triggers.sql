-- FESS POS — integrity mechanisms in the database (docs/05 §8, docs/07 §6, §9).
--   * updated_at maintenance
--   * immutability (append-only tables refuse UPDATE/DELETE/TRUNCATE)
--   * no deletes on mutable tables (only the retention worker, with pos.purge = on)
--   * column whitelists (evidence, ingest_envelopes, session tokens; inspections once sealed)
--   * status transition guards (jobs, inspections, assignments)
--   * universal audit log with a hash chain

-- ── Request context: set by every pos_rpc function so triggers can attribute changes ───────────
-- Lives in pos_rpc (service_role only) so no client can spoof the actor recorded in the audit log.
create function pos_rpc.set_context(p_actor_id uuid, p_actor_role text, p_request_id text)
returns void language sql volatile set search_path = '' as $$
  select set_config('pos.actor_id', coalesce(p_actor_id::text, ''), true),
         set_config('pos.actor_role', coalesce(p_actor_role, ''), true),
         set_config('pos.request_id', coalesce(p_request_id, ''), true);
$$;

-- ── updated_at ─────────────────────────────────────────────────────────────────────────────────
create function pos.tg_touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── Append-only ────────────────────────────────────────────────────────────────────────────────
create function pos.tg_append_only() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('pos.purge', true) = 'on' then
    return old;                                                  -- retention worker only (docs/05 §11)
  end if;
  raise exception 'pos.% is append-only: % refused', tg_table_name, tg_op
    using errcode = 'P0001', hint = 'Write a new row (new version, amendment or event) instead.';
end $$;

-- ── No deletes on mutable tables ───────────────────────────────────────────────────────────────
create function pos.tg_no_delete() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('pos.purge', true) = 'on' then
    return old;
  end if;
  raise exception 'pos.%: rows are never deleted (deactivate, revoke or supersede instead)', tg_table_name
    using errcode = 'P0001';
end $$;

-- ── Column whitelist: only the columns named in the trigger arguments may change ───────────────
create function pos.tg_column_whitelist() returns trigger language plpgsql set search_path = '' as $$
declare
  v_changed text;
begin
  select string_agg(n.key, ', ' order by n.key) into v_changed
    from jsonb_each(to_jsonb(new)) n
   where not (n.key = any (tg_argv))
     and n.value is distinct from (to_jsonb(old) -> n.key);
  if v_changed is not null then
    raise exception 'pos.%: column(s) % are immutable', tg_table_name, v_changed using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ── Jobs: reference, insert status, transitions ────────────────────────────────────────────────
create function pos.next_job_reference() returns text language sql volatile set search_path = '' as $$
  select 'POS-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYYY') || '-'
         || lpad(nextval('pos.job_reference_seq')::text, 6, '0');
$$;

create function pos.tg_job_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'pos.jobs: a new job starts in PENDING (got %)', new.status using errcode = 'P0001';
    end if;
    if new.reference is null then
      new.reference := pos.next_job_reference();
    end if;
    return new;
  end if;

  if new.id <> old.id or new.reference <> old.reference or new.bank_id <> old.bank_id
     or new.created_at <> old.created_at or new.created_by is distinct from old.created_by then
    raise exception 'pos.jobs: id, reference, bank, created_* are immutable' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    if not exists (select 1 from pos.job_transitions t
                    where t.from_status = old.status and t.to_status = new.status) then
      raise exception 'pos.jobs: transition % → % is not allowed (docs/06 §2)', old.status, new.status
        using errcode = 'P0001';
    end if;
    new.status_changed_at := now();
    if new.status = 'closed' then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  end if;
  return new;
end $$;

-- ── Inspections: insert statuses, transitions, sealing ─────────────────────────────────────────
create function pos.tg_inspection_guard() returns trigger language plpgsql set search_path = '' as $$
declare
  v_sealed constant pos.inspection_status[] :=
    array['submitted', 'verifying', 'integrity_failed', 'under_review', 'approved', 'returned', 'rejected', 'abandoned']::pos.inspection_status[];
  v_allowed_after_seal constant text[] :=
    array['status', 'evidence_expected', 'evidence_received', 'evidence_verified', 'flags', 'updated_at'];
  v_ok boolean;
  v_changed text;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('in_progress', 'submitted', 'abandoned') then
      raise exception 'pos.inspections: cannot be created as %', new.status using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    v_ok := (old.status, new.status) in (
      ('in_progress', 'paused'), ('paused', 'in_progress'),
      ('in_progress', 'submitted'), ('paused', 'submitted'),
      ('in_progress', 'abandoned'), ('paused', 'abandoned'),
      ('submitted', 'verifying'), ('submitted', 'under_review'), ('submitted', 'integrity_failed'),
      ('verifying', 'under_review'), ('verifying', 'integrity_failed'),
      ('under_review', 'integrity_failed'),
      ('submitted', 'approved'), ('submitted', 'returned'), ('submitted', 'rejected'),
      ('verifying', 'approved'), ('verifying', 'returned'), ('verifying', 'rejected'),
      ('under_review', 'approved'), ('under_review', 'returned'), ('under_review', 'rejected'),
      ('integrity_failed', 'approved'), ('integrity_failed', 'returned'), ('integrity_failed', 'rejected')
    );
    if not v_ok then
      raise exception 'pos.inspections: transition % → % is not allowed', old.status, new.status
        using errcode = 'P0001';
    end if;
  end if;

  -- Immutable once sealed (status ≥ submitted, or abandoned): only whitelisted server-side columns change.
  if old.status = any (v_sealed) then
    select string_agg(n.key, ', ' order by n.key) into v_changed
      from jsonb_each(to_jsonb(new)) n
     where not (n.key = any (v_allowed_after_seal))
       and n.value is distinct from (to_jsonb(old) -> n.key);
    if v_changed is not null then
      raise exception 'pos.inspections: sealed inspection — column(s) % are immutable', v_changed
        using errcode = 'P0001';
    end if;
  elsif new.job_id <> old.job_id or new.attempt <> old.attempt or new.user_id <> old.user_id
        or new.device_id <> old.device_id then
    raise exception 'pos.inspections: job, attempt, user and device are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ── Assignments: one response per assignment (docs/12 §15) ─────────────────────────────────────
create function pos.tg_assignment_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.job_id <> old.job_id or new.user_id <> old.user_id or new.assigned_at <> old.assigned_at then
    raise exception 'pos.job_assignments: job, user and assigned_at are immutable' using errcode = 'P0001';
  end if;
  if new.response is distinct from old.response
     and not ((old.response = 'pending' and new.response in ('accepted', 'rejected', 'expired', 'revoked'))
              or (old.response = 'accepted' and new.response = 'revoked')) then
    raise exception 'pos.job_assignments: response % → % is not allowed', old.response, new.response
      using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ── Audit log with hash chain ──────────────────────────────────────────────────────────────────
-- hash = sha256(prev_hash | table | row_id | action | before | after | epoch(at)). Trigger arguments name
-- large columns to leave out of before/after (payloads, answers, definitions); the domain rows keep them.
create function pos.audit_hash(p_prev text, p_table text, p_row text, p_action text,
                               p_before jsonb, p_after jsonb, p_at timestamptz)
returns text language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(
    coalesce(p_prev, '') || '|' || p_table || '|' || coalesce(p_row, '') || '|' || p_action || '|'
    || coalesce(p_before::text, '') || '|' || coalesce(p_after::text, '') || '|' || extract(epoch from p_at)::text,
    'UTF8')), 'hex');
$$;

create function pos.tg_audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_row    text;
  v_prev   text;
  v_at     timestamptz := clock_timestamp();
  v_actor  uuid;
  v_role   text;
begin
  if tg_op <> 'INSERT' then v_before := to_jsonb(old) - tg_argv; end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new) - tg_argv; end if;
  v_row := coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'code', v_before ->> 'code',
                    v_after ->> 'key', v_before ->> 'key');
  v_actor := nullif(current_setting('pos.actor_id', true), '')::uuid;
  v_role := nullif(current_setting('pos.actor_role', true), '');
  if v_actor is null then
    v_actor := pos.current_user_id();
    v_role := coalesce(v_role, pos.current_pos_role()::text);
  end if;

  perform pg_advisory_xact_lock(hashtext('pos.audit_log.chain'));
  select a.hash into v_prev from pos.audit_log a order by a.seq desc limit 1;

  insert into pos.audit_log (table_name, row_id, action, actor_id, actor_role, before, after, at, request_id, prev_hash, hash)
  values (tg_table_name, v_row, tg_op, v_actor, v_role, v_before, v_after, v_at,
          nullif(current_setting('pos.request_id', true), ''), v_prev,
          pos.audit_hash(v_prev, tg_table_name, v_row, tg_op, v_before, v_after, v_at));
  return null;
end $$;

-- ── Attach triggers ────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
  append_only constant text[] := array[
    'definition_versions', 'definition_activations', 'approvals', 'definition_test_runs', 'definition_assets',
    'lookup_list_versions', 'declarations', 'remote_config_versions', 'config_snapshots',
    'location_traces', 'reviews', 'amendments', 'evidence_replicas', 'form_submissions',
    'job_events', 'appointment_attempts', 'custody_events', 'device_sync_reports', 'ingest_conflicts',
    'client_error_reports', 'auth_events', 'audit_log', 'job_transitions'];
  mutable constant text[] := array[
    'settings', 'banks', 'pos_users', 'mcc_codes', 'reason_codes', 'lookup_lists', 'module_releases',
    'trusted_issuers', 'external_identities', 'devices', 'pos_sessions', 'definition_families',
    'definition_test_cases', 'ingest_envelopes', 'device_sync_status', 'server_epoch', 'alerts',
    'jobs', 'job_assignments', 'session_tokens', 'agent_card_tokens', 'inspections', 'evidence',
    'notifications', 'exports', 'api_keys'];
begin
  foreach t in array append_only loop
    execute format('create trigger append_only before update or delete on pos.%I for each row execute function pos.tg_append_only()', t);
    execute format('create trigger append_only_truncate before truncate on pos.%I for each statement execute function pos.tg_append_only()', t);
  end loop;

  foreach t in array mutable loop
    execute format('create trigger no_delete before delete on pos.%I for each row execute function pos.tg_no_delete()', t);
    execute format('create trigger no_truncate before truncate on pos.%I for each statement execute function pos.tg_no_delete()', t);
  end loop;

  for t in select c.table_name from information_schema.columns c
            where c.table_schema = 'pos' and c.column_name = 'updated_at' loop
    execute format('create trigger touch_updated_at before update on pos.%I for each row execute function pos.tg_touch_updated_at()', t);
  end loop;
end $$;

-- Audit: every mutable table (large payload columns excluded from before/after).
create trigger audit after insert or update or delete on pos.settings for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.banks for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.pos_users for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.mcc_codes for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.reason_codes for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.lookup_lists for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.module_releases for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.trusted_issuers for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.external_identities for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.devices for each row execute function pos.tg_audit('push_token');
create trigger audit after insert or update or delete on pos.pos_sessions for each row execute function pos.tg_audit('refresh_token_hash');
create trigger audit after insert or update or delete on pos.definition_families for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.definition_drafts for each row execute function pos.tg_audit('definition');
create trigger audit after insert or update or delete on pos.definition_test_cases for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.ingest_envelopes for each row execute function pos.tg_audit('payload', 'wrapper', 'result');
create trigger audit after insert or update or delete on pos.device_sync_status for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.server_epoch for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.alerts for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.jobs for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.job_assignments for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.session_tokens for each row execute function pos.tg_audit('token_hash');
create trigger audit after insert or update or delete on pos.agent_card_tokens for each row execute function pos.tg_audit('token_hash');
create trigger audit after insert or update or delete on pos.inspections for each row
  execute function pos.tg_audit('answers', 'snapshot_answers', 'context_snapshot', 'manifest', 'diagnostics', 'unable_answers');
create trigger audit after insert or update or delete on pos.evidence for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.notifications for each row execute function pos.tg_audit('payload');
create trigger audit after insert or update or delete on pos.exports for each row execute function pos.tg_audit();
create trigger audit after insert or update or delete on pos.api_keys for each row execute function pos.tg_audit('key_hash');

-- Guards and whitelists.
create trigger job_guard before insert or update on pos.jobs for each row execute function pos.tg_job_guard();
create trigger inspection_guard before insert or update on pos.inspections for each row execute function pos.tg_inspection_guard();
create trigger assignment_guard before update on pos.job_assignments for each row execute function pos.tg_assignment_guard();
create trigger column_whitelist before update on pos.evidence for each row execute function pos.tg_column_whitelist(
  'sha256_server', 'integrity_verified', 'upload_state', 'replica_state', 'uploaded_at', 'verified_at',
  'quarantined_reason', 'in_manifest', 'bytes', 'updated_at');
create trigger column_whitelist before update on pos.ingest_envelopes for each row execute function pos.tg_column_whitelist(
  'state', 'duplicate_of', 'last_request_id', 'last_seen_at', 'attempts', 'waiting_on', 'result', 'error',
  'processed_at', 'resolution', 'resolved_by', 'resolved_at', 'resolution_note', 'updated_at');
create trigger column_whitelist before update on pos.session_tokens for each row execute function pos.tg_column_whitelist(
  'used_at', 'used_by_inspection_id', 'revoked_at', 'revoke_reason', 'updated_at');
create trigger column_whitelist before update on pos.agent_card_tokens for each row execute function pos.tg_column_whitelist(
  'revoked_at', 'revoke_reason', 'updated_at');
