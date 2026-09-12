-- Fix: pos.tg_audit recorded no row_id / before / after for tables whose audit trigger lists no excluded columns
-- (pos_users, banks, jobs, …): with no trigger arguments TG_ARGV is NULL, and `jsonb - NULL::text[]` is NULL. Actor,
-- action, time and the hash chain were always recorded; rows logged before this fix keep their empty images (the log is
-- append-only). Same body as 20260911100700 apart from the coalesce.
create or replace function pos.tg_audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_skip   text[] := coalesce(tg_argv, '{}'::text[]);
  v_before jsonb;
  v_after  jsonb;
  v_row    text;
  v_prev   text;
  v_at     timestamptz := clock_timestamp();
  v_actor  uuid;
  v_role   text;
begin
  if tg_op <> 'INSERT' then v_before := to_jsonb(old) - v_skip; end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new) - v_skip; end if;
  v_row := coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'code', v_before ->> 'code',
                    v_after ->> 'key', v_before ->> 'key');
  v_actor := nullif(current_setting('pos.actor_id', true), '')::uuid;
  v_role := nullif(current_setting('pos.actor_role', true), '');
  if v_actor is null then
    v_actor := pos.current_user_id();
    v_role := coalesce(v_role, pos.current_pos_role()::text);
  end if;

  perform pg_advisory_xact_lock(hashtext('pos.audit_log.chain'));
  select a.hash into v_prev from pos.audit_log a order by a.seq desc limit 1;

  insert into pos.audit_log (table_name, row_id, action, actor_id, actor_role, before, after, at, request_id, prev_hash, hash)
  values (tg_table_name, v_row, tg_op, v_actor, v_role, v_before, v_after, v_at,
          nullif(current_setting('pos.request_id', true), ''), v_prev,
          pos.audit_hash(v_prev, tg_table_name, v_row, tg_op, v_before, v_after, v_at));
  return null;
end $$;
