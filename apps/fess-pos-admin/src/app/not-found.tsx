import { FileQuestion } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="The page you asked for doesn't exist."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/">Go to the dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
