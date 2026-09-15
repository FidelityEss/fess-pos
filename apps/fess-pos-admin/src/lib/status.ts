// Job status presentation and the dashboard-status mapping (docs/06 §1), plus labels and badge tones for other enums.
// Labels are plain English for an office user (D-98); the internal values never change.
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
  /** The scope's dashboard status name (docs/06 §1) — contractual, so it keeps the bank's wording. */
  label: string;
  /** What the group means, in a sentence. */
  hint: string;
  statuses: readonly JobStatus[];
  tone: StatusTone;
}

/** The six scope dashboard statuses and the internal states each covers, in display order. */
export const DASHBOARD_GROUPS: readonly DashboardGroup[] = [
  { key: 'pending', label: 'Pending', hint: 'Not yet given to an agent', statuses: ['pending', 'scheduled'], tone: 'neutral' },
  { key: 'assigned', label: 'Assigned', hint: 'With an agent, visit not started', statuses: ['assigned', 'accepted'], tone: 'info' },
  {
    key: 'in_progress',
    label: 'In Progress',
    hint: 'Visit under way or being reviewed',
    statuses: ['in_progress', 'paused', 'submitted', 'under_review', 'returned'],
    tone: 'progress',
  },
  { key: 'completed', label: 'Completed', hint: 'Approved or rejected', statuses: ['approved', 'rejected'], tone: 'success' },
  { key: 'cancelled', label: 'Cancelled', hint: 'Stopped before the end', statuses: ['cancelled'], tone: 'muted' },
  {
    key: 'unable_to_complete',
    label: 'Unable to Complete',
    hint: 'The visit couldn’t be done or booked',
    statuses: ['unable_to_complete', 'appointment_not_secured'],
    tone: 'warning',
  },
];

/** Plain label for each internal job status (what an office worker would say). */
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'To be booked',
  scheduled: 'Booked, no agent yet',
  assigned: 'Sent to agent',
  accepted: 'Agent accepted',
  in_progress: 'Visit under way',
  paused: 'Visit paused',
  submitted: 'Visit sent in',
  under_review: 'Waiting for review',
  returned: 'Sent back to agent',
  approved: 'Approved',
  rejected: 'Rejected',
  unable_to_complete: 'Couldn’t be done',
  appointment_not_secured: 'Couldn’t book a visit',
  cancelled: 'Cancelled',
  closed: 'Archived',
};

/** One sentence: where the job is now (the job page summary, docs/17 §4.7). */
export const JOB_STATUS_MEANING: Record<JobStatus, string> = {
  pending: 'Nobody has agreed a visit time with the merchant yet.',
  scheduled: 'A visit time is agreed with the merchant. It needs an agent.',
  assigned: 'The job has been sent to an agent, who hasn’t accepted it yet.',
  accepted: 'The agent has accepted the job and will visit at the agreed time.',
  in_progress: 'The agent is on site doing the visit.',
  paused: 'The agent started the visit and paused it.',
  submitted: 'The agent sent the visit in. The system is checking it before review.',
  under_review: 'The visit is waiting for someone to check and approve it.',
  returned: 'The visit was sent back to the agent to fix something.',
  approved: 'The visit was checked and approved. The job is finished.',
  rejected: 'The visit was checked and rejected. The job is finished.',
  unable_to_complete: 'The agent couldn’t do the visit.',
  appointment_not_secured: 'No visit could be booked with the merchant.',
  cancelled: 'The job was cancelled.',
  closed: 'The job is finished and archived. Nothing more can happen to it.',
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

/** Plain label for each visit (inspection attempt) status. */
export const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  in_progress: 'Under way',
  paused: 'Paused',
  abandoned: 'Stopped by the agent',
  submitted: 'Sent in',
  verifying: 'Checking photos',
  integrity_failed: 'Failed a security check',
  under_review: 'Waiting for review',
  approved: 'Approved',
  returned: 'Sent back for changes',
  rejected: 'Rejected',
};

/** Badge tones for other enums (use with <ToneBadge value={…} tones={…} labels={…} />). */
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

/** Incoming data (envelope) states. */
export const ENVELOPE_STATE_TONE: Record<EnvelopeState, StatusTone> = {
  received: 'info',
  deferred: 'warning',
  committed: 'success',
  duplicate: 'muted',
  rejected: 'danger',
  conflict: 'danger',
};
export const ENVELOPE_STATE_LABEL: Record<EnvelopeState, string> = {
  received: 'Received',
  deferred: 'Waiting for earlier data',
  committed: 'Saved',
  duplicate: 'Already had it',
  rejected: 'Couldn’t be saved (kept)',
  conflict: 'Clashes with earlier data',
};

/** Photo and file (evidence) upload states. */
export const UPLOAD_STATE_TONE: Record<UploadState, StatusTone> = {
  pending: 'neutral',
  uploaded: 'info',
  verified: 'success',
  quarantined: 'danger',
};
export const UPLOAD_STATE_LABEL: Record<UploadState, string> = {
  pending: 'Not received yet',
  uploaded: 'Received, being checked',
  verified: 'Received and checked',
  quarantined: 'Held back: failed a check',
};

export const ALERT_SEVERITY_TONE: Record<AlertSeverity, StatusTone> = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
};
export const ALERT_SEVERITY_LABEL: Record<AlertSeverity, string> = {
  info: 'For information',
  warning: 'Warning',
  critical: 'Urgent',
};

export const EXPORT_STATUS_TONE: Record<ExportStatus, StatusTone> = {
  queued: 'neutral',
  running: 'progress',
  done: 'success',
  failed: 'danger',
};
export const EXPORT_STATUS_LABEL: Record<ExportStatus, string> = {
  queued: 'Waiting to start',
  running: 'Being prepared',
  done: 'Ready',
  failed: 'Failed',
};

export const APPROVAL_DECISION_TONE: Record<ApprovalDecision, StatusTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'muted',
};
export const APPROVAL_DECISION_LABEL: Record<ApprovalDecision, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Turned down',
  withdrawn: 'Withdrawn',
};

export const RELEASE_STATUS_TONE: Record<ReleaseStatus, StatusTone> = {
  supported: 'success',
  deprecated: 'warning',
  unsupported_for_new_work: 'danger',
};
export const RELEASE_STATUS_LABEL: Record<ReleaseStatus, string> = {
  supported: 'Allowed',
  deprecated: 'Allowed, update soon',
  unsupported_for_new_work: 'Must update before new visits',
};

/** Terminal states (no further agent/admin work except close). */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  'approved', 'rejected', 'unable_to_complete', 'appointment_not_secured', 'cancelled', 'closed',
];
