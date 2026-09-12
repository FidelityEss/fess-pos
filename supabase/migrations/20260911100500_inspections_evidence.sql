-- FESS POS — inspections, evidence, traces, reviews, amendments, generic form submissions. docs/05 §5.

create table pos.inspections (
  id                     uuid primary key,                     -- device UUIDv7
  job_id                 uuid not null references pos.jobs (id),
  attempt                integer not null check (attempt > 0),
  user_id                uuid not null references pos.pos_users (id),
  device_id              uuid not null,
  client_type            pos.client_type not null default 'native',
  session_token_id       uuid references pos.session_tokens (id),
  form_version_id        uuid references pos.definition_versions (id),
  definition_hash        text,
  flow_version_id        uuid references pos.definition_versions (id),
  flow_hash              text,
  job_schema_version_id  uuid references pos.definition_versions (id),
  config_version_id      uuid references pos.config_snapshots (id),
  context_snapshot       jsonb,
  status                 pos.inspection_status not null,
  started_at_device      timestamptz,
  started_at_server      timestamptz,
  submitted_at_device    timestamptz,
  submitted_at_server    timestamptz,
  clock_offset_ms        integer,
  answers                jsonb,
  answers_hash           text,
  submission_hash        text,
  manifest               jsonb,
  evidence_expected      integer not null default 0,
  evidence_received      integer not null default 0,
  evidence_verified      integer not null default 0,
  geofence_result        jsonb,
  integrity              jsonb,
  diagnostics            jsonb,
  flags                  text[] not null default '{}',
  unable_reason_code     text,
  unable_answers         jsonb,
  -- in-progress snapshot (inspection_snapshot envelopes): last-writer-wins by device_seq (12 §15)
  snapshot_answers       jsonb,
  snapshot_device_seq    bigint,
  started_envelope_id    uuid references pos.ingest_envelopes (id),
  submission_envelope_id uuid references pos.ingest_envelopes (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (job_id, attempt)                                     -- business key (12 §15)
);
create index inspections_user_idx on pos.inspections (user_id, created_at desc);
create index inspections_status_idx on pos.inspections (status, submitted_at_server);
create index inspections_answers_gin on pos.inspections using gin (answers jsonb_path_ops);

create table pos.evidence (
  id                       uuid primary key,                   -- device UUIDv7
  inspection_id            uuid not null references pos.inspections (id),
  job_id                   uuid not null references pos.jobs (id),
  field_key                text,
  category                 text,
  type                     pos.evidence_type not null,
  sha256_client            text not null check (sha256_client ~ '^[0-9a-f]{64}$'),
  sha256_server            text,
  integrity_verified       boolean,
  storage_path             text not null unique,               -- server-derived (docs/03 §4)
  bytes                    bigint,
  mime                     text,
  width                    integer,
  height                   integer,
  captured_at_device       timestamptz,
  captured_at_monotonic_ms bigint,
  gnss_time                timestamptz,
  location                 extensions.geography(point, 4326),
  accuracy_m               numeric(8, 2),
  is_mocked                boolean,
  session_token_id         uuid,
  in_manifest              boolean not null default false,
  upload_state             pos.upload_state not null default 'pending',
  replica_state            pos.replica_state not null default 'pending',
  uploaded_at              timestamptz,
  verified_at              timestamptz,
  quarantined_reason       text,
  meta                     jsonb not null default '{}'::jsonb,
  envelope_id              uuid references pos.ingest_envelopes (id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index evidence_inspection_idx on pos.evidence (inspection_id);
create index evidence_upload_state_idx on pos.evidence (upload_state);
create index evidence_replica_state_idx on pos.evidence (replica_state);
create index evidence_hash_idx on pos.evidence (inspection_id, sha256_client);

create table pos.location_traces (
  id              uuid primary key default gen_random_uuid(),
  fix_id          uuid not null unique,                         -- device UUIDv7; re-sent batches collapse
  inspection_id   uuid not null references pos.inspections (id),
  ts_device       timestamptz not null,
  ts_monotonic_ms bigint,
  gnss_ts         timestamptz,
  location        extensions.geography(point, 4326) not null,
  accuracy_m      numeric(8, 2),
  speed           numeric(8, 2),
  is_mocked       boolean,
  inside_fence    boolean,
  event           pos.trace_event not null default 'fix',
  envelope_id     uuid references pos.ingest_envelopes (id),
  created_at      timestamptz not null default now()
);
create index location_traces_inspection_idx on pos.location_traces (inspection_id, ts_device);

create table pos.reviews (
  id                    uuid primary key default gen_random_uuid(),
  inspection_id         uuid not null references pos.inspections (id),
  reviewer_id           uuid not null references pos.pos_users (id),
  decision              pos.review_decision not null,
  reason_code           text,
  note                  text,
  override_acknowledged boolean not null default false,
  decided_at            timestamptz not null default now(),
  request_id            text
);
create unique index reviews_one_per_inspection_uidx on pos.reviews (inspection_id);

create table pos.amendments (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references pos.inspections (id),
  author_id     uuid not null references pos.pos_users (id),
  field_key     text not null,
  old_value     jsonb,
  new_value     jsonb,
  justification text not null check (length(justification) > 0),
  created_at    timestamptz not null default now()
);

create table pos.form_submissions (
  id                  uuid primary key,                         -- device UUIDv7
  form_version_id     uuid not null references pos.definition_versions (id),
  definition_hash     text not null,
  subject_type        pos.subject_type not null,
  subject_id          uuid,
  user_id             uuid not null references pos.pos_users (id),
  device_id           uuid,
  answers             jsonb not null,
  answers_hash        text not null,
  flags               text[] not null default '{}',
  submitted_at_device timestamptz,
  submitted_at_server timestamptz not null default now(),
  envelope_id         uuid references pos.ingest_envelopes (id),
  created_at          timestamptz not null default now()
);
create index form_submissions_subject_idx on pos.form_submissions (subject_type, subject_id);
