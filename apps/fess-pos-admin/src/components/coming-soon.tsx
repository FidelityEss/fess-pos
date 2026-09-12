import { Construction } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { Card } from '@/components/ui/card';

/** Placeholder body for screens not built yet. */
export function ComingSoon({ note }: { note?: string }) {
  return (
    <Card>
      <EmptyState icon={Construction} title="Coming soon" description={note ?? 'This screen is being built.'} />
    </Card>
  );
}
