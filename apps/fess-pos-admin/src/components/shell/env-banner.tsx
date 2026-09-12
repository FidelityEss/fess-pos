import { env, type EnvName } from '@/lib/env';
import { cn } from '@/lib/utils';

const BANNER: Record<Exclude<EnvName, 'production'>, { text: string; className: string }> = {
  local: { text: 'LOCAL — development stack, not real data', className: 'bg-slate-700 text-slate-100' },
  qa: { text: 'QA — testing environment, dummy data only', className: 'bg-amber-400 text-amber-950' },
  staging: { text: 'STAGING — test data only', className: 'bg-amber-400 text-amber-950' },
};

/** Full-width environment banner for non-production environments (renders nothing in production). */
export function EnvBanner() {
  if (env.envName === 'production') return null;
  const b = BANNER[env.envName];
  return (
    <div role="status" className={cn('px-4 py-1 text-center text-xs font-semibold tracking-wide', b.className)}>
      {b.text}
    </div>
  );
}

const BADGE: Record<EnvName, string> = {
  local: 'border-slate-300 bg-slate-100 text-slate-700',
  qa: 'border-amber-300 bg-amber-100 text-amber-900',
  staging: 'border-amber-300 bg-amber-100 text-amber-900',
  production: 'border-emerald-300 bg-emerald-50 text-emerald-800',
};

/** Small environment badge for the header. */
export function EnvBadge({ className }: { className?: string }) {
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide', BADGE[env.envName], className)}>
      {env.envName}
    </span>
  );
}
