import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegisterFlow } from '@/components/auth/register-flow';
import { PageSpinner } from '@/components/ui/spinner';

// The link carries a sign-up token until it is used: never send this address to another site.
export const metadata: Metadata = { title: 'Choose your password', referrer: 'no-referrer' };

export default function RegisterPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <RegisterFlow />
    </Suspense>
  );
}
