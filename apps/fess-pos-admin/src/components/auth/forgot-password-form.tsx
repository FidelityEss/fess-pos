'use client';

// "Forgot your password?" (D-96, T2-37): the person gives their email address and Supabase Auth emails a sign-in link,
// which opens /register to choose a new password. The page answers the same whether or not the address has an account,
// and whatever Supabase Auth says about it, so it never tells anyone which addresses have accounts.
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useId, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabase } from '@/lib/supabase';
import { AuthCard } from './auth-card';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function ForgotPasswordForm() {
  const uid = useId();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(clean)) {
      setEmailError('Enter an email address, like name@company.co.za.');
      return;
    }
    setEmailError(null);
    setPending(true);
    try {
      // The answer is deliberately ignored: "no such account", "can't email that address" and "too many emails" would
      // each say something about the address. Every outcome shows the same message.
      await getSupabase().auth.resetPasswordForEmail(clean, { redirectTo: `${window.location.origin}/register` });
    } catch {
      // A network failure also shows the same message; the page says what to do if nothing arrives.
    } finally {
      setPending(false);
      setSent(true);
    }
  }

  const backToSignIn = (
    <p className="text-center">
      Remembered it?{' '}
      <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-2">
        Sign in
      </Link>
    </p>
  );

  if (sent) {
    return (
      <AuthCard title="Check your email" footer={backToSignIn}>
        <div className="grid gap-4 text-sm">
          <Alert variant="success">
            <MailCheck />
            <AlertTitle>If that address has an account, we’ve sent a link.</AlertTitle>
            <AlertDescription>Open it and choose a new password. It works once, for a limited time.</AlertDescription>
          </Alert>
          <p className="text-muted-foreground">
            Nothing after a few minutes? Check your spam folder, or ask an administrator to send you a new sign-in link from the
            People page.
          </p>
          <Button variant="outline" onClick={() => setSent(false)}>
            Try another address
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      description="Enter the email address you sign in with. We’ll email you a link to choose a new password."
      footer={backToSignIn}
    >
      <form onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-email`}>Email address</Label>
          <Input
            id={`${uid}-email`}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!emailError || undefined}
            autoFocus
          />
          {emailError ? <p className="text-sm text-destructive">{emailError}</p> : null}
        </div>
        <Button type="submit" loading={pending} disabled={!email}>
          Email me a link
        </Button>
      </form>
    </AuthCard>
  );
}
