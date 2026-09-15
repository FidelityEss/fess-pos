import type { Metadata } from 'next';
import { ReviewQueueView } from '@/components/review/review-queue-view';

export const metadata: Metadata = { title: 'To review' };

export default function ReviewQueuePage() {
  return <ReviewQueueView />;
}
