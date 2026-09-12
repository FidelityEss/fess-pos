import type { Metadata } from 'next';
import { JobImport } from '@/components/jobs/job-import';

export const metadata: Metadata = { title: 'Import jobs' };

export default function ImportJobsPage() {
  return <JobImport />;
}
