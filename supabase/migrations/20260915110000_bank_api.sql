-- FESS POS — bank API keys and the bank read API (T6-06, D-100, B6.5, B6.9, docs/17 §4.2).
--
-- A bank's systems read that bank's inspections through the POS API (/v1/bank/*) with an API key an admin creates on the
-- bank's page. The key (fpos_<env>_<random>) is shown once; only its SHA-256 fingerprint and last four characters are
-- stored (pos.api_keys, which has existed empty since 20260911100600). Keys expire (12 months by default, 24 at most) and
-- can be switched off. Access is read-only and limited to the key's own bank, and by default to inspections that have
-- reached a decision; a bank's export_settings.api.inspection_statuses can widen that. Each key is rate-limited per minute,
-- and every call is recorded (pos.bank_api_calls, which the activity history also receives through its audit trigger).
--
-- Expand-only: new columns on an empty table, two new tables, new functions and settings rows. Reverse: drop the new
-- functions and tables; the new api_keys columns can stay (nullable).

-- ── Settings (fail closed when missing: pos_rpc.setting_int) ──────────────────────────────────
insert into pos.settings (key, value, note) values
  ('bank_api.rate_limit_per_minute', '60'::jsonb, 'Requests a minute each bank API key may make, unless the key has its own limit (D-100)'),
  ('bank_api.key_default_months', '12'::jsonb, 'How long a new bank API key works when the admin does not choose (D-100)'),
  ('bank_api.key_max_months', '24'::jsonb, 'The longest a bank API key may work (D-100)'),
  ('bank_api.default_statuses', '["approved", "rejected"]'::jsonb,
   'Inspection statuses a bank can read by default: those that have reached a decision (D-100). A bank widens it with '
   'banks.export_settings.api.inspection_statuses')
on conflict (key) do nothing;

create function pos_rpc.setting_int(p_key text, p_min integer, p_max integer)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare v integer;
begin
  select case when jsonb_typeof(s.value) = 'number' and (s.value)::text ~ '^[0-9]{1,9}$' then (s.value)::text::integer end
    into v from pos.settings s where s.key = p_key;
  if v is null or v < p_min or v > p_max then
    perform pos_rpc.fail('NOT_READY', format('%s must be a whole number from %s to %s', p_key, p_min, p_max));
  end if;
  return v;
end $$;

-- ── Keys ───────────────────────────────────────────────────────────────────────────────────────
alter table pos.api_keys
  add column last_four             text check (last_four ~ '^[A-Za-z0-9]{4}$'),
  add column expires_at            timestamptz,
  add column revoked_at            timestamptz,
  add column revoked_by            uuid references pos.pos_users (id),
  add column revoke_reason         text,
  add column rate_limit_per_minute integer check (rate_limit_per_minute between 1 and 6000),
  add column request_id            text,
  add constraint api_keys_key_hash_sha256 check (key_hash ~ '^[0-9a-f]{64}$'),
  add constraint api_keys_revoked_is_inactive check (revoked_at is null or not active);
comment on column pos.api_keys.key_hash is
  'SHA-256 of the whole key (fpos_<env>_<random>), lower-case hex. The key itself is shown once and never stored (D-100).';
comment on column pos.api_keys.label is 'The name the admin gave the key, e.g. "Ubuntu Bank nightly import".';
create index api_keys_bank_idx on pos.api_keys (bank_id, created_at desc);

-- Per-key request counts per minute (the rate limit). Operational counters: windows older than an hour are cleared by
-- pos_rpc.bank_key_authorize. Nobody reads them through the Data API.
create table pos.bank_api_usage (
  key_id       uuid not null references pos.api_keys (id),
  window_start timestamptz not null,
  requests     integer not null default 0,
  primary key (key_id, window_start)
);
alter table pos.bank_api_usage enable row level security;
grant select on pos.bank_api_usage to service_role;

-- Every call a bank makes, allowed or refused (D-100). Append-only; in the activity history through the audit trigger.
create table pos.bank_api_calls (
  id         uuid primary key default gen_random_uuid(),
  key_id     uuid not null references pos.api_keys (id),
  bank_id    uuid not null references pos.banks (id),
  at         timestamptz not null default now(),
  method     text not null check (length(method) <= 10),
  route      text not null check (length(route) <= 200),
  subject_id uuid,
  status     integer not null check (status between 100 and 599),
  items      integer check (items >= 0),
  request_id text,
  ip         text,
  user_agent text
);
create index bank_api_calls_key_idx on pos.bank_api_calls (key_id, at desc);
create index bank_api_calls_bank_idx on pos.bank_api_calls (bank_id, at desc);
create trigger append_only before update or delete on pos.bank_api_calls for each row execute function pos.tg_append_only();
create trigger append_only_truncate before truncate on pos.bank_api_calls for each statement execute function pos.tg_append_only();
create trigger audit after insert or update or delete on pos.bank_api_calls for each row execute function pos.tg_audit();
alter table pos.bank_api_calls enable row level security;
grant select on pos.bank_api_calls to authenticated, service_role;
create policy bank_api_calls_read on pos.bank_api_calls for select to authenticated using ((select pos.can_read_bank(bank_id)));

-- ── Helpers ────────────────────────────────────────────────────────────────────────────────────
create function pos_rpc.api_key_status(p pos.api_keys)
returns text language sql stable set search_path = '' as $$
  select case when p.revoked_at is not null or not p.active then 'revoked'
              when p.expires_at is null or p.expires_at <= now() then 'expired'
              else 'active' end;
$$;

-- A key as the admin sees it: never the fingerprint.
create function pos_rpc.api_key_json(p pos.api_keys)
returns jsonb language sql stable security definer set search_path = '' as $$
  select (to_jsonb(p) - 'key_hash' - 'scopes' - 'request_id')
         || jsonb_build_object('status', pos_rpc.api_key_status(p),
                               'created_by_name', (select btrim(u.first_name || ' ' || u.last_name) from pos.pos_users u where u.id = p.created_by),
                               'calls_last_24h', (select count(*) from pos.bank_api_calls c where c.key_id = p.id and c.at > now() - interval '24 hours'));
$$;

-- Inspection statuses a bank may read: the bank's export_settings.api.inspection_statuses, else the default. Only
-- statuses after submission are ever allowed. Fails closed on anything else.
create function pos_rpc.bank_api_statuses(p_bank_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
  v_out text[];
begin
  select b.export_settings #> '{api,inspection_statuses}' into v from pos.banks b where b.id = p_bank_id;
  if v is null or jsonb_typeof(v) <> 'array' then
    select s.value into v from pos.settings s where s.key = 'bank_api.default_statuses';
  end if;
  if v is null or jsonb_typeof(v) <> 'array' then perform pos_rpc.fail('NOT_READY', 'bank_api.default_statuses is not set'); end if;
  v_out := array(select jsonb_array_elements_text(v));
  if cardinality(v_out) = 0
     or not (v_out <@ array['submitted', 'verifying', 'integrity_failed', 'under_review', 'approved', 'returned', 'rejected']::text[]) then
    perform pos_rpc.fail('NOT_READY', 'the inspection statuses this bank may read are not valid (export_settings.api.inspection_statuses)');
  end if;
  return v_out;
end $$;

-- ── Admin: create, list, revoke (docs/03 §5: one pos_rpc.admin_* per write, actor and bank scope re-checked) ─────
-- The POS API makes the key and passes only its fingerprint and last four characters.
create function pos_rpc.admin_api_key_create(p_actor uuid, p_bank_id uuid, p_input jsonb, p_key_hash text, p_last_four text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.api_keys;
  v_months integer;
  v_max integer;
  v_limit integer;
begin
  if p_bank_id is null then perform pos_rpc.fail('INVALID_REQUEST', 'bank is required'); end if;
  perform pos_rpc.admin_require_bank(p_actor, p_bank_id);
  if not (select b.active from pos.banks b where b.id = p_bank_id) then
    perform pos_rpc.fail('CONFLICT', 'this bank is switched off; switch it on before giving it an API key');
  end if;
  if coalesce(p_key_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(p_last_four, '') !~ '^[A-Za-z0-9]{4}$' then
    perform pos_rpc.fail('INVALID_REQUEST', 'key fingerprint missing');
  end if;
  v_max := pos_rpc.setting_int('bank_api.key_max_months', 1, 60);
  if p_input ? 'expires_in_months' then
    if jsonb_typeof(p_input -> 'expires_in_months') <> 'number' or (p_input ->> 'expires_in_months') !~ '^[0-9]{1,3}$' then
      perform pos_rpc.fail('INVALID_REQUEST', 'expires_in_months must be a whole number', jsonb_build_object('path', 'expires_in_months'));
    end if;
    v_months := (p_input ->> 'expires_in_months')::integer;
  else
    v_months := pos_rpc.setting_int('bank_api.key_default_months', 1, v_max);
  end if;
  if v_months < 1 or v_months > v_max then
    perform pos_rpc.fail('INVALID_REQUEST', format('a key can work for 1 to %s months', v_max), jsonb_build_object('path', 'expires_in_months'));
  end if;
  if p_input ? 'rate_limit_per_minute' and jsonb_typeof(p_input -> 'rate_limit_per_minute') <> 'null' then
    if jsonb_typeof(p_input -> 'rate_limit_per_minute') <> 'number' or (p_input ->> 'rate_limit_per_minute') !~ '^[0-9]{1,4}$' then
      perform pos_rpc.fail('INVALID_REQUEST', 'rate_limit_per_minute must be a whole number', jsonb_build_object('path', 'rate_limit_per_minute'));
    end if;
    v_limit := (p_input ->> 'rate_limit_per_minute')::integer;
  end if;
  insert into pos.api_keys (bank_id, key_hash, label, scopes, active, created_by, last_four, expires_at, rate_limit_per_minute,
                            request_id)
  values (p_bank_id, p_key_hash, pos_rpc.in_text(p_input, 'name', true, 120), array['bank.read'], true, p_actor, p_last_four,
          now() + make_interval(months => v_months), v_limit, nullif(current_setting('pos.request_id', true), ''))
  returning * into v;
  return pos_rpc.api_key_json(v);
exception
  when unique_violation then
    perform pos_rpc.fail('ALREADY_EXISTS', 'that key already exists; make another');
    return null;
  when check_violation then
    perform pos_rpc.fail('INVALID_REQUEST', 'the key settings are out of range (rate_limit_per_minute 1–6000)');
    return null;
end $$;

create function pos_rpc.admin_api_key_list(p_actor uuid, p_bank_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_bank_id is null then perform pos_rpc.fail('INVALID_REQUEST', 'bank is required'); end if;
  perform pos_rpc.admin_require_bank(p_actor, p_bank_id);
  return coalesce((select jsonb_agg(pos_rpc.api_key_json(k) order by k.created_at desc) from pos.api_keys k where k.bank_id = p_bank_id),
                  '[]'::jsonb);
end $$;

create function pos_rpc.admin_api_key_revoke(p_actor uuid, p_key_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.api_keys;
begin
  select * into v from pos.api_keys where id = p_key_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'API key not found'); end if;
  perform pos_rpc.admin_require_bank(p_actor, v.bank_id);
  if coalesce(btrim(p_reason), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a reason is required to switch off a key'); end if;
  if v.revoked_at is not null then perform pos_rpc.fail('CONFLICT', 'this key is already switched off'); end if;
  update pos.api_keys
     set active = false, revoked_at = now(), revoked_by = p_actor, revoke_reason = btrim(p_reason),
         request_id = nullif(current_setting('pos.request_id', true), '')
   where id = p_key_id returning * into v;
  return pos_rpc.api_key_json(v);
end $$;

-- ── The bank read API ──────────────────────────────────────────────────────────────────────────
-- Record one call (allowed or refused). The API calls it for every request it authorised, before the response goes out.
create function pos_rpc.bank_call_record(p_key_id uuid, p_method text, p_route text, p_subject_id uuid, p_status integer,
                                         p_items integer, p_request_id text, p_ip text, p_user_agent text)
returns void language sql security definer set search_path = '' as $$
  insert into pos.bank_api_calls (key_id, bank_id, method, route, subject_id, status, items, request_id, ip, user_agent)
  select k.id, k.bank_id, left(p_method, 10), left(p_route, 200), p_subject_id, p_status, p_items, left(p_request_id, 80),
         left(p_ip, 64), left(p_user_agent, 300)
    from pos.api_keys k where k.id = p_key_id;
$$;

-- Check a key (by fingerprint) and count the call against its limit. Refusals of a known key are recorded here and
-- returned as {allowed:false} (not raised) so the record commits. An unknown fingerprint records nothing.
create function pos_rpc.bank_key_authorize(p_key_hash text, p_method text, p_route text, p_ip text, p_user_agent text,
                                           p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.api_keys;
  v_bank pos.banks;
  v_code text;
  v_message text;
  v_limit integer;
  v_count integer;
  v_window timestamptz := date_trunc('minute', now());
begin
  select * into v from pos.api_keys k where k.key_hash = p_key_hash;
  if not found then
    return jsonb_build_object('allowed', false, 'code', 'UNAUTHENTICATED', 'message', 'unknown API key');
  end if;
  select * into v_bank from pos.banks b where b.id = v.bank_id;
  if pos_rpc.api_key_status(v) = 'revoked' then
    v_code := 'UNAUTHENTICATED'; v_message := 'this API key has been switched off';
  elsif pos_rpc.api_key_status(v) = 'expired' then
    v_code := 'UNAUTHENTICATED'; v_message := 'this API key has expired';
  elsif not v_bank.active then
    v_code := 'FORBIDDEN'; v_message := 'this bank''s access is switched off';
  end if;
  if v_code is not null then
    perform pos_rpc.bank_call_record(v.id, p_method, p_route, null, case v_code when 'FORBIDDEN' then 403 else 401 end, null,
                                     p_request_id, p_ip, p_user_agent);
    return jsonb_build_object('allowed', false, 'code', v_code, 'message', v_message);
  end if;

  v_limit := coalesce(v.rate_limit_per_minute, pos_rpc.setting_int('bank_api.rate_limit_per_minute', 1, 6000));
  insert into pos.bank_api_usage as u (key_id, window_start, requests) values (v.id, v_window, 1)
  on conflict (key_id, window_start) do update set requests = u.requests + 1
  returning u.requests into v_count;
  delete from pos.bank_api_usage u where u.key_id = v.id and u.window_start < v_window - interval '1 hour';
  if v_count > v_limit then
    perform pos_rpc.bank_call_record(v.id, p_method, p_route, null, 429, null, p_request_id, p_ip, p_user_agent);
    return jsonb_build_object('allowed', false, 'code', 'RATE_LIMITED', 'message', 'too many requests for this API key; wait a minute',
                              'limit', v_limit, 'retry_after_s', greatest(1, 60 - floor(extract(epoch from now() - v_window))::integer));
  end if;
  if v.last_used_at is null or v.last_used_at < now() - interval '1 minute' then   -- at most one audited update a minute
    update pos.api_keys set last_used_at = now() where id = v.id;
  end if;
  return jsonb_build_object('allowed', true, 'key_id', v.id, 'bank_id', v.bank_id, 'bank_code', v_bank.code,
                            'statuses', to_jsonb(pos_rpc.bank_api_statuses(v.bank_id)), 'limit', v_limit,
                            'remaining', greatest(0, v_limit - v_count));
end $$;

-- Inspections of one bank, in the readable statuses, changed after a cursor (changed = the row or its amendments), oldest
-- first. Returns {items, has_more, last} where last is the next cursor.
create function pos_rpc.bank_inspections_changed(p_bank_id uuid, p_statuses text[], p_after_at timestamptz, p_after_id uuid,
                                                 p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_rows jsonb;
  v_more boolean;
begin
  with c as (
    select i.id, i.job_id, i.status, i.attempt, i.submitted_at_server,
           greatest(i.updated_at, coalesce((select max(a.created_at) from pos.amendments a where a.inspection_id = i.id), i.updated_at)) as changed_at
      from pos.inspections i
      join pos.jobs j on j.id = i.job_id
     where j.bank_id = p_bank_id and i.status::text = any (p_statuses)
  ), page as (
    select c.* from c
     where p_after_at is null or (c.changed_at, c.id) > (p_after_at, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
     order by c.changed_at, c.id
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'job_id', p.job_id, 'job_reference', j.reference, 'external_ref', j.external_ref,
             'merchant_name', j.merchant_name, 'status', p.status, 'attempt', p.attempt, 'submitted_at', p.submitted_at_server,
             'changed_at', p.changed_at,
             'decision', (select jsonb_build_object('decision', r.decision, 'reason_code', r.reason_code, 'decided_at', r.decided_at)
                            from pos.reviews r where r.inspection_id = p.id))
           order by p.changed_at, p.id) filter (where p.rn <= v_limit), '[]'::jsonb),
         count(*) > v_limit
    into v_rows, v_more
    from (select page.*, row_number() over (order by page.changed_at, page.id) as rn from page) p
    join pos.jobs j on j.id = p.job_id;
  return jsonb_build_object('items', v_rows, 'has_more', v_more,
                            'last', case when jsonb_array_length(v_rows) > 0 then jsonb_build_object(
                                     'changed_at', v_rows -> -1 ->> 'changed_at', 'id', v_rows -> -1 ->> 'id') end);
end $$;

-- One inspection of the bank, in a readable status: the record, its answers with the pinned form (the API adds the
-- labels), amendments, a custody summary and the evidence (the API swaps storage paths for 15-minute links).
create function pos_rpc.bank_inspection_get(p_bank_id uuid, p_statuses text[], p_inspection_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v pos.inspections;
  v_job pos.jobs;
begin
  select i.* into v from pos.inspections i join pos.jobs j on j.id = i.job_id
   where i.id = p_inspection_id and j.bank_id = p_bank_id and i.status::text = any (p_statuses);
  if not found then perform pos_rpc.fail('NOT_FOUND', 'inspection not found'); end if;
  select * into v_job from pos.jobs where id = v.job_id;
  return jsonb_build_object(
    'inspection', jsonb_build_object(
      'id', v.id, 'status', v.status, 'attempt', v.attempt, 'started_at', v.started_at_server,
      'submitted_at_device', v.submitted_at_device, 'submitted_at', v.submitted_at_server, 'flags', to_jsonb(v.flags),
      'definition_hash', v.definition_hash, 'answers_hash', v.answers_hash, 'submission_hash', v.submission_hash),
    'job', jsonb_build_object(
      'id', v_job.id, 'reference', v_job.reference, 'external_ref', v_job.external_ref, 'merchant_name', v_job.merchant_name,
      'trading_name', v_job.trading_name, 'address', v_job.address, 'mcc_code', v_job.mcc_code),
    'decision', (select jsonb_build_object('decision', r.decision, 'reason_code', r.reason_code, 'decided_at', r.decided_at)
                   from pos.reviews r where r.inspection_id = v.id),
    'answers', coalesce(v.answers, '{}'::jsonb),
    'form', (select jsonb_build_object('family', f.key, 'version', dv.version, 'definition', dv.definition)
               from pos.definition_versions dv join pos.definition_families f on f.id = dv.family_id where dv.id = v.form_version_id),
    'amendments', coalesce((select jsonb_agg(jsonb_build_object('field_key', a.field_key, 'old_value', a.old_value,
                                                                 'new_value', a.new_value, 'justification', a.justification,
                                                                 'created_at', a.created_at) order by a.created_at)
                              from pos.amendments a where a.inspection_id = v.id), '[]'::jsonb),
    'custody', jsonb_build_object(
      'evidence_expected', v.evidence_expected, 'evidence_received', v.evidence_received, 'evidence_verified', v.evidence_verified,
      'evidence_replicated', (select count(*) from pos.evidence e where e.inspection_id = v.id and e.replica_state = 'replicated'),
      'events', coalesce((select jsonb_agg(jsonb_build_object('event', ce.event, 'source', ce.source, 'at_device', ce.at_device,
                                                              'at_server', ce.at_server) order by ce.at_server)
                            from (select * from pos.custody_events x where x.subject_type = 'inspection' and x.subject_id = v.id
                                   order by x.at_server limit 200) ce), '[]'::jsonb)),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object(
                                   'id', e.id, 'field_key', e.field_key, 'category', e.category, 'type', e.type, 'mime', e.mime,
                                   'bytes', e.bytes, 'width', e.width, 'height', e.height, 'captured_at', e.captured_at_device,
                                   'sha256', coalesce(e.sha256_server, e.sha256_client), 'integrity_verified', e.integrity_verified,
                                   'upload_state', e.upload_state, 'replica_state', e.replica_state, 'storage_path', e.storage_path)
                                 order by e.captured_at_device nulls last, e.id)
                            from pos.evidence e where e.inspection_id = v.id), '[]'::jsonb));
end $$;
