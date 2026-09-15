-- Exports (T6-03, T6-04, D-102, D-100 (3)): asking (admin and bank key), who may, the frozen scope, the worker's
-- claim, pages, finish and fail, honest states and retry, refusals (requester lost access, too big, format not ready,
-- key switched off), audited downloads, the trace to the source visits, and who reads what under RLS.
-- Allow AND deny cases (DEVELOPMENT-GUIDELINES §3).
begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select no_plan();

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_hint text; v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
  return coalesce(nullif(v_hint, ''), v_state);
end $$;
create temp table ids (name text primary key, id uuid);
grant all on ids to public;
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from ids where name = p_name $$;

-- ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, aud, role) values
  ('eb000000-0000-0000-0000-000000000001', 'exports.global@test.local', 'authenticated', 'authenticated'),
  ('eb000000-0000-0000-0000-000000000002', 'exports.scoped@test.local', 'authenticated', 'authenticated'),
  ('eb000000-0000-0000-0000-000000000003', 'exports.leaver@test.local', 'authenticated', 'authenticated');
insert into pos.banks (id, code, name) values
  ('eb200000-0000-0000-0000-00000000000a', 'EXPBA', 'Export Bank A'),
  ('eb200000-0000-0000-0000-00000000000b', 'EXPBB', 'Export Bank B');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, bank_ids, admin_auth_uid) values
  ('eb100000-0000-0000-0000-000000000001', 'EXP-ADM1', 'Gugu', 'Global', 'pos_admin', '{}', null, 'eb000000-0000-0000-0000-000000000001'),
  ('eb100000-0000-0000-0000-000000000002', 'EXP-ADM2', 'Sipho', 'Scoped', 'pos_admin', '{}', array['eb200000-0000-0000-0000-00000000000b']::uuid[], 'eb000000-0000-0000-0000-000000000002'),
  ('eb100000-0000-0000-0000-000000000003', 'EXP-ADM3', 'Lindi', 'Leaver', 'pos_admin', '{}', array['eb200000-0000-0000-0000-00000000000a']::uuid[], 'eb000000-0000-0000-0000-000000000003'),
  ('eb100000-0000-0000-0000-000000000004', 'EXP-AG1', 'Ade', 'Agent', 'pos_agent', '{}', null, null);
insert into pos.definition_families (id, kind, key, title) values
  ('eb700000-0000-0000-0000-000000000001', 'form', 'exp_site_visit', 'Export site visit'),
  ('eb700000-0000-0000-0000-000000000002', 'flow', 'exp_flow', 'Export flow');
insert into pos.definition_versions (id, family_id, version, spec_version, definition, definition_hash) values
  ('eb800000-0000-0000-0000-000000000001', 'eb700000-0000-0000-0000-000000000001', 1, '1.0',
   '{"kind": "form", "sections": [{"key": "s", "fields": [{"key": "staff_count", "type": "number", "label": "Staff"}]}]}', repeat('d', 64));
insert into pos.jobs (id, bank_id, merchant_name, address) values
  ('eb300000-0000-0000-0000-00000000000a', 'eb200000-0000-0000-0000-00000000000a', 'Spaza A', '{"line1": "1 Main Rd"}'),
  ('eb300000-0000-0000-0000-00000000000c', 'eb200000-0000-0000-0000-00000000000a', 'Spaza A2', '{"line1": "3 Main Rd"}'),
  ('eb300000-0000-0000-0000-00000000000b', 'eb200000-0000-0000-0000-00000000000b', 'Spaza B', '{"line1": "2 Main Rd"}');
-- Bank A: one approved (with the form and a 2 MB photo), one under review. Bank B: one approved.
insert into pos.inspections (id, job_id, attempt, user_id, device_id, status, answers, answers_hash, form_version_id, submitted_at_server) values
  ('eb400000-0000-0000-0000-000000000001', 'eb300000-0000-0000-0000-00000000000a', 1, 'eb100000-0000-0000-0000-000000000004', 'eb500000-0000-0000-0000-000000000001',
   'submitted', '{"staff_count": {"v": 4}}', repeat('1', 64), 'eb800000-0000-0000-0000-000000000001', '2026-09-10 08:00:00+00'),
  ('eb400000-0000-0000-0000-000000000002', 'eb300000-0000-0000-0000-00000000000c', 1, 'eb100000-0000-0000-0000-000000000004', 'eb500000-0000-0000-0000-000000000001',
   'submitted', '{}', null, null, '2026-09-12 08:00:00+00'),
  ('eb400000-0000-0000-0000-000000000003', 'eb300000-0000-0000-0000-00000000000b', 1, 'eb100000-0000-0000-0000-000000000004', 'eb500000-0000-0000-0000-000000000001',
   'submitted', '{}', null, null, '2026-09-10 08:00:00+00');
update pos.inspections set status = 'approved' where id in ('eb400000-0000-0000-0000-000000000001', 'eb400000-0000-0000-0000-000000000003');
update pos.inspections set status = 'under_review' where id = 'eb400000-0000-0000-0000-000000000002';
insert into pos.evidence (id, inspection_id, job_id, type, sha256_client, storage_path, field_key, bytes, upload_state) values
  ('eb600000-0000-0000-0000-000000000001', 'eb400000-0000-0000-0000-000000000001', 'eb300000-0000-0000-0000-00000000000a', 'photo',
   repeat('a', 64), 'bank/eb2/job/eb3/inspection/eb4/eb600000-0000-0000-0000-000000000001.jpg', 'shopfront_photo', 2097152, 'uploaded');
insert into pos.api_keys (id, bank_id, key_hash, label, scopes, created_by, last_four, expires_at) values
  ('eb900000-0000-0000-0000-00000000000a', 'eb200000-0000-0000-0000-00000000000a', repeat('e', 64), 'Bank A feed', array['bank.read'],
   'eb100000-0000-0000-0000-000000000001', 'Ab12', now() + interval '1 month');
select pos_rpc.set_context('eb100000-0000-0000-0000-000000000001', 'pos_admin', 'pgtap-exports');

-- ── Settings and helpers ──────────────────────────────────────────────────────────────────────
select is(pos_rpc.export_formats(), '["csv", "xlsx", "evidence_zip"]'::jsonb, 'CSV, Excel and photo ZIPs can be made');
select is(cardinality(pos_rpc.export_setting_statuses('exports.admin_statuses')), 7, 'an admin export covers every visit after submission');
select is(pos_rpc.setting_int('exports.keep_days', 1, 3650), 30, 'files are kept 30 days');

-- ── Only the POS API reaches the functions ────────────────────────────────────────────────────
set local role authenticated;
select is(pg_temp.err($$select pos_rpc.export_claim(gen_random_uuid())$$), '42501', 'a signed-in client cannot drive the worker');
set local role postgres;
set local role anon;
select is(pg_temp.err($$select pos_rpc.bank_export_request(gen_random_uuid(), gen_random_uuid(), array['approved'], 'csv', '{}')$$), '42501',
          'an anonymous caller cannot ask for a bank export');
set local role postgres;

-- ── Asking ────────────────────────────────────────────────────────────────────────────────────
insert into ids select 'csv_a', (pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000001', 'csv',
          '{"bank_id": "eb200000-0000-0000-0000-00000000000a", "from": "2026-09-01", "to": "2026-09-30"}', ' ') ->> 'id')::uuid;
select ok((select e.status = 'queued' and e.bank_id = 'eb200000-0000-0000-0000-00000000000a' and cardinality(e.statuses) = 7
                  and e.scope = '{"bank_id": "eb200000-0000-0000-0000-00000000000a", "from": "2026-09-01", "to": "2026-09-30"}'::jsonb
                  and e.recipient is null and e.requested_by = 'eb100000-0000-0000-0000-000000000001'
             from pos.exports e where e.id = pg_temp.id('csv_a')),
          'an admin export is queued with its bank, dates and statuses frozen');
select ok(exists (select 1 from pgmq.q_export q where q.message ->> 'export_id' = pg_temp.id('csv_a')::text), 'and a message waits for the worker');
select is(pg_temp.err($$select pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000001', 'pdf', '{}', null)$$), 'POS:VALIDATION_FAILED',
          'a format that can''t be made yet is refused, not left waiting');
select is(pg_temp.err($$select pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000001', 'docx', '{}', null)$$), 'POS:INVALID_REQUEST', 'an unknown format is refused');
select is(pg_temp.err($$select pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000002', 'csv', '{"bank_id": "eb200000-0000-0000-0000-00000000000a"}', null)$$),
          'POS:FORBIDDEN', 'an admin for another bank cannot export this bank');
select is(pg_temp.err($$select pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000002', 'csv', '{}', null)$$), 'POS:VALIDATION_FAILED',
          'a bank-scoped admin must choose a bank');
select is(pg_temp.err($$select pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000004', 'csv', '{}', null)$$), 'POS:FORBIDDEN', 'an agent cannot export');
select is(pg_temp.err($$select pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000001', 'csv', '{"colour": "red"}', null)$$), 'POS:INVALID_REQUEST',
          'an unknown limit is refused');
select is(pg_temp.err($$select pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000001', 'csv', '{"from": "2026-09-30", "to": "2026-09-01"}', null)$$),
          'POS:INVALID_REQUEST', 'the end date can''t be before the start');
select is(pg_temp.err($$select pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000001', 'csv', '{"from": "2026-02-30"}', null)$$), 'POS:INVALID_REQUEST',
          'a date that doesn''t exist is refused');
select is(pg_temp.err($$select pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000001', 'csv',
            '{"bank_id": "eb200000-0000-0000-0000-00000000000a", "job_ids": ["eb300000-0000-0000-0000-00000000000b"]}', null)$$),
          'POS:NOT_FOUND', 'a job of another bank is refused');
select is(pg_temp.err($$select pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000001', 'csv', '{"family_id": "eb700000-0000-0000-0000-000000000002"}', null)$$),
          'POS:NOT_FOUND', 'only a form can be chosen as the form');

-- ── What an export covers ─────────────────────────────────────────────────────────────────────
select is(array(select m.inspection_id from pos_rpc.export_matches(pg_temp.id('csv_a')) m order by m.sort_at),
          array['eb400000-0000-0000-0000-000000000001', 'eb400000-0000-0000-0000-000000000002']::uuid[],
          'bank A''s visits in the dates, in every status after submission, oldest first; not bank B''s');
insert into ids select 'form_a', (pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000001', 'xlsx',
          '{"bank_id": "eb200000-0000-0000-0000-00000000000a", "family_id": "eb700000-0000-0000-0000-000000000001"}', null) ->> 'id')::uuid;
select is(array(select m.inspection_id from pos_rpc.export_matches(pg_temp.id('form_a')) m), array['eb400000-0000-0000-0000-000000000001']::uuid[],
          'choosing a form covers only visits on that form');
insert into ids select 'later', (pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000001', 'csv', '{"from": "2026-09-11", "to": "2026-09-12"}', null) ->> 'id')::uuid;
-- (Other QA visits can fall in these dates too, so only the fixtures are compared.)
select is(array(select m.inspection_id from pos_rpc.export_matches(pg_temp.id('later')) m where m.inspection_id::text like 'eb400000-%'),
          array['eb400000-0000-0000-0000-000000000002']::uuid[], 'the dates are the days the visits reached us; all banks for a global admin');

-- ── The worker: claim, page, fail, retry by itself, finish ────────────────────────────────────
select is(pos_rpc.export_claim(pg_temp.id('csv_a')) #>> '{export,attempts}', '1', 'the worker claims it: try 1');
select is((select status::text from pos.exports where id = pg_temp.id('csv_a')), 'running', 'it shows as being prepared');
select is(pos_rpc.export_claim(pg_temp.id('csv_a')) #>> '{export,attempts}', '2', 'a try that died is picked up again as try 2');
select is(pos_rpc.export_page(pg_temp.id('csv_a'), null, null, 1, false) ->> 'has_more', 'true', 'visits come in pages');
select is(pos_rpc.export_page(pg_temp.id('csv_a'), (pos_rpc.export_page(pg_temp.id('csv_a'), null, null, 1, false) #>> '{last,at}')::timestamptz,
                              (pos_rpc.export_page(pg_temp.id('csv_a'), null, null, 1, false) #>> '{last,id}')::uuid, 1, false) #>> '{items,0,id}',
          'eb400000-0000-0000-0000-000000000002', 'the cursor reaches the next visit');
select is(pos_rpc.export_page(pg_temp.id('csv_a'), null, null, 10, true) #>> '{items,0,answers,staff_count,v}', '4', 'with its answers');
select is(pos_rpc.export_page(pg_temp.id('csv_a'), null, null, 10, true) #>> '{items,0,evidence,0,sha256}', repeat('a', 64), 'and, for photos, its evidence');
select is(pos_rpc.export_versions(array['eb800000-0000-0000-0000-000000000001']::uuid[]) #>> '{eb800000-0000-0000-0000-000000000001,family_key}',
          'exp_site_visit', 'and the pinned form');
select is(pos_rpc.export_fail(pg_temp.id('csv_a'), 1, 'old try', false), null, 'a stale try can''t change it');
select is(pos_rpc.export_fail(pg_temp.id('csv_a'), 2, 'The last try didn''t finish (the file store didn''t answer). It will be tried again by itself.', false) ->> 'status',
          'queued', 'a passing failure goes back to waiting');
select is((select error from pos.exports where id = pg_temp.id('csv_a')), 'The last try didn''t finish (the file store didn''t answer). It will be tried again by itself.',
          'with the reason shown, never a false done');
select is(pos_rpc.export_claim(pg_temp.id('csv_a')) #>> '{export,attempts}', '3', 'try 3');
select is(pg_temp.err(format($$select pos_rpc.export_finish(%L, 2, '{"storage_path": "x", "file_name": "x.csv", "bytes": 1, "sha256": "%s"}', '[]', '[]')$$,
                             pg_temp.id('csv_a'), repeat('f', 64))), 'POS:CONFLICT', 'an old try can''t finish it');
select is(pg_temp.err(format($$select pos_rpc.export_finish(%L, 3, '{"storage_path": "x", "file_name": "x.csv", "bytes": 1}', '[]', '[]')$$, pg_temp.id('csv_a'))),
          'POS:INVALID_REQUEST', 'done needs the file''s fingerprint');
select is(pos_rpc.export_finish(pg_temp.id('csv_a'), 3,
            jsonb_build_object('storage_path', 'exports/a/x/try-3/EXPBA.csv', 'file_name', 'EXPBA.csv', 'mime', 'text/csv', 'bytes', 120, 'sha256', repeat('c', 64)),
            '[{"inspection_id": "eb400000-0000-0000-0000-000000000001", "form_version_id": "eb800000-0000-0000-0000-000000000001", "answers_hash": "1111", "evidence_listed": 1},
              {"inspection_id": "eb400000-0000-0000-0000-000000000002"}]', '[]') ->> 'status', 'done', 'the worker finishes it');
select ok((select e.storage_path is not null and e.sha256 = repeat('c', 64) and e.bytes = 120 and e.inspection_count = 2 and e.row_count = 2
                  and e.expires_at between now() + interval '30 days' - interval '1 minute' and now() + interval '30 days' + interval '1 minute'
             from pos.exports e where e.id = pg_temp.id('csv_a')), 'done carries the file, its size, fingerprint, count and 30-day expiry');
select is((select count(*)::int from pos.export_items where export_id = pg_temp.id('csv_a')), 2, 'every visit in the file is listed');
select is((select count(*)::int from pos.custody_events where event = 'exported' and detail ->> 'export_id' = pg_temp.id('csv_a')::text), 2,
          'and each visit''s chain of custody says it was exported');
select is(pos_rpc.export_finish(pg_temp.id('csv_a'), 3, '{}', '[]', '[]') ->> 'status', 'done', 'finishing twice is harmless');
select is(pos_rpc.export_claim(pg_temp.id('csv_a')) ->> 'run', 'false', 'a done export is not made again');
select throws_ok($$update pos.export_items set answers_hash = 'x'$$, 'P0001', null, 'the list of visits in a file cannot be changed');

select is(pos_rpc.export_claim(pg_temp.id('later')) ->> 'run', 'true', 'the all-banks export is claimed');
select is(pg_temp.err(format($$select pos_rpc.export_finish(%L, 1, jsonb_build_object('storage_path', 'p', 'file_name', 'f', 'bytes', 1, 'sha256', repeat('b', 64)),
            '[{"inspection_id": "eb400000-0000-0000-0000-000000000002"}]', '[{"severity": "critical", "kind": "missing_in_storage", "message": "1 photo couldn''t be found"}]')$$,
            pg_temp.id('later'))), 'OK', 'a file with a problem still finishes');
select ok(exists (select 1 from pos.alerts where kind = 'export_evidence_problem' and subject_id = pg_temp.id('later')), 'and the problem raises an alert');

-- ── Failing for good, and trying again ────────────────────────────────────────────────────────
select is(pos_rpc.export_claim(pg_temp.id('form_a')) ->> 'run', 'true', 'the Excel export is claimed');
select is(pos_rpc.export_fail(pg_temp.id('form_a'), 1, 'It couldn''t be made after 5 tries.', true) ->> 'status', 'failed', 'the last try fails it');
select ok(exists (select 1 from pos.alerts where kind = 'export_failed' and subject_id = pg_temp.id('form_a')), 'with an alert');
select is(pg_temp.err(format($$select pos_rpc.admin_export_retry('eb100000-0000-0000-0000-000000000002', %L)$$, pg_temp.id('form_a'))), 'POS:FORBIDDEN',
          'an admin for another bank cannot try it again');
select is(pos_rpc.admin_export_retry('eb100000-0000-0000-0000-000000000001', pg_temp.id('form_a')) ->> 'status', 'queued', 'an admin tries it again');
select ok((select error is null and failed_at is null from pos.exports where id = pg_temp.id('form_a')), 'the old reason is cleared (it stays in the activity history)');
select is((select count(*)::int from pgmq.q_export q where q.message ->> 'export_id' = pg_temp.id('form_a')::text), 2, 'and it is queued again');
select is(pg_temp.err(format($$select pos_rpc.admin_export_retry('eb100000-0000-0000-0000-000000000001', %L)$$, pg_temp.id('csv_a'))), 'POS:CONFLICT',
          'a ready export is not tried again');

-- ── Refusals at claim time: shown as failed with the reason ───────────────────────────────────
insert into ids select 'leaver', (pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000003', 'csv', '{"bank_id": "eb200000-0000-0000-0000-00000000000a"}', null) ->> 'id')::uuid;
update pos.pos_users set active = false where id = 'eb100000-0000-0000-0000-000000000003';
select is(pos_rpc.export_claim(pg_temp.id('leaver')) ->> 'reason', 'refused', 'an export whose requester left is refused');
select is((select status::text || ': ' || error from pos.exports where id = pg_temp.id('leaver')),
          'failed: The person who asked for this export can no longer use the admin panel, so it wasn''t made.', 'and says why');
update pos.settings set value = '1' where key = 'exports.max_inspections';
insert into ids select 'too_many', (pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000001', 'csv', '{"bank_id": "eb200000-0000-0000-0000-00000000000a"}', null) ->> 'id')::uuid;
select is(pos_rpc.export_claim(pg_temp.id('too_many')) ->> 'error',
          'This covers 2 visits; one export can hold 1 at most. Choose fewer dates or one form, and ask again.', 'too many visits is refused, in words');
update pos.settings set value = '5000' where key = 'exports.max_inspections';
update pos.settings set value = '1' where key = 'exports.max_file_mb';
insert into ids select 'big_zip', (pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000001', 'evidence_zip', '{"bank_id": "eb200000-0000-0000-0000-00000000000a"}', null) ->> 'id')::uuid;
select is(pos_rpc.export_claim(pg_temp.id('big_zip')) ->> 'error',
          'The photos come to about 2 MB; one download can hold 1 MB at most. Choose fewer dates, and ask again.', 'too many photos for one download is refused before any work');
update pos.settings set value = '50' where key = 'exports.max_file_mb';
update pos.settings set value = '["csv"]' where key = 'exports.formats_ready';
select is(pos_rpc.export_claim(pg_temp.id('form_a')) ->> 'error', 'Excel exports can''t be made yet. Nothing was lost: ask again once they are available.',
          'a format switched off after the request is refused, not left waiting');
update pos.settings set value = '["csv", "xlsx", "evidence_zip"]' where key = 'exports.formats_ready';

-- ── Downloads: recorded, scoped, only when ready ──────────────────────────────────────────────
select is(pos_rpc.admin_export_download('eb100000-0000-0000-0000-000000000001', pg_temp.id('csv_a'), '10.0.0.9', 'pgtap') ->> 'storage_path',
          'exports/a/x/try-3/EXPBA.csv', 'an admin gets the file''s place for a signed link');
select ok((select d.by_user = 'eb100000-0000-0000-0000-000000000001' and d.ip = '10.0.0.9' from pos.export_downloads d where d.export_id = pg_temp.id('csv_a')),
          'the download is recorded, with who and from where');
select is((select download_count from pos.exports where id = pg_temp.id('csv_a')), 1, 'and counted');
select ok(exists (select 1 from pos.audit_log a where a.table_name = 'export_downloads' and a.after ->> 'export_id' = pg_temp.id('csv_a')::text),
          'and it is in the activity history');
select throws_ok($$delete from pos.export_downloads$$, 'P0001', null, 'download records cannot be deleted');
select is(pg_temp.err(format($$select pos_rpc.admin_export_download('eb100000-0000-0000-0000-000000000002', %L, null, null)$$, pg_temp.id('csv_a'))), 'POS:FORBIDDEN',
          'an admin for another bank cannot download it');
select is(pg_temp.err(format($$select pos_rpc.admin_export_download('eb100000-0000-0000-0000-000000000001', %L, null, null)$$, pg_temp.id('form_a'))), 'POS:CONFLICT',
          'nothing to download until it is ready');
update pos.exports set expires_at = now() - interval '1 second' where id = pg_temp.id('later');
select is(pg_temp.err(format($$select pos_rpc.admin_export_download('eb100000-0000-0000-0000-000000000001', %L, null, null)$$, pg_temp.id('later'))), 'POS:CONFLICT',
          'nor after it has expired');

-- ── A bank's key ──────────────────────────────────────────────────────────────────────────────
insert into ids select 'bank_csv', (pos_rpc.bank_export_request('eb900000-0000-0000-0000-00000000000a', 'eb200000-0000-0000-0000-00000000000a',
          array['approved', 'rejected'], 'csv', '{"from": "2026-09-01", "form": "exp_site_visit"}') ->> 'id')::uuid;
select ok((select e.api_key_id = 'eb900000-0000-0000-0000-00000000000a' and e.requested_by is null and e.bank_id = 'eb200000-0000-0000-0000-00000000000a'
                  and e.statuses = array['approved', 'rejected'] and e.family_id = 'eb700000-0000-0000-0000-000000000001'
             from pos.exports e where e.id = pg_temp.id('bank_csv')), 'a bank''s key asks for an export of its bank, with its statuses frozen');
select is(array(select m.inspection_id from pos_rpc.export_matches(pg_temp.id('bank_csv')) m), array['eb400000-0000-0000-0000-000000000001']::uuid[],
          'it covers only decided visits, not the one under review');
select is(pos_rpc.bank_export_get('eb200000-0000-0000-0000-00000000000a', pg_temp.id('bank_csv')) ->> 'status', 'queued', 'the bank checks on it: queued');
select is(pg_temp.err(format($$select pos_rpc.bank_export_get('eb200000-0000-0000-0000-00000000000b', %L)$$, pg_temp.id('bank_csv'))), 'POS:NOT_FOUND',
          'another bank cannot see it');
select is(pg_temp.err(format($$select pos_rpc.bank_export_get('eb200000-0000-0000-0000-00000000000a', %L)$$, pg_temp.id('csv_a'))), 'POS:NOT_FOUND',
          'a bank never sees an admin''s export, even of its own bank');
select is(jsonb_array_length(pos_rpc.bank_export_list('eb200000-0000-0000-0000-00000000000a', 50)), 1, 'its list holds only its keys'' exports');
select is(pg_temp.err($$select pos_rpc.bank_export_request('eb900000-0000-0000-0000-00000000000a', 'eb200000-0000-0000-0000-00000000000a', array['approved'], 'csv', '{"form": "nope"}')$$),
          'POS:NOT_FOUND', 'an unknown form key is refused');
select is(pg_temp.err($$select pos_rpc.bank_export_request('eb900000-0000-0000-0000-00000000000a', 'eb200000-0000-0000-0000-00000000000b', array['approved'], 'csv', '{}')$$),
          'POS:UNAUTHENTICATED', 'a key cannot ask for another bank''s export');
select is(pg_temp.err($$select pos_rpc.bank_export_request('eb900000-0000-0000-0000-00000000000a', 'eb200000-0000-0000-0000-00000000000a', array['in_progress'], 'csv', '{}')$$),
          'POS:NOT_READY', 'drafts can never be exported to a bank (fails closed)');
update pos.settings set value = '1' where key = 'exports.bank_max_open';
select is(pg_temp.err($$select pos_rpc.bank_export_request('eb900000-0000-0000-0000-00000000000a', 'eb200000-0000-0000-0000-00000000000a', array['approved'], 'xlsx', '{}')$$),
          'POS:RATE_LIMITED', 'a bank can''t pile up exports');
update pos.settings set value = '3' where key = 'exports.bank_max_open';
select is(pos_rpc.bank_export_download('eb900000-0000-0000-0000-00000000000a', 'eb200000-0000-0000-0000-00000000000a', pg_temp.id('bank_csv'), null, null, 'r1'), null,
          'no link before it is ready');
select is(pos_rpc.export_claim(pg_temp.id('bank_csv')) ->> 'run', 'true', 'the worker claims the bank''s export');
select is(pos_rpc.bank_export_get('eb200000-0000-0000-0000-00000000000a', pg_temp.id('bank_csv')) ->> 'status', 'preparing', 'the bank sees: preparing');
select pos_rpc.export_finish(pg_temp.id('bank_csv'), 1, jsonb_build_object('storage_path', 'exports/b/f.csv', 'file_name', 'f.csv', 'mime', 'text/csv', 'bytes', 5, 'sha256', repeat('a', 64)),
                             '[{"inspection_id": "eb400000-0000-0000-0000-000000000001"}]', '[]');
select is(pos_rpc.bank_export_get('eb200000-0000-0000-0000-00000000000a', pg_temp.id('bank_csv')) #>> '{file,sha256}', repeat('a', 64), 'then: ready, with the file''s fingerprint');
select ok(not (pos_rpc.bank_export_get('eb200000-0000-0000-0000-00000000000a', pg_temp.id('bank_csv')) -> 'file' ? 'storage_path'), 'never the storage path');
select is(pos_rpc.bank_export_download('eb900000-0000-0000-0000-00000000000a', 'eb200000-0000-0000-0000-00000000000a', pg_temp.id('bank_csv'), '10.1.1.1', 'curl', 'r2') ->> 'file_name',
          'f.csv', 'the key gets its download');
select ok(exists (select 1 from pos.export_downloads d where d.export_id = pg_temp.id('bank_csv') and d.by_key = 'eb900000-0000-0000-0000-00000000000a' and d.request_id = 'r2'),
          'recorded against the key');
insert into ids select 'bank_csv2', (pos_rpc.bank_export_request('eb900000-0000-0000-0000-00000000000a', 'eb200000-0000-0000-0000-00000000000a',
          array['approved'], 'csv', '{}') ->> 'id')::uuid;
select is(pos_rpc.export_claim(pg_temp.id('bank_csv2')) ->> 'run', 'true', 'a second bank export is claimed');
select is(pg_temp.err(format($$select pos_rpc.export_finish(%L, 1, jsonb_build_object('storage_path', 'p', 'file_name', 'f', 'bytes', 1, 'sha256', repeat('b', 64)),
            '[{"inspection_id": "eb400000-0000-0000-0000-000000000003"}]', '[]')$$, pg_temp.id('bank_csv2'))),
          'POS:CONFLICT', 'a file can''t hold visits of another bank');
insert into ids select 'revoked', (pos_rpc.bank_export_request('eb900000-0000-0000-0000-00000000000a', 'eb200000-0000-0000-0000-00000000000a',
          array['approved'], 'evidence_zip', '{}') ->> 'id')::uuid;
update pos.api_keys set active = false, revoked_at = now(), revoke_reason = 'test' where id = 'eb900000-0000-0000-0000-00000000000a';
select is(pos_rpc.export_claim(pg_temp.id('revoked')) ->> 'error', 'The API key that asked for this export was switched off or has expired, so it wasn''t made.',
          'switching the key off stops its waiting exports');

-- ── Who reads what (RLS) ──────────────────────────────────────────────────────────────────────
insert into ids select 'csv_b', (pos_rpc.admin_export_request('eb100000-0000-0000-0000-000000000002', 'csv', '{"bank_id": "eb200000-0000-0000-0000-00000000000b"}', null) ->> 'id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eb000000-0000-0000-0000-000000000002","aal":"aal1","role":"authenticated"}', true);
select ok(exists (select 1 from pos.exports where id = pg_temp.id('csv_b')), 'a bank-scoped admin reads their bank''s exports');
select ok(not exists (select 1 from pos.exports where id in (pg_temp.id('csv_a'), pg_temp.id('later'))), 'but not another bank''s, nor an all-banks export');
select ok(not exists (select 1 from pos.export_items where export_id = pg_temp.id('csv_a')), 'nor what is in them');
select ok(not exists (select 1 from pos.export_downloads where export_id = pg_temp.id('csv_a')), 'nor who downloaded them');
select set_config('request.jwt.claims', '{"sub":"eb000000-0000-0000-0000-000000000001","aal":"aal1","role":"authenticated"}', true);
select ok((select count(*) from pos.exports where id in (pg_temp.id('csv_a'), pg_temp.id('later'), pg_temp.id('csv_b'))) = 3, 'a global admin reads every export');
select ok(exists (select 1 from pos.export_items where export_id = pg_temp.id('csv_a')), 'with what is in them');
select set_config('request.jwt.claims', '{"token_use":"pos_access","pos_user_id":"eb100000-0000-0000-0000-000000000004","pos_role":"pos_agent","scope":"full","role":"authenticated"}', true);
select ok(not exists (select 1 from pos.exports where id in (pg_temp.id('csv_a'), pg_temp.id('csv_b'))), 'an agent reads no exports');
set local role postgres;

select finish();
rollback;
