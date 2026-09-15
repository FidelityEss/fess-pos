-- FESS POS — a bank API key's fingerprint is never readable through the database API (T6-06 follow-up, D-100).
--
-- pos.api_keys is readable by signed-in staff under RLS (api_keys_read: pos.can_read_bank(bank_id)), and the blanket
-- `grant select on all tables in schema pos to authenticated` (20260911100800) included every column, so an admin or a
-- bank viewer with the bank in scope could read key_hash, the SHA-256 the key check looks up. D-100 says the fingerprint
-- is never shown. From here on `authenticated` may read every column except key_hash:
--   - the table-level SELECT is revoked and column-level SELECT granted on the other columns;
--   - a column added later is NOT readable by `authenticated` until a migration grants it (fails closed);
--   - service_role keeps full SELECT, and the security-definer functions (pos_rpc.bank_key_authorize,
--     pos_rpc.admin_api_key_*) run as their owner, so the key check and the admin API are unchanged;
--   - RLS (api_keys_read) is unchanged, so who sees which bank's keys is unchanged.
-- The admin reads only id, label and last_four (exports) and lists keys through the POS API, which never returns key_hash.
--
-- Reverse: `grant select on pos.api_keys to authenticated;` (restores the table-level grant; the column grants then
-- become redundant). Nothing else depends on this.
revoke select on pos.api_keys from authenticated;

do $$
declare v_cols text;
begin
  select string_agg(format('%I', a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'pos.api_keys'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'key_hash';
  execute format('grant select (%s) on pos.api_keys to authenticated', v_cols);
end $$;

comment on column pos.api_keys.key_hash is
  'SHA-256 of the whole key (fpos_<env>_<random>), lower-case hex. The key itself is shown once and never stored (D-100). '
  'Not readable by signed-in staff (20260915140100): only the key check (pos_rpc.bank_key_authorize) and service_role use it.';
