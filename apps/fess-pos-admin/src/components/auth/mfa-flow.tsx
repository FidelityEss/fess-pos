'use client';

import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, LogOut, RotateCw } from 'lucide-react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/api';
import { currentAal, safeNextPath, setMfaSkipped, TOTP_FRIENDLY_NAME, useSignOut } from '@/lib/auth';
import { env } from '@/lib/env';
import { queryKeys } from '@/lib/hooks';
import { getSupabase } from '@/lib/supabase';
import { AuthCard } from './auth-card';

type Step =
  | { kind: 'loading' }
  | { kind: 'enrol'; factorId: string; qrSrc: string; secret: string }
  | { kind: 'verify'; factorId: string }
  | { kind: 'error'; message: string };

/** Supabase returns the QR as `data:image/svg+xml;utf-8,<svg…>` — re-encode so characters like # survive. */
function qrImageSrc(qr: string): string {
  const m = /^data:image\/svg\+xml;(?:charset=)?utf-?8,(.*)$/is.exec(qr);
  const svg = m?.[1];
  if (svg !== undefined && svg.trimStart().startsWith('<')) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  if (qr.trimStart().startsWith('<svg')) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`;
  return qr;
}

/**
 * TOTP MFA: verified factor → verify a code; none → remove stale unverified factors, enrol, show QR + secret,
 * confirm with a code. Success lifts the session to aal2 and continues to `next`.
 */
export function MfaFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const serverRequired = params.get('reason') === 'mfa_required';
  const queryClient = useQueryClient();
  const signOut = useSignOut();
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const started = useRef(false);

  const prepare = useCallback(async () => {
    setStep({ kind: 'loading' });
    try {
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        router.replace(`/sign-in?next=${encodeURIComponent(next)}`);
        return;
      }
      if ((await currentAal()) === 'aal2') {
        if (serverRequired) {
          setStep({
            kind: 'error',
            message: 'The POS API still requires two-factor verification although this session is verified. Sign out and sign in again.',
          });
          return;
        }
        router.replace(next);
        return;
      }
      const { data: factors, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const totp = factors.all.filter((f) => f.factor_type === 'totp');
      const verified = totp.find((f) => f.status === 'verified');
      if (verified) {
        setStep({ kind: 'verify', factorId: verified.id });
        return;
      }
      for (const stale of totp) {
        const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: stale.id });
        if (unenrollError) throw unenrollError;
      }
      const { data: enrolled, error: enrolError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: TOTP_FRIENDLY_NAME,
      });
      if (enrolError) throw enrolError;
      setStep({ kind: 'enrol', factorId: enrolled.id, qrSrc: qrImageSrc(enrolled.totp.qr_code), secret: enrolled.totp.secret });
    } catch (e) {
      setStep({ kind: 'error', message: errorMessage(e) });
    }
  }, [next, router, serverRequired]);

  useEffect(() => {
    // Guard against React strict-mode double effects, which would enrol twice.
    if (started.current) return;
    started.current = true;
    void prepare();
  }, [prepare]);

  async function onVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.kind !== 'enrol' && step.kind !== 'verify') return;
    const clean = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) {
      setVerifyError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    try {
      const { error } = await getSupabase().auth.mfa.challengeAndVerify({ factorId: step.factorId, code: clean });
      if (error) {
        setVerifyError(`That code didn't work: ${error.message}`);
        setCode('');
        setVerifying(false);
        return;
      }
      setMfaSkipped(false);
      queryClient.removeQueries({ queryKey: queryKeys.me });
      router.replace(next);
    } catch (err) {
      setVerifyError(errorMessage(err));
      setVerifying(false);
    }
  }

  function onSkip() {
    setMfaSkipped(true);
    queryClient.removeQueries({ queryKey: queryKeys.me });
    router.replace(next);
  }

  const footer = (
    <>
      {env.allowSkipMfa ? (
        <button type="button" onClick={onSkip} className="font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900">
          Skip (local test only)
        </button>
      ) : null}
      <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1 hover:text-foreground">
        <LogOut className="size-4" /> Sign out or use a different account
      </button>
    </>
  );

  const notice = serverRequired ? (
    <Alert variant="info" className="mb-4">
      <Info />
      <AlertDescription>The POS API requires two-factor verification for this account.</AlertDescription>
    </Alert>
  ) : null;

  const codeForm = (
    <form onSubmit={onVerify} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="mfa-code">6-digit code</Label>
        <Input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className="h-11 text-center font-mono text-lg tracking-[0.5em]"
          autoFocus
        />
      </div>
      {verifyError ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{verifyError}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" loading={verifying} disabled={code.length !== 6}>
        Verify
      </Button>
    </form>
  );

  if (step.kind === 'loading') {
    return (
      <AuthCard title="Two-factor verification" footer={footer}>
        <Spinner label="Preparing…" />
      </AuthCard>
    );
  }

  if (step.kind === 'error') {
    return (
      <AuthCard title="Two-factor verification" footer={footer} wide>
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{step.message}</AlertDescription>
        </Alert>
        <Button className="mt-4 w-full" variant="outline" onClick={() => void prepare()}>
          <RotateCw /> Try again
        </Button>
      </AuthCard>
    );
  }

  if (step.kind === 'verify') {
    return (
      <AuthCard
        title="Enter your verification code"
        description={`Open your authenticator app and enter the current code for “${TOTP_FRIENDLY_NAME}”.`}
        footer={footer}
      >
        {notice}
        {codeForm}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set up two-factor authentication"
      description="Two-factor authentication is required for POS administrators. Scan the QR code with an authenticator app (e.g. Microsoft Authenticator, Google Authenticator, 1Password), then enter the 6-digit code it shows."
      footer={footer}
      wide
    >
      {notice}
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-md border bg-white p-2">
          <Image src={step.qrSrc} alt="QR code to add FESS POS admin to your authenticator app" width={176} height={176} unoptimized />
        </div>
        <div className="w-full">
          <p className="text-sm text-muted-foreground">Can&apos;t scan? Enter this key manually:</p>
          <div className="mt-1 flex items-center gap-1 rounded-md border bg-slate-50 px-2 py-1">
            <code className="flex-1 break-all font-mono text-sm">{step.secret}</code>
            <CopyButton value={step.secret} title="Copy secret" />
          </div>
        </div>
      </div>
      <div className="mt-5">{codeForm}</div>
    </AuthCard>
  );
}
