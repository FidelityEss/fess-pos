'use client';

// Panel login for administrators and bank readers (Supabase Auth + MFA, docs/07 §2). The temporary password comes back
// ONCE: it lives only in this component's state (never a query/mutation cache, storage or log) and is cleared on close.
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, TriangleAlert } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { MonoId } from '@/components/admin/admin-ui';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { CopyButton } from '@/components/copy-button';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { adminApi } from '@/lib/api';
import { fullName } from '@/lib/format';
import { adminLoginSchema } from '@/lib/schemas';
import type { PosUser } from '@/lib/types';

interface OneTimeSecret {
  email: string;
  password: string;
}

/** Rendered unconditionally on the profile tab so the one-time dialog survives the user row refreshing. */
export function AdminLoginCard({ user, canManage }: { user: PosUser; canManage: boolean }) {
  const queryClient = useQueryClient();
  const uid = useId();
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState(user.email ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState<OneTimeSecret | null>(null);

  const isAgent = user.role === 'pos_agent';
  const linked = user.admin_auth_uid !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = adminLoginSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? 'Enter a valid email address');
      return;
    }
    setEmailError(null);
    setError(null);
    setPending(true);
    try {
      // Called directly (not through useMutation) so the password never enters the TanStack mutation cache.
      const result = await adminApi.users.adminLogin(user.id, parsed.data);
      setFormOpen(false);
      setSecret({ email: result.email, password: result.temporary_password });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  function closeSecret() {
    setSecret(null);
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Panel login</CardTitle>
        <CardDescription>Email and two-factor sign-in to this admin panel.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {isAgent ? (
          <p className="text-muted-foreground">Agents sign in through the FESS app only. They never get a panel login.</p>
        ) : linked ? (
          <>
            <Badge tone="success">Linked</Badge>
            <p className="text-muted-foreground">This person signs in with their email, password and an authenticator app.</p>
            <div className="text-sm text-muted-foreground">
              Auth account <MonoId value={user.admin_auth_uid} />
            </div>
          </>
        ) : (
          <>
            <Badge tone="warning">Not linked</Badge>
            <p className="text-muted-foreground">No panel login yet. Creating one issues a temporary password that is shown once.</p>
            {canManage ? (
              <Button
                size="sm"
                onClick={() => {
                  setError(null);
                  setEmailError(null);
                  setFormOpen(true);
                }}
              >
                <KeyRound /> Create panel login
              </Button>
            ) : null}
          </>
        )}
      </CardContent>

      <Dialog open={formOpen} onOpenChange={(open) => (pending ? undefined : setFormOpen(open))}>
        <DialogContent>
          <form onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Create a panel login for {fullName(user)}</DialogTitle>
              <DialogDescription>
                They sign in with this email and a temporary password, then must set up two-factor authentication before they can
                see any data.
              </DialogDescription>
            </DialogHeader>
            <FormField label="Sign-in email" htmlFor={`${uid}-email`} required error={emailError}>
              <Input id={`${uid}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus aria-invalid={!!emailError || undefined} />
            </FormField>
            <ApiErrorAlert error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                Create login
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={secret !== null}
        onOpenChange={(open) => {
          if (!open) closeSecret();
        }}
      >
        <DialogContent hideClose onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Temporary password</DialogTitle>
            <DialogDescription>Give this to {fullName(user)} over a secure channel.</DialogDescription>
          </DialogHeader>
          <Alert variant="warning">
            <TriangleAlert />
            <AlertTitle>Copy it now — it will not be shown again</AlertTitle>
            <AlertDescription>The panel doesn’t keep it anywhere. If it is lost, the login has to be reset.</AlertDescription>
          </Alert>
          {secret ? (
            <div className="grid gap-3 text-sm">
              <div className="grid gap-1">
                <span className="text-sm text-muted-foreground">Email</span>
                <span className="font-medium">{secret.email}</span>
              </div>
              <div className="grid gap-1">
                <span className="text-sm text-muted-foreground">Temporary password</span>
                <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-2">
                  <code className="min-w-0 flex-1 break-all font-mono text-sm">{secret.password}</code>
                  <CopyButton value={secret.password} label="Copy" variant="outline" />
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" onClick={closeSecret}>
              I’ve copied it — close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
