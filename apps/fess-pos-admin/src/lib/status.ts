// Job status presentation and the dashboard-status mapping (docs/06 §1), plus badge tones for other enums.
import type {
  AlertSeverity,
  ApprovalDecision,
  EnvelopeState,
  ExportStatus,
  InspectionStatus,
  JobStatus,
  ReleaseStatus,
  UploadState,
} from './types';

export const DASHBOARD_KEYS = ['pending', 'assigned', 'in_progress', 'completed', 'cancelled', 'unable_to_complete'] as const;
export type DashboardKey = (typeof DASHBOARD_KEYS)[number];

/** Visual tone shared by badges and cards. */
export type StatusTone = 'neutral' | 'info' | 'accent' | 'progress' | 'success' | 'warning' | 'danger' | 'muted';

export interface DashboardGroup {
  key: DashboardKey;
  label: string;
  statuses: readonly JobStatus[];
  tone: StatusTone;
}

/** The six scope dashboard statuses and the internal states each covers, in display order. */
export const DASHBOARD_GROUPS: readonly DashboardGroup[] = [
  { key: 'pending', label: 'Pending', statuses: ['pending', 'scheduled'], tone: 'neutral' },
  { key: 'assigned', label: 'Assigned', statuses: ['assigned', 'accepted'], tone: 'info' },
  {
    key: 'in_progress',
    label: 'In Progress',
    statuses: ['in_progress', 'paused', 'submitted', 'under_review', 'returned'],
    tone: 'progress',
  },
  { key: 'completed', label: 'Completed', statuses: ['approved', 'rejected'], tone: 'success' },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'], tone: 'muted' },
  {
    key: 'unable_to_complete',
    label: 'Unable to Complete',
    statuses: ['unable_to_complete', 'appointment_not_secured'],
    tone: 'warning',
  },
];

/** Human label for each internal job status. */
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  assigned: 'Assigned',
  accepted: 'Accepted',
  in_progress: 'In progress',
  paused: 'Paused',
  submitted: 'Submitted',
  under_review: 'Under review',
  returned: 'Returned',
  approved: 'Approved',
  rejected: 'Rejected',
  unable_to_complete: 'Unable to complete',
  appointment_not_secured: 'Appointment not secured',
  cancelled: 'Cancelled',
  closed: 'Closed',
};

/** Badge tone for each internal job status. */
export const JOB_STATUS_TONE: Record<JobStatus, StatusTone> = {
  pending: 'neutral',
  scheduled: 'accent',
  assigned: 'info',
  accepted: 'info',
  in_progress: 'progress',
  paused: 'warning',
  submitted: 'progress',
  under_review: 'progress',
  returned: 'warning',
  approved: 'success',
  rejected: 'danger',
  unable_to_complete: 'warning',
  appointment_not_secured: 'warning',
  cancelled: 'muted',
  closed: 'muted',
};

/** Special sub-labels the scope requires for some internal states. */
const SUB_LABELS: Partial<Record<JobStatus, string>> = {
  scheduled: 'Pending – appointment confirmed',
  rejected: 'Completed – rejected',
  appointment_not_secured: 'Unable to complete – appointment not secured',
};

export interface DashboardStatus {
  /** 'archived' for closed jobs. */
  key: DashboardKey | 'archived';
  /** Dashboard label, e.g. "Pending". */
  label: string;
  /** The label to display for this exact state, e.g. "Pending – appointment confirmed" (else = label). */
  displayLabel: string;
  /** The sub-label when the state has one, else null. */
  subLabel: string | null;
  tone: StatusTone;
}

/** Map an internal job status to its scope dashboard status (docs/06 §1). */
export function dashboardStatus(status: JobStatus): DashboardStatus {
  if (status === 'closed') {
    return { key: 'archived', label: 'Archived', displayLabel: 'Archived', subLabel: null, tone: 'muted' };
  }
  const group = DASHBOARD_GROUPS.find((g) => g.statuses.includes(status));
  if (!group) {
    return { key: 'archived', label: status, displayLabel: status, subLabel: null, tone: 'muted' };
  }
  const subLabel = SUB_LABELS[status] ?? null;
  return { key: group.key, label: group.label, displayLabel: subLabel ?? group.label, subLabel, tone: group.tone };
}

/** Internal statuses for a dashboard key (for `/jobs?dash=<key>` filters). */
export function statusesForDashboardKey(key: DashboardKey): readonly JobStatus[] {
  return DASHBOARD_GROUPS.find((g) => g.key === key)?.statuses ?? [];
}

/** Type guard for a `dash` query parameter. */
export function isDashboardKey(value: string | null | undefined): value is DashboardKey {
  return typeof value === 'string' && (DASHBOARD_KEYS as readonly string[]).includes(value);
}

/** Label for a dashboard key. */
export function dashboardLabel(key: DashboardKey): string {
  return DASHBOARD_GROUPS.find((g) => g.key === key)?.label ?? key;
}

/** Plain-language label for each inspection (attempt) status. */
export const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  in_progress: 'In progress',
  paused: 'Paused',
  abandoned: 'Abandoned',
  submitted: 'Submitted',
  verifying: 'Checking photos',
  integrity_failed: 'Failed tamper check',
  under_review: 'Awaiting review',
  approved: 'Approved',
  returned: 'Returned for rework',
  rejected: 'Rejected',
};

/** Badge tones for other enums (use with <ToneBadge value={…} tones={…} />). */
export const INSPECTION_STATUS_TONE: Record<InspectionStatus, StatusTone> = {
  in_progress: 'progress',
  paused: 'warning',
  abandoned: 'muted',
  submitted: 'progress',
  verifying: 'info',
  integrity_failed: 'danger',
  under_review: 'progress',
  approved: 'success',
  returned: 'warning',
  rejected: 'danger',
};
export const ENVELOPE_STATE_TONE: Record<EnvelopeState, StatusTone> = {
  received: 'info',
  deferred: 'warning',
  committed: 'success',
  duplicate: 'muted',
  rejected: 'danger',
  conflict: 'danger',
};
export const UPLOAD_STATE_TONE: Record<UploadState, StatusTone> = {
  pending: 'neutral',
  uploaded: 'info',
  verified: 'success',
  quarantined: 'danger',
};
export const ALERT_SEVERITY_TONE: Record<AlertSeverity, StatusTone> = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
};
export const EXPORT_STATUS_TONE: Record<ExportStatus, StatusTone> = {
  queued: 'neutral',
  running: 'progress',
  done: 'success',
  failed: 'danger',
};
export const APPROVAL_DECISION_TONE: Record<ApprovalDecision, StatusTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'muted',
};
export const RELEASE_STATUS_TONE: Record<ReleaseStatus, StatusTone> = {
  supported: 'success',
  deprecated: 'warning',
  unsupported_for_new_work: 'danger',
};

/** Terminal states (no further agent/admin work except close). */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  'approved', 'rejected', 'unable_to_complete', 'appointment_not_secured', 'cancelled', 'closed',
];
