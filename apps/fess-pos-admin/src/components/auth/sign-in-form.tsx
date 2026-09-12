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
import { currentAal, safeNextPath, setMfaSkipped } from '@/lib/auth';
import { queryKeys } from '@/lib/hooks';
import { getSupabase } from '@/lib/supabase';
import { AuthCard } from './auth-card';

/** Email + password sign-in (Supabase Auth). On success always continues to /mfa (enrol or verify). */
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
    void (async () => {
      const { data } = await getSupabase().auth.getSession();
      if (cancelled || !data.session) return;
      const aal = await currentAal();
      if (cancelled) return;
      router.replace(aal === 'aal2' ? next : `/mfa?next=${encodeURIComponent(next)}`);
    })();
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
        setError(signInError.message);
        setPending(false);
        return;
      }
      setMfaSkipped(false);
      queryClient.removeQueries({ queryKey: queryKeys.me });
      router.replace(`/mfa?next=${encodeURIComponent(next)}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <AuthCard title="Sign in" description="FESS POS administration. Use your POS admin email and password.">
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
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
