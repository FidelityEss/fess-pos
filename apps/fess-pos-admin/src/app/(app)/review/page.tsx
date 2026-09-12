import type { Metadata } from 'next';
import { ReviewQueueView } from '@/components/review/review-queue-view';

export const metadata: Metadata = { title: 'Review queue' };

export default function ReviewQueuePage() {
  return <ReviewQueueView />;
}
