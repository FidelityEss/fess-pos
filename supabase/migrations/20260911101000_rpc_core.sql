-- FESS POS — pos_rpc core helpers shared by admin, ingest, sync and worker functions.
-- Conventions (docs/03 §4, DEVELOPMENT-GUIDELINES §2):
--   * The POS API opens a transaction, SET LOCAL ROLE service_role, calls pos_rpc.set_context(actor, role, request_id),
--     then exactly ONE pos_rpc function per operation. Every function takes the actor explicitly and re-checks it.
--   * Errors: pos_rpc.fail(code, message, details) raises SQLSTATE P0001 with HINT 'POS:<code>' and DETAIL = details JSON.
--     The API maps the code to an HTTP status and a `retryable` flag (supabase/functions/_shared/errors.ts).
--   * Async work is enqueued with pos_rpc.enqueue() in the same transaction (docs/12 §8).

create function pos_rpc.fail(p_code text, p_message text, p_details jsonb default null)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_message
    using errcode = 'P0001', hint = 'POS:' || p_code, detail = coalesce(p_details::text, '');
end $$;

create function pos_rpc.enqueue(p_queue text, p_message jsonb, p_delay_s integer default 0)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  select pgmq.send(p_queue, p_message, p_delay_s) into v_id;
  return v_id;
end $$;

create function pos_rpc.alert(p_kind text, p_severity pos.alert_severity, p_message text,
                              p_subject_type text default null, p_subject_id uuid default null,
                              p_bank_id uuid default null, p_detail jsonb default '{}'::jsonb,
                              p_dedupe_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into pos.alerts (kind, severity, message, subject_type, subject_id, bank_id, detail, dedupe_key)
  values (p_kind, p_severity, p_message, p_subject_type, p_subject_id, p_bank_id, coalesce(p_detail, '{}'::jsonb), p_dedupe_key)
  on conflict (dedupe_key) where acknowledged_at is null do nothing
  returning id into v_id;
  return v_id;
end $$;

create function pos_rpc.custody(p_subject pos.custody_subject, p_subject_id uuid, p_event text,
                                p_source pos.custody_source default 'server', p_device_id uuid default null,
                                p_envelope_id uuid default null, p_detail jsonb default '{}'::jsonb,
                                p_at_device timestamptz default null, p_monotonic_ms bigint default null)
returns void language sql security definer set search_path = '' as $$
  insert into pos.custody_events (subject_type, subject_id, event, source, device_id, envelope_id, detail,
                                  at_device, monotonic_ms, request_id)
  values (p_subject, p_subject_id, p_event, p_source, p_device_id, p_envelope_id, coalesce(p_detail, '{}'::jsonb),
          p_at_device, p_monotonic_ms, nullif(current_setting('pos.request_id', true), ''));
$$;

-- Notifications: row + queue message in the caller's transaction. Push payloads are content-free hints (07 §8);
-- email text comes from content definitions rendered by the notify worker (06 §5).
create function pos_rpc.notify(p_user_id uuid, p_channel pos.notification_channel, p_template_key text,
                               p_payload jsonb, p_subject_type text, p_subject_id uuid, p_email text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into pos.notifications (recipient_user_id, recipient_email, channel, template_key, payload, subject_type, subject_id)
  values (p_user_id, p_email, p_channel, p_template_key, coalesce(p_payload, '{}'::jsonb), p_subject_type, p_subject_id)
  returning id into v_id;
  perform pos_rpc.enqueue('notify', jsonb_build_object('notification_id', v_id));
  return v_id;
end $$;

-- Agent notification per the matrix in docs/06 §5. `p_event` e.g. 'job_assigned'.
create function pos_rpc.notify_agent(p_user_id uuid, p_event text, p_job_id uuid, p_push boolean, p_email boolean,
                                     p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_push then
    perform pos_rpc.notify(p_user_id, 'push', 'notify.' || p_event || '.push',
                           jsonb_build_object('source', 'fess_pos', 'kind', 'sync', 'hint', p_event),
                           'job', p_job_id);
  end if;
  if p_email then
    perform pos_rpc.notify(p_user_id, 'email', 'notify.' || p_event || '.email',
                           jsonb_build_object('job_id', p_job_id) || coalesce(p_extra, '{}'::jsonb), 'job', p_job_id);
  end if;
end $$;

-- Admin notification: email to every active admin holding the permission within the bank's scope, plus a
-- dashboard badge (alert). Returns the number of recipients.
create function pos_rpc.notify_admins(p_bank_id uuid, p_permission text, p_event text, p_subject_type text,
                                      p_subject_id uuid, p_extra jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user pos.pos_users;
  v_n integer := 0;
begin
  for v_user in
    select * from pos.pos_users u
     where u.active and u.role = 'pos_admin'
       and (p_permission is null or p_permission = any (u.permissions))
       and (u.bank_ids is null or p_bank_id is null or p_bank_id = any (u.bank_ids))
  loop
    perform pos_rpc.notify(v_user.id, 'email', 'notify.' || p_event || '.email',
                           jsonb_build_object('subject_id', p_subject_id) || coalesce(p_extra, '{}'::jsonb),
                           p_subject_type, p_subject_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create function pos_rpc.job_event(p_job_id uuid, p_type text, p_actor_id uuid, p_actor_role text,
                                  p_from pos.job_status, p_to pos.job_status, p_verdict text default 'applied',
                                  p_reason_code text default null, p_note text default null,
                                  p_payload jsonb default '{}'::jsonb, p_envelope_id uuid default null,
                                  p_device_id uuid default null, p_client_created_at timestamptz default null,
                                  p_client_monotonic_ms bigint default null, p_form_version_id uuid default null,
                                  p_form_answers jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into pos.job_events (job_id, type, actor_id, actor_role, from_status, to_status, verdict, reason_code, note,
                              payload, envelope_id, device_id, client_created_at, client_monotonic_ms,
                              form_version_id, form_answers, request_id)
  values (p_job_id, p_type, p_actor_id, p_actor_role, p_from, p_to, p_verdict, p_reason_code, p_note,
          coalesce(p_payload, '{}'::jsonb), p_envelope_id, p_device_id, p_client_created_at, p_client_monotonic_ms,
          p_form_version_id, p_form_answers, nullif(current_setting('pos.request_id', true), ''))
  returning id into v_id;
  return v_id;
end $$;

-- The single path for job status changes. Locks the job, checks the transition for this actor kind against
-- pos.job_transitions (docs/06 §2), updates, and writes the timeline event. The trigger is the final guard.
create function pos_rpc.transition_job(p_job_id uuid, p_to pos.job_status, p_actor_kind text, p_actor_id uuid,
                                       p_event_type text, p_reason_code text default null, p_note text default null,
                                       p_payload jsonb default '{}'::jsonb, p_envelope_id uuid default null,
                                       p_device_id uuid default null, p_client_created_at timestamptz default null,
                                       p_client_monotonic_ms bigint default null, p_form_version_id uuid default null,
                                       p_form_answers jsonb default null)
returns pos.jobs language plpgsql security definer set search_path = '' as $$
declare
  v_job pos.jobs;
  v_from pos.job_status;
begin
  select * into v_job from pos.jobs where id = p_job_id for update;
  if not found then
    perform pos_rpc.fail('NOT_FOUND', 'job not found', jsonb_build_object('job_id', p_job_id));
  end if;
  v_from := v_job.status;
  if not exists (select 1 from pos.job_transitions t
                  where t.from_status = v_from and t.to_status = p_to and t.actor = p_actor_kind) then
    perform pos_rpc.fail('INVALID_TRANSITION',
      format('job %s: %s → %s is not allowed for %s', v_job.reference, v_from, p_to, p_actor_kind),
      jsonb_build_object('job_id', p_job_id, 'from', v_from, 'to', p_to, 'actor', p_actor_kind));
  end if;
  update pos.jobs set status = p_to where id = p_job_id returning * into v_job;
  perform pos_rpc.job_event(p_job_id, p_event_type, p_actor_id, p_actor_kind, v_from, p_to, 'applied', p_reason_code,
                            p_note, p_payload, p_envelope_id, p_device_id, p_client_created_at, p_client_monotonic_ms,
                            p_form_version_id, p_form_answers);
  return v_job;
end $$;

create function pos_rpc.can_transition(p_from pos.job_status, p_to pos.job_status, p_actor_kind text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from pos.job_transitions t where t.from_status = p_from and t.to_status = p_to and t.actor = p_actor_kind);
$$;

-- Re-check an admin actor (the API authenticated them; the database checks again).
create function pos_rpc.require_staff(p_actor uuid, p_permission text default null, p_bank_id uuid default null)
returns pos.pos_users language plpgsql stable security definer set search_path = '' as $$
declare v_user pos.pos_users;
begin
  select * into v_user from pos.pos_users where id = p_actor;
  if not found or not v_user.active or v_user.role <> 'pos_admin' then
    perform pos_rpc.fail('FORBIDDEN', 'not an active POS admin');
  end if;
  if p_permission is not null and not (p_permission = any (v_user.permissions)) then
    perform pos_rpc.fail('FORBIDDEN', format('missing permission %s', p_permission), jsonb_build_object('permission', p_permission));
  end if;
  if p_bank_id is not null and v_user.bank_ids is not null and not (p_bank_id = any (v_user.bank_ids)) then
    perform pos_rpc.fail('FORBIDDEN', 'bank outside your scope', jsonb_build_object('bank_id', p_bank_id));
  end if;
  return v_user;
end $$;

-- Reason code check: active, right category, global or the job's bank.
create function pos_rpc.require_reason(p_category pos.reason_category, p_code text, p_bank_id uuid, p_note text default null)
returns pos.reason_codes language plpgsql stable security definer set search_path = '' as $$
declare v_rc pos.reason_codes;
begin
  select * into v_rc from pos.reason_codes r
   where r.category = p_category and r.code = p_code and r.active and (r.bank_id is null or r.bank_id = p_bank_id)
   order by r.bank_id nulls last limit 1;
  if not found then
    perform pos_rpc.fail('INVALID_REASON', format('unknown %s reason code %s', p_category, p_code),
                         jsonb_build_object('category', p_category, 'code', p_code));
  end if;
  if v_rc.requires_note and coalesce(btrim(p_note), '') = '' then
    perform pos_rpc.fail('NOTE_REQUIRED', format('reason %s requires a note', p_code), jsonb_build_object('code', p_code));
  end if;
  return v_rc;
end $$;

-- ── JSON helpers ───────────────────────────────────────────────────────────────────────────────
create function pos.jsonb_deep_merge(p_a jsonb, p_b jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_out jsonb;
  v_key text;
begin
  if p_b is null then return p_a; end if;
  if p_a is null or jsonb_typeof(p_a) <> 'object' or jsonb_typeof(p_b) <> 'object' then return p_b; end if;
  v_out := p_a;
  for v_key in select jsonb_object_keys(p_b) loop
    v_out := jsonb_set(v_out, array[v_key], pos.jsonb_deep_merge(p_a -> v_key, p_b -> v_key), true);
  end loop;
  return v_out;
end $$;

create function pos.sha256_hex(p_text text) returns text language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(p_text, 'UTF8')), 'hex');
$$;

create function pos.random_token_hex(p_bytes integer default 32) returns text language sql volatile set search_path = '' as $$
  select encode(extensions.gen_random_bytes(p_bytes), 'hex');
$$;

-- ── Definition resolution (docs/04 §2, §7) ─────────────────────────────────────────────────────
create function pos.audience_matches(p_audience jsonb, p_user_id uuid, p_attributes jsonb, p_family_id uuid)
returns boolean language sql immutable set search_path = '' as $$
  select case p_audience ->> 'type'
    when 'all' then true
    when 'agents' then coalesce(p_audience -> 'user_ids' ? p_user_id::text, false)
    when 'percent' then (abs(hashtext(p_user_id::text || ':' || p_family_id::text)) % 100)
                        < coalesce((p_audience ->> 'percent')::int, 0)
    when 'attribute' then coalesce((p_audience -> 'values') ? (p_attributes ->> (p_audience ->> 'key')), false)
    else false
  end;
$$;

-- Version of a family in force for a user now: newest activation in window whose audience matches.
create function pos.resolve_definition_version(p_family_id uuid, p_user_id uuid, p_at timestamptz default now())
returns uuid language sql stable set search_path = '' as $$
  select a.version_id
    from pos.definition_activations a
    left join pos.pos_users u on u.id = p_user_id
   where a.family_id = p_family_id
     and a.effective_from <= p_at
     and (a.effective_to is null or a.effective_to > p_at)
     and pos.audience_matches(a.audience, p_user_id, coalesce(u.attributes, '{}'::jsonb), a.family_id)
   order by a.effective_from desc, a.created_at desc
   limit 1;
$$;

-- For a user and bank: every definition kind/key resolved, bank family overriding the global one (B4.4).
create function pos.resolve_definitions(p_user_id uuid, p_bank_id uuid default null)
returns table (family_id uuid, kind pos.definition_kind, key text, bank_id uuid, version_id uuid)
language sql stable set search_path = '' as $$
  with fams as (
    select distinct on (f.kind, f.key) f.*
      from pos.definition_families f
     where f.bank_id is null or f.bank_id = p_bank_id
     order by f.kind, f.key, (f.bank_id is null)                 -- bank family first
  )
  select f.id, f.kind, f.key, f.bank_id, pos.resolve_definition_version(f.id, p_user_id)
    from fams f
   where pos.resolve_definition_version(f.id, p_user_id) is not null;
$$;

-- ── Remote config resolution (docs/13 §5): global → bank → agent → device; frozen as a snapshot ──
create function pos_rpc.resolve_config(p_user_id uuid, p_device_id uuid, p_bank_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_values jsonb := '{}'::jsonb;
  v_sources uuid[] := '{}';
  v_row pos.remote_config_versions;
  v_hash text;
  v_id uuid;
begin
  for v_row in
    with latest as (
      select distinct on (r.layer) r.*
        from pos.remote_config_versions r
       where r.effective_from <= now()
         and ((r.layer = 'global')
              or (r.layer = 'bank' and r.subject_id = p_bank_id)
              or (r.layer = 'agent' and r.subject_id = p_user_id)
              or (r.layer = 'device' and r.subject_id = p_device_id))
       order by r.layer, r.version desc)
    select * from latest
     order by case layer when 'global' then 1 when 'bank' then 2 when 'agent' then 3 else 4 end
  loop
    v_values := pos.jsonb_deep_merge(v_values, v_row.values);
    v_sources := v_sources || v_row.id;
  end loop;

  v_hash := pos.sha256_hex(v_values::text);
  insert into pos.config_snapshots (hash, values, source_versions)
  values (v_hash, v_values, v_sources)
  on conflict (hash) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from pos.config_snapshots where hash = v_hash;
  end if;
  return jsonb_build_object('config_version_id', v_id, 'values', v_values);
end $$;

-- A single typed value from the resolved global config (server-side policy reads, e.g. timeouts).
create function pos.config_value(p_path text[], p_default jsonb default null)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce((select r.values #> p_path
                     from pos.remote_config_versions r
                    where r.layer = 'global' and r.effective_from <= now()
                    order by r.version desc limit 1), p_default);
$$;
