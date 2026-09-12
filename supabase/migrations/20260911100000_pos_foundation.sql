-- FESS POS — foundation: schemas, extensions, enums, server settings.
-- docs/05 §0. Expand-only; reversible by dropping the pos / pos_rpc schemas on an empty project.
--
-- Schemas
--   pos      tables, views, claim/RLS helpers, trigger functions. `authenticated` gets USAGE + SELECT
--            (filtered by RLS); nothing is writable by clients except admin upserts on definition_drafts.
--   pos_rpc  every write path: pos_rpc.ingest_*, pos_rpc.admin_*, worker and session functions.
--            SECURITY DEFINER, USAGE granted to service_role ONLY, never exposed through PostgREST.
--            Because no client role has USAGE on pos_rpc, the default PUBLIC execute privilege on
--            functions can't be exercised by anon/authenticated (docs/05 §0, §9).

create schema if not exists pos;
create schema if not exists pos_rpc;

comment on schema pos is 'FESS POS domain tables (docs/05). Client reads under RLS; no client writes.';
comment on schema pos_rpc is 'FESS POS write/worker functions. service_role only; called by the POS API (docs/03 §4).';

create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ── Enums ──────────────────────────────────────────────────────────────────────────────────────
create type pos.pos_role as enum ('pos_agent', 'pos_admin', 'pos_bank_reader');
create type pos.session_scope as enum ('full', 'ingest_only');
create type pos.issuer_type as enum ('jwks', 'introspection', 'dev_stub');
create type pos.identity_link_via as enum ('claim', 'issuer_lookup', 'admin');
create type pos.auth_event_type as enum (
  'exchange', 'exchange_refused', 'refresh', 'reuse_detected', 'downgrade', 'revoke', 'link_request', 'reverify'
);
create type pos.client_type as enum ('native', 'web');
create type pos.scope_kind as enum ('global', 'bank');
create type pos.config_layer as enum ('global', 'bank', 'agent', 'device');
create type pos.release_status as enum ('supported', 'deprecated', 'unsupported_for_new_work');
create type pos.reason_category as enum (
  'assignment_reject', 'unable_to_complete', 'cancel', 'geofence_override', 'review_return', 'review_reject',
  'appointment_not_secured', 'reassign', 'unschedule', 'envelope_resolution'
);
create type pos.definition_kind as enum ('form', 'flow', 'job_schema', 'view', 'content', 'app');
create type pos.job_status as enum (
  'pending', 'scheduled', 'assigned', 'accepted', 'in_progress', 'paused', 'submitted', 'under_review',
  'returned', 'approved', 'rejected', 'unable_to_complete', 'appointment_not_secured', 'cancelled', 'closed'
);
create type pos.location_source as enum ('geocoded', 'pinned', 'bank_supplied');
create type pos.assignment_response as enum ('pending', 'accepted', 'rejected', 'expired', 'revoked');
create type pos.contact_channel as enum ('phone', 'email', 'whatsapp', 'in_person', 'other');
create type pos.contact_outcome as enum ('no_answer', 'declined', 'rescheduled', 'confirmed', 'wrong_number', 'other');
create type pos.inspection_status as enum (
  'in_progress', 'paused', 'abandoned', 'submitted', 'verifying', 'integrity_failed', 'under_review',
  'approved', 'returned', 'rejected'
);
create type pos.evidence_type as enum ('photo', 'signature', 'override_photo', 'unable_photo', 'document', 'video', 'audio');
create type pos.upload_state as enum ('pending', 'uploaded', 'verified', 'quarantined');
create type pos.replica_state as enum ('pending', 'replicated', 'failed');
create type pos.trace_event as enum ('fix', 'checkin', 'enter', 'exit', 'pause', 'resume');
create type pos.review_decision as enum ('approved', 'returned', 'rejected');
create type pos.subject_type as enum ('job', 'agent', 'none');
create type pos.envelope_state as enum ('received', 'deferred', 'committed', 'duplicate', 'rejected', 'conflict');
create type pos.custody_subject as enum ('inspection', 'evidence', 'envelope', 'job');
create type pos.custody_source as enum ('device', 'server');
create type pos.notification_channel as enum ('push', 'email');
create type pos.notification_state as enum ('queued', 'sent', 'failed', 'dead');
create type pos.export_type as enum ('pdf', 'csv', 'xlsx', 'evidence_zip', 'spec_pdf', 'billing_csv');
create type pos.export_status as enum ('queued', 'running', 'done', 'failed');
create type pos.approval_decision as enum ('pending', 'approved', 'rejected', 'withdrawn');
create type pos.alert_severity as enum ('info', 'warning', 'critical');

-- ── Server-only settings (never exposed to clients) ────────────────────────────────────────────
-- Environment wiring the database itself needs, e.g. the POS API base URL that pg_cron calls.
-- Not remote config: remote config is client-safe and lives in remote_config_versions.
create table pos.settings (
  key        text primary key check (key ~ '^[a-z][a-z0-9_.]*$'),
  value      jsonb not null,
  note       text,
  updated_at timestamptz not null default now()
);
comment on table pos.settings is 'Server-only environment settings (not remote config, never sent to clients).';

grant usage on schema pos to authenticated, service_role;
grant usage on schema pos_rpc to service_role;
