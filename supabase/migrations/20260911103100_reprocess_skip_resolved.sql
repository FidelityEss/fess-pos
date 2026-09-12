-- The reprocessor must not keep retrying an envelope a human has resolved from the envelope inbox (docs/12 §5): a held
-- envelope (unknown type, never processable here) stays `received`, and once an admin resolves it, it is closed.
-- Same body as 20260911101200 plus `resolution is null`.
create or replace function pos_rpc.reprocess_candidates(p_limit integer default 100)
returns table (envelope_id uuid) language sql stable security definer set search_path = '' as $$
  select e.id from pos.ingest_envelopes e
   where e.resolution is null
     and ((e.state = 'received' and e.received_at < now() - interval '2 minutes'
           and (e.processed_at is null or e.processed_at < now() - interval '5 minutes'))   -- held ones back off
       or (e.state = 'deferred' and (
             (e.waiting_on ? 'job_id' and exists (select 1 from pos.jobs j where j.id = (e.waiting_on ->> 'job_id')::uuid))
          or (e.waiting_on ? 'inspection_id' and exists (select 1 from pos.inspections i where i.id = (e.waiting_on ->> 'inspection_id')::uuid))
          or (e.waiting_on ? 'evidence_id' and exists (select 1 from pos.evidence v where v.id = (e.waiting_on ->> 'evidence_id')::uuid)))))
   order by e.received_at
   limit p_limit;
$$;
