-- FESS POS — "Preview on a phone" links (T3-12, D-101, docs/04 §10, docs/17 §4.3).
--
-- An admin asks for a link that opens the draft they are working on in the app on a phone. The POS API makes a random
-- token, puts it in the link it shows once, and stores only its SHA-256 fingerprint here, with the preview request
-- ({kind, definition, bundle, context, theme}) exactly as the admin panel drew it. A signed-in agent or tester opens the
-- link in the module, which fetches the request with GET /v1/preview/<token> and draws it in the preview sandbox, where
-- nothing is recorded (D-90). Links expire (preview.link_minutes, 30 by default). Each opening is counted, with who
-- opened it last.
--
-- pos.preview_sessions has existed, empty, since 20260911100200 with a required family_id and a draft_hash. A preview of
-- App settings has no family, and the module needs the request itself, so this migration:
-- - makes family_id optional and adds kind, request, bank_id, open counts, last opener and request_id;
-- - adds pos_rpc.admin_preview_link_create and pos_rpc.preview_link_open (service_role only, like every pos_rpc function);
-- - adds the settings preview.link_minutes and preview.link_templates.
--
-- Expand-only. Reverse: drop the two functions and the two settings rows; the new columns can stay (nullable).

-- ── Settings (fail closed when missing: pos_rpc.setting_int) ──────────────────────────────────
insert into pos.settings (key, value, note) values
  ('preview.link_minutes', '30'::jsonb,
   'How long a "Preview on a phone" link works, in minutes (5 to 1440; T3-12, D-101)'),
  ('preview.link_templates',
   '{"android": "fidelity://fess.com/pos/preview/{token}", "ios": "fess://pos/preview/{token}"}'::jsonb,
   'How a phone opens a preview link, by platform: FESS''s own link schemes (findings/03) with the module''s path '
   '/pos/preview/<token> (HOST_INTEGRATION). {token} is replaced by the link''s token (D-101)')
on conflict (key) do nothing;

-- ── The links ──────────────────────────────────────────────────────────────────────────────────
alter table pos.preview_sessions
  alter column family_id drop not null,
  add column kind           text check (kind in ('form', 'flow', 'view', 'content', 'job_schema', 'app')),
  add column request        jsonb check (request is null or jsonb_typeof(request) = 'object'),
  add column bank_id        uuid references pos.banks (id),
  add column opened_count   integer not null default 0 check (opened_count >= 0),
  add column last_opened_at timestamptz,
  add column last_opened_by uuid references pos.pos_users (id),
  add column request_id     text,
  add constraint preview_sessions_token_hash_sha256 check (token_hash ~ '^[0-9a-f]{64}$');
comment on table pos.preview_sessions is
  '"Preview on a phone" links (T3-12, D-101): the preview request a link''s token opens. Only the token''s SHA-256 is '
  'kept; the token itself is shown once, in the link.';
comment on column pos.preview_sessions.request is
  'The preview request as the admin panel drew it: {kind, definition, bundle, context, theme} (docs/04 §10).';
create index preview_sessions_expires_idx on pos.preview_sessions (expires_at);

-- ── Admin: make a link (docs/03 §5: one pos_rpc.admin_* per write, actor and bank scope re-checked) ─────────────
-- The POS API makes the token and passes only its fingerprint, and the request's canonical hash.
create function pos_rpc.admin_preview_link_create(p_actor uuid, p_input jsonb, p_token_hash text, p_draft_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.preview_sessions;
  v_kind text := p_input ->> 'kind';
  v_request jsonb := p_input -> 'request';
  v_family pos.definition_families;
  v_bank uuid;
  v_minutes integer;
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(p_draft_hash, '') !~ '^[0-9a-f]{64}$' then
    perform pos_rpc.fail('INVALID_REQUEST', 'link fingerprint missing');
  end if;
  if v_kind is null or v_kind not in ('form', 'flow', 'view', 'content', 'job_schema', 'app') then
    perform pos_rpc.fail('INVALID_REQUEST', 'kind must be form, flow, view, content, job_schema or app', jsonb_build_object('path', 'kind'));
  end if;
  if jsonb_typeof(v_request) is distinct from 'object' or jsonb_typeof(v_request -> 'definition') is distinct from 'object'
     or v_request ->> 'kind' is distinct from v_kind then
    perform pos_rpc.fail('INVALID_REQUEST', 'request must be a preview request of the same kind with a definition', jsonb_build_object('path', 'request'));
  end if;
  if octet_length(v_request::text) > 2000000 then
    perform pos_rpc.fail('INVALID_REQUEST', 'this preview is too large to send to a phone', jsonb_build_object('path', 'request'));
  end if;
  if p_input ? 'family_id' and jsonb_typeof(p_input -> 'family_id') <> 'null' then
    select * into v_family from pos.definition_families f where f.id = (p_input ->> 'family_id')::uuid;
    if v_family.id is null then perform pos_rpc.fail('NOT_FOUND', 'definition family not found'); end if;
    if v_family.kind::text <> v_kind then
      perform pos_rpc.fail('INVALID_REQUEST', 'the preview is not of the family''s kind', jsonb_build_object('path', 'kind'));
    end if;
    v_bank := v_family.bank_id;
  elsif p_input ? 'bank_id' and jsonb_typeof(p_input -> 'bank_id') <> 'null' then
    v_bank := (p_input ->> 'bank_id')::uuid;
  end if;
  -- A global preview needs a global admin; a bank's, an admin with that bank in scope.
  perform pos_rpc.admin_require_bank(p_actor, v_bank);
  v_minutes := pos_rpc.setting_int('preview.link_minutes', 5, 1440);
  insert into pos.preview_sessions (token_hash, family_id, draft_hash, created_by, expires_at, kind, request, bank_id, request_id)
  values (p_token_hash, v_family.id, p_draft_hash, p_actor, now() + make_interval(mins => v_minutes), v_kind, v_request, v_bank,
          nullif(current_setting('pos.request_id', true), ''))
  returning * into v;
  return jsonb_build_object(
    'id', v.id,
    'kind', v.kind,
    'family_id', v.family_id,
    'bank_id', v.bank_id,
    'expires_at', v.expires_at,
    'link_templates', coalesce(pos_rpc.setting('preview.link_templates'), '{}'::jsonb)
  );
exception
  when unique_violation then
    perform pos_rpc.fail('ALREADY_EXISTS', 'that link already exists; make another');
    return null;
  when invalid_text_representation then
    perform pos_rpc.fail('INVALID_REQUEST', 'family_id and bank_id must be uuids');
    return null;
end $$;

-- ── Open a link (GET /v1/preview/<token>, a signed-in agent or tester) ───────────────────────────
-- An unknown or expired token reads as not found, the same either way. Opening it counts.
create function pos_rpc.preview_link_open(p_actor uuid, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.preview_sessions;
begin
  if coalesce(p_token_hash, '') ~ '^[0-9a-f]{64}$' then
    update pos.preview_sessions s
       set opened_count = s.opened_count + 1, last_opened_at = now(), last_opened_by = p_actor
     where s.token_hash = p_token_hash and s.expires_at > now() and s.request is not null
    returning * into v;
  end if;
  if v.id is null then
    perform pos_rpc.fail('NOT_FOUND', 'this preview link has expired or does not exist; ask for a new one');
  end if;
  return v.request || jsonb_build_object('kind', v.kind, 'expires_at', v.expires_at);
end $$;
