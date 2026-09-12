-- FESS POS — claim helpers, grants and RLS (docs/05 §0, §9; docs/07 §2; D-32).
--
-- Callers
--   agents  POS-issued session (D-32). The POS API verifies it, then runs agent reads as `authenticated`
--           with request.jwt.claims = {token_use:"pos_access", pos_user_id, pos_role, scope, device_id, session_id}.
--   admins  Supabase Auth (email + MFA) via PostgREST; resolved to pos_users by admin_auth_uid. aal2 required
--           unless pos.settings 'admin.require_mfa' is false.
--   service_role  bypasses RLS; used only inside the POS API and workers, which call pos_rpc functions.
-- Clients never write tables. The only client write is admin upsert on definition_drafts.

-- ── Claim helpers ──────────────────────────────────────────────────────────────────────────────
create function pos.jwt_claims() returns jsonb language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

-- POS session claims (agents). Only honoured on tokens the POS API marked as its own.
create function pos.agent_id() returns uuid language sql stable set search_path = '' as $$
  select case when c ->> 'token_use' = 'pos_access' then (c ->> 'pos_user_id')::uuid end
    from (select pos.jwt_claims() as c) s;
$$;

create function pos.session_scope() returns text language sql stable set search_path = '' as $$
  select case when c ->> 'token_use' = 'pos_access' then c ->> 'scope' end
    from (select pos.jwt_claims() as c) s;
$$;

-- Agent with a full-scope session; ingest_only sessions read nothing (docs/05 §9).
create function pos.agent_full_id() returns uuid language sql stable set search_path = '' as $$
  select case when pos.session_scope() = 'full' and pos.jwt_claims() ->> 'pos_role' = 'pos_agent'
              then pos.agent_id() end;
$$;

-- Admin / bank reader signed in with Supabase Auth.
create function pos.current_staff() returns pos.pos_users
language sql stable security definer set search_path = '' as $$
  select u.*
    from pos.pos_users u,
         (select pos.jwt_claims() as c) s
   where s.c ->> 'token_use' is null
     and s.c ->> 'sub' is not null
     and u.admin_auth_uid = (s.c ->> 'sub')::uuid
     and u.active
     and u.role in ('pos_admin', 'pos_bank_reader')
     and ((s.c ->> 'aal') = 'aal2'
          or coalesce((select (st.value)::text::boolean from pos.settings st where st.key = 'admin.require_mfa'), true) = false);
$$;

create function pos.current_user_id() returns uuid language sql stable set search_path = '' as $$
  select coalesce(pos.agent_id(), (pos.current_staff()).id);
$$;

create function pos.current_pos_role() returns pos.pos_role language sql stable set search_path = '' as $$
  select coalesce(case when pos.agent_id() is not null then (pos.jwt_claims() ->> 'pos_role')::pos.pos_role end,
                  (pos.current_staff()).role);
$$;

create function pos.is_admin() returns boolean language sql stable set search_path = '' as $$
  select coalesce((pos.current_staff()).role = 'pos_admin', false);
$$;

create function pos.has_permission(p_permission text) returns boolean language sql stable set search_path = '' as $$
  select coalesce(p_permission = any ((pos.current_staff()).permissions) and pos.is_admin(), false);
$$;

create function pos.is_agent() returns boolean language sql stable set search_path = '' as $$
  select pos.agent_full_id() is not null;
$$;

-- Admin bank scope: bank_ids null = all banks.
create function pos.can_read_bank(p_bank_id uuid) returns boolean language sql stable set search_path = '' as $$
  select coalesce(s.role = 'pos_admin' and (s.bank_ids is null or p_bank_id = any (s.bank_ids)), false)
    from (select (pos.current_staff()).*) s;
$$;

create function pos.is_bank_reader_for(p_bank_id uuid) returns boolean language sql stable set search_path = '' as $$
  select coalesce(s.role = 'pos_bank_reader' and p_bank_id = any (s.bank_ids), false)
    from (select (pos.current_staff()).*) s;
$$;

-- Job-level helpers (SECURITY DEFINER so policies don't recurse through each other's RLS).
create function pos.admin_can_read_job(p_job_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pos.jobs j where j.id = p_job_id and pos.can_read_bank(j.bank_id));
$$;

create function pos.agent_can_read_job(p_job_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pos.job_assignments a
                  where a.job_id = p_job_id and a.user_id = pos.agent_full_id());
$$;

create function pos.agent_owns_inspection(p_inspection_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pos.inspections i
                  where i.id = p_inspection_id and i.user_id = pos.agent_full_id());
$$;

create function pos.admin_can_read_inspection(p_inspection_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pos.inspections i join pos.jobs j on j.id = i.job_id
                  where i.id = p_inspection_id and pos.can_read_bank(j.bank_id));
$$;

-- Bank readers see approved inspections of their bank only.
create function pos.reader_can_read_inspection(p_inspection_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pos.inspections i join pos.jobs j on j.id = i.job_id
                  where i.id = p_inspection_id and i.status = 'approved' and pos.is_bank_reader_for(j.bank_id));
$$;

create function pos.reader_can_read_job(p_job_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pos.inspections i join pos.jobs j on j.id = i.job_id
                  where j.id = p_job_id and i.status = 'approved' and pos.is_bank_reader_for(j.bank_id));
$$;

insert into pos.settings (key, value, note) values
  ('admin.require_mfa', 'true'::jsonb, 'Admins must have aal2 (TOTP) for any read under RLS');

-- ── Grants ─────────────────────────────────────────────────────────────────────────────────────
grant select on all tables in schema pos to authenticated, service_role;
grant insert, update on pos.definition_drafts to authenticated;
grant execute on all functions in schema pos to authenticated, service_role;

-- ── RLS: enabled on every table ────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
-- (pos.settings has no policy: nobody reads it through the API.)

-- Reference & configuration
create policy banks_read on pos.banks for select to authenticated using (
  (select pos.can_read_bank(id)) or (select pos.is_bank_reader_for(id))
  or exists (select 1 from pos.jobs j where j.bank_id = banks.id and pos.agent_can_read_job(j.id)));
create policy pos_users_read on pos.pos_users for select to authenticated using (
  (select pos.is_admin()) or id = (select pos.current_user_id()));
create policy mcc_read on pos.mcc_codes for select to authenticated using ((select pos.is_admin()) or (select pos.is_agent()));
create policy reason_codes_read on pos.reason_codes for select to authenticated using (
  (bank_id is null and ((select pos.is_admin()) or (select pos.is_agent())))
  or (select pos.can_read_bank(bank_id))
  or ((select pos.is_agent()) and active));
create policy lookup_lists_read on pos.lookup_lists for select to authenticated using (
  (select pos.is_agent()) or bank_id is null and (select pos.is_admin()) or (select pos.can_read_bank(bank_id)));
create policy lookup_list_versions_read on pos.lookup_list_versions for select to authenticated using (
  (select pos.is_agent()) or (select pos.is_admin()));
create policy declarations_read on pos.declarations for select to authenticated using ((select pos.is_admin()) or (select pos.is_agent()));
create policy remote_config_read on pos.remote_config_versions for select to authenticated using (
  (select pos.is_admin()) and (layer <> 'bank' or pos.can_read_bank(subject_id)));
create policy config_snapshots_read on pos.config_snapshots for select to authenticated using ((select pos.is_admin()));
create policy module_releases_read on pos.module_releases for select to authenticated using ((select pos.is_admin()) or (select pos.is_agent()));

-- Identity, sessions, devices
create policy trusted_issuers_read on pos.trusted_issuers for select to authenticated using ((select pos.is_admin()));
create policy external_identities_read on pos.external_identities for select to authenticated using ((select pos.is_admin()));
create policy devices_read on pos.devices for select to authenticated using (
  (select pos.is_admin()) or user_id = (select pos.agent_full_id()));
create policy pos_sessions_read on pos.pos_sessions for select to authenticated using ((select pos.is_admin()));
create policy auth_events_read on pos.auth_events for select to authenticated using ((select pos.is_admin()));

-- Definitions
create policy definition_families_read on pos.definition_families for select to authenticated using (
  (select pos.is_agent()) or bank_id is null and (select pos.is_admin()) or (select pos.can_read_bank(bank_id)));
create policy definition_versions_read on pos.definition_versions for select to authenticated using (
  exists (select 1 from pos.definition_families f where f.id = family_id));
create policy definition_activations_read on pos.definition_activations for select to authenticated using (
  exists (select 1 from pos.definition_families f where f.id = family_id));
create policy definition_drafts_read on pos.definition_drafts for select to authenticated using (
  (select pos.is_admin()) and exists (select 1 from pos.definition_families f where f.id = family_id));
create policy definition_drafts_insert on pos.definition_drafts for insert to authenticated with check (
  (select pos.is_admin()) and exists (select 1 from pos.definition_families f where f.id = family_id)
  and updated_by = (select pos.current_user_id()));
create policy definition_drafts_update on pos.definition_drafts for update to authenticated
  using ((select pos.is_admin()) and exists (select 1 from pos.definition_families f where f.id = family_id))
  with check ((select pos.is_admin()) and updated_by = (select pos.current_user_id()));
create policy approvals_read on pos.approvals for select to authenticated using ((select pos.is_admin()));
create policy definition_test_cases_read on pos.definition_test_cases for select to authenticated using ((select pos.is_admin()));
create policy definition_test_runs_read on pos.definition_test_runs for select to authenticated using ((select pos.is_admin()));
create policy definition_assets_read on pos.definition_assets for select to authenticated using ((select pos.is_admin()) or (select pos.is_agent()));
create policy preview_sessions_read on pos.preview_sessions for select to authenticated using ((select pos.is_admin()));

-- Ingest & custody
create policy ingest_envelopes_read on pos.ingest_envelopes for select to authenticated using (
  (select pos.is_admin()) or user_id = (select pos.agent_full_id()));
create policy ingest_conflicts_read on pos.ingest_conflicts for select to authenticated using ((select pos.is_admin()));
create policy custody_events_read on pos.custody_events for select to authenticated using ((select pos.is_admin()));
create policy device_sync_reports_read on pos.device_sync_reports for select to authenticated using ((select pos.is_admin()));
create policy device_sync_status_read on pos.device_sync_status for select to authenticated using ((select pos.is_admin()));
create policy client_error_reports_read on pos.client_error_reports for select to authenticated using ((select pos.is_admin()));
create policy server_epoch_read on pos.server_epoch for select to authenticated using ((select pos.is_admin()) or (select pos.is_agent()));
create policy alerts_read on pos.alerts for select to authenticated using (
  (select pos.is_admin()) and (bank_id is null or pos.can_read_bank(bank_id)));

-- Jobs
create policy jobs_read on pos.jobs for select to authenticated using (
  (select pos.can_read_bank(bank_id)) or pos.agent_can_read_job(id) or pos.reader_can_read_job(id));
create policy job_transitions_read on pos.job_transitions for select to authenticated using ((select pos.is_admin()) or (select pos.is_agent()));
create policy job_events_read on pos.job_events for select to authenticated using (
  pos.admin_can_read_job(job_id) or pos.agent_can_read_job(job_id));
create policy job_assignments_read on pos.job_assignments for select to authenticated using (
  pos.admin_can_read_job(job_id) or user_id = (select pos.agent_full_id()));
create policy appointment_attempts_read on pos.appointment_attempts for select to authenticated using (pos.admin_can_read_job(job_id));
create policy session_tokens_read on pos.session_tokens for select to authenticated using (pos.admin_can_read_job(job_id));
create policy agent_card_tokens_read on pos.agent_card_tokens for select to authenticated using ((select pos.is_admin()));

-- Inspections & evidence
create policy inspections_read on pos.inspections for select to authenticated using (
  pos.admin_can_read_job(job_id) or user_id = (select pos.agent_full_id())
  or (status = 'approved' and pos.reader_can_read_job(job_id)));
create policy evidence_read on pos.evidence for select to authenticated using (
  pos.admin_can_read_job(job_id) or pos.agent_owns_inspection(inspection_id) or pos.reader_can_read_inspection(inspection_id));
create policy location_traces_read on pos.location_traces for select to authenticated using (
  pos.admin_can_read_inspection(inspection_id) or pos.agent_owns_inspection(inspection_id));
create policy reviews_read on pos.reviews for select to authenticated using (
  pos.admin_can_read_inspection(inspection_id) or pos.agent_owns_inspection(inspection_id)
  or pos.reader_can_read_inspection(inspection_id));
create policy amendments_read on pos.amendments for select to authenticated using (
  pos.admin_can_read_inspection(inspection_id) or pos.reader_can_read_inspection(inspection_id));
create policy form_submissions_read on pos.form_submissions for select to authenticated using (
  (select pos.is_admin()) or user_id = (select pos.agent_full_id()));

-- Async & outputs
create policy notifications_read on pos.notifications for select to authenticated using ((select pos.is_admin()));
create policy evidence_replicas_read on pos.evidence_replicas for select to authenticated using ((select pos.is_admin()));
create policy exports_read on pos.exports for select to authenticated using ((select pos.is_admin()));
create policy api_keys_read on pos.api_keys for select to authenticated using ((select pos.can_read_bank(bank_id)));
create policy audit_log_read on pos.audit_log for select to authenticated using ((select pos.is_admin()));
