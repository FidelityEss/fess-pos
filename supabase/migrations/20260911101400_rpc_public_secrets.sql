-- FESS POS — API secrets in Vault, public verification (docs/07 §10).
--
-- The POS API reads its signing keys from Vault through pos_rpc.secret_value() at cold start, so no secret is
-- ever typed into a dashboard, a CLI or a file: each project generates its own. An environment variable with the
-- same name upper-cased (e.g. POS_SESSION_SIGNING_KEY) overrides the Vault value (docs/07 §6 secrets).

do $$
declare
  s record;
begin
  for s in select * from (values
      ('pos_session_signing_key', 'HS256 key for POS access tokens (D-32)'),
      ('pos_dev_issuer_secret',   'HS256 key of the stand-in identity issuer used in dev/staging (never production)')
    ) as t(name, description)
  loop
    if not exists (select 1 from vault.secrets where name = s.name) then
      perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), s.name, s.description);
    end if;
  end loop;
end $$;

create function pos_rpc.secret_value(p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select d.decrypted_secret from vault.decrypted_secrets d
   where d.name = p_name and p_name in ('pos_session_signing_key', 'pos_dev_issuer_secret', 'pos_worker_key');
$$;

-- Public verification of an authorisation-card QR (agent card or job card). Returns only what 07 §10 allows:
-- name, masked employee number, status and validity (+ job reference, bank and window for job cards).
-- Unknown, expired, revoked and deactivated all answer `invalid` without saying which (no enumeration signal).
create function pos_rpc.public_verify(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_t pos.agent_card_tokens;
  v_u pos.pos_users;
  v_j pos.jobs;
  v_bank text;
begin
  select * into v_t from pos.agent_card_tokens where token_hash = p_token_hash;
  if not found or v_t.revoked_at is not null or v_t.valid_to <= now() or v_t.valid_from > now() then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_u from pos.pos_users where id = v_t.user_id;
  if not found or not v_u.active or v_u.role <> 'pos_agent' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_t.job_id is not null then
    select * into v_j from pos.jobs where id = v_t.job_id;
    if v_j.assigned_to is distinct from v_u.id or v_j.status in ('cancelled', 'closed', 'approved', 'rejected') then
      return jsonb_build_object('status', 'invalid');
    end if;
    select b.name into v_bank from pos.banks b where b.id = v_j.bank_id;
  end if;
  return jsonb_build_object(
    'status', 'valid',
    'kind', case when v_t.job_id is null then 'agent_card' else 'job_card' end,
    'valid_to', v_t.valid_to,
    'agent', jsonb_build_object('first_name', v_u.first_name, 'last_name', v_u.last_name,
                                'employee_number_masked', repeat('•', greatest(length(v_u.employee_number) - 3, 0)) || right(v_u.employee_number, 3),
                                'photo_path', v_u.photo_path),
    'job', case when v_j.id is null then null else jsonb_build_object(
             'reference', v_j.reference, 'bank', v_bank, 'scheduled_start', v_j.scheduled_start, 'scheduled_end', v_j.scheduled_end) end);
end $$;

-- Issuer configuration for the exchange endpoint.
create function pos_rpc.issuer_get(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(i) from pos.trusted_issuers i where i.key = p_key;
$$;

-- Staff (admin / bank reader) behind a verified Supabase Auth user.
create function pos_rpc.staff_for_auth_uid(p_auth_uid uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', u.id, 'role', u.role, 'permissions', u.permissions, 'bank_ids', u.bank_ids,
                            'active', u.active, 'first_name', u.first_name, 'last_name', u.last_name,
                            'employee_number', u.employee_number, 'email', u.email)
    from pos.pos_users u where u.admin_auth_uid = p_auth_uid;
$$;

create function pos_rpc.setting(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select s.value from pos.settings s where s.key = p_key;
$$;

-- Pinned definition version (validation of submissions and generic form submissions against what the device used).
create function pos_rpc.definition_version_get(p_version_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', v.id, 'family_id', v.family_id, 'kind', f.kind, 'key', f.key, 'version', v.version,
                            'spec_version', v.spec_version, 'definition', v.definition, 'definition_hash', v.definition_hash)
    from pos.definition_versions v join pos.definition_families f on f.id = v.family_id
   where v.id = p_version_id;
$$;

-- Evidence ownership check for upload grants (03 §4: server checks ownership, derives the path).
create function pos_rpc.evidence_for_grant(p_evidence_id uuid, p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'storage_path', e.storage_path, 'upload_state', e.upload_state,
                            'mime', e.mime, 'owner_matches', i.user_id = p_user_id)
    from pos.evidence e join pos.inspections i on i.id = e.inspection_id
   where e.id = p_evidence_id;
$$;
