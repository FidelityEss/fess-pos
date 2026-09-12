import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JobDetailView } from '@/components/jobs/job-detail-view';
import { PageSpinner } from '@/components/ui/spinner';

export const metadata: Metadata = { title: 'Job' };

// Tabs are kept in `?tab=` (and `?inspection=` for the review queue's deep link) — useSearchParams → Suspense.
export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<PageSpinner label="Loading job…" />}>
      <JobDetailView id={id} />
    </Suspense>
  );
}
