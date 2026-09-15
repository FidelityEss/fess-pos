-- FESS POS — exports that work: the export worker's database side, exports a bank asks for through its API key, and
-- audited downloads (T6-03, T6-04; B6.4, B6.5; D-100 (3), D-102; docs/17 §4.2; assessment A-07).
--
-- An export is asked for (admin panel or bank API), prepared in the background by the `workers` function (task
-- 'export', kicked every 30 s by pg_cron and once straight after each request), stored in the private `reports` bucket
-- and downloaded through short-lived signed links. What the database guarantees:
--   - honest states: queued → running → done | failed. A try that fails for a passing reason goes back to queued with the
--     reason shown and is retried; a refusal (too big, format not available, requester lost access) or the last try ends
--     in failed with the reason. Only a failed export can be retried. `done` is set only with the file's path, size and
--     SHA-256, after the worker has read the stored file back (DEVELOPMENT-GUIDELINES §2, A-03);
--   - scope frozen at request: the bank, the form, the dates and the visit statuses it covers;
--   - trace: export_items lists every visit in the file with its fingerprints, and each visit gets an `exported` custody
--     event;
--   - audit: every download link handed out is a row in export_downloads (append-only, in the activity history).
-- A bank's API key only ever sees the exports its bank's keys asked for, never an admin's (an admin export can include
-- visits the bank's API may not read).
--
-- Expand-only: new columns on pos.exports (nullable or defaulted), two new tables, new functions, settings rows and one
-- pg_cron schedule. admin_export_request keeps its signature and is replaced; the exports read policy is narrowed from
-- "any admin" to "admins with the export's bank in scope". Reverse: cron.unschedule('pos-workers-export'); drop the new
-- functions and tables; recreate admin_export_request and exports_read from 20260911102200 / 20260911100800. The new
-- columns can stay.

-- ── Settings (fail closed when missing: pos_rpc.setting_int, pos_rpc.export_setting_statuses) ─────────────────────
insert into pos.settings (key, value, note) values
  ('exports.formats_ready', '["csv", "xlsx", "evidence_zip"]'::jsonb,
   'Export formats the export worker can make (D-102). Anything else is refused at request. The PDF report (T6-02) adds "pdf" when its worker lands'),
  ('exports.admin_statuses', '["submitted", "verifying", "integrity_failed", "under_review", "approved", "returned", "rejected"]'::jsonb,
   'Visit statuses an admin''s export covers: every visit after submission (D-102). A bank''s API export covers what its API may read (D-100)'),
  ('exports.max_inspections', '5000'::jsonb, 'Most visits one export may cover (D-102)'),
  ('exports.max_file_mb', '50'::jsonb, 'Largest file one export may make, in MB (D-102). The reports bucket takes 100; the edge worker holds the file in memory'),
  ('exports.keep_days', '30'::jsonb, 'Days an export can be downloaded after it is ready (docs/05 §11: exports are kept 30 days)'),
  ('exports.link_seconds', '300'::jsonb, 'How long a download link works, in seconds (at most 900: DEVELOPMENT-GUIDELINES §4)'),
  ('exports.bank_max_open', '3'::jsonb, 'Most exports one bank''s keys may have waiting or being prepared at once (D-102)')
on conflict (key) do nothing;

-- ── Exports: what was asked, the frozen scope, progress and the file ──────────────────────────
alter table pos.exports
  add column bank_id            uuid references pos.banks (id),
  add column family_id          uuid references pos.definition_families (id),
  add column statuses           text[],
  add column api_key_id         uuid references pos.api_keys (id),
  add column attempts           integer not null default 0 check (attempts >= 0),
  add column started_at         timestamptz,
  add column failed_at          timestamptz,
  add column file_name          text check (length(file_name) between 1 and 200),
  add column mime               text,
  add column bytes              bigint check (bytes >= 0),
  add column sha256             text check (sha256 ~ '^[0-9a-f]{64}$'),
  add column inspection_count   integer check (inspection_count >= 0),
  add column evidence_count     integer check (evidence_count >= 0),
  add column problems           jsonb not null default '[]'::jsonb check (jsonb_typeof(problems) = 'array'),
  add column expires_at         timestamptz,
  add column download_count     integer not null default 0 check (download_count >= 0),
  add column last_downloaded_at timestamptz,
  add constraint exports_one_requester check (requested_by is null or api_key_id is null),
  add constraint exports_done_has_file check (status <> 'done' or (storage_path is not null and sha256 is not null and bytes is not null));
comment on column pos.exports.statuses is 'Visit statuses the export covers, frozen when it was asked for (D-102).';
comment on column pos.exports.api_key_id is 'The bank API key that asked for it (D-100 (3)); null when an admin did (requested_by).';
comment on column pos.exports.problems is 'What the file holds that needs attention, e.g. a photo not yet received or not matching its fingerprint. Listed, never hidden.';
create index exports_bank_idx on pos.exports (bank_id, created_at desc);
create index exports_key_idx on pos.exports (api_key_id, created_at desc) where api_key_id is not null;
create index exports_status_idx on pos.exports (status) where status in ('queued', 'running');

-- Admins see the exports of the banks in their scope; an export of every bank only global admins (was: any admin).
alter policy exports_read on pos.exports using ((select pos.can_read_bank(bank_id)));

-- Every visit in a finished export, with the fingerprints that prove what it held. Append-only.
create table pos.export_items (
  export_id         uuid not null references pos.exports (id),
  inspection_id     uuid not null references pos.inspections (id),
  form_version_id   uuid references pos.definition_versions (id),
  answers_hash      text,
  submission_hash   text,
  evidence_listed   integer not null default 0 check (evidence_listed >= 0),
  evidence_included integer not null default 0 check (evidence_included >= 0),
  primary key (export_id, inspection_id)
);
create index export_items_inspection_idx on pos.export_items (inspection_id);
create trigger append_only before update or delete on pos.export_items for each row execute function pos.tg_append_only();
create trigger append_only_truncate before truncate on pos.export_items for each statement execute function pos.tg_append_only();

-- Every download link handed out, to an admin or a bank's key. Append-only; in the activity history.
create table pos.export_downloads (
  id         uuid primary key default gen_random_uuid(),
  export_id  uuid not null references pos.exports (id),
  at         timestamptz not null default now(),
  by_user    uuid references pos.pos_users (id),
  by_key     uuid references pos.api_keys (id),
  ip         text,
  user_agent text,
  request_id text,
  check ((by_user is null) <> (by_key is null))
);
create index export_downloads_export_idx on pos.export_downloads (export_id, at desc);
create trigger append_only before update or delete on pos.export_downloads for each row execute function pos.tg_append_only();
create trigger append_only_truncate before truncate on pos.export_downloads for each statement execute function pos.tg_append_only();
create trigger audit after insert or update or delete on pos.export_downloads for each row execute function pos.tg_audit();

create function pos.can_read_export(p_export_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pos.exports e where e.id = p_export_id and pos.can_read_bank(e.bank_id));
$$;
grant execute on function pos.can_read_export(uuid) to authenticated, service_role;

alter table pos.export_items enable row level security;
alter table pos.export_downloads enable row level security;
grant select on pos.export_items, pos.export_downloads to authenticated, service_role;
create policy export_items_read on pos.export_items for select to authenticated using ((select pos.can_read_export(export_id)));
create policy export_downloads_read on pos.export_downloads for select to authenticated using ((select pos.can_read_export(export_id)));

-- ── Helpers ────────────────────────────────────────────────────────────────────────────────────
-- Visit statuses from a settings array; only statuses after submission are ever allowed. Fails closed.
create function pos_rpc.export_setting_statuses(p_key text)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
  v_out text[];
begin
  select s.value into v from pos.settings s where s.key = p_key;
  if v is null or jsonb_typeof(v) <> 'array' then perform pos_rpc.fail('NOT_READY', format('%s is not set', p_key)); end if;
  v_out := array(select jsonb_array_elements_text(v));
  if cardinality(v_out) = 0
     or not (v_out <@ array['submitted', 'verifying', 'integrity_failed', 'under_review', 'approved', 'returned', 'rejected']::text[]) then
    perform pos_rpc.fail('NOT_READY', format('%s must list visit statuses after submission', p_key));
  end if;
  return v_out;
end $$;

-- What a format is called, for messages.
create function pos_rpc.export_format_name(p_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_type when 'csv' then 'Spreadsheet (CSV) exports' when 'xlsx' then 'Excel exports'
                     when 'evidence_zip' then 'Photo (ZIP) exports' when 'pdf' then 'PDF visit reports'
                     when 'spec_pdf' then 'Set-up description PDFs' when 'billing_csv' then 'Billing lists'
                     else coalesce(p_type, 'This kind of export') end;
$$;

-- Refuses a format the worker can't make yet (exports.formats_ready), so no request waits for ever (A-07).
create function pos_rpc.export_format_ready(p_type text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  select s.value into v from pos.settings s where s.key = 'exports.formats_ready';
  if v is null or jsonb_typeof(v) <> 'array' then perform pos_rpc.fail('NOT_READY', 'exports.formats_ready is not set'); end if;
  if not (v ? p_type) then
    perform pos_rpc.fail('VALIDATION_FAILED', format('%s can''t be made yet.', pos_rpc.export_format_name(p_type)),
                         jsonb_build_array(jsonb_build_object('path', 'type', 'message', 'not available yet')));
  end if;
end $$;

-- The formats the worker can make now, for the admin screen (GET /v1/admin/exports/formats).
create function pos_rpc.export_formats()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value from pos.settings s where s.key = 'exports.formats_ready'), '[]'::jsonb);
$$;

-- Checks what an export is limited to and returns it tidied: bank_id, from, to (YYYY-MM-DD, the day the visit reached
-- us in the configured time zone), family_id (a form) and job_ids. Anything else is refused.
create function pos_rpc.export_scope(p_scope jsonb, p_bank_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  k text;
  v_from date;
  v_to date;
  v_family uuid;
  v_jobs uuid[];
  v_out jsonb := '{}'::jsonb;
begin
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' then perform pos_rpc.fail('INVALID_REQUEST', 'scope must be an object'); end if;
  for k in select jsonb_object_keys(p_scope) loop
    if k not in ('bank_id', 'from', 'to', 'family_id', 'job_ids') then
      perform pos_rpc.fail('INVALID_REQUEST', format('an export can''t be limited by "%s"', k), jsonb_build_object('path', 'scope.' || k));
    end if;
  end loop;
  if p_bank_id is not null then v_out := jsonb_build_object('bank_id', p_bank_id); end if;
  foreach k in array array['from', 'to'] loop
    if p_scope ? k and jsonb_typeof(p_scope -> k) <> 'null' then
      if jsonb_typeof(p_scope -> k) <> 'string' or (p_scope ->> k) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        perform pos_rpc.fail('INVALID_REQUEST', format('%s must be a date written as YYYY-MM-DD', k), jsonb_build_object('path', 'scope.' || k));
      end if;
      begin
        if k = 'from' then v_from := (p_scope ->> k)::date; else v_to := (p_scope ->> k)::date; end if;
      exception when others then
        perform pos_rpc.fail('INVALID_REQUEST', format('%s is not a real date', k), jsonb_build_object('path', 'scope.' || k));
      end;
    end if;
  end loop;
  if v_from is not null and v_to is not null and v_to < v_from then
    perform pos_rpc.fail('INVALID_REQUEST', 'the end date must be on or after the start date', jsonb_build_object('path', 'scope.to'));
  end if;
  if v_from is not null then v_out := v_out || jsonb_build_object('from', v_from::text); end if;
  if v_to is not null then v_out := v_out || jsonb_build_object('to', v_to::text); end if;

  if p_scope ? 'family_id' and jsonb_typeof(p_scope -> 'family_id') <> 'null' then
    begin
      v_family := (p_scope ->> 'family_id')::uuid;
    exception when others then
      perform pos_rpc.fail('INVALID_REQUEST', 'scope.family_id must be a form id', jsonb_build_object('path', 'scope.family_id'));
    end;
    if not exists (select 1 from pos.definition_families f
                    where f.id = v_family and f.kind = 'form' and (f.bank_id is null or p_bank_id is null or f.bank_id = p_bank_id)) then
      perform pos_rpc.fail('NOT_FOUND', 'that form isn''t one this export can use', jsonb_build_object('path', 'scope.family_id'));
    end if;
    v_out := v_out || jsonb_build_object('family_id', v_family);
  end if;

  if p_scope ? 'job_ids' and jsonb_typeof(p_scope -> 'job_ids') <> 'null' then
    if jsonb_typeof(p_scope -> 'job_ids') <> 'array' or jsonb_array_length(p_scope -> 'job_ids') > 1000 then
      perform pos_rpc.fail('INVALID_REQUEST', 'scope.job_ids must be a list of at most 1000 job ids', jsonb_build_object('path', 'scope.job_ids'));
    end if;
    begin
      v_jobs := array(select jsonb_array_elements_text(p_scope -> 'job_ids')::uuid);
    exception when others then
      perform pos_rpc.fail('INVALID_REQUEST', 'one of the job ids isn''t a valid id', jsonb_build_object('path', 'scope.job_ids'));
    end;
    if cardinality(v_jobs) > 0 then
      if (select count(*) from pos.jobs j where j.id = any (v_jobs) and (p_bank_id is null or j.bank_id = p_bank_id))
         <> (select count(distinct x) from unnest(v_jobs) x) then
        perform pos_rpc.fail('NOT_FOUND', 'one of the jobs doesn''t exist or isn''t this bank''s', jsonb_build_object('path', 'scope.job_ids'));
      end if;
      v_out := v_out || jsonb_build_object('job_ids', to_jsonb(v_jobs));
    end if;
  end if;
  return v_out;
end $$;

-- Best-effort kick so an export starts within seconds; pg_cron's 30-second kick is the guarantee (docs/12 §8), so a
-- failed kick is ignored.
create function pos_rpc.export_kick()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pos_rpc.cron_kick_workers('export');
exception when others then
  null;
end $$;

-- The visits an export covers: its bank, statuses, form, jobs and dates, the day read in the configured time zone.
create function pos_rpc.export_matches(p_export_id uuid)
returns table (inspection_id uuid, sort_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with e as (
    select x.*, coalesce(pos.config_value(array['locale', 'timezone']) #>> '{}', 'Africa/Johannesburg') as tz
      from pos.exports x where x.id = p_export_id
  )
  select i.id, coalesce(i.submitted_at_server, i.created_at)
    from e
    join pos.inspections i on i.status::text = any (e.statuses)
    join pos.jobs j on j.id = i.job_id
    left join pos.definition_versions dv on dv.id = i.form_version_id
   where (e.bank_id is null or j.bank_id = e.bank_id)
     and (e.family_id is null or dv.family_id = e.family_id)
     and (not (e.scope ? 'job_ids') or j.id in (select (x #>> '{}')::uuid from jsonb_array_elements(e.scope -> 'job_ids') x))
     and (not (e.scope ? 'from') or coalesce(i.submitted_at_server, i.created_at) >= ((e.scope ->> 'from')::date::timestamp at time zone e.tz))
     and (not (e.scope ? 'to') or coalesce(i.submitted_at_server, i.created_at) < (((e.scope ->> 'to')::date + 1)::timestamp at time zone e.tz));
$$;

-- An export as a bank's system sees it: plain states, the file once ready, never the storage path.
create function pos_rpc.bank_export_json(p pos.exports)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'format', p.type,
    'status', case p.status when 'queued' then 'queued' when 'running' then 'preparing'
                            when 'failed' then 'failed'
                            else case when p.expires_at <= now() then 'expired' else 'ready' end end,
    'will_retry', p.status = 'queued' and p.error is not null,
    'error', p.error,
    'from', p.scope ->> 'from', 'to', p.scope ->> 'to',
    'form', (select f.key from pos.definition_families f where f.id = p.family_id),
    'requested_at', p.created_at, 'started_at', p.started_at, 'ready_at', p.completed_at, 'expires_at', p.expires_at,
    'visits', p.inspection_count, 'photos', p.evidence_count,
    'notes', coalesce((select jsonb_agg(x ->> 'message') from jsonb_array_elements(p.problems) x), '[]'::jsonb),
    'file', case when p.status = 'done' then jsonb_build_object('name', p.file_name, 'mime', p.mime, 'bytes', p.bytes, 'sha256', p.sha256) end);
$$;

-- ── Admin: ask, try again, download ────────────────────────────────────────────────────────────
create or replace function pos_rpc.admin_export_request(p_actor uuid, p_type text, p_scope jsonb, p_recipient text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor pos.pos_users;
  v pos.exports;
  v_bank uuid;
  v_scope jsonb;
begin
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' then
    perform pos_rpc.fail('INVALID_REQUEST', 'scope must be an object');
  end if;
  begin
    v_bank := nullif(p_scope ->> 'bank_id', '')::uuid;
  exception when others then
    perform pos_rpc.fail('INVALID_REQUEST', 'scope.bank_id must be a bank id', jsonb_build_object('path', 'scope.bank_id'));
  end;
  v_actor := pos_rpc.require_staff(p_actor, null, v_bank);
  if v_actor.bank_ids is not null and v_bank is null then
    perform pos_rpc.fail('VALIDATION_FAILED', 'choose a bank for this export',
                         jsonb_build_array(jsonb_build_object('path', 'scope.bank_id', 'message', 'required for bank-scoped admins')));
  end if;
  if v_bank is not null and not exists (select 1 from pos.banks b where b.id = v_bank) then
    perform pos_rpc.fail('NOT_FOUND', 'bank not found', jsonb_build_object('path', 'scope.bank_id'));
  end if;
  if p_type is null or p_type not in (select unnest(enum_range(null::pos.export_type))::text) then
    perform pos_rpc.fail('INVALID_REQUEST', 'unknown export type', jsonb_build_object('path', 'type'));
  end if;
  perform pos_rpc.export_format_ready(p_type);
  v_scope := pos_rpc.export_scope(p_scope, v_bank);
  insert into pos.exports (type, scope, requested_by, recipient, request_id, bank_id, family_id, statuses)
  values (p_type::pos.export_type, v_scope, p_actor, nullif(btrim(p_recipient), ''), nullif(current_setting('pos.request_id', true), ''),
          v_bank, nullif(v_scope ->> 'family_id', '')::uuid, pos_rpc.export_setting_statuses('exports.admin_statuses'))
  returning * into v;
  perform pos_rpc.enqueue('export', jsonb_build_object('export_id', v.id));
  perform pos_rpc.export_kick();
  return to_jsonb(v);
end $$;

create function pos_rpc.admin_export_retry(p_actor uuid, p_export_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.exports;
begin
  select * into v from pos.exports where id = p_export_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'export not found'); end if;
  perform pos_rpc.admin_require_bank(p_actor, v.bank_id);
  if v.status <> 'failed' then
    perform pos_rpc.fail('CONFLICT', case v.status when 'done' then 'this export is ready; download it, or ask for a new one'
                                                   else 'this export is still being prepared' end);
  end if;
  update pos.exports set status = 'queued', error = null, failed_at = null, problems = '[]'::jsonb,
                         request_id = nullif(current_setting('pos.request_id', true), '')
   where id = v.id returning * into v;
  perform pos_rpc.enqueue('export', jsonb_build_object('export_id', v.id));
  perform pos_rpc.export_kick();
  return to_jsonb(v);
end $$;

-- Records the download and returns where the file is; the API makes the signed link (≤ 15 min).
create function pos_rpc.admin_export_download(p_actor uuid, p_export_id uuid, p_ip text, p_user_agent text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.exports;
begin
  select * into v from pos.exports where id = p_export_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'export not found'); end if;
  perform pos_rpc.admin_require_bank(p_actor, v.bank_id);
  if v.status <> 'done' then perform pos_rpc.fail('CONFLICT', 'this export isn''t ready to download'); end if;
  if v.expires_at <= now() then perform pos_rpc.fail('CONFLICT', 'this export has expired; ask for it again'); end if;
  insert into pos.export_downloads (export_id, by_user, ip, user_agent, request_id)
  values (v.id, p_actor, left(p_ip, 64), left(p_user_agent, 300), nullif(current_setting('pos.request_id', true), ''));
  update pos.exports set download_count = download_count + 1, last_downloaded_at = now() where id = v.id;
  return jsonb_build_object('storage_path', v.storage_path, 'file_name', v.file_name, 'mime', v.mime, 'bytes', v.bytes, 'sha256', v.sha256,
                            'link_seconds', pos_rpc.setting_int('exports.link_seconds', 30, 900));
end $$;

-- ── Bank API: ask, check, download (D-100 (3)): the key's bank only; never an admin's exports ─────────────────
create function pos_rpc.bank_export_request(p_key_id uuid, p_bank_id uuid, p_statuses text[], p_type text, p_scope jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.exports;
  v_family uuid;
  v_scope jsonb;
  v_open integer;
  v_max integer;
begin
  if not exists (select 1 from pos.api_keys k where k.id = p_key_id and k.bank_id = p_bank_id and pos_rpc.api_key_status(k) = 'active') then
    perform pos_rpc.fail('UNAUTHENTICATED', 'this API key can''t ask for exports');
  end if;
  if p_type is null or p_type not in ('csv', 'xlsx', 'evidence_zip') then
    perform pos_rpc.fail('INVALID_REQUEST', 'format must be csv, xlsx or evidence_zip', jsonb_build_object('path', 'format'));
  end if;
  perform pos_rpc.export_format_ready(p_type);
  if p_statuses is null or cardinality(p_statuses) = 0
     or not (p_statuses <@ array['submitted', 'verifying', 'integrity_failed', 'under_review', 'approved', 'returned', 'rejected']::text[]) then
    perform pos_rpc.fail('NOT_READY', 'the visit statuses this bank may read are not valid');
  end if;
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' then perform pos_rpc.fail('INVALID_REQUEST', 'the body must be an object'); end if;
  if p_scope ? 'form' and jsonb_typeof(p_scope -> 'form') <> 'null' then
    select f.id into v_family from pos.definition_families f
     where f.kind = 'form' and f.key = p_scope ->> 'form' and (f.bank_id = p_bank_id or f.bank_id is null)
     order by f.bank_id nulls last limit 1;
    if v_family is null then perform pos_rpc.fail('NOT_FOUND', 'no form with that key', jsonb_build_object('path', 'form')); end if;
  end if;
  v_max := pos_rpc.setting_int('exports.bank_max_open', 1, 100);
  select count(*) into v_open from pos.exports e
   where e.bank_id = p_bank_id and e.api_key_id is not null and e.status in ('queued', 'running');
  if v_open >= v_max then
    perform pos_rpc.fail('RATE_LIMITED', format('this bank already has %s exports waiting or being prepared; ask again when one is ready', v_open),
                         jsonb_build_object('open', v_open, 'limit', v_max, 'retry_after_s', 60));
  end if;
  v_scope := pos_rpc.export_scope(jsonb_strip_nulls(jsonb_build_object('from', p_scope -> 'from', 'to', p_scope -> 'to', 'family_id', v_family)),
                                  p_bank_id);
  insert into pos.exports (type, scope, api_key_id, request_id, bank_id, family_id, statuses)
  values (p_type::pos.export_type, v_scope, p_key_id, nullif(current_setting('pos.request_id', true), ''), p_bank_id, v_family, p_statuses)
  returning * into v;
  perform pos_rpc.enqueue('export', jsonb_build_object('export_id', v.id));
  perform pos_rpc.export_kick();
  return pos_rpc.bank_export_json(v);
end $$;

create function pos_rpc.bank_export_get(p_bank_id uuid, p_export_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v pos.exports;
begin
  select * into v from pos.exports e where e.id = p_export_id and e.bank_id = p_bank_id and e.api_key_id is not null;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'export not found'); end if;
  return pos_rpc.bank_export_json(v);
end $$;

create function pos_rpc.bank_export_list(p_bank_id uuid, p_limit integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(pos_rpc.bank_export_json(e) order by e.created_at desc), '[]'::jsonb)
    from (select * from pos.exports x where x.bank_id = p_bank_id and x.api_key_id is not null
           order by x.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) e;
$$;

-- Records the download by the key and returns where the file is; the API makes the signed link (≤ 15 min).
create function pos_rpc.bank_export_download(p_key_id uuid, p_bank_id uuid, p_export_id uuid, p_ip text, p_user_agent text,
                                             p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.exports;
begin
  select * into v from pos.exports e where e.id = p_export_id and e.bank_id = p_bank_id and e.api_key_id is not null for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'export not found'); end if;
  if v.status <> 'done' or v.expires_at <= now() then return null; end if;
  if not exists (select 1 from pos.api_keys k where k.id = p_key_id and k.bank_id = p_bank_id) then
    perform pos_rpc.fail('FORBIDDEN', 'this key isn''t this bank''s');
  end if;
  insert into pos.export_downloads (export_id, by_key, ip, user_agent, request_id)
  values (v.id, p_key_id, left(p_ip, 64), left(p_user_agent, 300), left(p_request_id, 80));
  update pos.exports set download_count = download_count + 1, last_downloaded_at = now() where id = v.id;
  return jsonb_build_object('storage_path', v.storage_path, 'file_name', v.file_name, 'link_seconds', pos_rpc.setting_int('exports.link_seconds', 30, 900));
end $$;

-- ── The export worker (service_role only) ─────────────────────────────────────────────────────
-- Starts a try: checks the export may still be made (the requester still has access, the format exists, it isn't too
-- big) and marks it running. A refusal ends the export as failed with the reason, and the message is done with.
create function pos_rpc.export_claim(p_export_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.exports;
  v_user pos.pos_users;
  v_key pos.api_keys;
  v_bank pos.banks;
  v_reason text;
  v_ready jsonb;
  v_count bigint;
  v_bytes bigint;
  v_max_visits integer;
  v_max_mb integer;
begin
  select * into v from pos.exports where id = p_export_id for update;
  if not found then return jsonb_build_object('run', false, 'reason', 'not_found'); end if;
  if v.status in ('done', 'failed') then return jsonb_build_object('run', false, 'reason', v.status::text); end if;

  -- Requests made before this migration: freeze their bank and statuses now.
  if v.bank_id is null and nullif(v.scope ->> 'bank_id', '') is not null then
    begin
      v.bank_id := (v.scope ->> 'bank_id')::uuid;
    exception when others then
      v_reason := 'The bank in this request isn''t valid, so it wasn''t made.';
    end;
  end if;
  if v.statuses is null then
    v.statuses := case when v.api_key_id is null then pos_rpc.export_setting_statuses('exports.admin_statuses')
                       else pos_rpc.bank_api_statuses(v.bank_id) end;
  end if;
  if v.bank_id is not null then select * into v_bank from pos.banks where id = v.bank_id; end if;

  if v_reason is null and v.requested_by is not null then
    select * into v_user from pos.pos_users where id = v.requested_by;
    if not found or not v_user.active or v_user.role <> 'pos_admin' then
      v_reason := 'The person who asked for this export can no longer use the admin panel, so it wasn''t made.';
    elsif v_user.bank_ids is not null and (v.bank_id is null or not (v.bank_id = any (v_user.bank_ids))) then
      v_reason := 'The person who asked for this export no longer has access to this bank, so it wasn''t made.';
    end if;
  elsif v_reason is null and v.api_key_id is not null then
    select * into v_key from pos.api_keys where id = v.api_key_id;
    if pos_rpc.api_key_status(v_key) <> 'active' then
      v_reason := 'The API key that asked for this export was switched off or has expired, so it wasn''t made.';
    elsif not coalesce(v_bank.active, false) then
      v_reason := 'This bank''s access is switched off, so the export wasn''t made.';
    end if;
  end if;

  select s.value into v_ready from pos.settings s where s.key = 'exports.formats_ready';
  if v_reason is null and not coalesce(v_ready ? v.type::text, false) then
    v_reason := format('%s can''t be made yet. Nothing was lost: ask again once they are available.', pos_rpc.export_format_name(v.type::text));
  end if;

  if v_reason is null then
    v_max_visits := pos_rpc.setting_int('exports.max_inspections', 1, 100000);
    v_max_mb := pos_rpc.setting_int('exports.max_file_mb', 1, 100);
    update pos.exports set bank_id = v.bank_id, statuses = v.statuses where id = v.id;
    select count(*),
           coalesce(sum((select coalesce(sum(e.bytes), 0) from pos.evidence e
                          where e.inspection_id = m.inspection_id and e.upload_state in ('uploaded', 'verified'))), 0)
      into v_count, v_bytes
      from pos_rpc.export_matches(v.id) m;
    if v_count > v_max_visits then
      v_reason := format('This covers %s visits; one export can hold %s at most. Choose fewer dates or one form, and ask again.', v_count, v_max_visits);
    elsif v.type = 'evidence_zip' and v_bytes > v_max_mb::bigint * 1048576 then
      v_reason := format('The photos come to about %s MB; one download can hold %s MB at most. Choose fewer dates, and ask again.',
                         ceil(v_bytes / 1048576.0)::bigint, v_max_mb);
    end if;
  end if;

  if v_reason is not null then
    update pos.exports set status = 'failed', failed_at = now(), error = v_reason, bank_id = v.bank_id, statuses = v.statuses
     where id = v.id;
    return jsonb_build_object('run', false, 'reason', 'refused', 'error', v_reason);
  end if;

  update pos.exports set status = 'running', started_at = now(), attempts = attempts + 1, error = null
   where id = v.id returning * into v;
  return jsonb_build_object(
    'run', true,
    'export', to_jsonb(v),
    'bank', case when v_bank.id is null then null else jsonb_build_object('code', v_bank.code, 'name', v_bank.name) end,
    'form', (select jsonb_build_object('key', f.key, 'title', f.title) from pos.definition_families f where f.id = v.family_id),
    'time_zone', coalesce(pos.config_value(array['locale', 'timezone']) #>> '{}', 'Africa/Johannesburg'),
    'visits', v_count,
    'max_file_bytes', v_max_mb::bigint * 1048576);
end $$;

-- One page of the export's visits, oldest first, with answers, corrections and (for photo ZIPs) the evidence and its
-- custody events. {items, has_more, last: {at, id}}.
create function pos_rpc.export_page(p_export_id uuid, p_after_at timestamptz, p_after_id uuid, p_limit integer, p_with_evidence boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_items jsonb;
  v_more boolean;
begin
  with page as (
    select m.inspection_id, m.sort_at from pos_rpc.export_matches(p_export_id) m
     where p_after_at is null
        or (m.sort_at, m.inspection_id) > (p_after_at, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
     order by m.sort_at, m.inspection_id
     limit v_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by page.sort_at, page.inspection_id) as rn from page
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'sort_at', n.sort_at, 'job_id', j.id, 'job_reference', j.reference, 'external_ref', j.external_ref,
           'merchant_name', j.merchant_name, 'trading_name', j.trading_name, 'bank_code', b.code,
           'status', i.status, 'attempt', i.attempt, 'submitted_at', i.submitted_at_server,
           'decision', (select jsonb_build_object('decision', r.decision, 'reason_code', r.reason_code, 'decided_at', r.decided_at)
                          from pos.reviews r where r.inspection_id = i.id),
           'form_version_id', i.form_version_id, 'definition_hash', i.definition_hash, 'answers_hash', i.answers_hash,
           'submission_hash', i.submission_hash, 'answers', coalesce(i.answers, '{}'::jsonb),
           'amendments', coalesce((select jsonb_agg(jsonb_build_object('field_key', a.field_key, 'old_value', a.old_value,
                                                                      'new_value', a.new_value, 'justification', a.justification,
                                                                      'created_at', a.created_at) order by a.created_at)
                                     from pos.amendments a where a.inspection_id = i.id), '[]'::jsonb),
           'evidence_expected', i.evidence_expected, 'evidence_received', i.evidence_received, 'evidence_verified', i.evidence_verified,
           'evidence', case when p_with_evidence then coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', e.id, 'field_key', e.field_key, 'category', e.category, 'type', e.type, 'mime', e.mime, 'bytes', e.bytes,
                      'captured_at', e.captured_at_device, 'sha256', coalesce(e.sha256_server, e.sha256_client),
                      'integrity_verified', e.integrity_verified, 'upload_state', e.upload_state, 'replica_state', e.replica_state,
                      'storage_path', e.storage_path,
                      'custody', coalesce((select jsonb_agg(jsonb_build_object('event', ce.event, 'at', ce.at_server) order by ce.at_server)
                                             from pos.custody_events ce where ce.subject_type = 'evidence' and ce.subject_id = e.id), '[]'::jsonb))
                    order by e.captured_at_device nulls last, e.id)
               from pos.evidence e where e.inspection_id = i.id), '[]'::jsonb) end)
         order by n.sort_at, n.inspection_id) filter (where n.rn <= v_limit), '[]'::jsonb),
         count(*) > v_limit
    into v_items, v_more
    from numbered n
    join pos.inspections i on i.id = n.inspection_id
    join pos.jobs j on j.id = i.job_id
    join pos.banks b on b.id = j.bank_id;
  return jsonb_build_object('items', v_items, 'has_more', v_more,
                            'last', case when jsonb_array_length(v_items) > 0 then jsonb_build_object(
                                     'at', v_items -> -1 ->> 'sort_at', 'id', v_items -> -1 ->> 'id') end);
end $$;

-- The pinned form versions the visits used: {version id: {family_key, title, version, definition}}.
create function pos_rpc.export_versions(p_ids uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(dv.id, jsonb_build_object('id', dv.id, 'family_key', f.key, 'title', f.title, 'version', dv.version,
                                                               'definition', dv.definition)), '{}'::jsonb)
    from pos.definition_versions dv join pos.definition_families f on f.id = dv.family_id
   where dv.id = any (p_ids);
$$;

-- Ends a try with the file stored and read back. Lists every visit in it, marks each with an `exported` custody event,
-- and raises an alert when a photo was missing or didn't match its fingerprint. Idempotent for the same try.
create function pos_rpc.export_finish(p_export_id uuid, p_attempt integer, p_file jsonb, p_items jsonb, p_problems jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.exports;
  v_keep integer;
  v_outside integer;
  v_critical integer;
begin
  select * into v from pos.exports where id = p_export_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'export not found'); end if;
  if v.status = 'done' and v.attempts = p_attempt then return to_jsonb(v); end if;
  if v.status <> 'running' or v.attempts <> p_attempt then
    perform pos_rpc.fail('CONFLICT', 'this try is no longer the current one');
  end if;
  if coalesce(p_file ->> 'storage_path', '') = '' or coalesce(p_file ->> 'file_name', '') = ''
     or coalesce(p_file ->> 'sha256', '') !~ '^[0-9a-f]{64}$' or coalesce(p_file ->> 'bytes', '') !~ '^[0-9]+$' then
    perform pos_rpc.fail('INVALID_REQUEST', 'the finished file needs storage_path, file_name, bytes and sha256');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or p_problems is null or jsonb_typeof(p_problems) <> 'array' then
    perform pos_rpc.fail('INVALID_REQUEST', 'items and problems must be lists');
  end if;
  v_keep := pos_rpc.setting_int('exports.keep_days', 1, 3650);

  insert into pos.export_items (export_id, inspection_id, form_version_id, answers_hash, submission_hash, evidence_listed, evidence_included)
  select v.id, (x ->> 'inspection_id')::uuid, nullif(x ->> 'form_version_id', '')::uuid, x ->> 'answers_hash', x ->> 'submission_hash',
         coalesce((x ->> 'evidence_listed')::integer, 0), coalesce((x ->> 'evidence_included')::integer, 0)
    from jsonb_array_elements(p_items) x;
  -- Defence in depth: nothing in the file may come from another bank.
  select count(*) into v_outside from pos.export_items it
    join pos.inspections i on i.id = it.inspection_id join pos.jobs j on j.id = i.job_id
   where it.export_id = v.id and v.bank_id is not null and j.bank_id <> v.bank_id;
  if v_outside > 0 then perform pos_rpc.fail('CONFLICT', 'the file holds visits from another bank; it was not accepted'); end if;

  update pos.exports
     set status = 'done', completed_at = now(), expires_at = now() + make_interval(days => v_keep), error = null,
         storage_path = p_file ->> 'storage_path', file_name = p_file ->> 'file_name', mime = p_file ->> 'mime',
         bytes = (p_file ->> 'bytes')::bigint, sha256 = p_file ->> 'sha256',
         row_count = (select count(*) from pos.export_items it where it.export_id = v.id),
         inspection_count = (select count(*) from pos.export_items it where it.export_id = v.id),
         evidence_count = (select coalesce(sum(it.evidence_included), 0) from pos.export_items it where it.export_id = v.id),
         problems = p_problems
   where id = v.id returning * into v;

  insert into pos.custody_events (subject_type, subject_id, event, source, detail, request_id)
  select 'inspection', it.inspection_id, 'exported', 'server',
         jsonb_build_object('export_id', v.id, 'format', v.type, 'by', case when v.api_key_id is null then 'admin' else 'bank_api' end),
         nullif(current_setting('pos.request_id', true), '')
    from pos.export_items it where it.export_id = v.id;

  select count(*) into v_critical from jsonb_array_elements(p_problems) x where x ->> 'severity' = 'critical';
  if v_critical > 0 then
    perform pos_rpc.alert('export_evidence_problem', 'critical',
                          format('An export found %s photo(s) missing from storage or not matching their fingerprint', v_critical),
                          'export', v.id, v.bank_id, jsonb_build_object('problems', p_problems), 'export_evidence_problem:' || v.id::text);
  end if;
  return to_jsonb(v);
end $$;

-- Ends a try that went wrong. Not final: back to queued with the reason, retried with backoff. Final: failed with the
-- reason, an alert, and a Try again button in the admin. Ignored when the try is no longer the current one.
create function pos_rpc.export_fail(p_export_id uuid, p_attempt integer, p_error text, p_final boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v pos.exports;
begin
  select * into v from pos.exports where id = p_export_id for update;
  if not found or v.status <> 'running' or v.attempts <> p_attempt then return null; end if;
  if p_final then
    update pos.exports set status = 'failed', failed_at = now(), error = left(coalesce(nullif(btrim(p_error), ''), 'it failed'), 2000)
     where id = v.id returning * into v;
    perform pos_rpc.alert('export_failed', 'warning', format('An export failed: %s', left(v.error, 200)), 'export', v.id, v.bank_id,
                          jsonb_build_object('type', v.type, 'attempts', v.attempts), 'export_failed:' || v.id::text);
  else
    update pos.exports set status = 'queued', error = left(coalesce(nullif(btrim(p_error), ''), 'it failed'), 2000)
     where id = v.id returning * into v;
  end if;
  return to_jsonb(v);
end $$;

-- ── The export task: its own kick, so a long export never delays evidence verification ─────────
select cron.schedule('pos-workers-export', '30 seconds', $$ select pos_rpc.cron_kick_workers('export') $$);
