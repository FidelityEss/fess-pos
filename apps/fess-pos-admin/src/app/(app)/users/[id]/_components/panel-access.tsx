'use client';

// How a person gets into the admin panel (D-96): a registration link they open to choose a password. Replaces the
// temporary password + authenticator-app set-up. Agents never sign in here.
import { Send } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { FormField } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { fullName } from '@/lib/format';
import type { PosUser } from '@/lib/types';
import { EMAIL_PATTERN, invitationsApi, type LinkResult, useRefreshPeople, useWaitingInvitations } from '../../_components/invitations';
import { LinkPanel } from '../../_components/link-panel';
import { WaitingRow } from '../../_components/waiting-list';

/** Rendered unconditionally on the profile so the link dialog survives the person's row refreshing. */
export function PanelAccessCard({ user, canManage }: { user: PosUser; canManage: boolean }) {
  const isAgent = user.role === 'pos_agent';
  const waiting = useWaitingInvitations(user.id, !isAgent && canManage);
  const invitation = waiting.data?.[0] ?? null;
  const [sendOpen, setSendOpen] = useState(false);

  let body;
  if (isAgent) {
    body = <p className="text-muted-foreground">Agents use the FESS app on their phone. They never sign in to this panel.</p>;
  } else if (canManage && waiting.isPending) {
    body = <Skeleton className="h-16 w-full" />;
  } else if (invitation) {
    body = (
      <>
        <p>A registration link is waiting for them to choose a password.</p>
        <div className="rounded-md border">
          <WaitingRow invitation={invitation} showName={false} />
        </div>
      </>
    );
  } else if (user.admin_auth_uid) {
    body = (
      <>
        <Badge tone="success">Can sign in</Badge>
        <p className="text-muted-foreground">Signs in with their email address and password.</p>
      </>
    );
  } else {
    body = (
      <>
        <Badge tone="muted">No sign-in yet</Badge>
        <p className="text-muted-foreground">
          Send them a registration link. They open it, choose a password and get the access shown on this page.
        </p>
        {canManage && user.active ? (
          <Button size="sm" onClick={() => setSendOpen(true)}>
            <Send /> Send registration link
          </Button>
        ) : null}
        {canManage && !user.active ? <p className="text-muted-foreground">Reactivate them before sending a link.</p> : null}
      </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin panel sign-in</CardTitle>
        <CardDescription>How this person gets into this admin panel.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{body}</CardContent>
      {!isAgent ? <SendLinkDialog user={user} open={sendOpen} onOpenChange={setSendOpen} /> : null}
    </Card>
  );
}

function SendLinkDialog({ user, open, onOpenChange }: { user: PosUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  const uid = useId();
  const refresh = useRefreshPeople();
  const [email, setEmail] = useState(user.email ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<LinkResult | null>(null);
  const name = fullName(user);

  function close() {
    onOpenChange(false);
    setResult(null);
    setError(null);
    setEmailError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(clean)) {
      setEmailError('Enter an email address, like name@company.co.za.');
      return;
    }
    setEmailError(null);
    setError(null);
    setPending(true);
    try {
      // Called directly (not through useMutation) so the link never enters the query cache.
      setResult(await invitationsApi.send({ email: clean, user_id: user.id }));
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : next ? onOpenChange(true) : close())}>
      <DialogContent size="md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Registration link for {name}</DialogTitle>
              <DialogDescription>Next, they open it and choose a password.</DialogDescription>
            </DialogHeader>
            <LinkPanel result={result} name={user.first_name} kind="sent" />
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Send {name} a registration link</DialogTitle>
              <DialogDescription>
                They open it, choose a password and get the access shown on this page. The link works once, for a limited time;
                you’ll see until when.
              </DialogDescription>
            </DialogHeader>
            <FormField label="Their email address" htmlFor={`${uid}-email`} required error={emailError} hint="They’ll sign in with this address.">
              <Input id={`${uid}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus aria-invalid={!!emailError || undefined} />
            </FormField>
            <ApiErrorAlert error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                Send registration link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
