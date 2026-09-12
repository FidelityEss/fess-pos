import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Inline spinning loader. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

/** Centred full-area loader. */
export function PageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}
