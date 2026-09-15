'use client';

import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/api';
import { safeNextPath } from '@/lib/auth';
import { queryKeys } from '@/lib/hooks';
import { getSupabase } from '@/lib/supabase';
import { AuthCard } from './auth-card';

function plainSignInError(error: { message: string; code?: string }): string {
  if (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message)) {
    return 'That email and password don’t match. Check them and try again.';
  }
  if (error.code === 'email_not_confirmed') return 'This account isn’t set up yet. Open the registration link from your invitation email first.';
  if (/rate limit|too many/i.test(error.message)) return 'Too many tries in a short time. Wait a few minutes, then try again.';
  return error.message;
}

/** Email + password sign-in (Supabase Auth). There is no authenticator-app step (D-96). */
export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Already signed in? Skip the form.
  useEffect(() => {
    let cancelled = false;
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (!cancelled && data.session) router.replace(next);
      });
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { error: signInError } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) {
        setError(plainSignInError(signInError));
        setPending(false);
        return;
      }
      queryClient.removeQueries({ queryKey: queryKeys.me });
      router.replace(next);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      description="Sign in to the FESS POS admin panel with your email address and password."
      footer={
        <>
          <p className="text-center">New here? Open the registration link from your invitation email to choose your password.</p>
          <p className="text-center">Forgotten your password? Ask an administrator for help.</p>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" loading={pending} disabled={!email || !password}>
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
