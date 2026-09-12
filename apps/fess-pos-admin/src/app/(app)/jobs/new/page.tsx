import type { Metadata } from 'next';
import { JobForm } from '@/components/jobs/job-form';

export const metadata: Metadata = { title: 'New job' };

export default function NewJobPage() {
  return <JobForm mode="create" />;
}
