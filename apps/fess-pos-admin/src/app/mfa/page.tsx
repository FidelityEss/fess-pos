import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MfaFlow } from '@/components/auth/mfa-flow';
import { PageSpinner } from '@/components/ui/spinner';

export const metadata: Metadata = { title: 'Two-factor verification' };

export default function MfaPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <MfaFlow />
    </Suspense>
  );
}
