-- FESS POS — versioned definitions (docs/04, docs/05 §3).

create table pos.definition_families (
  id          uuid primary key default gen_random_uuid(),
  kind        pos.definition_kind not null,
  key         text not null check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  scope       pos.scope_kind not null default 'global',
  bank_id     uuid references pos.banks (id),
  title       text not null,
  description text,
  created_by  uuid references pos.pos_users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique nulls not distinct (kind, key, bank_id),
  check ((scope = 'global') = (bank_id is null))
);

create table pos.definition_versions (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null references pos.definition_families (id),
  version             integer not null check (version > 0),
  spec_version        text not null check (spec_version ~ '^[0-9]+\.[0-9]+$'),
  definition          jsonb not null check (jsonb_typeof(definition) = 'object'),
  definition_hash     text not null,                          -- sha256(JCS(definition)), hex
  requires            jsonb not null default '{}'::jsonb,
  changelog           jsonb not null default '{}'::jsonb,
  breaking            boolean not null default false,
  analysis            jsonb not null default '{}'::jsonb,
  previous_version_id uuid references pos.definition_versions (id),
  published_by        uuid references pos.pos_users (id),
  approved_by         uuid references pos.pos_users (id),
  published_at        timestamptz not null default now(),
  unique (family_id, version)
);

-- Mutable working copy, one per family. The only table admins write directly (docs/05 §0).
create table pos.definition_drafts (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null unique references pos.definition_families (id),
  definition      jsonb not null check (jsonb_typeof(definition) = 'object'),
  base_version_id uuid references pos.definition_versions (id),
  updated_by      uuid references pos.pos_users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Append-only. Resolution for an agent: among activations in effect now, newest first
-- (effective_from desc, created_at desc), the first whose audience matches. Rollback = a new
-- activation of the previous version (docs/04 §7). See pos.resolve_definition_version().
create table pos.definition_activations (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references pos.definition_families (id),
  version_id     uuid not null references pos.definition_versions (id),
  -- {"type":"all"} | {"type":"agents","user_ids":[…]} | {"type":"percent","percent":10}
  -- | {"type":"attribute","key":"region","values":["GP"]}
  audience       jsonb not null default '{"type":"all"}'::jsonb
                   check (audience ->> 'type' in ('all', 'agents', 'percent', 'attribute')),
  policy         jsonb not null default '{"incompatible":"fallback_version"}'::jsonb,
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  activated_by   uuid references pos.pos_users (id),
  approved_by    uuid references pos.pos_users (id),
  reason         text not null check (length(reason) > 0),
  created_at     timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index definition_activations_family_idx on pos.definition_activations (family_id, effective_from desc);

-- Four-eyes records (D-31). A request row (decision = pending) and a later decision row referencing it.
create table pos.approvals (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('definition_publish', 'definition_activation', 'remote_config', 'block_in_progress')),
  subject_ref  uuid,
  request_ref  uuid references pos.approvals (id),             -- set on decision rows
  payload      jsonb not null default '{}'::jsonb,              -- what is being approved, frozen
  requested_by uuid references pos.pos_users (id),
  approved_by  uuid references pos.pos_users (id),
  decision     pos.approval_decision not null default 'pending',
  note         text,
  at           timestamptz not null default now(),
  check (decision = 'pending' or request_ref is not null)
);
create index approvals_request_idx on pos.approvals (request_ref);

create table pos.definition_test_cases (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references pos.definition_families (id),
  name         text not null,
  context      jsonb not null default '{}'::jsonb,
  steps        jsonb not null default '[]'::jsonb,
  expectations jsonb not null default '{}'::jsonb,
  created_by   uuid references pos.pos_users (id),
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table pos.definition_test_runs (
  id         uuid primary key default gen_random_uuid(),
  version_id uuid not null references pos.definition_versions (id),
  results    jsonb not null,
  passed     boolean not null,
  run_at     timestamptz not null default now()
);

create table pos.definition_assets (
  id           uuid primary key default gen_random_uuid(),
  sha256       text not null unique,
  storage_path text not null unique,
  mime         text not null,
  bytes        bigint not null check (bytes > 0),
  uploaded_by  uuid references pos.pos_users (id),
  created_at   timestamptz not null default now()
);

create table pos.preview_sessions (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  family_id  uuid not null references pos.definition_families (id),
  draft_hash text not null,
  created_by uuid references pos.pos_users (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
