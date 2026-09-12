'use client';

// Deactivation (D-35, docs/07 §2): ingest_only (default) keeps captured work uploading; hard_revoke (stolen device)
// refuses everything and is shown with the pending count from the last device sync reports.
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { MonoId } from '@/components/admin/admin-ui';
import { useSyncStatusForUser } from '@/components/admin/queries';
import { RadioCards } from '@/components/admin/radio-cards';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { formatNumber, formatRelative, fullName } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import type { UserDeactivateBody } from '@/lib/schemas';
import type { DeactivateUserResult, DeactivationMode, PosUser } from '@/lib/types';

function toCount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function DeactivateDialog({ user, open, onOpenChange }: { user: PosUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">{open ? <DeactivateForm user={user} onClose={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function DeactivateForm({ user, onClose }: { user: PosUser; onClose: () => void }) {
  const uid = useId();
  const [mode, setMode] = useState<DeactivationMode>('ingest_only');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [result, setResult] = useState<DeactivateUserResult | null>(null);
  const sync = useSyncStatusForUser(user.id);
  const pendingTotal = (sync.data ?? []).reduce((sum, r) => sum + r.pending_total, 0);
  const mutation = useMutationWithToast({
    mutationFn: (body: UserDeactivateBody) => adminApi.users.deactivate(user.id, body),
    invalidate: [['users'], ['agents'], ['devices'], ['pos_sessions'], ['auth_events'], ['alerts'], ['device_sync_status']],
    toastErrors: false,
    successMessage: (_r, v) => (v.mode === 'hard_revoke' ? 'Access hard-revoked' : 'User deactivated'),
    onSuccess: (r) => setResult(r),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setReasonError('A reason is required — it is recorded in the audit log.');
      return;
    }
    setReasonError(null);
    mutation.mutate({ mode, reason: reason.trim() });
  }

  if (result) {
    const pending = toCount(result.pending_items);
    const hard = mode === 'hard_revoke';
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{hard ? 'Access hard-revoked' : 'User deactivated'}</DialogTitle>
          <DialogDescription>{fullName(result.user)}</DialogDescription>
        </DialogHeader>
        <Alert variant={hard ? 'warning' : 'success'}>
          {hard ? <ShieldAlert /> : <CheckCircle2 />}
          <AlertDescription className="space-y-1">
            <p>
              {formatNumber(result.sessions_affected)} session{result.sessions_affected === 1 ? '' : 's'}{' '}
              {hard ? 'revoked' : 'switched to upload-only'}.
            </p>
            <p>
              {pending === null
                ? 'No pending count was reported.'
                : `${formatNumber(pending)} item${pending === 1 ? ' was' : 's were'} pending on their devices at the last sync.`}
              {hard && pending ? ' Those items can’t upload now; an alert has been raised for follow-up.' : ''}
            </p>
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Deactivate {fullName(user)}?</DialogTitle>
        <DialogDescription>Choose what happens to their sessions. Either way they can’t start new work.</DialogDescription>
      </DialogHeader>
      <RadioCards<DeactivationMode>
        label="Deactivation mode"
        value={mode}
        onChange={setMode}
        options={[
          {
            value: 'ingest_only',
            title: 'Upload only (recommended)',
            description:
              'Sessions drop to upload-only. Work they already captured still uploads (flagged as after deactivation), so no evidence is stranded. Use this for HR changes.',
          },
          {
            value: 'hard_revoke',
            title: 'Hard revoke — lost or stolen device',
            description: 'Revokes every session immediately. Nothing more is accepted from their devices, including work still waiting to upload.',
            tone: 'danger',
          },
        ]}
      />
      {mode === 'hard_revoke' ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Check what is still on their devices</AlertTitle>
          <AlertDescription className="space-y-2">
            {sync.isPending ? (
              <Skeleton className="h-4 w-64" />
            ) : sync.error ? (
              <ApiErrorAlert error={sync.error} title="Could not load sync reports" />
            ) : (sync.data ?? []).length === 0 ? (
              <p>No sync reports from their devices — the number of items still waiting is unknown.</p>
            ) : (
              <>
                <p className="font-medium">
                  {formatNumber(pendingTotal)} item{pendingTotal === 1 ? '' : 's'} pending across {sync.data?.length} device
                  {sync.data?.length === 1 ? '' : 's'} at their last sync. They won’t upload after a hard revoke.
                </p>
                <ul className="space-y-0.5 text-sm">
                  {(sync.data ?? []).map((s) => (
                    <li key={s.device_id} className="flex flex-wrap items-center gap-x-2">
                      <MonoId value={s.device_id} copy={false} />
                      <span>{formatNumber(s.pending_total)} pending</span>
                      <span className="opacity-75">reported {formatRelative(s.received_at)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      <FormField label="Reason" htmlFor={`${uid}-reason`} required error={reasonError} hint="Recorded in the audit log.">
        <Textarea id={`${uid}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} aria-invalid={!!reasonError || undefined} />
      </FormField>
      <ApiErrorAlert error={mutation.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" loading={mutation.isPending}>
          {mode === 'hard_revoke' ? 'Hard revoke' : 'Deactivate'}
        </Button>
      </DialogFooter>
    </form>
  );
}
