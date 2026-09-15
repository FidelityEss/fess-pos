'use client';

// Small presentational pieces shared by the reference-data and administration screens.
import { Check, Lock, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { shortId } from '@/lib/format';
import { useBankLookup } from '@/lib/hooks';
import { PERMISSION_LABEL, ROLE_LABEL } from '@/lib/labels';
import type { StatusTone } from '@/lib/status';
import type { Permission, PosRole } from '@/lib/types';
import { cn } from '@/lib/utils';

// The plain role and permission names live in @/lib/labels; re-exported for the screens that import them from here.
export { PERMISSION_LABEL, ROLE_LABEL };

const ROLE_TONE: Record<PosRole, StatusTone> = { pos_agent: 'info', pos_admin: 'accent', pos_bank_reader: 'neutral' };

export const ROLE_HINT: Record<PosRole, string> = {
  pos_agent: 'Does the visits, using the FESS app on their phone. Agents never sign in to this panel.',
  pos_admin: 'Uses this admin panel to set things up, create jobs and check visits.',
  pos_bank_reader: 'Can see their own banks’ jobs and visits in this panel, but can’t change anything.',
};

export const PERMISSION_HINT: Record<Permission, string> = {
  review_inspections: 'Approve finished visits, send them back to the agent or reject them, and record corrections.',
  approve_definitions: 'Give the second approval when another administrator changes the set-up or app settings.',
  schedule_jobs: 'Record calls to merchants, agree visit times, and note when a visit couldn’t be booked.',
};

export function RoleBadge({ role, className }: { role: PosRole; className?: string }) {
  return (
    <Badge tone={ROLE_TONE[role]} className={className}>
      {ROLE_LABEL[role]}
    </Badge>
  );
}

export function ActiveBadge({
  active,
  activeLabel = 'Active',
  inactiveLabel = 'Inactive',
}: {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  return <Badge tone={active ? 'success' : 'muted'}>{active ? activeLabel : inactiveLabel}</Badge>;
}

/** Tick / dash for boolean columns. */
export function YesNo({ value, title }: { value: boolean; title?: string }) {
  return value ? (
    <span className="inline-flex items-center text-emerald-700" title={title ?? 'Yes'}>
      <Check className="size-4" aria-hidden />
      <span className="sr-only">Yes</span>
    </span>
  ) : (
    <span className="inline-flex items-center text-slate-400" title={title ?? 'No'}>
      <Minus className="size-4" aria-hidden />
      <span className="sr-only">No</span>
    </span>
  );
}

/** Info box explaining why something is read-only for this staff member. */
export function ReadOnlyNotice({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Alert variant="info" className={className}>
      <Lock />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** Heading row for a block inside a page or sheet. */
export function SectionHeading({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-end justify-between gap-2', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Shortened UUID / hash in monospace with the full value in the tooltip and a copy button. */
export function MonoId({
  value,
  head = 8,
  tail = 4,
  copy = true,
  className,
}: {
  value: string | null | undefined;
  head?: number;
  tail?: number;
  copy?: boolean;
  className?: string;
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-mono text-xs', className)} title={value}>
      {shortId(value, head, tail)}
      {copy ? <CopyButton value={value} title="Copy" /> : null}
    </span>
  );
}

/** Bank codes for a bank_ids array (null = all banks). */
export function BankList({ bankIds, allLabel = 'All banks' }: { bankIds: readonly string[] | null; allLabel?: string }) {
  const lookup = useBankLookup();
  if (bankIds === null) return <Badge tone="accent">{allLabel}</Badge>;
  if (bankIds.length === 0) return <span className="text-muted-foreground">None</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {bankIds.map((id) => {
        const bank = lookup(id);
        return (
          <Badge key={id} tone="neutral" className="font-mono" title={bank?.name ?? id}>
            {bank?.code ?? id.slice(0, 8)}
          </Badge>
        );
      })}
    </span>
  );
}

/** "All banks" (global) or the owning bank's code (reason codes, lookup lists). */
export function BankScopeBadge({ bankId }: { bankId: string | null }) {
  const lookup = useBankLookup();
  if (bankId === null) return <Badge tone="muted">All banks</Badge>;
  const bank = lookup(bankId);
  return (
    <Badge tone="neutral" className="font-mono" title={bank?.name ?? bankId}>
      {bank?.code ?? bankId.slice(0, 8)}
    </Badge>
  );
}
