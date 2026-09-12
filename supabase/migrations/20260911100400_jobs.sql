-- FESS POS — jobs, timeline, assignments, appointment scheduling, tokens. docs/05 §2, §4; docs/06.

create sequence pos.job_reference_seq as bigint start 1;

create table pos.jobs (
  id                       uuid primary key default gen_random_uuid(),
  reference                text not null unique check (reference ~ '^POS-[0-9]{4}-[0-9]{6,}$'),
  bank_id                  uuid not null references pos.banks (id),
  external_ref             text,
  merchant_name            text not null check (length(merchant_name) between 1 and 300),
  trading_name             text,
  address                  jsonb not null check (jsonb_typeof(address) = 'object'),
  location                 extensions.geography(point, 4326),
  location_source          pos.location_source,
  location_type            text not null default 'standalone' check (location_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  mcc_code                 text references pos.mcc_codes (code),
  scheduled_start          timestamptz,
  scheduled_end            timestamptz,
  appointment_confirmed_by uuid references pos.pos_users (id),
  appointment_confirmed_at timestamptz,
  onsite_contact           jsonb,
  contact                  jsonb,
  notes                    text,
  attributes               jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  job_schema_version_id    uuid references pos.definition_versions (id),
  status                   pos.job_status not null default 'pending',
  status_changed_at        timestamptz not null default now(),
  assigned_to              uuid references pos.pos_users (id),
  assigned_at              timestamptz,
  geofence_radius_m        integer check (geofence_radius_m between 25 and 500),
  gps_accuracy_max_m       integer check (gps_accuracy_max_m between 5 and 200),
  parent_job_id            uuid references pos.jobs (id),
  flags                    text[] not null default '{}',
  created_by               uuid references pos.pos_users (id),
  closed_at                timestamptz,
  request_id               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start)
);
create index jobs_assigned_status_idx on pos.jobs (assigned_to, status);
create index jobs_bank_schedule_idx on pos.jobs (bank_id, scheduled_start);
create index jobs_status_idx on pos.jobs (status, status_changed_at);
create index jobs_location_idx on pos.jobs using gist (location);

-- The job state machine is code, not configuration (docs/06 §2): the transition trigger checks this table.
create table pos.job_transitions (
  from_status pos.job_status not null,
  to_status   pos.job_status not null,
  actor       text not null check (actor in ('admin', 'scheduler', 'reviewer', 'agent', 'system')),
  note        text,
  primary key (from_status, to_status, actor)
);
insert into pos.job_transitions (from_status, to_status, actor, note) values
  ('pending', 'scheduled', 'scheduler', 'appointment confirmed (06 §1a)'),
  ('pending', 'appointment_not_secured', 'scheduler', 'reason code required'),
  ('pending', 'cancelled', 'admin', null),
  ('scheduled', 'pending', 'scheduler', 'appointment fell through'),
  ('scheduled', 'assigned', 'admin', 'allocate; only scheduled jobs can be allocated'),
  ('scheduled', 'cancelled', 'admin', null),
  ('assigned', 'scheduled', 'agent', 'reject via assignment_reject form'),
  ('assigned', 'scheduled', 'system', 'assignment expired'),
  ('assigned', 'scheduled', 'admin', 'revoke / reassign'),
  ('assigned', 'accepted', 'agent', null),
  ('assigned', 'in_progress', 'agent', 'inspection_started landed before the accept event (order tolerance, 12 §5)'),
  ('assigned', 'submitted', 'agent', 'submission landed before accept/start (order tolerance)'),
  ('assigned', 'unable_to_complete', 'agent', 'unable landed before accept (order tolerance)'),
  ('assigned', 'cancelled', 'admin', null),
  ('accepted', 'in_progress', 'agent', 'inspection_started'),
  ('accepted', 'submitted', 'agent', 'self-sufficient submission (12 §4)'),
  ('accepted', 'unable_to_complete', 'agent', null),
  ('accepted', 'scheduled', 'admin', 'revoke / reassign'),
  ('accepted', 'cancelled', 'admin', null),
  ('in_progress', 'paused', 'system', 'fence exit'),
  ('in_progress', 'submitted', 'agent', null),
  ('in_progress', 'unable_to_complete', 'agent', null),
  ('in_progress', 'cancelled', 'admin', 'agent may still submit offline → submitted_after_cancel'),
  ('paused', 'in_progress', 'agent', 'fence re-entered'),
  ('paused', 'submitted', 'agent', 'resume event may arrive after the submission (order tolerance)'),
  ('paused', 'unable_to_complete', 'agent', null),
  ('paused', 'cancelled', 'admin', null),
  ('submitted', 'under_review', 'system', 'submission committed and manifest verified'),
  ('submitted', 'under_review', 'reviewer', 'review may begin while evidence is outstanding'),
  ('under_review', 'approved', 'reviewer', null),
  ('under_review', 'rejected', 'reviewer', null),
  ('under_review', 'returned', 'reviewer', 'new attempt; job stays RETURNED until the agent starts it'),
  ('submitted', 'approved', 'reviewer', null),
  ('submitted', 'rejected', 'reviewer', null),
  ('submitted', 'returned', 'reviewer', null),
  ('returned', 'in_progress', 'agent', 'new attempt started'),
  ('returned', 'submitted', 'agent', 'new attempt submitted (order tolerance)'),
  ('returned', 'unable_to_complete', 'agent', null),
  ('returned', 'cancelled', 'admin', null),
  ('unable_to_complete', 'cancelled', 'admin', null),
  ('unable_to_complete', 'closed', 'system', null),
  ('approved', 'closed', 'system', null),
  ('rejected', 'closed', 'system', null),
  ('appointment_not_secured', 'closed', 'system', null),
  ('cancelled', 'closed', 'system', null);

create table pos.job_events (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references pos.jobs (id),
  type                text not null,
  actor_id            uuid references pos.pos_users (id),
  actor_role          text,
  from_status         pos.job_status,
  to_status           pos.job_status,
  -- the server's verdict on the action: applied / superseded / recorded (no transition) — docs/08 §6
  verdict             text not null default 'applied' check (verdict in ('applied', 'superseded', 'recorded')),
  reason_code         text,
  note                text,
  form_version_id     uuid references pos.definition_versions (id),
  form_answers        jsonb,
  payload             jsonb not null default '{}'::jsonb,
  device_id           uuid,
  envelope_id         uuid references pos.ingest_envelopes (id),
  request_id          text,
  client_created_at   timestamptz,
  client_monotonic_ms bigint,
  server_received_at  timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
create index job_events_job_idx on pos.job_events (job_id, created_at);
create unique index job_events_envelope_uidx on pos.job_events (envelope_id) where envelope_id is not null;

create table pos.job_assignments (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null references pos.jobs (id),
  user_id              uuid not null references pos.pos_users (id),
  assigned_by          uuid references pos.pos_users (id),
  assigned_at          timestamptz not null default now(),
  response             pos.assignment_response not null default 'pending',
  responded_at         timestamptz,
  reason_code          text,
  note                 text,
  response_envelope_id uuid references pos.ingest_envelopes (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index job_assignments_user_idx on pos.job_assignments (user_id, assigned_at desc);
-- one live assignment per job
create unique index job_assignments_live_uidx on pos.job_assignments (job_id) where response in ('pending', 'accepted');

create table pos.appointment_attempts (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references pos.jobs (id),
  attempted_by   uuid references pos.pos_users (id),
  attempted_at   timestamptz not null default now(),
  channel        pos.contact_channel not null,
  outcome        pos.contact_outcome not null,
  proposed_start timestamptz,
  proposed_end   timestamptz,
  contact_name   text,
  note           text,
  request_id     text,
  created_at     timestamptz not null default now()
);
create index appointment_attempts_job_idx on pos.appointment_attempts (job_id, attempted_at);

-- Pre-issued single-use inspection nonces (docs/07 §3). Only the hash is stored.
create table pos.session_tokens (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references pos.jobs (id),
  user_id               uuid not null references pos.pos_users (id),
  device_id             uuid not null,
  token_hash            text not null unique,
  valid_from            timestamptz not null,
  valid_to              timestamptz not null,
  issued_at             timestamptz not null default now(),
  used_at               timestamptz,
  used_by_inspection_id uuid,
  revoked_at            timestamptz,
  revoke_reason         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (valid_to > valid_from)
);
create index session_tokens_job_user_idx on pos.session_tokens (job_id, user_id, device_id);

-- Tokens behind the authorisation-card QRs (docs/07 §10): job_id null = agent card, set = job card.
create table pos.agent_card_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references pos.pos_users (id),
  job_id        uuid references pos.jobs (id),
  token_hash    text not null unique,
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz not null,
  revoked_at    timestamptz,
  revoke_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (valid_to > valid_from)
);
create index agent_card_tokens_user_idx on pos.agent_card_tokens (user_id, valid_to desc);
