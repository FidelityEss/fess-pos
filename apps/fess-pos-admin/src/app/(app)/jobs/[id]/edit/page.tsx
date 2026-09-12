import type { Metadata } from 'next';
import { JobEditView } from '@/components/jobs/job-form';

export const metadata: Metadata = { title: 'Edit job' };

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JobEditView id={id} />;
}
