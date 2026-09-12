-- FESS POS — queue workers, evidence verification/replication, notifications, cron (docs/12 §6–9).
-- Workers are edge functions kicked by pg_cron; the queue (pgmq) is the reliability mechanism, the HTTP kick is
-- best-effort. Messages are deleted only after the effect commits; exhausted retries dead-letter + alert.

-- ── Queue operations ───────────────────────────────────────────────────────────────────────────
create function pos_rpc.queue_read(p_queue text, p_vt_seconds integer, p_qty integer)
returns table (msg_id bigint, read_ct integer, enqueued_at timestamptz, message jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  return query select m.msg_id, m.read_ct, m.enqueued_at, m.message from pgmq.read(p_queue, p_vt_seconds, p_qty) m;
end $$;

create function pos_rpc.queue_ack(p_queue text, p_msg_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v boolean;
begin
  select pgmq.delete(p_queue, p_msg_id) into v;
  return v;
end $$;

create function pos_rpc.queue_retry(p_queue text, p_msg_id bigint, p_delay_s integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pgmq.set_vt(p_queue, p_msg_id, p_delay_s);
end $$;

create function pos_rpc.queue_dead_letter(p_queue text, p_msg_id bigint, p_message jsonb, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pgmq.send(p_queue || '_dlq', coalesce(p_message, '{}'::jsonb)
                    || jsonb_build_object('dead_lettered_at', now(), 'error', p_error, 'source_msg_id', p_msg_id));
  perform pgmq.delete(p_queue, p_msg_id);
  perform pos_rpc.alert('dead_letter', 'critical', format('Queue %s dead-lettered a message: %s', p_queue, left(p_error, 200)),
                        'queue', null, null, jsonb_build_object('queue', p_queue, 'message', p_message),
                        'dead_letter:' || p_queue || ':' || p_msg_id::text);
end $$;

create function pos_rpc.queue_depths()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := '{}'::jsonb;
  q text;
  n bigint;
begin
  foreach q in array array['verify_evidence', 'replicate_evidence', 'notify', 'export', 'reprocess_envelopes',
                           'verify_evidence_dlq', 'replicate_evidence_dlq', 'notify_dlq', 'export_dlq', 'reprocess_envelopes_dlq'] loop
    execute format('select count(*) from pgmq.%I', 'q_' || q) into n;
    v := v || jsonb_build_object(q, n);
  end loop;
  return v;
end $$;

-- ── Evidence verification & replication ────────────────────────────────────────────────────────
create function pos_rpc.evidence_for_worker(p_evidence_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'inspection_id', e.inspection_id, 'job_id', e.job_id, 'storage_path', e.storage_path,
                            'sha256_client', e.sha256_client, 'upload_state', e.upload_state, 'replica_state', e.replica_state,
                            'mime', e.mime, 'bytes', e.bytes)
    from pos.evidence e where e.id = p_evidence_id;
$$;

-- Result of recomputing SHA-256 on the stored object (07 §4 step 6).
create function pos_rpc.evidence_verified(p_evidence_id uuid, p_sha256_server text, p_bytes bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.evidence;
  v_job pos.jobs;
begin
  select * into v from pos.evidence where id = p_evidence_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'evidence not found'); end if;
  if v.upload_state in ('verified', 'quarantined') then
    return jsonb_build_object('upload_state', v.upload_state, 'changed', false);
  end if;
  select * into v_job from pos.jobs where id = v.job_id;

  if p_sha256_server = v.sha256_client then
    update pos.evidence set upload_state = 'verified', sha256_server = p_sha256_server, integrity_verified = true,
                            verified_at = now(), bytes = coalesce(p_bytes, bytes)
     where id = v.id;
    perform pos_rpc.custody('evidence', v.id, 'verified', 'server', null, null, jsonb_build_object('sha256', p_sha256_server));
    perform pos_rpc.enqueue('replicate_evidence', jsonb_build_object('evidence_id', v.id));
  else
    update pos.evidence set upload_state = 'quarantined', sha256_server = p_sha256_server, integrity_verified = false,
                            quarantined_reason = 'hash_mismatch', bytes = coalesce(p_bytes, bytes)
     where id = v.id;
    perform pos_rpc.custody('evidence', v.id, 'quarantined', 'server', null, null,
                            jsonb_build_object('expected', v.sha256_client, 'actual', p_sha256_server));
    update pos.inspections set flags = pos.array_union(flags, array['evidence_quarantined']) where id = v.inspection_id;
    perform pos_rpc.alert('evidence_quarantined', 'critical', format('Evidence hash mismatch on %s', v_job.reference),
                          'evidence', v.id, v_job.bank_id, jsonb_build_object('inspection_id', v.inspection_id),
                          'evidence_quarantined:' || v.id::text);
  end if;
  perform pos_rpc.recount_evidence(v.inspection_id);
  perform pos_rpc.promote_inspection(v.inspection_id);
  select * into v from pos.evidence where id = p_evidence_id;
  return jsonb_build_object('upload_state', v.upload_state, 'changed', true);
end $$;

create function pos_rpc.evidence_replicated(p_evidence_id uuid, p_target text, p_path text, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.evidence;
begin
  select * into v from pos.evidence where id = p_evidence_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'evidence not found'); end if;
  if p_sha256 <> coalesce(v.sha256_server, v.sha256_client) then
    update pos.evidence set replica_state = 'failed' where id = v.id;
    perform pos_rpc.alert('replica_mismatch', 'critical', 'Replica hash does not match verified evidence', 'evidence', v.id,
                          null, jsonb_build_object('target', p_target), 'replica_mismatch:' || v.id::text);
    return jsonb_build_object('replica_state', 'failed');
  end if;
  insert into pos.evidence_replicas (evidence_id, target, path, sha256_verified)
  values (v.id, p_target, p_path, p_sha256) on conflict (evidence_id, target) do nothing;
  update pos.evidence set replica_state = 'replicated' where id = v.id;
  perform pos_rpc.custody('evidence', v.id, 'replicated', 'server', null, null, jsonb_build_object('target', p_target));
  return jsonb_build_object('replica_state', 'replicated');
end $$;

-- Safety net (12 §6 step 4): evidence still `pending` after 5 min is re-checked by the worker against storage.
create function pos_rpc.evidence_sweep_candidates(p_limit integer default 50)
returns table (evidence_id uuid, storage_path text) language sql stable security definer set search_path = '' as $$
  select e.id, e.storage_path from pos.evidence e
   where e.upload_state = 'pending' and e.created_at < now() - interval '5 minutes'
   order by e.created_at limit p_limit;
$$;

-- Found in storage although the device's evidence_uploaded hasn't arrived: treat as uploaded.
create function pos_rpc.evidence_mark_uploaded(p_evidence_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v pos.evidence;
begin
  select * into v from pos.evidence where id = p_evidence_id for update;
  if found and v.upload_state = 'pending' then
    update pos.evidence set upload_state = 'uploaded', uploaded_at = now() where id = v.id;
    perform pos_rpc.custody('evidence', v.id, 'uploaded', 'server', null, null, jsonb_build_object('via', 'sweeper'));
    perform pos_rpc.enqueue('verify_evidence', jsonb_build_object('evidence_id', v.id));
    perform pos_rpc.recount_evidence(v.inspection_id);
  end if;
end $$;

-- ── Notifications ──────────────────────────────────────────────────────────────────────────────
create function pos_rpc.notification_for_send(p_notification_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'notification', to_jsonb(n),
    'recipient', case when u.id is null then jsonb_build_object('email', n.recipient_email)
                      else jsonb_build_object('id', u.id, 'email', coalesce(n.recipient_email, u.email), 'first_name', u.first_name,
                                              'last_name', u.last_name, 'role', u.role) end,
    'push_targets', coalesce((select jsonb_agg(jsonb_build_object('provider', d.push_provider, 'token', d.push_token))
                                from pos.devices d where d.user_id = u.id and d.push_token is not null and d.revoked_at is null), '[]'::jsonb),
    'job', (select jsonb_build_object('id', j.id, 'reference', j.reference, 'merchant_name', j.merchant_name, 'bank_id', j.bank_id,
                                      'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end, 'status', j.status)
              from pos.jobs j where n.subject_type = 'job' and j.id = n.subject_id))
    from pos.notifications n left join pos.pos_users u on u.id = n.recipient_user_id
   where n.id = p_notification_id;
$$;

-- Merged content strings for a bank (global content families, bank families override), audience "all" only.
create function pos_rpc.content_bundle(p_bank_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb := '{}'::jsonb;
  r record;
begin
  for r in
    select v2.definition
      from pos.definition_families f
      join lateral (
        select a.version_id from pos.definition_activations a
         where a.family_id = f.id and a.effective_from <= now() and (a.effective_to is null or a.effective_to > now())
           and a.audience ->> 'type' = 'all'
         order by a.effective_from desc, a.created_at desc limit 1) act on true
      join pos.definition_versions v2 on v2.id = act.version_id
     where f.kind = 'content' and (f.bank_id is null or f.bank_id = p_bank_id)
     order by (f.bank_id is not null), f.key
  loop
    v := v || coalesce(r.definition -> 'strings', '{}'::jsonb);
  end loop;
  return v;
end $$;

create function pos_rpc.notification_result(p_notification_id uuid, p_ok boolean, p_provider text, p_provider_ref text,
                                            p_error text, p_final boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update pos.notifications
     set state = case when p_ok then 'sent'::pos.notification_state
                      when p_final then 'dead'::pos.notification_state else 'failed'::pos.notification_state end,
         attempts = attempts + 1, provider = p_provider, provider_ref = coalesce(p_provider_ref, provider_ref),
         last_error = case when p_ok then null else left(p_error, 1000) end,
         sent_at = case when p_ok then now() else sent_at end
   where id = p_notification_id;
end $$;

-- ── Worker authentication (pg_cron → workers function) ─────────────────────────────────────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'pos_worker_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'pos_worker_key',
                                'Shared secret pg_cron sends to the workers edge function (x-pos-worker-key)');
  end if;
end $$;

create function pos_rpc.worker_key_valid(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.decrypted_secret = p_key from vault.decrypted_secrets s where s.name = 'pos_worker_key'), false);
$$;

create function pos_rpc.cron_kick_workers(p_task text default 'drain')
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_base text := (select s.value #>> '{}' from pos.settings s where s.key = 'api.base_url');
  v_key text := (select d.decrypted_secret from vault.decrypted_secrets d where d.name = 'pos_worker_key');
begin
  if v_base is null or v_key is null then
    return null;  -- environment not wired yet (see pos.settings 'api.base_url')
  end if;
  return net.http_post(
    url := v_base || '/workers',
    body := jsonb_build_object('task', p_task),
    headers := jsonb_build_object('content-type', 'application/json', 'x-pos-worker-key', v_key),
    timeout_milliseconds := 55000);
end $$;

-- ── SQL-only scheduled jobs ────────────────────────────────────────────────────────────────────
-- Assignment response timeout (06 §2: ASSIGNED → SCHEDULED by system; D-18 default 24 h, remote config).
create function pos_rpc.cron_expire_assignments()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_hours integer := coalesce((pos.config_value(array['assignment', 'response_timeout_h'], '24'::jsonb))::text::integer, 24);
  v_asg record;
  v_n integer := 0;
begin
  perform pos_rpc.set_context(null, 'system', 'cron:expire_assignments');
  for v_asg in
    select a.id as assignment_id, a.user_id, j.id as job_id, j.bank_id, j.reference
      from pos.job_assignments a join pos.jobs j on j.id = a.job_id
     where a.response = 'pending' and j.status = 'assigned' and a.assigned_at < now() - make_interval(hours => v_hours)
     for update of a, j skip locked
  loop
    update pos.job_assignments set response = 'expired', responded_at = now() where id = v_asg.assignment_id;
    perform pos_rpc.transition_job(v_asg.job_id, 'scheduled', 'system', null, 'assignment_expired', null, null,
                                   jsonb_build_object('assignment_id', v_asg.assignment_id, 'timeout_h', v_hours));
    update pos.jobs set assigned_to = null, assigned_at = null where id = v_asg.job_id;
    update pos.session_tokens set revoked_at = now(), revoke_reason = 'assignment_expired'
     where job_id = v_asg.job_id and used_at is null and revoked_at is null;
    perform pos_rpc.notify_admins(v_asg.bank_id, 'schedule_jobs', 'assignment_expired', 'job', v_asg.job_id,
                                  jsonb_build_object('job_reference', v_asg.reference));
    perform pos_rpc.alert('assignment_expired', 'warning', format('%s: agent did not respond in %s h', v_asg.reference, v_hours),
                          'job', v_asg.job_id, v_asg.bank_id, '{}'::jsonb, 'assignment_expired:' || v_asg.assignment_id::text);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Timeliness & custody alerts (12 §9; thresholds proposed pending D-34).
create function pos_rpc.cron_reconcile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_depths jsonb;
  v_dlq bigint;
begin
  perform pos_rpc.set_context(null, 'system', 'cron:reconcile');
  for r in select * from pos.device_sync_status s where s.oldest_pending_at < now() - interval '4 hours' loop
    perform pos_rpc.alert('device_backlog', case when r.oldest_pending_at < now() - interval '24 hours' then 'critical' else 'warning' end::pos.alert_severity,
                          'Device has items pending since ' || to_char(r.oldest_pending_at, 'YYYY-MM-DD HH24:MI'),
                          'device', r.device_id, null, jsonb_build_object('user_id', r.user_id, 'pending', r.pending),
                          'device_backlog:' || r.device_id::text);
  end loop;
  for r in select i.id, j.reference, j.bank_id, i.evidence_expected, i.evidence_verified from pos.inspections i join pos.jobs j on j.id = i.job_id
            where i.status in ('submitted', 'verifying') and i.submitted_at_server < now() - interval '6 hours' loop
    perform pos_rpc.alert('incomplete_manifest', 'warning',
                          format('%s: %s of %s evidence items verified after 6 h', r.reference, r.evidence_verified, r.evidence_expected),
                          'inspection', r.id, r.bank_id, '{}'::jsonb, 'incomplete_manifest:' || r.id::text);
  end loop;
  for r in select e.id, e.type from pos.ingest_envelopes e
            where e.state in ('received', 'deferred') and e.received_at < now() - interval '1 hour' loop
    perform pos_rpc.alert('envelope_stuck', 'warning', format('%s envelope not committed after 1 h', r.type),
                          'envelope', r.id, null, '{}'::jsonb, 'envelope_stuck:' || r.id::text);
  end loop;
  v_depths := pos_rpc.queue_depths();
  select coalesce(sum(value::text::bigint), 0) into v_dlq from jsonb_each(v_depths) where key like '%\_dlq';
  if v_dlq > 0 then
    perform pos_rpc.alert('dlq_depth', 'critical', format('%s dead-lettered message(s) waiting', v_dlq), 'queue', null, null,
                          v_depths, 'dlq_depth');
  end if;
  return v_depths;
end $$;

-- ── Schedules (pg_cron) ────────────────────────────────────────────────────────────────────────
select cron.schedule('pos-workers-drain', '15 seconds', $$ select pos_rpc.cron_kick_workers('drain') $$);
select cron.schedule('pos-expire-assignments', '*/5 * * * *', $$ select pos_rpc.cron_expire_assignments() $$);
select cron.schedule('pos-reconcile', '*/5 * * * *', $$ select pos_rpc.cron_reconcile() $$);
