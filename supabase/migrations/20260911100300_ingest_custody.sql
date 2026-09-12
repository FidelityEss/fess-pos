-- FESS POS — ingest landing and data custody (docs/12, docs/05 §6).
-- Landing is a single insert and never refuses data for version, schema or business reasons (docs/12 §5).

create table pos.ingest_envelopes (
  -- identity + payload: immutable (column whitelist trigger)
  id                uuid primary key,                          -- client UUIDv7 = idempotency key
  type              text not null,
  type_version      integer not null,
  api_version       text not null,
  payload           jsonb not null,
  payload_hash      text not null,                             -- as claimed by the device: sha256(JCS(payload)), hex
  stored_hash       text not null,                             -- recomputed by the server on landing
  wrapper           jsonb not null,                            -- the envelope as received, minus payload
  device_id         uuid,
  user_id           uuid references pos.pos_users (id),
  session_id        uuid,
  module_version    text,
  client_type       pos.client_type,
  device_seq        bigint,
  created_at_device timestamptz,
  monotonic_ms      bigint,
  first_request_id  text,
  received_at       timestamptz not null default now(),
  -- state: written only by pos_rpc ingest functions
  state             pos.envelope_state not null default 'received',
  duplicate_of      uuid references pos.ingest_envelopes (id),
  last_request_id   text,
  last_seen_at      timestamptz not null default now(),
  attempts          integer not null default 1,
  waiting_on        jsonb,
  result            jsonb,                                     -- the receipt
  error             jsonb,
  processed_at      timestamptz,
  resolution        text check (resolution in ('reprocessed', 'attached', 'resolved')),
  resolved_by       uuid references pos.pos_users (id),
  resolved_at       timestamptz,
  resolution_note   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index ingest_envelopes_state_idx on pos.ingest_envelopes (state, received_at);
create index ingest_envelopes_device_idx on pos.ingest_envelopes (device_id, received_at);
create index ingest_envelopes_user_idx on pos.ingest_envelopes (user_id, received_at desc);

create table pos.ingest_conflicts (
  id           uuid primary key default gen_random_uuid(),
  envelope_id  uuid not null references pos.ingest_envelopes (id),
  payload      jsonb not null,
  payload_hash text not null,
  stored_hash  text not null,
  wrapper      jsonb not null,
  device_id    uuid,
  request_id   text,
  received_at  timestamptz not null default now()
);
create index ingest_conflicts_envelope_idx on pos.ingest_conflicts (envelope_id);

create table pos.custody_events (
  id           uuid primary key default gen_random_uuid(),
  subject_type pos.custody_subject not null,
  subject_id   uuid not null,
  event        text not null,
  source       pos.custody_source not null,
  at_device    timestamptz,
  monotonic_ms bigint,
  at_server    timestamptz not null default now(),
  device_id    uuid,
  envelope_id  uuid,
  request_id   text,
  detail       jsonb not null default '{}'::jsonb
);
create index custody_events_subject_idx on pos.custody_events (subject_id, at_server);

create table pos.device_sync_reports (
  id                 uuid primary key default gen_random_uuid(),
  envelope_id        uuid unique references pos.ingest_envelopes (id),
  device_id          uuid not null,
  user_id            uuid references pos.pos_users (id),
  device_seq         bigint,
  reported_at_device timestamptz,
  received_at        timestamptz not null default now(),
  pending            jsonb not null default '{}'::jsonb,
  oldest_pending_at  timestamptz,
  last_success_at    timestamptz,
  free_storage_mb    integer,
  battery_restricted boolean,
  module_version     text,
  config_version_id  uuid,
  capabilities       jsonb not null default '{}'::jsonb
);
create index device_sync_reports_device_idx on pos.device_sync_reports (device_id, received_at desc);

-- Latest projection per (user, device) — drives the custody dashboard. Last-writer-wins by device_seq (docs/12 §15).
create table pos.device_sync_status (
  id                 uuid primary key default gen_random_uuid(),
  device_id          uuid not null,
  user_id            uuid not null references pos.pos_users (id),
  last_report_id     uuid references pos.device_sync_reports (id),
  last_device_seq    bigint,
  reported_at_device timestamptz,
  received_at        timestamptz not null default now(),
  pending            jsonb not null default '{}'::jsonb,
  pending_total      integer not null default 0,
  oldest_pending_at  timestamptz,
  last_success_at    timestamptz,
  free_storage_mb    integer,
  battery_restricted boolean,
  module_version     text,
  config_version_id  uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, device_id)
);
create index device_sync_status_oldest_idx on pos.device_sync_status (oldest_pending_at);

create table pos.client_error_reports (
  id                uuid primary key default gen_random_uuid(),
  envelope_id       uuid references pos.ingest_envelopes (id), -- the client_error envelope that carried it
  about_envelope_id uuid,                                      -- the item the device is reporting on
  device_id         uuid,
  user_id           uuid references pos.pos_users (id),
  code              text not null,
  detail            jsonb not null default '{}'::jsonb,
  at                timestamptz,
  received_at       timestamptz not null default now()
);

-- Single row; changed on any restore so devices re-send retained envelopes (docs/12 §12).
create table pos.server_epoch (
  id     smallint primary key default 1 check (id = 1),
  epoch  uuid not null default gen_random_uuid(),
  set_at timestamptz not null default now(),
  reason text not null
);
insert into pos.server_epoch (reason) values ('initial');

-- Operational alerts for admins: dead letters, quarantines, SLO breaches, conflicts (docs/12 §8–9).
create table pos.alerts (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,
  severity        pos.alert_severity not null default 'warning',
  subject_type    text,
  subject_id      uuid,
  bank_id         uuid references pos.banks (id),
  message         text not null,
  detail          jsonb not null default '{}'::jsonb,
  dedupe_key      text,
  acknowledged_by uuid references pos.pos_users (id),
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index alerts_open_idx on pos.alerts (created_at desc) where acknowledged_at is null;
create unique index alerts_dedupe_open_uidx on pos.alerts (dedupe_key) where acknowledged_at is null;  -- one open alert per key
