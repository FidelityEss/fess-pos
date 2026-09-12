-- Queue operations, dead-lettering, notifications, content, scheduled jobs (docs/12 §8–9, docs/06 §2, §5).
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select no_plan();

insert into pos.banks (id, code, name) values ('b0000000-0000-0000-0000-000000000001', 'TBANKA', 'Test Bank A');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, email, bank_ids) values
  ('c0000000-0000-0000-0000-000000000001', 'TA001', 'Ada', 'Admin', 'pos_admin', array['schedule_jobs'], 'ada@test.local', null),
  ('c0000000-0000-0000-0000-000000000002', 'TA002', 'Bo', 'Other', 'pos_admin', array['schedule_jobs'], 'bo@test.local',
   array['b0000000-0000-0000-0000-00000000000f']::uuid[]),
  ('d0000000-0000-0000-0000-000000000001', 'TG001', 'Gugu', 'Agent', 'pos_agent', '{}', null, null);

-- ── queues ─────────────────────────────────────────────────────────────────────────────────────
delete from pgmq.q_export;   -- start from an empty queue whatever the local DB holds (rolled back at the end)
create temp table t_q as select pos_rpc.enqueue('export', '{"export_id": "x"}') as id;
create temp table t_read as select * from pos_rpc.queue_read('export', 30, 10);
select is((select count(*) from t_read), 1::bigint, 'an enqueued message is read');
select is_empty($$select 1 from pos_rpc.queue_read('export', 30, 10)$$, 'a read message is invisible until its visibility timeout');
select lives_ok($$select pos_rpc.queue_retry('export', (select msg_id from t_read), 0)$$, 'retry makes it visible again');
select is((select count(*) from pos_rpc.queue_read('export', 30, 10)), 1::bigint, 'the retried message is read again');
select lives_ok($$select pos_rpc.queue_dead_letter('export', (select msg_id from t_read), '{"export_id": "x"}', 'boom')$$, 'dead-letter');
select is_empty($$select 1 from pgmq.q_export where msg_id = (select msg_id from t_read)$$, 'dead-lettered message leaves the queue');
select isnt_empty($$select 1 from pgmq.q_export_dlq where message ->> 'error' = 'boom' and message ->> 'export_id' = 'x'$$,
                  'and lands in the DLQ with its error');
select isnt_empty($$select 1 from pos.alerts where kind = 'dead_letter'$$, 'dead-lettering alerts admins');
select ok((pos_rpc.queue_depths() ->> 'export_dlq')::int >= 1, 'queue depths report the DLQ');
select lives_ok($$select pos_rpc.cron_reconcile()$$, 'reconcile runs');
select isnt_empty($$select 1 from pos.alerts where kind = 'dlq_depth' and acknowledged_at is null$$, 'reconcile raises the DLQ alert');
create temp table t_ack as select pos_rpc.enqueue('export', '{"n": 2}') as id;
select ok(pos_rpc.queue_ack('export', (select id from t_ack)), 'ack deletes a processed message');

-- ── notifications ──────────────────────────────────────────────────────────────────────────────
insert into pos.jobs (id, bank_id, merchant_name, address) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Spaza One', '{"line1": "x"}');
create temp table t_expected as
  select count(*)::int as n from pos.pos_users u
   where u.active and u.role = 'pos_admin' and 'schedule_jobs' = any (u.permissions)
     and (u.bank_ids is null or 'b0000000-0000-0000-0000-000000000001' = any (u.bank_ids));
select is(pos_rpc.notify_admins('b0000000-0000-0000-0000-000000000001', 'schedule_jobs', 'assignment_expired', 'job',
                                'e0000000-0000-0000-0000-000000000001'), (select n from t_expected),
          'every in-scope scheduler is notified');
select is_empty($$select 1 from pos.notifications where recipient_user_id = 'c0000000-0000-0000-0000-000000000002'$$,
                'a scheduler scoped to another bank is not');
create temp table t_n as select id from pos.notifications where recipient_user_id = 'c0000000-0000-0000-0000-000000000001';
select is(pos_rpc.notification_for_send((select id from t_n)) #>> '{recipient,email}', 'ada@test.local', 'delivery data carries the recipient');
select is(pos_rpc.notification_for_send((select id from t_n)) #>> '{job,merchant_name}', 'Spaza One', 'and the job');
select lives_ok($$select pos_rpc.notification_result((select id from t_n), true, 'log', null, null, false)$$, 'mark sent');
select is((select state::text from pos.notifications where id = (select id from t_n)), 'sent', 'notification sent');
select isnt_empty($$select 1 from pgmq.q_notify where message ->> 'notification_id' = (select id::text from t_n)$$,
                  'the notification was queued in the same transaction');

-- ── content bundle (bank family overrides global) ──────────────────────────────────────────────
insert into pos.definition_families (id, kind, key, scope, bank_id, title) values
  ('90000000-0000-0000-0000-000000000001', 'content', 'zz_test_copy', 'global', null, 'test copy'),
  ('90000000-0000-0000-0000-000000000002', 'content', 'zz_test_copy', 'bank', 'b0000000-0000-0000-0000-000000000001', 'test copy A');
insert into pos.definition_versions (id, family_id, version, spec_version, definition, definition_hash) values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 1, '1.0', '{"strings": {"zz.a": "global", "zz.b": "global"}}', 'h1'),
  ('91000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002', 1, '1.0', '{"strings": {"zz.b": "bank"}}', 'h2');
insert into pos.definition_activations (family_id, version_id, reason) values
  ('90000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 't'),
  ('90000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002', 't');
select is(pos_rpc.content_bundle(null) ->> 'zz.b', 'global', 'global content');
select is(pos_rpc.content_bundle('b0000000-0000-0000-0000-000000000001') ->> 'zz.b', 'bank', 'bank content overrides global keys');
select is(pos_rpc.content_bundle('b0000000-0000-0000-0000-000000000001') ->> 'zz.a', 'global', 'keys the bank does not override fall back to global');

-- ── definition resolution & audiences (docs/04 §7) ─────────────────────────────────────────────
insert into pos.definition_families (id, kind, key, title) values ('90000000-0000-0000-0000-000000000003', 'form', 'zz_resolution_test', 'test');
insert into pos.definition_versions (id, family_id, version, spec_version, definition, definition_hash) values
  ('91000000-0000-0000-0000-000000000031', '90000000-0000-0000-0000-000000000003', 1, '1.0', '{}', 'v1'),
  ('91000000-0000-0000-0000-000000000032', '90000000-0000-0000-0000-000000000003', 2, '1.0', '{}', 'v2');
insert into pos.definition_activations (family_id, version_id, audience, reason, effective_from) values
  ('90000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000031', '{"type": "all"}', 'v1 for all', now() - interval '2 days'),
  ('90000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000032', '{"type": "agents", "user_ids": ["d0000000-0000-0000-0000-000000000001"]}', 'pilot', now() - interval '1 day');
select is(pos.resolve_definition_version('90000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001'),
          '91000000-0000-0000-0000-000000000032'::uuid, 'a named-agent activation wins for that agent');
select is(pos.resolve_definition_version('90000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001'),
          '91000000-0000-0000-0000-000000000031'::uuid, 'everyone else keeps the version activated for all');
insert into pos.definition_activations (family_id, version_id, audience, reason) values
  ('90000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000031', '{"type": "all"}', 'rollback');
select is(pos.resolve_definition_version('90000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001'),
          '91000000-0000-0000-0000-000000000031'::uuid, 'rollback = a newer activation of the previous version');

-- ── assignment expiry (06 §2, D-18) ────────────────────────────────────────────────────────────
update pos.jobs set status = 'scheduled', scheduled_start = now() + interval '1 day', scheduled_end = now() + interval '1 day 2 hours'
 where id = 'e0000000-0000-0000-0000-000000000001';
update pos.jobs set status = 'assigned', assigned_to = 'd0000000-0000-0000-0000-000000000001', assigned_at = now() - interval '30 hours'
 where id = 'e0000000-0000-0000-0000-000000000001';
insert into pos.job_assignments (job_id, user_id, assigned_at) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', now() - interval '30 hours');
select is(pos_rpc.cron_expire_assignments(), 1, 'an assignment unanswered past the timeout expires');
select is((select status::text from pos.jobs where id = 'e0000000-0000-0000-0000-000000000001'), 'scheduled', 'the job returns to SCHEDULED');
select is((select response::text from pos.job_assignments where job_id = 'e0000000-0000-0000-0000-000000000001'), 'expired', 'assignment expired');
select isnt_empty($$select 1 from pos.job_events where type = 'assignment_expired' and actor_role = 'system'$$, 'timeline records the system action');
select is(pos_rpc.cron_expire_assignments(), 0, 'expiry is idempotent');

-- ── worker key ─────────────────────────────────────────────────────────────────────────────────
select ok(pos_rpc.worker_key_valid((select decrypted_secret from vault.decrypted_secrets where name = 'pos_worker_key')), 'the Vault worker key is accepted');
select ok(not pos_rpc.worker_key_valid('nope'), 'any other key is refused');
select ok(pos_rpc.secret_value('pos_session_signing_key') is not null, 'signing key provisioned in Vault');
select ok(pos_rpc.secret_value('some_other_secret') is null, 'secret_value only reveals the allowlisted API secrets');

select * from finish();
rollback;
