-- Envelope inbox round trip (docs/12 §5, T4-21): a held envelope is reprocessed by an admin, picked up again by the
-- reprocessor, held again, and can still be resolved; a resolved envelope is never retried.
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select no_plan();

insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, email) values
  ('c0000000-0000-0000-0000-0000000000e1', 'TE001', 'Inbox', 'Admin', 'pos_admin', array['review_inspections'], 'inbox@test.local'),
  ('d0000000-0000-0000-0000-0000000000e1', 'TE002', 'Inbox', 'Agent', 'pos_agent', '{}', null);

create function pg_temp.land(p_id uuid, p_type text, p_payload jsonb) returns jsonb language plpgsql as $$
declare
  v_hash text := pos.sha256_hex(p_payload::text);
  v_env jsonb := jsonb_build_object('id', p_id, 'type', p_type, 'type_version', 1, 'api_version', '1', 'payload_hash', v_hash,
    'device_id', 'f0000000-0000-0000-0000-0000000000e1', 'device_seq', 1, 'module_version', '1.0.0', 'client_type', 'native',
    'created_at_device', '2026-09-12T10:00:00+02:00', 'monotonic_ms', 1000, 'payload', p_payload);
begin
  perform pos_rpc.ingest_land(v_env, v_hash, 'd0000000-0000-0000-0000-0000000000e1', null, 'test-req');
  return pos_rpc.ingest_apply(p_id, '{"ok": true, "computed": {"unknown_type": true}}');
end $$;

-- Backdating received_at is test-only: the column whitelist forbids it, so triggers are bypassed inside this transaction.
create function pg_temp.age(p_id uuid) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  update pos.ingest_envelopes set received_at = now() - interval '10 minutes', processed_at = now() - interval '10 minutes' where id = p_id;
  set local session_replication_role = origin;
end $$;

select is(pg_temp.land('01000000-0000-7000-8000-0000000000e1', 'future_widget', '{"x": 1}') ->> 'state', 'deferred',
          'an unknown envelope type is held (deferred receipt)');
select is((select state::text || '/' || (waiting_on ? 'reprocess')::text from pos.ingest_envelopes where id = '01000000-0000-7000-8000-0000000000e1'),
          'received/true', 'held = received, waiting_on.reprocess');

select lives_ok($$select pos_rpc.admin_envelope_reprocess('c0000000-0000-0000-0000-0000000000e1', '01000000-0000-7000-8000-0000000000e1', 'module fix deployed')$$,
                'an admin reprocesses the held envelope');
select is((select resolution from pos.ingest_envelopes where id = '01000000-0000-7000-8000-0000000000e1'), 'reprocessed', 'marked reprocessed');
select pg_temp.age('01000000-0000-7000-8000-0000000000e1');
select isnt_empty($$select 1 from pos_rpc.reprocess_candidates(100) where envelope_id = '01000000-0000-7000-8000-0000000000e1'$$,
                  'the reprocessor picks a reprocessed envelope up again');

select is(pos_rpc.ingest_apply('01000000-0000-7000-8000-0000000000e1', '{"ok": true, "computed": {"unknown_type": true}}') ->> 'state', 'deferred',
          'still unknown after the retry → held again');
select lives_ok($$select pos_rpc.admin_envelope_resolve('c0000000-0000-0000-0000-0000000000e1', '01000000-0000-7000-8000-0000000000e1',
                  'resolved', 'Sent by a newer module build; nothing to apply', null, null)$$,
                'a reprocessed envelope that is held again can still be resolved');
select is((select resolution from pos.ingest_envelopes where id = '01000000-0000-7000-8000-0000000000e1'), 'resolved', 'resolved');
select pg_temp.age('01000000-0000-7000-8000-0000000000e1');
select is_empty($$select 1 from pos_rpc.reprocess_candidates(100) where envelope_id = '01000000-0000-7000-8000-0000000000e1'$$,
                'a resolved envelope is never retried');
select throws_ok($$select pos_rpc.admin_envelope_resolve('c0000000-0000-0000-0000-0000000000e1', '01000000-0000-7000-8000-0000000000e1',
                   'resolved', 'again', null, null)$$, 'P0001', null, 'resolving twice is refused');

select * from finish();
rollback;
