'use client';

import { Suspense } from 'react';
import { EnvelopesView } from '@/components/ops/envelopes-view';
import { PageSpinner } from '@/components/ui/spinner';

export default function EnvelopeInboxPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <EnvelopesView />
    </Suspense>
  );
}
