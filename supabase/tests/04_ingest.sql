-- Ingest pipeline: land raw, then process; receipts; duplicates and conflicts; deferral; evidence verification
-- and promotion; custody (docs/12 §4–7, §15; docs/08 §6).
begin;
-- Hosted projects run tests as a temporary CLI login role without postgres privileges; act as postgres (no-op locally).
set local role postgres;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in extensions locally; on hosted projects `supabase test db --linked` installs it in its own schema.
select set_config('search_path', concat_ws(', ', 'extensions', 'public', (select extnamespace::regnamespace::text from pg_extension where extname = 'pgtap')), true);
select no_plan();

insert into pos.banks (id, code, name) values ('b0000000-0000-0000-0000-000000000001', 'TBANKA', 'Test Bank A');
insert into pos.pos_users (id, employee_number, first_name, last_name, role, permissions, email) values
  ('c0000000-0000-0000-0000-000000000001', 'TA001', 'Ada', 'Admin', 'pos_admin', array['schedule_jobs', 'review_inspections'], 'ada@test.local'),
  ('d0000000-0000-0000-0000-000000000001', 'TG001', 'Gugu', 'Agent', 'pos_agent', '{}', null);
insert into pos.reason_codes (category, code, label, requires_note) values
  ('unable_to_complete', 'business_closed', 'Business closed', false),
  ('assignment_reject', 'too_far', 'Too far', false)
on conflict do nothing;   -- the reference seed has them too
-- jobs 1..5, all assigned to the agent
insert into pos.jobs (id, bank_id, merchant_name, address)
select ('e0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-000000000001', 'Merchant ' || n, '{"line1": "x"}'
  from generate_series(1, 5) n;
update pos.jobs set status = 'scheduled', scheduled_start = now() + interval '1 hour', scheduled_end = now() + interval '3 hours'
 where bank_id = 'b0000000-0000-0000-0000-000000000001';
update pos.jobs set status = 'assigned', assigned_to = 'd0000000-0000-0000-0000-000000000001', assigned_at = now()
 where bank_id = 'b0000000-0000-0000-0000-000000000001';
insert into pos.job_assignments (job_id, user_id)
select id, 'd0000000-0000-0000-0000-000000000001' from pos.jobs where bank_id = 'b0000000-0000-0000-0000-000000000001';

-- envelope helpers (the API computes stored_hash = sha256(JCS(payload)); any stable hash works here)
create function pg_temp.env(p_id text, p_type text, p_payload jsonb, p_seq bigint default 1) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'type', p_type, 'type_version', 1, 'api_version', '1', 'payload_hash', '',
    'device_id', 'f0000000-0000-0000-0000-000000000001', 'device_seq', p_seq, 'module_version', '1.0.0', 'client_type', 'native',
    'created_at_device', '2026-09-11T10:00:00+02:00', 'monotonic_ms', 1000, 'payload', p_payload);
$$;
create function pg_temp.ingest(p_env jsonb, p_validation jsonb default '{"ok": true}') returns jsonb language plpgsql as $$
declare
  v_hash text := pos.sha256_hex((p_env -> 'payload')::text);
  v jsonb;
begin
  p_env := jsonb_set(p_env, '{payload_hash}', to_jsonb(v_hash));
  v := pos_rpc.ingest_land(p_env, v_hash, 'd0000000-0000-0000-0000-000000000001', null, 'test-req');
  if v ->> 'outcome' in ('new', 'retry') then
    return pos_rpc.ingest_apply((p_env ->> 'id')::uuid, p_validation);
  end if;
  return v -> 'receipt';
end $$;

-- ── land + apply, duplicates, conflicts (12 §15 layers 2–3) ─────────────────────────────────────
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000001', 'job_event',
            '{"job_id": "e0000000-0000-0000-0000-000000000001", "action": "accept"}')) ->> 'state', 'committed', 'accept is committed');
select is((select status::text from pos.jobs where id = 'e0000000-0000-0000-0000-000000000001'), 'accepted', 'job ACCEPTED');
select is((select response::text from pos.job_assignments where job_id = 'e0000000-0000-0000-0000-000000000001'), 'accepted', 'assignment accepted');
select isnt_empty($$select 1 from pos.custody_events where subject_id = '01000000-0000-7000-8000-000000000001' and event = 'landed'$$,
                  'custody: landed');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000001', 'job_event',
            '{"job_id": "e0000000-0000-0000-0000-000000000001", "action": "accept"}')) ->> 'state', 'duplicate',
          'the same envelope again is a duplicate with the original receipt');
select is((select attempts from pos.ingest_envelopes where id = '01000000-0000-7000-8000-000000000001'), 2, 'the retry is counted');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000001', 'job_event',
            '{"job_id": "e0000000-0000-0000-0000-000000000001", "action": "reject"}')) ->> 'state', 'conflict',
          'same id, different payload → conflict');
select is((select count(*) from pos.ingest_conflicts where envelope_id = '01000000-0000-7000-8000-000000000001'), 1::bigint,
          'the conflicting payload is kept');
select is((select state::text from pos.ingest_envelopes where id = '01000000-0000-7000-8000-000000000001'), 'committed',
          'the original committed envelope is untouched');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000002', 'job_event',
            '{"job_id": "e0000000-0000-0000-0000-000000000001", "action": "accept"}')) #>> '{result,verdict}', 'superseded',
          'a second accept under a new id is recorded as superseded, not re-applied');

-- ── deferral, rejection, unknown types ─────────────────────────────────────────────────────────
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000003', 'job_event',
            '{"job_id": "e0000000-0000-0000-0000-0000000000ff", "action": "accept"}')) ->> 'state', 'deferred',
          'an event for an unknown job is deferred, not refused');
select is((select waiting_on ->> 'job_id' from pos.ingest_envelopes where id = '01000000-0000-7000-8000-000000000003'),
          'e0000000-0000-0000-0000-0000000000ff', 'deferral records what it waits on');
select is_empty($$select 1 from pos_rpc.reprocess_candidates(100) where envelope_id = '01000000-0000-7000-8000-000000000003'$$,
                'not reprocessed while the dependency is missing');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000004', 'form_submission', '{"answers": {}}'),
                         '{"ok": false, "errors": [{"code": "required", "field_key": "x"}]}') ->> 'state', 'rejected',
          'a payload failing validation is rejected…');
select is((select payload from pos.ingest_envelopes where id = '01000000-0000-7000-8000-000000000004'), '{"answers": {}}'::jsonb,
          '…and kept server-side');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000005', 'lead_created', '{"x": 1}')) ->> 'state', 'deferred',
          'an envelope type without a handler is held (deferred), never refused');
select is((select state::text from pos.ingest_envelopes where id = '01000000-0000-7000-8000-000000000005'), 'received',
          'held envelopes stay received for the reprocessor');

-- ── inspection lifecycle with a session token ──────────────────────────────────────────────────
create temp table t_prep as
  select pos_rpc.sync_prepare('d0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', '{}', false, '{}') as r;
create temp table t_tok as
  select (t ->> 'token') as token, (t ->> 'token_id')::uuid as token_id
    from t_prep, jsonb_array_elements(r -> 'session_tokens') t where t ->> 'job_id' = 'e0000000-0000-0000-0000-000000000001';

select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000010', 'inspection_started', jsonb_build_object(
            'inspection_id', '02000000-0000-7000-8000-000000000001', 'job_id', 'e0000000-0000-0000-0000-000000000001', 'attempt', 1,
            'session_token', (select token from t_tok), 'session_token_id', (select token_id from t_tok),
            'started_at_device', now(), 'geofence_result', '{"inside": true, "method": "inside_fix", "profile": "standalone"}'::jsonb,
            'integrity', '{}'::jsonb, 'context_snapshot', '{}'::jsonb))) ->> 'state', 'committed', 'inspection_started committed');
select is((select status::text from pos.jobs where id = 'e0000000-0000-0000-0000-000000000001'), 'in_progress', 'job IN_PROGRESS');
select ok((select used_at is not null from pos.session_tokens where id = (select token_id from t_tok)), 'session token consumed');
select is((select flags from pos.inspections where id = '02000000-0000-7000-8000-000000000001'), '{}'::text[], 'a clean start carries no flags');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000011', 'inspection_started', jsonb_build_object(
            'inspection_id', '02000000-0000-7000-8000-000000000001', 'job_id', 'e0000000-0000-0000-0000-000000000001', 'attempt', 1))) ->> 'state',
          'duplicate', 'the same inspection started under a new envelope id is a business duplicate');

-- in-progress snapshots: last-writer-wins by device_seq, not arrival order
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000012', 'inspection_snapshot',
            '{"inspection_id": "02000000-0000-7000-8000-000000000001", "answers": {"n": {"v": 5}}}', 5)) #>> '{result,applied}', 'true',
          'snapshot seq 5 applied');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000013', 'inspection_snapshot',
            '{"inspection_id": "02000000-0000-7000-8000-000000000001", "answers": {"n": {"v": 3}}}', 3)) #>> '{result,applied}', 'false',
          'a stale snapshot (seq 3) does not overwrite newer data');

-- traces: re-sent batches collapse on fix_id
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000014', 'traces_batch', jsonb_build_object(
            'inspection_id', '02000000-0000-7000-8000-000000000001', 'fixes', jsonb_build_array(
              jsonb_build_object('fix_id', '04000000-0000-7000-8000-000000000001', 'ts_device', now(), 'lat', -26.2, 'lng', 28.04, 'accuracy_m', 8),
              jsonb_build_object('fix_id', '04000000-0000-7000-8000-000000000002', 'ts_device', now(), 'lat', -26.2, 'lng', 28.04, 'accuracy_m', 9)))))
          #>> '{result,inserted}', '2', 'two fixes stored');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000015', 'traces_batch', jsonb_build_object(
            'inspection_id', '02000000-0000-7000-8000-000000000001', 'fixes', jsonb_build_array(
              jsonb_build_object('fix_id', '04000000-0000-7000-8000-000000000001', 'ts_device', now(), 'lat', -26.2, 'lng', 28.04, 'accuracy_m', 8)))))
          #>> '{result,inserted}', '0', 'a re-sent fix collapses');

-- evidence: meta → uploaded (verification queued in the same transaction) → submission → verified → UNDER_REVIEW
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000016', 'evidence_meta', jsonb_build_object(
            'evidence_id', '03000000-0000-7000-8000-000000000001', 'inspection_id', '02000000-0000-7000-8000-000000000001',
            'field_key', 'external_photos', 'category', 'external', 'type', 'photo', 'sha256', repeat('a', 64), 'bytes', 1234,
            'mime', 'image/jpeg', 'captured_at_device', now(), 'location', jsonb_build_object('lat', -26.2, 'lng', 28.04),
            'accuracy_m', 8, 'is_mocked', false))) ->> 'state', 'committed', 'evidence_meta committed');
select matches((select storage_path from pos.evidence where id = '03000000-0000-7000-8000-000000000001'),
               '^bank/b0000000-0000-0000-0000-000000000001/job/e0000000-0000-0000-0000-000000000001/inspection/02000000-0000-7000-8000-000000000001/03000000-0000-7000-8000-000000000001\.jpg$',
               'storage path is derived by the server');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000017', 'evidence_uploaded',
            '{"evidence_id": "03000000-0000-7000-8000-000000000001"}')) #>> '{result,upload_state}', 'uploaded', 'evidence uploaded');
select ok((select count(*) from pgmq.q_verify_evidence where message ->> 'evidence_id' = '03000000-0000-7000-8000-000000000001') = 1,
          'verification enqueued in the same transaction');

select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000018', 'submission', jsonb_build_object(
            'inspection_id', '02000000-0000-7000-8000-000000000001', 'job_id', 'e0000000-0000-0000-0000-000000000001', 'attempt', 1,
            'session_token_id', (select token_id from t_tok), 'definition_refs', '{}'::jsonb,
            'answers', '{"merchant_name": {"v": "Merchant 1"}}'::jsonb, 'answers_hash', 'ah-1', 'submission_hash', 'sh-1',
            'manifest', jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
              'evidence_id', '03000000-0000-7000-8000-000000000001', 'sha256', repeat('a', 64), 'field_key', 'external_photos', 'bytes', 1234))),
            'geofence', '{"inside": true, "method": "inside_fix", "profile": "standalone"}'::jsonb,
            'integrity', '{}'::jsonb, 'diagnostics', '{}'::jsonb, 'started_at_device', now(), 'submitted_at_device', now(), 'clock_offset_ms', 0)))
            #>> '{result,inspection_status}', 'verifying', 'submission committed; all evidence received → verifying');
select is((select status::text from pos.jobs where id = 'e0000000-0000-0000-0000-000000000001'), 'submitted', 'job SUBMITTED');
select is((select evidence_expected || '/' || evidence_received || '/' || evidence_verified from pos.inspections
            where id = '02000000-0000-7000-8000-000000000001'), '1/1/0', 'completeness counters');

select is(pos_rpc.evidence_verified('03000000-0000-7000-8000-000000000001', repeat('a', 64), 1234) ->> 'upload_state', 'verified',
          'matching server hash → verified');
select is((select status::text from pos.inspections where id = '02000000-0000-7000-8000-000000000001'), 'under_review', 'inspection UNDER_REVIEW');
select is((select status::text from pos.jobs where id = 'e0000000-0000-0000-0000-000000000001'), 'under_review', 'job UNDER_REVIEW');
select ok((select count(*) from pgmq.q_replicate_evidence where message ->> 'evidence_id' = '03000000-0000-7000-8000-000000000001') = 1,
          'replication enqueued after verification');

select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000019', 'submission', jsonb_build_object(
            'inspection_id', '02000000-0000-7000-8000-000000000001', 'job_id', 'e0000000-0000-0000-0000-000000000001', 'attempt', 1,
            'answers_hash', 'ah-1', 'submission_hash', 'sh-1'))) ->> 'state', 'duplicate',
          'an identical second submission is a duplicate (one committed submission per inspection)');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000020', 'submission', jsonb_build_object(
            'inspection_id', '02000000-0000-7000-8000-000000000001', 'job_id', 'e0000000-0000-0000-0000-000000000001', 'attempt', 1,
            'answers_hash', 'ah-2', 'submission_hash', 'sh-2'))) ->> 'state', 'conflict',
          'a different second submission is a conflict, both kept');
select ok((select 'conflicting_submission' = any (flags) from pos.inspections where id = '02000000-0000-7000-8000-000000000001'),
          'the inspection is flagged for review');

-- ── self-sufficient submission without a start, evidence quarantined → INTEGRITY_FAILED ───────
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000030', 'submission', jsonb_build_object(
            'inspection_id', '02000000-0000-7000-8000-000000000002', 'job_id', 'e0000000-0000-0000-0000-000000000002', 'attempt', 1,
            'definition_refs', '{}'::jsonb, 'answers', '{}'::jsonb, 'answers_hash', 'ah-3', 'submission_hash', 'sh-3',
            'manifest', jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
              'evidence_id', '03000000-0000-7000-8000-000000000002', 'sha256', repeat('b', 64)))),
            'started_at_device', now(), 'submitted_at_device', now())))
            #>> '{result,inspection_status}', 'submitted', 'a submission creates its inspection when the start never arrived');
select ok((select 'token_missing' = any (flags) from pos.inspections where id = '02000000-0000-7000-8000-000000000002'),
          'a submission without a session token is flagged, not refused');
select is((select response::text from pos.job_assignments where job_id = 'e0000000-0000-0000-0000-000000000002'), 'accepted',
          'submitting implies acceptance');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000031', 'evidence_meta', jsonb_build_object(
            'evidence_id', '03000000-0000-7000-8000-000000000002', 'inspection_id', '02000000-0000-7000-8000-000000000002',
            'type', 'photo', 'sha256', repeat('b', 64), 'mime', 'image/jpeg'))) ->> 'state', 'committed', 'late evidence meta accepted');
select ok((select in_manifest from pos.evidence where id = '03000000-0000-7000-8000-000000000002'), 'matched to the manifest');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000032', 'evidence_uploaded',
            '{"evidence_id": "03000000-0000-7000-8000-000000000002"}')) ->> 'state', 'committed', 'uploaded');
select is(pos_rpc.evidence_verified('03000000-0000-7000-8000-000000000002', repeat('0', 64), 99) ->> 'upload_state', 'quarantined',
          'hash mismatch → quarantined');
select is((select status::text from pos.inspections where id = '02000000-0000-7000-8000-000000000002'), 'integrity_failed',
          'inspection INTEGRITY_FAILED (still reviewable)');
select is((select status::text from pos.jobs where id = 'e0000000-0000-0000-0000-000000000002'), 'under_review',
          'the job still enters review');
select isnt_empty($$select 1 from pos.alerts where kind = 'evidence_quarantined'$$, 'quarantine alerts admins');

-- ── unable to complete, reject ─────────────────────────────────────────────────────────────────
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000040', 'job_event',
            '{"job_id": "e0000000-0000-0000-0000-000000000003", "action": "unable", "reason_code": "business_closed", "form_answers": {"reason": {"v": "business_closed"}}}'))
          #>> '{result,job_status}', 'unable_to_complete', 'unable to complete applied');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000041', 'job_event',
            '{"job_id": "e0000000-0000-0000-0000-000000000004", "action": "reject", "reason_code": "nope"}')) ->> 'state', 'rejected',
          'an unknown reason code rejects the envelope (kept for the inbox)');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000042', 'job_event',
            '{"job_id": "e0000000-0000-0000-0000-000000000004", "action": "reject", "reason_code": "too_far"}'))
          #>> '{result,job_status}', 'scheduled', 'reject returns the job to SCHEDULED');
select ok((select assigned_to is null from pos.jobs where id = 'e0000000-0000-0000-0000-000000000004'), 'assignee cleared');
select isnt_empty($$select 1 from pos.notifications where template_key = 'notify.job_rejected_by_agent.email'$$, 'schedulers are emailed');

-- ── device status projection ───────────────────────────────────────────────────────────────────
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000050', 'sync_report',
            '{"pending": {"submission": 1, "evidence": 2}, "free_storage_mb": 900}', 10)) ->> 'state', 'committed', 'sync report stored');
select is(pg_temp.ingest(pg_temp.env('01000000-0000-7000-8000-000000000051', 'sync_report', '{"pending": {}}', 5)) ->> 'state', 'committed',
          'an older report is still stored…');
select is((select pending_total from pos.device_sync_status where device_id = 'f0000000-0000-0000-0000-000000000001'), 3,
          '…but cannot overwrite the newer projection');

-- ── audit chain intact after the whole flow ────────────────────────────────────────────────────
select is((select count(*) from pos.audit_log a
            where a.hash <> pos.audit_hash(a.prev_hash, a.table_name, a.row_id, a.action, a.before, a.after, a.at)),
          0::bigint, 'audit chain verifies after the ingest flow');

select * from finish();
rollback;
