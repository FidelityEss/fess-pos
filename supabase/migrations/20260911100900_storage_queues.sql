-- FESS POS — storage buckets and queues (docs/03 §4, docs/12 §6, §8).

-- Buckets: all private. No storage.objects policies are created for anon/authenticated, so clients can
-- only use server-issued signed upload URLs (exact server-derived path, no upsert) and signed download
-- URLs (≤ 15 min) created by the POS API. Only service_role reads/writes directly.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('evidence',         'evidence',         false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'application/json']),
  ('evidence-replica', 'evidence-replica', false, 26214400, null),
  ('reports',          'reports',          false, 104857600, array['application/pdf', 'text/csv', 'application/zip',
                                                                   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('assets',           'assets',           false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']),
  ('profiles',         'profiles',         false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Queues (pgmq) with dead-letter queues. Messages are enqueued in the same transaction as the write
-- that causes them; workers delete only after the effect commits (docs/12 §8).
select pgmq.create('verify_evidence');
select pgmq.create('verify_evidence_dlq');
select pgmq.create('replicate_evidence');
select pgmq.create('replicate_evidence_dlq');
select pgmq.create('notify');
select pgmq.create('notify_dlq');
select pgmq.create('export');
select pgmq.create('export_dlq');
select pgmq.create('reprocess_envelopes');
select pgmq.create('reprocess_envelopes_dlq');

-- Retry policy per queue (docs/12 §8), read by pos_rpc.queue_* and the workers.
insert into pos.settings (key, value, note) values
  ('queues.policy', '{
     "verify_evidence":     {"max_attempts": 10, "vt_seconds": 120, "backoff": {"base_s": 30,  "cap_s": 3600}},
     "replicate_evidence":  {"max_attempts": null, "vt_seconds": 300, "backoff": {"base_s": 60,  "cap_s": 21600}},
     "notify":              {"max_attempts": 8,  "vt_seconds": 60,  "backoff": {"base_s": 60,  "cap_s": 10800}},
     "export":              {"max_attempts": 5,  "vt_seconds": 900, "backoff": {"base_s": 60,  "cap_s": 3600}},
     "reprocess_envelopes": {"max_attempts": 10, "vt_seconds": 120, "backoff": {"base_s": 30,  "cap_s": 3600}}
   }'::jsonb, 'docs/12 §8 retry policy; null max_attempts = unlimited');
