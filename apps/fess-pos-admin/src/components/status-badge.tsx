import { Badge } from '@/components/ui/badge';
import { humanize } from '@/lib/format';
import { dashboardStatus, INSPECTION_STATUS_LABEL, INSPECTION_STATUS_TONE, JOB_STATUS_LABEL, JOB_STATUS_TONE, type StatusTone } from '@/lib/status';
import type { InspectionStatus, JobStatus } from '@/lib/types';

/** Internal job status badge (tooltip shows the dashboard status, e.g. "Pending – appointment confirmed"). */
export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <Badge tone={JOB_STATUS_TONE[status]} title={`Dashboard: ${dashboardStatus(status).displayLabel}`} className={className}>
      {JOB_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Dashboard (scope) status badge for an internal status, including the special sub-labels. */
export function DashboardStatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const d = dashboardStatus(status);
  return (
    <Badge tone={d.tone} title={JOB_STATUS_LABEL[status]} className={className}>
      {d.displayLabel}
    </Badge>
  );
}

/** Inspection (attempt) status in plain language, e.g. integrity_failed → "Failed tamper check". */
export function InspectionStatusBadge({ status, className }: { status: InspectionStatus; className?: string }) {
  return (
    <Badge tone={INSPECTION_STATUS_TONE[status] ?? 'neutral'} title={status} className={className}>
      {INSPECTION_STATUS_LABEL[status] ?? humanize(status)}
    </Badge>
  );
}

/** Generic enum badge: `<ToneBadge value={row.state} tones={ENVELOPE_STATE_TONE} />`. Label defaults to humanize(value). */
export function ToneBadge<T extends string>({
  value,
  tones,
  label,
  labels,
  className,
}: {
  value: T;
  tones: Partial<Record<T, StatusTone>>;
  label?: string;
  /** Friendly labels per value (else humanize(value)). */
  labels?: Partial<Record<T, string>>;
  className?: string;
}) {
  return (
    <Badge tone={tones[value] ?? 'neutral'} className={className}>
      {label ?? labels?.[value] ?? humanize(value)}
    </Badge>
  );
}
