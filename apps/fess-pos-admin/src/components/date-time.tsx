'use client';

import { useEffect, useState } from 'react';
import { formatDate, formatDateTime, formatRelative, formatTime, toDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Current time (ms), re-rendering every `intervalMs` (default 30 s) — for live relative ages. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * An ISO timestamp rendered in Africa/Johannesburg. mode: datetime (default) | date | time | relative.
 * `showRelative` appends "(5m ago)". The full timestamp is always in the tooltip.
 */
export function DateTime({
  value,
  mode = 'datetime',
  showRelative = false,
  seconds = false,
  className,
}: {
  value: string | null | undefined;
  mode?: 'datetime' | 'date' | 'time' | 'relative';
  showRelative?: boolean;
  seconds?: boolean;
  className?: string;
}) {
  const now = useNow();
  const d = toDate(value);
  if (!d || !value) return <span className={cn('text-muted-foreground', className)}>—</span>;
  const main =
    mode === 'date' ? formatDate(d) : mode === 'time' ? formatTime(d) : mode === 'relative' ? formatRelative(d, now) : formatDateTime(d, { seconds });
  return (
    <time dateTime={d.toISOString()} title={`${formatDateTime(d, { seconds: true })} SAST`} className={cn('whitespace-nowrap', className)} suppressHydrationWarning>
      {main}
      {showRelative && mode !== 'relative' ? <span className="ml-1 text-muted-foreground">({formatRelative(d, now)})</span> : null}
    </time>
  );
}
