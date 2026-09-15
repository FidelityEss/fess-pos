'use client';

import { type ReactNode, useEffect, useId, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra body content above the reason box. */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Show a reason textarea that must be filled before confirming. */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  minReasonLength?: number;
  /**
   * Called with the trimmed reason ('' when not required). If it resolves the dialog closes; if it throws the
   * error is shown inline and the dialog stays open (pass `toastErrors: false` to the mutation to avoid a toast too).
   */
  onConfirm: (reason: string) => unknown;
}

/** Confirmation dialog with optional required reason and inline error display. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  requireReason = false,
  reasonLabel = 'Reason',
  reasonPlaceholder = 'Why are you doing this? It’s saved in the activity history.',
  minReasonLength = 1,
  onConfirm,
}: ConfirmDialogProps) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) {
      setReason('');
      setError(null);
      setPending(false);
    }
  }, [open]);

  const reasonOk = !requireReason || reason.trim().length >= minReasonLength;

  async function handleConfirm() {
    if (!reasonOk || pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        {requireReason ? (
          <div className="grid gap-1.5">
            <Label htmlFor={reasonId}>
              {reasonLabel} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              rows={3}
              autoFocus
            />
          </div>
        ) : null}
        <ApiErrorAlert error={error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={!reasonOk}
            loading={pending}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
