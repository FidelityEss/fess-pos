import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JobForm } from '@/components/jobs/job-form';
import { PageSpinner } from '@/components/ui/spinner';

export const metadata: Metadata = { title: 'New job' };

// `?bank=<id>` preselects the bank (from a bank's page or the "Add its first job" prompt) — useSearchParams → Suspense.
export default function NewJobPage() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <JobForm mode="create" />
    </Suspense>
  );
}
