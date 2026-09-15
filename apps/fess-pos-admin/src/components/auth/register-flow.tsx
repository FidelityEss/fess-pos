'use client';

// The registration page (D-96, T2-37): opened from the link an admin sent. The person chooses a password and lands in the
// admin panel with the access they were given. The same page takes a sign-in link (type=recovery), from "Forgot your
// password?" or "Send a new sign-in link": the person chooses a new password and is signed in. The link's token is spent
// only when they submit the password, so a mail scanner that opens the link can't use it up. Understands:
//   ?token_hash=…&type=invite|recovery     the panel's own links (the POS email templates and Copy link)
//   #access_token=…&type=invite|recovery   Supabase Auth's default emails, if the POS templates aren't installed
//   #error_code=otp_expired…               a used or expired link, from those default emails
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Circle, Eye, EyeOff, LinkIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageSpinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { passwordRules } from '@/lib/auth';
import { queryKeys } from '@/lib/hooks';
import { getSupabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { AuthCard } from './auth-card';

/** invite: a registration link (first password); recovery: a sign-in link (a new password). */
type Purpose = 'invite' | 'recovery';

type LinkState =
  | { kind: 'token'; tokenHash: string; purpose: Purpose }
  | { kind: 'session'; accessToken: string; refreshToken: string; purpose: Purpose }
  | { kind: 'broken'; reason: 'used_or_expired' | 'missing'; purpose: Purpose | null };

function purposeOf(type: string | null): Purpose | null {
  return type === 'invite' || type === 'recovery' ? type : null;
}

function readLink(): LinkState {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const purpose = purposeOf(query.get('type')) ?? purposeOf(hash.get('type'));
  if (hash.get('error_code') || hash.get('error')) return { kind: 'broken', reason: 'used_or_expired', purpose };
  const tokenHash = query.get('token_hash');
  const type = query.get('type');
  if (tokenHash && (!type || purpose)) return { kind: 'token', tokenHash, purpose: purpose ?? 'invite' };
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  const hashPurpose = purposeOf(hash.get('type'));
  if (accessToken && refreshToken && hashPurpose) return { kind: 'session', accessToken, refreshToken, purpose: hashPurpose };
  return { kind: 'broken', reason: 'missing', purpose };
}

function plainPasswordError(error: { message: string; code?: string }): string {
  if (error.code === 'weak_password' || /weak|should contain|at least/i.test(error.message)) {
    return 'That password was turned down as too weak. Try a longer one: a short sentence you’ll remember works well.';
  }
  if (error.code === 'same_password') return 'Choose a password you haven’t used for this account before.';
  return error.message;
}

export function RegisterFlow() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const uid = useId();
  const [link, setLink] = useState<LinkState | null>(null);
  // Once the token is spent the person has a session; if saving the password then fails they can simply try again.
  const [linkSpent, setLinkSpent] = useState(false);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'form' | 'saving' | 'done'>('form');

  useEffect(() => {
    const read = () => {
      const state = readLink();
      // A later visit without a link (the address was cleaned below) keeps the link already read.
      setLink((current) => (current && current.kind !== 'broken' && state.kind === 'broken' && state.reason === 'missing' ? current : state));
      // Keep the token out of the address bar and the browser history. (The emailed link still works until it is used.)
      if (state.kind === 'token') window.history.replaceState(null, '', '/register');
    };
    read();
    // Supabase Auth's default email lands with the result in the #fragment, which can change without a page load.
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const rules = passwordRules(password);
  const allMet = rules.every((r) => r.met);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!link || link.kind === 'broken') return;
    if (!allMet) {
      setError('Choose a password that ticks all four points below.');
      return;
    }
    if (password !== again) {
      setError('The two passwords are different. Type the same password in both boxes.');
      return;
    }
    setError(null);
    setPhase('saving');
    const supabase = getSupabase();
    try {
      if (!linkSpent) {
        // Someone else signed in on this browser must not be changed by this link.
        await supabase.auth.signOut({ scope: 'local' });
        const { error: linkError } =
          link.kind === 'token'
            ? await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.purpose })
            : await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
        if (linkError) {
          setLink({ kind: 'broken', reason: 'used_or_expired', purpose: link.purpose });
          setPhase('form');
          return;
        }
        setLinkSpent(true);
        if (link.kind === 'session') window.history.replaceState(null, '', '/register');
      }
      const { error: passwordError } = await supabase.auth.updateUser({ password });
      if (passwordError) {
        setError(plainPasswordError(passwordError));
        setPhase('form');
        return;
      }
      // Marks a registration link as used in the People list (also after a sign-in link, for someone who never finished
      // signing up). The list also works this out on its own, so a failure here is harmless.
      await api('POST', '/v1/admin/invitations/accept', {}).catch(() => undefined);
      queryClient.removeQueries({ queryKey: queryKeys.me });
      setPhase('done');
      router.replace('/');
    } catch (err) {
      setError(errorMessage(err));
      setPhase('form');
    }
  }

  if (!link) return <PageSpinner label="Opening your link…" />;

  if (link.kind === 'broken') {
    const used = link.reason === 'used_or_expired';
    const signIn = link.purpose === 'recovery';
    return (
      <AuthCard
        title={used ? 'This link no longer works' : 'Open the link from your email'}
        description={
          used
            ? signIn
              ? 'Sign-in links work once, and only for a limited time. Ask for a new one below.'
              : 'Registration links work once, and only for a limited time. Ask your admin for a new link.'
            : 'This page sets your password, and it needs the link from your email: the invitation your admin sent, or a sign-in link you asked for.'
        }
        wide
        footer={
          <p className="text-center">
            Already chose your password?{' '}
            <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-2">
              Sign in
            </Link>
          </p>
        }
      >
        <Alert variant={used ? 'warning' : 'info'}>
          <LinkIcon />
          <AlertDescription>
            {signIn ? (
              <>
                Get a new sign-in link from{' '}
                <Link href="/forgot-password" className="font-medium underline underline-offset-2">
                  Forgot your password?
                </Link>
                , or ask your admin to send you one.
              </>
            ) : used ? (
              'Your admin can send a new link from the People page. It replaces this one.'
            ) : (
              <>
                Your admin can send you a registration link from the People page. Signed up before and forgotten your password? Use{' '}
                <Link href="/forgot-password" className="font-medium underline underline-offset-2">
                  Forgot your password?
                </Link>
              </>
            )}
          </AlertDescription>
        </Alert>
      </AuthCard>
    );
  }

  if (phase === 'done') return <PageSpinner label="You’re all set. Opening the admin panel…" />;

  const reset = link.purpose === 'recovery';
  return (
    <AuthCard
      title={reset ? 'Choose a new password' : 'Choose your password'}
      description={
        reset
          ? 'Choose a new password for your FESS POS admin panel account. Once you save it, your old password stops working and you’re signed in.'
          : 'Welcome to the FESS POS admin panel. Choose a password to finish setting up your account. From now on you’ll sign in with your email address and this password.'
      }
      wide
    >
      <form onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${uid}-pw`}>New password</Label>
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {show ? 'Hide' : 'Show'}
            </button>
          </div>
          <Input
            id={`${uid}-pw`}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <ul className="grid gap-1 text-sm" aria-label="Your password needs">
          {rules.map((r) => (
            <li key={r.key} className={cn('flex items-center gap-2', r.met ? 'text-emerald-700' : 'text-muted-foreground')}>
              {r.met ? <Check className="size-4" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
              {r.label}
              <span className="sr-only">{r.met ? ' (done)' : ' (still needed)'}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Tip: a short sentence you’ll remember is easier to type, and harder to guess, than a jumble of symbols. Don’t reuse a
          password from another site.
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-again`}>Type it again</Label>
          <Input
            id={`${uid}-again`}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" loading={phase === 'saving'} disabled={!password || !again}>
          Save password and sign in
        </Button>
      </form>
    </AuthCard>
  );
}
