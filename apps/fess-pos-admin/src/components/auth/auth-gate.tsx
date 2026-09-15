'use client';

import { useQuery } from '@tanstack/react-query';
import { LogOut, ShieldQuestion } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { adminApi, isApiError } from '@/lib/api';
import { signOut, useSignOut } from '@/lib/auth';
import { queryKeys } from '@/lib/hooks';
import { StaffProvider } from '@/lib/staff';
import { getSupabase } from '@/lib/supabase';
import { AuthCard } from './auth-card';
import { GateError } from './gate-error';
import { NoAccess } from './no-access';

/** A registration link whose address lost its /register path (Supabase Auth falls back to the site address). */
function strayRegistrationLink(): string | null {
  const { search, hash } = window.location;
  if (/[?&]token_hash=/.test(search) || /(^#|&)(type=invite|error_code=)/.test(hash)) return `/register${search}${hash}`;
  return null;
}

/**
 * Wraps the signed-in app. Admins sign in with email and password (D-96); there is no authenticator step here.
 * No session → /sign-in. Then GET /v1/admin/me: FORBIDDEN → no-access page; MFA_REQUIRED (an environment where
 * admin.require_mfa is still on) → a plain explanation; UNAUTHENTICATED → sign out; success → <StaffProvider>.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabase();
    const stray = strayRegistrationLink();
    if (stray) {
      router.replace(stray);
      return;
    }
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        router.replace(`/sign-in?next=${encodeURIComponent(pathRef.current || '/')}`);
        return;
      }
      setSessionReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setSessionReady(false);
        router.replace('/sign-in');
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => adminApi.me(),
    enabled: sessionReady,
    staleTime: 5 * 60_000,
  });

  const errorCode = isApiError(me.error) ? me.error.code : null;
  useEffect(() => {
    if (errorCode === 'UNAUTHENTICATED') void signOut().then(() => router.replace('/sign-in'));
  }, [errorCode, router]);

  if (!sessionReady) return <PageSpinner label="Checking your sign-in…" />;
  if (me.isPending || (me.isError && me.isFetching)) return <PageSpinner label="Loading your account…" />;
  if (me.isError) {
    if (errorCode === 'FORBIDDEN') return <NoAccess />;
    if (errorCode === 'MFA_REQUIRED') return <SecondStepRequired />;
    if (errorCode === 'UNAUTHENTICATED') return <PageSpinner label="Signing you out…" />;
    return <GateError error={me.error} onRetry={() => void me.refetch()} />;
  }
  return <StaffProvider me={me.data}>{children}</StaffProvider>;
}

/** The server still asks for a second step (admin.require_mfa is on there), which this panel no longer offers. */
function SecondStepRequired() {
  const leave = useSignOut();
  return (
    <AuthCard title="This environment still asks for a second step" wide>
      <Alert variant="warning">
        <ShieldQuestion />
        <AlertDescription>
          Your password was accepted, but this environment still asks for a second sign-in step after it, and this version of
          the admin panel no longer has one. Ask the person who looks after FESS POS to finish switching the second step off.
        </AlertDescription>
      </Alert>
      <Button className="mt-4 w-full" variant="outline" onClick={() => void leave()}>
        <LogOut /> Sign out
      </Button>
    </AuthCard>
  );
}
