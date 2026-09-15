'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, RotateCw, Search, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyButton } from '@/components/copy-button';
import { DateTime } from '@/components/date-time';
import { Details } from '@/components/details';
import { apiFieldErrors, type FieldErrors, FormField, zodFieldErrors } from '@/components/form-field';
import { JsonView } from '@/components/json-view';
import { useNextStepToast } from '@/components/next-step';
import { ReasonCodeSelect } from '@/components/reason-code-select';
import { ToneBadge } from '@/components/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { shortId } from '@/lib/format';
import { labelFrom } from '@/lib/labels';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import { envelopeResolveSchema } from '@/lib/schemas';
import { ENVELOPE_STATE_LABEL, ENVELOPE_STATE_TONE, JOB_STATUS_LABEL, JOB_STATUS_TONE } from '@/lib/status';
import { fetchMaybeRow, fetchRows, pos } from '@/lib/supabase';
import type { CustodyEvent, IngestConflict, IngestEnvelope, Job } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';
import { LineDiffView } from './diff';
import { CUSTODY_EVENT_LABEL, CUSTODY_SOURCE_LABEL, ENVELOPE_RESOLUTION_LABEL, ENVELOPE_TYPE_LABEL } from './ops-labels';
import { DetailList, describeError, errorMessage, SectionTitle, UserName } from './ops-shared';

export const envelopeKeys = {
  all: ['envelopes'] as const,
  list: (filters: unknown) => ['envelopes', 'list', filters] as const,
  detail: (id: string) => ['envelopes', 'detail', id] as const,
  conflicts: (id: string) => ['envelopes', 'conflicts', id] as const,
  custody: (id: string) => ['envelopes', 'custody', id] as const,
};

const RESOLVABLE = ['rejected', 'conflict', 'deferred'];
const REPROCESSABLE = ['rejected', 'conflict', 'deferred', 'received'];

type JobLite = Pick<Job, 'id' | 'reference' | 'merchant_name' | 'bank_id' | 'status'>;

function ResolveDialog({ envelope, open, onOpenChange }: { envelope: IngestEnvelope; open: boolean; onOpenChange: (o: boolean) => void }) {
  const nextStep = useNextStepToast();
  const [resolution, setResolution] = useState<'resolved' | 'attached'>('resolved');
  const [note, setNote] = useState('');
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [requiresNote, setRequiresNote] = useState(false);
  const [ref, setRef] = useState('');
  const [search, setSearch] = useState<string | null>(null);
  const [job, setJob] = useState<JobLite | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  /** A field's error is stale once it is edited; it is re-checked on submit. */
  function clearError(field: string) {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  const jobs = useQuery({
    queryKey: ['envelopes', 'job_lookup', search],
    queryFn: () =>
      fetchRows<JobLite>(
        pos()
          .from('jobs')
          .select('id,reference,merchant_name,bank_id,status')
          .or(`reference.ilike.%${(search ?? '').replace(/[%,()]/g, '')}%,external_ref.ilike.%${(search ?? '').replace(/[%,()]/g, '')}%`)
          .order('created_at', { ascending: false })
          .limit(10),
      ),
    enabled: !!search,
  });

  const resolve = useMutationWithToast({
    mutationFn: (body: Parameters<typeof adminApi.envelopes.resolve>[1]) => adminApi.envelopes.resolve(envelope.id, body),
    successMessage: (_d, v) => (v.resolution === 'attached' ? null : 'Closed. The phone is told the next time it connects.'),
    toastErrors: false,
    invalidate: [envelopeKeys.all, ['alerts'], ['dashboard']],
    onSuccess: (_d, v) => {
      if (v.resolution === 'attached' && v.job_id) {
        nextStep('Added to the job. The phone is told the next time it connects.', { label: 'Open the job', href: `/jobs/${v.job_id}` });
      }
      onOpenChange(false);
    },
    onError: (e) => setErrors(apiFieldErrors(e)),
  });

  function submit() {
    const parsed = envelopeResolveSchema.safeParse({
      resolution,
      note,
      job_id: resolution === 'attached' ? job?.id : undefined,
      reason_code: reasonCode ?? undefined,
    });
    const errs = parsed.success ? {} : zodFieldErrors(parsed.error);
    if (requiresNote && !note.trim()) errs.note = 'This reason needs a note. Say what was done.';
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length > 0) return;
    resolve.mutate(parsed.data);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (resolve.isPending ? undefined : onOpenChange(o))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sort out this incoming data</DialogTitle>
          <DialogDescription>
            The data itself isn’t changed. What you choose is recorded, and the phone is told the next time it connects, so it can delete its own copy.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="What to do" htmlFor="env-resolution" required>
            <Select value={resolution} onValueChange={(v) => setResolution(v as 'resolved' | 'attached')}>
              <SelectTrigger id="env-resolution">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="resolved">Close it with a reason (nothing more happens to it)</SelectItem>
                <SelectItem value="attached">Add it to a job (shown in the job’s history)</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {resolution === 'attached' ? (
            <FormField label="Job" htmlFor="env-job" required error={errors.job_id}>
              {job ? (
                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <span>
                    <span className="font-mono">{job.reference}</span> · {job.merchant_name}{' '}
                    <ToneBadge value={job.status} tones={JOB_STATUS_TONE} labels={JOB_STATUS_LABEL} />
                  </span>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => setJob(null)} aria-label="Choose another job">
                    <X />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      id="env-job"
                      value={ref}
                      onChange={(e) => setRef(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setSearch(ref.trim() || null);
                      }}
                      placeholder="Job reference (POS-2026-…) or the bank’s reference"
                    />
                    <Button type="button" variant="outline" onClick={() => setSearch(ref.trim() || null)} loading={jobs.isFetching}>
                      {jobs.isFetching ? null : <Search />} Find
                    </Button>
                  </div>
                  {jobs.error ? <ApiErrorAlert error={jobs.error} /> : null}
                  {jobs.data ? (
                    jobs.data.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No jobs match. Check the reference and try again.</p>
                    ) : (
                      <ul className="max-h-40 overflow-y-auto rounded-md border">
                        {jobs.data.map((j) => (
                          <li key={j.id}>
                            <button type="button" onClick={() => {
                                setJob(j);
                                clearError('job_id');
                              }} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                              <span>
                                <span className="font-mono">{j.reference}</span> · {j.merchant_name}
                              </span>
                              <ToneBadge value={j.status} tones={JOB_STATUS_TONE} labels={JOB_STATUS_LABEL} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </div>
              )}
            </FormField>
          ) : null}
          <FormField label="Reason" htmlFor="env-reason" hint="Optional.">
            <div className="flex gap-2">
              <div className="flex-1">
                <ReasonCodeSelect
                  id="env-reason"
                  category="envelope_resolution"
                  bankId={job?.bank_id ?? null}
                  value={reasonCode}
                  onChange={(code, r) => {
                    setReasonCode(code);
                    setRequiresNote(r?.requires_note ?? false);
                  }}
                />
              </div>
              {reasonCode ? (
                <Button type="button" variant="ghost" size="icon" onClick={() => setReasonCode(null)} aria-label="Clear the reason">
                  <X />
                </Button>
              ) : null}
            </div>
          </FormField>
          <FormField label="Note" htmlFor="env-note" required error={errors.note}>
            <Textarea
              id="env-note"
              rows={3}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                clearError('note');
              }}
              placeholder="What was done and why"
            />
          </FormField>
          <ApiErrorAlert error={resolve.error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={resolve.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} loading={resolve.isPending}>
            {resolution === 'attached' ? 'Add to the job' : 'Close it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Envelope detail sheet: summary, problem, same-id conflicts, delivery record, technical details and actions (D-44). */
export function EnvelopeDetailSheet({ envelopeId, onClose, canAct }: { envelopeId: string | null; onClose: () => void; canAct: boolean }) {
  const id = envelopeId ?? '';
  const advanced = useIsAdvanced();
  const queryClient = useQueryClient();
  const envelope = useQuery({
    queryKey: envelopeKeys.detail(id),
    queryFn: () => fetchMaybeRow<IngestEnvelope>(pos().from('ingest_envelopes').select('*').eq('id', id).maybeSingle()),
    enabled: !!envelopeId,
  });
  const conflicts = useQuery({
    queryKey: envelopeKeys.conflicts(id),
    queryFn: () => fetchRows<IngestConflict>(pos().from('ingest_conflicts').select('*').eq('envelope_id', id).order('received_at')),
    enabled: !!envelopeId,
  });
  const custody = useQuery({
    queryKey: envelopeKeys.custody(id),
    queryFn: () =>
      fetchRows<CustodyEvent>(pos().from('custody_events').select('*').or(`envelope_id.eq.${id},subject_id.eq.${id}`).order('at_server').limit(200)),
    enabled: !!envelopeId,
  });
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);

  const reprocess = useMutationWithToast({
    mutationFn: (note: string) => adminApi.envelopes.reprocess(id, { note }),
    successMessage: 'Sent to be tried again. It’s usually handled within a minute.',
    toastErrors: false,
    invalidate: [envelopeKeys.all, ['alerts'], ['dashboard']],
  });

  const e = envelope.data;
  // Held = the backend rule (pos_rpc.ingest_hold / admin_envelope_resolve): received with waiting_on.reprocess.
  const held = !!e && e.state === 'received' && isPlainObject(e.waiting_on) && 'reprocess' in e.waiting_on;
  const hashMismatch = e && e.payload_hash !== e.stored_hash;
  const finallyResolved = e?.resolution === 'attached' || e?.resolution === 'resolved';
  // Mirrors pos_rpc.admin_envelope_resolve: rejected / conflict / deferred, or held (received, waiting_on.reprocess).
  const resolvable =
    !!e && (RESOLVABLE.includes(e.state) || (e.state === 'received' && isPlainObject(e.waiting_on) && 'reprocess' in e.waiting_on));

  return (
    <Sheet open={!!envelopeId} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent size="xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {e ? labelFrom(ENVELOPE_TYPE_LABEL, e.type) : 'Incoming data'}
            {e ? <ToneBadge value={e.state} tones={ENVELOPE_STATE_TONE} labels={ENVELOPE_STATE_LABEL} /> : null}
            {held ? <Badge tone="warning">Held to try again</Badge> : null}
          </SheetTitle>
          <SheetDescription>{e ? 'Data sent from an agent’s phone, as it arrived.' : 'Loading…'}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5">
          {envelope.error ? <ApiErrorAlert error={envelope.error} onRetry={() => void envelope.refetch()} /> : null}
          {envelope.isPending ? <Skeleton className="h-64 w-full" /> : null}
          {envelope.isSuccess && !e ? <p className="text-sm text-muted-foreground">This item couldn’t be found.</p> : null}
          {e ? (
            <>
              {hashMismatch ? (
                <Alert variant="destructive">
                  <ShieldAlert />
                  <AlertTitle>Failed a security check</AlertTitle>
                  <AlertDescription>
                    What the phone said it sent doesn’t match what arrived, so the phone treats it as a clash. The codes are under Technical details.
                  </AlertDescription>
                </Alert>
              ) : null}
              <DetailList
                items={[
                  ['Arrived', <DateTime key="r" value={e.received_at} seconds showRelative />],
                  ['Last sent again', <DateTime key="l" value={e.last_seen_at} seconds />],
                  ['Times sent', e.attempts],
                  ['Agent', <UserName key="u" id={e.user_id} />],
                  ['App version', e.module_version ?? '—'],
                  ['Made on the phone', <DateTime key="c" value={e.created_at_device} seconds />],
                  ['Processed', <DateTime key="p" value={e.processed_at} seconds />],
                  [
                    'Sorted out',
                    e.resolution ? (
                      <span key="res" className="space-y-0.5">
                        <Badge tone={e.resolution === 'reprocessed' ? 'info' : 'success'}>{labelFrom(ENVELOPE_RESOLUTION_LABEL, e.resolution)}</Badge>{' '}
                        <span className="text-sm text-muted-foreground">
                          by <UserName id={e.resolved_by} /> · <DateTime value={e.resolved_at} />
                        </span>
                        {e.resolution_note ? <span className="block break-words text-sm italic">“{e.resolution_note}”</span> : null}
                      </span>
                    ) : (
                      <span key="res" className="text-muted-foreground">
                        Not yet
                      </span>
                    ),
                  ],
                ]}
              />

              {e.error !== null && e.error !== undefined ? (
                <section className="space-y-1">
                  <SectionTitle>Problem</SectionTitle>
                  <p className="text-sm text-red-800">{advanced ? describeError(e.error) : errorMessage(e.error)}</p>
                </section>
              ) : null}

              {(conflicts.data?.length ?? 0) > 0 || conflicts.error ? (
                <section className="space-y-2">
                  <SectionTitle>Other copies that don’t match ({conflicts.data?.length ?? 0})</SectionTitle>
                  <p className="text-sm text-muted-foreground">The phone sent something else under the same ID. Compare the two below.</p>
                  {conflicts.error ? <ApiErrorAlert error={conflicts.error} /> : null}
                  {conflicts.data?.map((c) => (
                    <div key={c.id} className="space-y-2 rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        Arrived <DateTime value={c.received_at} seconds />
                        {advanced ? (
                          <>
                            · code <code>{shortId(c.stored_hash, 10, 6)}</code>
                            {c.request_id ? (
                              <>
                                · request <code>{shortId(c.request_id)}</code>
                              </>
                            ) : null}
                          </>
                        ) : null}
                        {c.device_id && c.device_id !== e.device_id ? <Badge tone="danger">From a different phone</Badge> : null}
                      </div>
                      <LineDiffView before={e.payload} after={c.payload} beforeLabel="First copy" afterLabel="This copy" maxHeight={320} />
                    </div>
                  ))}
                </section>
              ) : null}

              <section className="space-y-2">
                <SectionTitle>Delivery record</SectionTitle>
                {custody.error ? <ApiErrorAlert error={custody.error} /> : null}
                {custody.data?.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : null}
                <ol className="space-y-1 border-l pl-4">
                  {custody.data?.map((c) => (
                    <li key={c.id} className="text-sm">
                      <span className="font-medium" title={advanced ? c.event : undefined}>
                        {labelFrom(CUSTODY_EVENT_LABEL, c.event)}
                      </span>{' '}
                      <Badge tone={c.source === 'device' ? 'info' : 'neutral'}>{labelFrom(CUSTODY_SOURCE_LABEL, c.source)}</Badge>{' '}
                      <span className="text-sm text-muted-foreground">
                        <DateTime value={c.at_server} seconds />
                        {c.at_device ? (
                          <>
                            {' '}
                            (on the phone: <DateTime value={c.at_device} seconds />)
                          </>
                        ) : null}
                      </span>
                      {advanced && Object.keys(c.detail ?? {}).length > 0 ? (
                        <code className="ml-2 break-all text-xs text-muted-foreground">{JSON.stringify(c.detail)}</code>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>

              <Details summary="Technical details">
                <DetailList
                  items={[
                    [
                      'ID',
                      <span key="id" className="inline-flex items-center gap-1">
                        <code className="break-all text-xs">{e.id}</code>
                        <CopyButton value={e.id} title="Copy ID" />
                      </span>,
                    ],
                    ['Type', <code key="t" className="text-xs">{`${e.type} v${e.type_version} · API ${e.api_version}`}</code>],
                    ['Phone ID', e.device_id ? <code key="d" className="text-xs">{e.device_id}</code> : '—'],
                    ['Sign-in ID', e.session_id ? <code key="s" className="text-xs">{shortId(e.session_id)}</code> : '—'],
                    ['App', `${e.module_version ?? '—'} · ${e.client_type ?? '—'}`],
                    ['Phone sequence number', e.device_seq ?? '—'],
                    ['Copy of', e.duplicate_of ? <code key="dup" className="text-xs">{e.duplicate_of}</code> : '—'],
                    ['Security code (phone)', <code key="ph" className="break-all text-xs">{e.payload_hash ?? '—'}</code>],
                    ['Security code (stored)', <code key="sh" className="break-all text-xs">{e.stored_hash ?? '—'}</code>],
                  ]}
                />
                {e.error !== null && e.error !== undefined ? (
                  <section className="space-y-1">
                    <h3 className="text-sm font-medium">Problem (full)</h3>
                    <JsonView value={e.error} defaultExpandDepth={2} maxHeight={220} />
                  </section>
                ) : null}
                {e.waiting_on !== null && e.waiting_on !== undefined ? (
                  <section className="space-y-1">
                    <h3 className="text-sm font-medium">What it’s waiting for</h3>
                    <JsonView value={e.waiting_on} defaultExpandDepth={2} maxHeight={160} />
                  </section>
                ) : null}
                <section className="space-y-1">
                  <h3 className="text-sm font-medium">Confirmation sent to the phone</h3>
                  {e.result === null || e.result === undefined ? (
                    <p className="text-sm text-muted-foreground">No confirmation yet.</p>
                  ) : (
                    <JsonView value={e.result} defaultExpandDepth={2} maxHeight={220} />
                  )}
                </section>
                <section className="space-y-1">
                  <h3 className="text-sm font-medium">The data as it arrived (never changed)</h3>
                  <JsonView value={e.payload} defaultExpandDepth={2} maxHeight={360} />
                </section>
                <section className="space-y-1">
                  <h3 className="text-sm font-medium">Wrapper sent with it</h3>
                  <JsonView value={e.wrapper} defaultExpandDepth={1} maxHeight={220} />
                </section>
              </Details>
            </>
          ) : null}
        </SheetBody>
        {e ? (
          <SheetFooter className="flex-wrap items-center">
            {canAct ? (
              <>
                <Button type="button" variant="outline" disabled={!REPROCESSABLE.includes(e.state)} onClick={() => setReprocessOpen(true)}>
                  <RotateCw /> Try again…
                </Button>
                <Button type="button" disabled={!resolvable || finallyResolved} onClick={() => setResolveOpen(true)}>
                  <Link2 /> Sort it out…
                </Button>
              </>
            ) : (
              <p className="mr-auto text-sm text-muted-foreground">
                Only an administrator for all banks can act on incoming data, because it isn’t tied to one bank.
              </p>
            )}
          </SheetFooter>
        ) : null}
      </SheetContent>
      {e ? (
        <>
          <ConfirmDialog
            open={reprocessOpen}
            onOpenChange={setReprocessOpen}
            title="Try this again?"
            description="It’s checked and saved again in the background, usually within a minute. Use this after a set-up or system fix. The data itself isn’t changed."
            requireReason
            reasonLabel="Note"
            reasonPlaceholder="What was fixed. This is recorded in the activity history."
            confirmLabel="Try again"
            onConfirm={async (note) => {
              await reprocess.mutateAsync(note);
              await queryClient.invalidateQueries({ queryKey: envelopeKeys.detail(id) });
            }}
          />
          {resolveOpen ? <ResolveDialog envelope={e} open onOpenChange={setResolveOpen} /> : null}
        </>
      ) : null}
    </Sheet>
  );
}
