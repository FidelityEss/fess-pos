-- Fix (admin walkthrough, 2026-09-12): admin_envelope_reprocess puts an envelope back to `received` and marks it
-- resolution = 'reprocessed'. 20260911103100 made the reprocessor skip every envelope with a resolution, so reprocessed
-- envelopes were never retried, and admin_envelope_resolve refused them as "already resolved". 'reprocessed' means
-- "open, queued again": the reprocessor picks it up, and a human can still resolve it. 'resolved' / 'attached' stay final.

create or replace function pos_rpc.reprocess_candidates(p_limit integer default 100)
returns table (envelope_id uuid) language sql stable security definer set search_path = '' as $$
  select e.id from pos.ingest_envelopes e
   where (e.resolution is null or e.resolution = 'reprocessed')
     and ((e.state = 'received' and e.received_at < now() - interval '2 minutes'
           and (e.processed_at is null or e.processed_at < now() - interval '5 minutes'))   -- held ones back off
       or (e.state = 'deferred' and (
             (e.waiting_on ? 'job_id' and exists (select 1 from pos.jobs j where j.id = (e.waiting_on ->> 'job_id')::uuid))
          or (e.waiting_on ? 'inspection_id' and exists (select 1 from pos.inspections i where i.id = (e.waiting_on ->> 'inspection_id')::uuid))
          or (e.waiting_on ? 'evidence_id' and exists (select 1 from pos.evidence v where v.id = (e.waiting_on ->> 'evidence_id')::uuid)))))
   order by e.received_at
   limit p_limit;
$$;

create or replace function pos_rpc.admin_envelope_resolve(p_actor uuid, p_envelope_id uuid, p_resolution text, p_note text, p_job_id uuid,
                                               p_reason_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v pos.ingest_envelopes;
  v_job pos.jobs;
begin
  perform pos_rpc.admin_require_global(p_actor);
  if p_resolution not in ('resolved', 'attached') then
    perform pos_rpc.fail('INVALID_REQUEST', 'resolution must be resolved or attached');
  end if;
  if coalesce(btrim(p_note), '') = '' then perform pos_rpc.fail('NOTE_REQUIRED', 'a note is required'); end if;
  select * into v from pos.ingest_envelopes where id = p_envelope_id for update;
  if not found then perform pos_rpc.fail('NOT_FOUND', 'envelope not found'); end if;
  -- held envelopes (e.g. an unknown type) stay `received` with waiting_on.reprocess until processed or resolved here
  if not (v.state in ('rejected', 'conflict', 'deferred') or (v.state = 'received' and v.waiting_on ? 'reprocess')) then
    perform pos_rpc.fail('CONFLICT', format('envelope is %s: only rejected, conflict, deferred or held envelopes are resolved', v.state));
  end if;
  if v.resolution is not null and v.resolution <> 'reprocessed' then perform pos_rpc.fail('CONFLICT', 'envelope already resolved'); end if;
  if p_resolution = 'attached' then
    if p_job_id is null then perform pos_rpc.fail('INVALID_REQUEST', 'job_id is required to attach'); end if;
    select * into v_job from pos.jobs where id = p_job_id for update;
    if not found then perform pos_rpc.fail('NOT_FOUND', 'job not found'); end if;
  end if;
  if p_reason_code is not null then
    perform pos_rpc.require_reason('envelope_resolution', p_reason_code, v_job.bank_id, p_note);
  end if;
  update pos.ingest_envelopes set resolution = p_resolution, resolved_by = p_actor, resolved_at = now(),
                                  resolution_note = coalesce(p_reason_code || ': ', '') || p_note
   where id = p_envelope_id returning * into v;
  if p_resolution = 'attached' then
    perform pos_rpc.job_event(p_job_id, 'envelope_attached', p_actor, 'admin', v_job.status, v_job.status, 'recorded', p_reason_code, p_note,
                              jsonb_build_object('envelope_id', p_envelope_id, 'envelope_type', v.type, 'envelope_state', v.state));
  end if;
  perform pos_rpc.custody('envelope', p_envelope_id, 'resolved', 'server', v.device_id, p_envelope_id,
                          jsonb_build_object('resolution', p_resolution, 'job_id', p_job_id, 'by', p_actor));
  perform pos_rpc.envelope_ack_alerts(p_envelope_id, p_actor);
  return pos.envelope_summary(v);
end $$;
