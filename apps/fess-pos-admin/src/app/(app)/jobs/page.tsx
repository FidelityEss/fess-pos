import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JobsListView } from '@/components/jobs/jobs-list-view';
import { PageSpinner } from '@/components/ui/spinner';

export const metadata: Metadata = { title: 'Jobs' };

// Supports `?dash=<DashboardKey>` from the dashboard cards; filters are kept in the URL (useSearchParams → Suspense).
export default function JobsPage() {
  return (
    <Suspense fallback={<PageSpinner label="Loading jobs…" />}>
      <JobsListView />
    </Suspense>
  );
}
