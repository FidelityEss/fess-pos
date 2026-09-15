'use client';

// "Waiting to sign up" (D-96): people who have a registration link but haven't chosen a password yet, with Copy link,
// Resend and Cancel. Shown on People, and one row at a time on a person's page.
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { SectionHeading } from '@/components/admin/admin-ui';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateTime } from '@/components/date-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/api';
import { fullName } from '@/lib/format';
import { useStaff } from '@/lib/staff';
import type { StatusTone } from '@/lib/status';
import { invitationsApi, type LinkResult, linkProblem, useRefreshPeople, useWaitingInvitations, type WaitingInvitation } from './invitations';
import { LinkPanel } from './link-panel';

export function WaitingList() {
  const staff = useStaff();
  const waiting = useWaitingInvitations(null, staff.isAdmin);
  if (!staff.isAdmin || !waiting.data || waiting.data.length === 0) return null;
  return (
    <section className="mb-6">
      <SectionHeading
        title={`Waiting to sign up (${waiting.data.length})`}
        description="These people have a registration link but haven’t chosen their password yet."
      />
      <div className="divide-y rounded-md border">
        {waiting.data.map((inv) => (
          <WaitingRow key={inv.id} invitation={inv} />
        ))}
      </div>
    </section>
  );
}

function linkStatus(inv: WaitingInvitation): { tone: StatusTone; text: string } {
  if (inv.expired) return { tone: 'danger', text: 'Link expired' };
  if (inv.opened) return { tone: 'warning', text: 'Opened, no password yet' };
  if (inv.email_sent) return { tone: 'info', text: 'Emailed' };
  return { tone: 'warning', text: 'Not emailed: copy the link' };
}

export function WaitingRow({ invitation: inv, showName = true }: { invitation: WaitingInvitation; showName?: boolean }) {
  const refresh = useRefreshPeople();
  const [shown, setShown] = useState<{ kind: 'copied' | 'resent'; result: LinkResult } | null>(null);
  const [busy, setBusy] = useState<'copy' | 'resend' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const name = fullName(inv);
  const status = linkStatus(inv);

  async function run(kind: 'copy' | 'resend') {
    setBusy(kind);
    setError(null);
    try {
      const result = kind === 'copy' ? await invitationsApi.copyLink(inv.id) : await invitationsApi.resend(inv.id);
      setShown({ kind: kind === 'copy' ? 'copied' : 'resent', result });
      if (kind === 'resend') refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 p-3">
      <div className="grid min-w-0 gap-1">
        {showName ? (
          <Link href={`/users/${inv.user_id}`} className="font-medium hover:underline">
            {name}
          </Link>
        ) : null}
        <span className="break-all text-sm text-muted-foreground">{inv.email}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Badge tone={status.tone}>{status.text}</Badge>
          <span>
            Sent <DateTime value={inv.last_sent_at} mode="relative" />
            {inv.invited_by_name ? ` by ${inv.invited_by_name}` : ''}
          </span>
          {!inv.expired ? (
            <span>
              · works until <DateTime value={inv.expires_at} />
            </span>
          ) : null}
        </span>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {linkProblem(error) ?? errorMessage(error)}
          </p>
        ) : null}
      </div>
      {inv.can_manage ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void run('copy')}
            loading={busy === 'copy'}
            disabled={inv.expired || inv.opened || busy !== null}
            title={inv.expired || inv.opened ? 'This link can’t be used any more. Resend makes a new one.' : undefined}
          >
            Copy link
          </Button>
          <Button size="sm" variant="outline" onClick={() => void run('resend')} loading={busy === 'resend'} disabled={busy !== null}>
            {inv.expired || inv.opened ? 'Send a new link' : 'Resend'}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelOpen(true)} disabled={busy !== null}>
            Cancel
          </Button>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">Looked after by an administrator for other banks</span>
      )}

      <Dialog open={shown !== null} onOpenChange={(open) => (open ? undefined : setShown(null))}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{shown?.kind === 'resent' ? `New registration link for ${name}` : `${name}’s registration link`}</DialogTitle>
            <DialogDescription>They open it, choose a password and get the access shown on their page.</DialogDescription>
          </DialogHeader>
          {shown ? <LinkPanel result={shown.result} name={inv.first_name} kind={shown.kind} /> : null}
          <DialogFooter>
            <Button onClick={() => setShown(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        destructive
        title={`Cancel ${name}’s registration link?`}
        description="The link stops working straight away. They stay on People, and you can send a new link whenever you like."
        confirmLabel="Cancel the link"
        cancelLabel="Keep it"
        onConfirm={async () => {
          await invitationsApi.cancel(inv.id);
          refresh();
          toast.success(`Link cancelled. ${inv.first_name} can’t use it any more.`, {
            description: 'You can send a new link from their page.',
          });
        }}
      />
    </div>
  );
}
