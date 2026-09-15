'use client';

// "Worth checking as you go": the local advice (local-advice.ts) as a short list with "Show me" beside each item.
import { CheckCircle2, Lightbulb, LocateFixed } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Advice } from './local-advice';

const SHOWN = 4;

export function AdvicePanel({ items, onLocate, readOnly }: { items: Advice[]; onLocate: (target: string) => void; readOnly?: boolean }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) {
    return readOnly ? null : (
      <p className="flex items-center gap-1.5 text-sm text-emerald-800">
        <CheckCircle2 className="size-4" aria-hidden /> Nothing to check so far. “Check” runs the full check before you publish.
      </p>
    );
  }
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <div role="status" className="rounded-md border border-amber-200 bg-amber-50/50 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-amber-950">
        <Lightbulb className="size-4" aria-hidden /> {items.length === 1 ? '1 thing worth checking' : `${items.length} things worth checking`}
      </p>
      <ul className="mt-1.5 grid gap-1">
        {shown.map((a) => (
          <li key={a.text} className={cn('flex flex-wrap items-start gap-x-2 gap-y-1 text-sm', a.tone === 'warning' ? 'text-amber-950' : 'text-slate-700')}>
            <span className="min-w-0 flex-1">{a.text}</span>
            {a.target ? (
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => onLocate(a.target as string)}>
                <LocateFixed /> Show me
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {items.length > SHOWN ? (
        <Button type="button" size="sm" variant="ghost" className="mt-1 h-7" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </Button>
      ) : null}
    </div>
  );
}
