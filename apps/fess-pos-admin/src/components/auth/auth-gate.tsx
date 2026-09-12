'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { PageSpinner } from '@/components/ui/spinner';
import { adminApi, isApiError } from '@/lib/api';
import { currentAal, isMfaSkipped, setMfaSkipped, signOut } from '@/lib/auth';
import { queryKeys } from '@/lib/hooks';
import { StaffProvider } from '@/lib/staff';
import { getSupabase } from '@/lib/supabase';
import { GateError } from './gate-error';
import { NoAccess } from './no-access';

/**
 * Wraps the authenticated app. No session → /sign-in; aal1 → /mfa (unless the local-only skip is active);
 * then GET /v1/admin/me: FORBIDDEN → no-access page, MFA_REQUIRED → /mfa, success → <StaffProvider>.
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
    const next = () => encodeURIComponent(pathRef.current || '/');
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        router.replace(`/sign-in?next=${next()}`);
        return;
      }
      const aal = await currentAal();
      if (cancelled) return;
      if (aal !== 'aal2' && !isMfaSkipped()) {
        router.replace(`/mfa?next=${next()}`);
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
    if (errorCode === 'MFA_REQUIRED') {
      setMfaSkipped(false);
      router.replace(`/mfa?reason=mfa_required&next=${encodeURIComponent(pathRef.current || '/')}`);
    } else if (errorCode === 'UNAUTHENTICATED') {
      void signOut().then(() => router.replace('/sign-in'));
    }
  }, [errorCode, router]);

  if (!sessionReady) return <PageSpinner label="Checking your session…" />;
  if (me.isPending || (me.isError && me.isFetching)) return <PageSpinner label="Loading your profile…" />;
  if (me.isError) {
    if (errorCode === 'FORBIDDEN') return <NoAccess />;
    if (errorCode === 'MFA_REQUIRED' || errorCode === 'UNAUTHENTICATED') return <PageSpinner label="Redirecting…" />;
    return <GateError error={me.error} onRetry={() => void me.refetch()} />;
  }
  return <StaffProvider me={me.data}>{children}</StaffProvider>;
}
