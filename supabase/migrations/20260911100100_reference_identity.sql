-- FESS POS — reference data, configuration, identity, sessions, devices. docs/05 §1–2.

-- ── Banks ──────────────────────────────────────────────────────────────────────────────────────
create table pos.banks (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique check (code ~ '^[A-Z0-9_]{2,16}$'),
  name              text not null check (length(name) between 1 and 200),
  active            boolean not null default true,
  contacts          jsonb not null default '[]'::jsonb check (jsonb_typeof(contacts) = 'array'),
  export_settings   jsonb not null default '{}'::jsonb check (jsonb_typeof(export_settings) = 'object'),
  -- Which outcomes are chargeable under the contract; overrides reason_codes.billable (docs/06 §3, D-43).
  billing_settings  jsonb not null default '{}'::jsonb check (jsonb_typeof(billing_settings) = 'object'),
  four_eyes_enabled boolean not null default false,
  request_id        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── POS users ──────────────────────────────────────────────────────────────────────────────────
create table pos.pos_users (
  id                 uuid primary key default gen_random_uuid(),
  employee_number    text not null unique check (employee_number ~ '^[A-Za-z0-9-]{1,32}$'),
  first_name         text not null,
  last_name          text not null,
  email              text,
  phone              text,
  role               pos.pos_role not null,
  permissions        text[] not null default '{}'
                       check (permissions <@ array['review_inspections', 'approve_definitions', 'schedule_jobs']::text[]),
  active             boolean not null default true,
  deactivated_at     timestamptz,
  deactivated_reason text,
  bank_ids           uuid[],                                   -- null = all banks (D-20)
  attributes         jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  profile_snapshot   jsonb,                                    -- last host profile: display only, never authorises
  photo_path         text,                                     -- storage: profiles bucket
  admin_auth_uid     uuid unique references auth.users (id) on delete set null,
  created_by         uuid references pos.pos_users (id),
  request_id         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (role <> 'pos_agent' or admin_auth_uid is null)       -- agents never sign in with Supabase Auth
);
create index pos_users_role_active_idx on pos.pos_users (role, active);

-- ── Reference lists ────────────────────────────────────────────────────────────────────────────
create table pos.mcc_codes (
  code        text primary key check (code ~ '^[0-9]{4}$'),
  description text not null,
  risk_tier   text not null default 'standard' check (risk_tier in ('low', 'standard', 'elevated', 'high')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table pos.reason_codes (
  id             uuid primary key default gen_random_uuid(),
  category       pos.reason_category not null,
  code           text not null check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  label          text not null,
  description    text,
  requires_note  boolean not null default false,
  requires_photo boolean not null default false,
  billable       boolean not null default false,
  bank_id        uuid references pos.banks (id),               -- null = global
  active         boolean not null default true,
  sort_order     integer not null default 0,
  request_id     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique nulls not distinct (category, code, bank_id)
);

create table pos.lookup_lists (
  id         uuid primary key default gen_random_uuid(),
  key        text not null check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  scope      pos.scope_kind not null default 'global',
  bank_id    uuid references pos.banks (id),
  title      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (key, bank_id),
  check ((scope = 'global') = (bank_id is null))
);

create table pos.lookup_list_versions (
  id           uuid primary key default gen_random_uuid(),
  list_id      uuid not null references pos.lookup_lists (id),
  version      integer not null check (version > 0),
  items        jsonb not null check (jsonb_typeof(items) = 'array'),
  hash         text not null,
  published_by uuid references pos.pos_users (id),
  published_at timestamptz not null default now(),
  unique (list_id, version)
);

create table pos.declarations (
  id           uuid primary key default gen_random_uuid(),
  key          text not null check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  version      integer not null check (version > 0),
  title        text not null,
  text         text not null,
  hash         text not null,
  published_by uuid references pos.pos_users (id),
  published_at timestamptz not null default now(),
  unique (key, version)
);

-- ── Remote config (docs/13 §5) ─────────────────────────────────────────────────────────────────
create table pos.remote_config_versions (
  id             uuid primary key default gen_random_uuid(),
  layer          pos.config_layer not null,
  subject_id     uuid,                                         -- bank id / pos_users id / devices.device_id
  version        integer not null check (version > 0),
  values         jsonb not null check (jsonb_typeof(values) = 'object'),
  schema_version text not null,
  effective_from timestamptz not null default now(),
  set_by         uuid references pos.pos_users (id),
  approved_by    uuid references pos.pos_users (id),
  reason         text not null check (length(reason) > 0),
  created_at     timestamptz not null default now(),
  unique nulls not distinct (layer, subject_id, version),
  check ((layer = 'global') = (subject_id is null))
);

-- A resolved config (all layers merged, client-safe keys only) as delivered to a device. Deduplicated by
-- hash; its id is the `config_version_id` frozen into inspections (docs/13 §5).
create table pos.config_snapshots (
  id              uuid primary key default gen_random_uuid(),
  hash            text not null unique,
  values          jsonb not null,
  source_versions uuid[] not null default '{}',
  created_at      timestamptz not null default now()
);

create table pos.module_releases (
  id           uuid primary key default gen_random_uuid(),
  version      text not null unique check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$'),
  released_at  timestamptz not null default now(),
  status       pos.release_status not null default 'supported',
  api_versions text[] not null default array['1'],
  spec_range   text not null,
  components   jsonb not null default '{}'::jsonb,
  page_types   jsonb not null default '{}'::jsonb,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── Identity (docs/07 §2) ──────────────────────────────────────────────────────────────────────
create table pos.trusted_issuers (
  id                     uuid primary key default gen_random_uuid(),
  key                    text not null unique check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  type                   pos.issuer_type not null,
  title                  text not null,
  issuer                 text,
  audience               text,
  jwks_url               text,
  introspection_url      text,
  -- introspection: how to call the issuer and read the answer — all config, never code (D-05).
  request_template       jsonb not null default '{}'::jsonb,
  subject_claim          text,
  employee_number_source jsonb not null default '{}'::jsonb,
  secret_name            text,                                 -- name of the function secret holding the credential
  primary_issuer         boolean not null default false,       -- may establish a session on its own
  active                 boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table pos.external_identities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references pos.pos_users (id),
  issuer_key text not null references pos.trusted_issuers (key),
  subject    text not null,
  linked_via pos.identity_link_via not null,
  linked_by  uuid references pos.pos_users (id),
  linked_at  timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issuer_key, subject)
);
create index external_identities_user_idx on pos.external_identities (user_id);

create table pos.devices (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references pos.pos_users (id),
  device_id        uuid not null,                             -- generated by the module, kept in Keystore/Keychain
  client_type      pos.client_type not null default 'native',
  platform         text,
  model            text,
  os_version       text,
  host_app_version text,
  module_version   text,
  capabilities     jsonb not null default '{}'::jsonb,
  push_provider    text,
  push_token       text,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_integrity   jsonb,
  revoked_at       timestamptz,
  revoke_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, device_id)
);
create index devices_device_idx on pos.devices (device_id);

create table pos.pos_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references pos.pos_users (id),
  device_id          uuid not null,
  issuer_key         text not null,
  family_id          uuid not null,                           -- rotation family (first session id); reuse revokes all
  refresh_token_hash text not null unique,
  scope              pos.session_scope not null default 'full',
  issued_at          timestamptz not null default now(),
  expires_at         timestamptz not null,
  rotated_from       uuid references pos.pos_sessions (id),
  rotated_at         timestamptz,
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  revoke_reason      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index pos_sessions_user_device_idx on pos.pos_sessions (user_id, device_id);
create index pos_sessions_family_idx on pos.pos_sessions (family_id);

create table pos.auth_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references pos.pos_users (id),
  issuer_key       text,
  event            pos.auth_event_type not null,
  device_id        uuid,
  session_id       uuid,
  ip               text,
  user_agent       text,
  profile_mismatch jsonb,
  detail           jsonb not null default '{}'::jsonb,
  request_id       text,
  at               timestamptz not null default now()
);
create index auth_events_user_at_idx on pos.auth_events (user_id, at desc);
