import { env, type EnvName } from '@/lib/env';
import { cn } from '@/lib/utils';

/** The environment's name as people say it. */
export const ENV_NAME_LABEL: Record<EnvName, string> = {
  local: 'a local test copy',
  qa: 'QA (testing)',
  staging: 'staging (testing)',
  production: 'production (live)',
};

const BANNER: Record<Exclude<EnvName, 'production'>, { text: string; className: string }> = {
  local: { text: 'Local test copy: nothing here is real data', className: 'bg-slate-700 text-slate-100' },
  qa: { text: 'QA: for testing only, with made-up data', className: 'bg-amber-400 text-amber-950' },
  staging: { text: 'Staging: for testing only', className: 'bg-amber-400 text-amber-950' },
};

/**
 * Full-width environment banner for non-production environments (renders nothing in production). It stays on screen
 * (sticky) at a fixed height; globals.css reads `data-env-banner` to push the header and sidebar below it (T2-30).
 */
export function EnvBanner() {
  if (env.envName === 'production') return null;
  const b = BANNER[env.envName];
  return (
    <div
      role="status"
      data-env-banner
      className={cn('sticky top-0 z-40 h-6 truncate px-4 text-center text-xs font-semibold leading-6 tracking-wide', b.className)}
    >
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
    <span
      title={`You’re on ${ENV_NAME_LABEL[env.envName]}`}
      className={cn('rounded border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide', BADGE[env.envName], className)}
    >
      {env.envName}
    </span>
  );
}
