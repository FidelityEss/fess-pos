'use client';

// Review decision for one inspection (docs/06 §2, docs/07 §7): approve / return for rework / reject. Approval needs
// every manifest item verified (unless integrity_failed) and an explicit acknowledgement when a geofence override
// was used. An existing decision (reviews row, immutable) is shown instead of the form.
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CornerUpLeft, X } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { invalidateJob, isConflictError, type InspectionRow, REVIEWABLE_INSPECTION_STATUSES, type ReviewRow } from '@/components/jobs/job-data';
import { KeyValues } from '@/components/jobs/job-bits';
import { FormField } from '@/components/form-field';
import { ReasonCodeSelect } from '@/components/reason-code-select';
import { ToneBadge } from '@/components/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { formatDateTime, fullName, humanize } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import { useMutationWithToast } from '@/lib/mutations';
import type { ReviewBody } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import { INSPECTION_STATUS_LABEL, type StatusTone } from '@/lib/status';
import type { ReasonCode, ReviewDecision, ReviewResult } from '@/lib/types';
import { cn } from '@/lib/utils';

export const REVIEW_DECISION_TONE: Record<ReviewDecision, StatusTone> = { approved: 'success', returned: 'warning', rejected: 'danger' };
const DECISION_LABEL: Record<ReviewDecision, string> = { approved: 'Approve', returned: 'Return for rework', rejected: 'Reject' };

function ExistingReview({ review }: { review: ReviewRow }) {
  const advanced = useIsAdvanced();
  return (
    <KeyValues
      items={[
        ['Decision', <ToneBadge key="d" value={review.decision} tones={REVIEW_DECISION_TONE} labels={{ returned: 'Returned for rework' }} />],
        ['Reviewer', review.reviewer ? fullName(review.reviewer) : advanced ? review.reviewer_id : '—'],
        ['Decided', formatDateTime(review.decided_at)],
        [
          'Reason',
          review.reason_code ? (
            <span key="r">
              {humanize(review.reason_code)}
              {advanced ? <code className="block break-all text-xs text-muted-foreground">{review.reason_code}</code> : null}
            </span>
          ) : null,
        ],
        [advanced ? 'Override acknowledged' : 'Outside-area start checked', review.override_acknowledged ? 'Yes' : 'No'],
        ['Note', review.note ? <span key="n" className="whitespace-pre-wrap">{review.note}</span> : null],
      ]}
    />
  );
}

/** Decision form or the recorded decision for one inspection. */
export function ReviewPanel({ jobId, bankId, insp }: { jobId: string; bankId: string; insp: InspectionRow }) {
  const staff = useStaff();
  const review = insp.reviews[0];
  if (review) return <ExistingReview review={review} />;
  if (!(REVIEWABLE_INSPECTION_STATUSES as readonly string[]).includes(insp.status)) {
    return <p className="text-sm text-muted-foreground">Nothing to review — this attempt is {(INSPECTION_STATUS_LABEL[insp.status] ?? insp.status).toLowerCase()}.</p>;
  }
  if (!staff.hasPermission('review_inspections')) {
    return <p className="text-sm text-muted-foreground">Awaiting review. Deciding needs the Review inspections permission.</p>;
  }
  return <ReviewDecisionForm jobId={jobId} bankId={bankId} insp={insp} />;
}

function ReviewDecisionForm({ jobId, bankId, insp }: { jobId: string; bankId: string; insp: InspectionRow }) {
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<ReviewDecision>('approved');
  const [code, setCode] = useState<string | null>(null);
  const [reason, setReason] = useState<ReasonCode | null>(null);
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const hasOverride = insp.flags.includes('geofence_override');
  const outstanding = insp.status !== 'integrity_failed' && insp.evidence_verified < insp.evidence_expected;
  const noteRequired = decision === 'returned' || (decision === 'rejected' && (reason?.requires_note ?? false));
  const approveBlocker = outstanding
    ? `Still waiting for photos: ${insp.evidence_verified} of ${insp.evidence_expected} checked. Approval unlocks when every item is checked.`
    : hasOverride && !ack
      ? 'First tick that you checked why the agent started outside the site area.'
      : null;
  const canSubmit = decision === 'approved' ? approveBlocker === null : !!code && (!noteRequired || !!note.trim());

  const mutation = useMutationWithToast<ReviewResult, ReviewBody>({
    mutationFn: (body) => adminApi.inspections.review(insp.id, body),
    toastErrors: false,
    successMessage: (r) => `Review recorded: ${r.review.decision} — job is now ${r.job_status.replace(/_/g, ' ')}`,
    onSuccess: () => invalidateJob(queryClient, jobId),
    onError: (e) => {
      if (isConflictError(e)) void invalidateJob(queryClient, jobId);
    },
  });

  const body: ReviewBody = {
    decision,
    reason_code: decision === 'approved' ? undefined : (code ?? undefined),
    note: note.trim() || undefined,
    override_acknowledged: hasOverride ? ack : undefined,
  };

  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap gap-1 rounded-md border bg-slate-50 p-1" role="radiogroup" aria-label="Decision">
        {(['approved', 'returned', 'rejected'] as ReviewDecision[]).map((d) => {
          const Icon = d === 'approved' ? Check : d === 'returned' ? CornerUpLeft : X;
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={decision === d}
              onClick={() => {
                setDecision(d);
                setCode(null);
                setReason(null);
              }}
              className={cn(
                'inline-flex h-10 items-center gap-1.5 rounded px-4 text-sm font-medium text-muted-foreground transition hover:text-foreground',
                decision === d && d === 'approved' && 'bg-emerald-600 text-white hover:text-white',
                decision === d && d === 'returned' && 'bg-amber-500 text-white hover:text-white',
                decision === d && d === 'rejected' && 'bg-red-600 text-white hover:text-white',
              )}
            >
              <Icon className="size-4" /> {DECISION_LABEL[d]}
            </button>
          );
        })}
      </div>

      {hasOverride ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>The agent started outside the site area</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>They used the override form. Check the reason, note, photo and location trail before deciding.</p>
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />I have checked why they started outside the site area
            </label>
          </AlertDescription>
        </Alert>
      ) : null}

      {decision === 'approved' && outstanding ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertDescription>
            {insp.evidence_verified} of {insp.evidence_expected} photos and files checked so far. You can read the answers now; you can approve once everything is checked.
          </AlertDescription>
        </Alert>
      ) : null}

      {decision !== 'approved' ? (
        <div className="grid gap-3">
          <FormField label="Reason" htmlFor={`review-reason-${insp.id}`} required>
            <ReasonCodeSelect
              id={`review-reason-${insp.id}`}
              category={decision === 'returned' ? 'review_return' : 'review_reject'}
              bankId={bankId}
              value={code}
              onChange={(c, r) => {
                setCode(c);
                setReason(r);
              }}
            />
          </FormField>
          <FormField
            label={decision === 'returned' ? 'Note to the agent' : 'Note'}
            htmlFor={`review-note-${insp.id}`}
            required={noteRequired}
            hint={decision === 'returned' ? 'Shown to the agent with the returned job — say exactly what to fix.' : undefined}
          >
            <Textarea id={`review-note-${insp.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>
      ) : (
        <FormField label="Note (optional)" htmlFor={`review-note-${insp.id}`}>
          <Textarea id={`review-note-${insp.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={decision === 'rejected' ? 'destructive' : 'default'}
          className={cn(decision === 'approved' && 'bg-emerald-600 hover:bg-emerald-700', decision === 'returned' && 'bg-amber-500 hover:bg-amber-600')}
          disabled={!canSubmit}
          onClick={() => setConfirming(true)}
          title={decision === 'approved' ? (approveBlocker ?? undefined) : undefined}
        >
          {DECISION_LABEL[decision]} attempt {insp.attempt}
        </Button>
        {decision === 'approved' && approveBlocker ? <span className="text-sm text-muted-foreground">{approveBlocker}</span> : null}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`${DECISION_LABEL[decision]} attempt ${insp.attempt}?`}
        description={
          decision === 'returned'
            ? 'The job goes back to the agent for a new attempt, with your note. Review decisions are permanent.'
            : 'Review decisions are permanent and recorded in the audit log.'
        }
        confirmLabel={DECISION_LABEL[decision]}
        destructive={decision === 'rejected'}
        onConfirm={() => mutation.mutateAsync(body)}
      />
    </div>
  );
}
