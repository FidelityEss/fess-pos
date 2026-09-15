'use client';

// How a person gets into the admin panel (D-96): a registration link they open to choose a password. Replaces the
// temporary password + authenticator-app set-up. Someone who has signed up and forgotten their password can be sent a
// new sign-in link from here. Agents never sign in here.
import { KeyRound, Send } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { fullName } from '@/lib/format';
import type { PosUser } from '@/lib/types';
import {
  EMAIL_PATTERN,
  invitationsApi,
  type LinkResult,
  linkProblem,
  type SignInLinkResult,
  useRefreshPeople,
  useWaitingInvitations,
} from '../../_components/invitations';
import { LinkPanel } from '../../_components/link-panel';
import { WaitingRow } from '../../_components/waiting-list';

/** Rendered unconditionally on the profile so the link dialog survives the person's row refreshing. */
export function PanelAccessCard({ user, canManage }: { user: PosUser; canManage: boolean }) {
  const isAgent = user.role === 'pos_agent';
  const waiting = useWaitingInvitations(user.id, !isAgent && canManage);
  const invitation = waiting.data?.[0] ?? null;
  const [sendOpen, setSendOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

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
        {canManage && user.active ? (
          <>
            <p className="text-muted-foreground">
              Forgotten their password? Send them a new sign-in link. They open it and choose a new password.
            </p>
            <Button size="sm" variant="outline" onClick={() => setSignInOpen(true)}>
              <KeyRound /> Send a new sign-in link
            </Button>
          </>
        ) : null}
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
      {!isAgent ? <SignInLinkDialog user={user} open={signInOpen} onOpenChange={setSignInOpen} /> : null}
    </Card>
  );
}

/** "Send a new sign-in link": a password-reset link for someone who has signed up, emailed and also shown for copying. */
function SignInLinkDialog({ user, open, onOpenChange }: { user: PosUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SignInLinkResult | null>(null);
  const name = fullName(user);
  const problem = linkProblem(error);

  function close() {
    onOpenChange(false);
    setResult(null);
    setError(null);
  }

  async function send() {
    setError(null);
    setPending(true);
    try {
      // Called directly (not through useMutation) so the link never enters the query cache.
      setResult(await invitationsApi.signInLink(user.id));
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
              <DialogTitle>Sign-in link for {name}</DialogTitle>
              <DialogDescription>Next, they open it and choose a new password.</DialogDescription>
            </DialogHeader>
            <LinkPanel result={result} name={user.first_name} kind="sign-in" />
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Send {name} a new sign-in link?</DialogTitle>
              <DialogDescription>
                For when they’ve forgotten their password. The link goes to the address they sign in with. They open it, choose a
                new password and are signed in. Their current password keeps working until then.
              </DialogDescription>
            </DialogHeader>
            {problem ? (
              <Alert variant="warning">
                <AlertDescription>{problem}</AlertDescription>
              </Alert>
            ) : (
              <ApiErrorAlert error={error} />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={() => void send()} loading={pending}>
                Send sign-in link
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
