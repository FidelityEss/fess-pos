-- Integrity mechanisms (docs/05 §8): append-only tables, no deletes, column whitelists, transitions, audit chain.
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select no_plan();

insert into pos.banks (id, code, name) values ('b0000000-0000-0000-0000-000000000001', 'TBANKA', 'Test Bank A');
insert into pos.pos_users (id, employee_number, first_name, last_name, role) values
  ('d0000000-0000-0000-0000-000000000001', 'TG001', 'Gugu', 'Agent', 'pos_agent');

-- ── jobs ───────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$insert into pos.jobs (bank_id, merchant_name, address, status)
                   values ('b0000000-0000-0000-0000-000000000001', 'x', '{}', 'approved')$$,
                 'P0001', null, 'a job cannot be created in any state but PENDING');
insert into pos.jobs (id, bank_id, merchant_name, address) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Spaza One', '{"line1": "1 Main Rd"}');
select matches((select reference from pos.jobs where id = 'e0000000-0000-0000-0000-000000000001'), '^POS-[0-9]{4}-[0-9]{6}$',
               'job reference is generated server-side as POS-YYYY-NNNNNN');
select throws_ok($$update pos.jobs set status = 'approved' where id = 'e0000000-0000-0000-0000-000000000001'$$,
                 'P0001', null, 'PENDING → APPROVED is refused by the transition trigger');
select throws_ok($$update pos.jobs set reference = 'POS-2026-999999' where id = 'e0000000-0000-0000-0000-000000000001'$$,
                 'P0001', null, 'job reference is immutable');
select lives_ok($$update pos.jobs set status = 'scheduled' where id = 'e0000000-0000-0000-0000-000000000001'$$, 'PENDING → SCHEDULED allowed');
select throws_ok($$delete from pos.jobs where id = 'e0000000-0000-0000-0000-000000000001'$$, 'P0001', null, 'jobs are never deleted');
select isnt_empty($$select 1 from pos.audit_log where table_name = 'jobs' and action = 'UPDATE'$$, 'job updates are audited');

-- ── append-only ────────────────────────────────────────────────────────────────────────────────
insert into pos.job_events (id, job_id, type) values ('11000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'note');
select throws_ok($$update pos.job_events set note = 'x' where id = '11000000-0000-0000-0000-000000000001'$$, 'P0001', null, 'job_events are append-only (update)');
select throws_ok($$delete from pos.job_events where id = '11000000-0000-0000-0000-000000000001'$$, 'P0001', null, 'job_events are append-only (delete)');
select throws_ok('truncate pos.job_events cascade', 'P0001', null, 'job_events cannot be truncated');
select throws_ok($$update pos.job_transitions set note = 'x'$$, 'P0001', null, 'the state machine table is immutable');
select throws_ok($$update pos.audit_log set actor_role = 'x'$$, 'P0001', null, 'the audit log is append-only');

-- ── assignments: one response each ─────────────────────────────────────────────────────────────
insert into pos.job_assignments (id, job_id, user_id) values
  ('12000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001');
select lives_ok($$update pos.job_assignments set response = 'accepted' where id = '12000000-0000-0000-0000-000000000001'$$, 'pending → accepted');
select throws_ok($$update pos.job_assignments set response = 'rejected' where id = '12000000-0000-0000-0000-000000000001'$$,
                 'P0001', null, 'accepted → rejected refused (first response wins)');
select throws_ok($$insert into pos.job_assignments (job_id, user_id) values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001')$$,
                 '23505', null, 'only one live assignment per job');

-- ── inspections: sealed once submitted ─────────────────────────────────────────────────────────
select throws_ok($$insert into pos.inspections (id, job_id, attempt, user_id, device_id, status)
                   values ('13000000-0000-0000-0000-000000000009', 'e0000000-0000-0000-0000-000000000001', 9,
                           'd0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'approved')$$,
                 'P0001', null, 'an inspection cannot be created already approved');
insert into pos.inspections (id, job_id, attempt, user_id, device_id, status, answers) values
  ('13000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 1,
   'd0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'in_progress', '{"a": {"v": 1}}');
select lives_ok($$update pos.inspections set answers = '{"a": {"v": 2}}' where id = '13000000-0000-0000-0000-000000000001'$$,
                'in-progress inspection is mutable');
select lives_ok($$update pos.inspections set status = 'submitted' where id = '13000000-0000-0000-0000-000000000001'$$, 'in_progress → submitted');
select throws_ok($$update pos.inspections set answers = '{"a": {"v": 3}}' where id = '13000000-0000-0000-0000-000000000001'$$,
                 'P0001', null, 'submitted inspection answers are immutable');
select lives_ok($$update pos.inspections set flags = array['x'] where id = '13000000-0000-0000-0000-000000000001'$$,
                'flags remain writable after sealing (server-side flags)');
select throws_ok($$update pos.inspections set status = 'in_progress' where id = '13000000-0000-0000-0000-000000000001'$$,
                 'P0001', null, 'submitted → in_progress refused');

-- ── evidence column whitelist ──────────────────────────────────────────────────────────────────
insert into pos.evidence (id, inspection_id, job_id, type, sha256_client, storage_path) values
  ('14000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'photo', repeat('a', 64), 'bank/x/job/y/inspection/z/14000000-0000-0000-0000-000000000001.jpg');
select throws_ok($$update pos.evidence set sha256_client = repeat('b', 64) where id = '14000000-0000-0000-0000-000000000001'$$,
                 'P0001', null, 'evidence client hash is immutable');
select throws_ok($$update pos.evidence set storage_path = 'elsewhere' where id = '14000000-0000-0000-0000-000000000001'$$,
                 'P0001', null, 'evidence storage path is immutable');
select lives_ok($$update pos.evidence set upload_state = 'uploaded' where id = '14000000-0000-0000-0000-000000000001'$$,
                'evidence state columns are writable');
select throws_ok($$insert into pos.evidence (id, inspection_id, job_id, type, sha256_client, storage_path) values
                   ('14000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
                    'photo', repeat('c', 64), 'bank/x/job/y/inspection/z/14000000-0000-0000-0000-000000000001.jpg')$$,
                 '23505', null, 'storage paths are unique (objects are never overwritten)');

-- ── audit hash chain ───────────────────────────────────────────────────────────────────────────
select is((select count(*) from pos.audit_log a
            where a.hash <> pos.audit_hash(a.prev_hash, a.table_name, a.row_id, a.action, a.before, a.after, a.at)),
          0::bigint, 'every audit row hash recomputes');
select is((select count(*) from (select a.prev_hash, lag(a.hash) over (order by a.seq) as expected from pos.audit_log a) x
            where x.prev_hash is distinct from x.expected),
          0::bigint, 'audit rows chain to their predecessor');

select * from finish();
rollback;
