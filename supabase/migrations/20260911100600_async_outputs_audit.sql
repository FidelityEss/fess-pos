-- FESS POS — notifications, replicas, exports, API keys, audit log. docs/05 §7.

create table pos.notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references pos.pos_users (id),
  recipient_email   text,                                       -- admin alerts to addresses without a POS user
  channel           pos.notification_channel not null,
  template_key      text not null,
  content_version   uuid references pos.definition_versions (id),
  payload           jsonb not null default '{}'::jsonb,         -- push: content-free hint only (07 §8)
  subject_type      text,
  subject_id        uuid,
  state             pos.notification_state not null default 'queued',
  attempts          integer not null default 0,
  provider          text,
  provider_ref      text,
  last_error        text,
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (recipient_user_id is not null or recipient_email is not null)
);
create index notifications_state_idx on pos.notifications (state, created_at);
create index notifications_recipient_idx on pos.notifications (recipient_user_id, created_at desc);

create table pos.evidence_replicas (
  id              uuid primary key default gen_random_uuid(),
  evidence_id     uuid not null references pos.evidence (id),
  target          text not null,
  path            text not null,
  sha256_verified text not null,
  replicated_at   timestamptz not null default now(),
  unique (evidence_id, target)
);

create table pos.exports (
  id           uuid primary key default gen_random_uuid(),
  type         pos.export_type not null,
  scope        jsonb not null default '{}'::jsonb,
  requested_by uuid references pos.pos_users (id),
  recipient    text,
  status       pos.export_status not null default 'queued',
  storage_path text,
  error        text,
  row_count    integer,
  completed_at timestamptz,
  request_id   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table pos.api_keys (
  id           uuid primary key default gen_random_uuid(),
  bank_id      uuid not null references pos.banks (id),
  key_hash     text not null unique,
  label        text not null,
  scopes       text[] not null default '{}',
  active       boolean not null default true,
  last_used_at timestamptz,
  created_by   uuid references pos.pos_users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Universal append-only audit log with a hash chain (docs/05 §7–8, docs/07 §9).
create table pos.audit_log (
  seq        bigint generated always as identity primary key,
  id         uuid not null default gen_random_uuid() unique,
  table_name text not null,
  row_id     text,
  action     text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id   uuid,
  actor_role text,
  before     jsonb,
  after      jsonb,
  at         timestamptz not null default clock_timestamp(),
  request_id text,
  prev_hash  text,
  hash       text not null
);
create index audit_log_row_idx on pos.audit_log (table_name, row_id);
create index audit_log_at_idx on pos.audit_log (at desc);
