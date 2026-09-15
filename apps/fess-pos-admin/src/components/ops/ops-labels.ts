// Plain-English labels for the operations screens (D-98, docs/17 §2 rule 1). Local to this area; the internal values
// (alert kinds, envelope types, audited tables, queue names…) never change, only what people read. Anything a map
// doesn't know falls back to humanize() through labelFrom().
import type { EnvelopeResolution } from '@/lib/types';

/** Alert kinds raised by the backend (pos_rpc.alert callers). */
export const ALERT_KIND_LABEL: Record<string, string> = {
  admin_bootstrapped: 'First administrator set up',
  approval_requested: 'A change is waiting for approval',
  assignment_expired: 'Agent didn’t answer a job in time',
  assignment_rejected: 'Agent turned a job down',
  cancelled_in_progress: 'Job cancelled during a visit',
  client_error: 'The app reported an error',
  dead_letter: 'Background work failed after several tries',
  deactivated_with_jobs: 'Person turned off while they still had jobs',
  device_backlog: 'Phone is holding data it hasn’t sent',
  device_revoked: 'Phone blocked',
  dlq_depth: 'Background work keeps failing',
  envelope_conflict: 'Incoming data clashes with earlier data',
  envelope_deferred: 'Incoming data is waiting for earlier data',
  envelope_rejected: 'Incoming data couldn’t be saved',
  envelope_stuck: 'Incoming data is stuck',
  evidence_quarantined: 'Photo failed a security check',
  incomplete_manifest: 'Visit sent in with photos missing',
  ingest_hold: 'Incoming data held to be tried again',
  integrity_failed: 'Visit failed a security check',
  issuer_activated: 'Sign-in source turned on',
  issuer_deactivated: 'Sign-in source turned off',
  link_request: 'Someone signed in who we couldn’t match to a person',
  new_device: 'Agent signed in on a new phone',
  payload_hash_mismatch: 'Incoming data failed a security check',
  refresh_reuse: 'A sign-in was used twice (possible copying)',
  replica_mismatch: 'Backup copy of a photo doesn’t match',
  server_epoch_rotated: 'Phones were asked to re-send everything',
  shared_device: 'Two agents used the same phone',
  submission_out_of_state: 'Visit sent in when the job didn’t expect it',
  unable_to_complete: 'A visit couldn’t be done',
  user_hard_revoked: 'Person’s access removed',
};

/** What an alert is about (alerts.subject_type). */
export const ALERT_SUBJECT_LABEL: Record<string, string> = {
  job: 'Job',
  inspection: 'Visit',
  envelope: 'Incoming data',
  evidence: 'Photo',
  approval: 'Approval',
  device: 'Phone',
  user: 'Person',
  agent: 'Agent',
  bank: 'Bank',
  issuer: 'Sign-in source',
  trusted_issuer: 'Sign-in source',
  export: 'Export',
  session: 'Sign-in',
};

/** Types of data a phone sends (KNOWN_ENVELOPE_TYPES in the engine). */
export const ENVELOPE_TYPE_LABEL: Record<string, string> = {
  job_event: 'Job update',
  inspection_started: 'Visit started',
  inspection_snapshot: 'Visit progress',
  evidence_meta: 'Photo details',
  evidence_uploaded: 'Photo received',
  traces_batch: 'Location trail',
  submission: 'Visit sent in',
  form_submission: 'Answers',
  custody_batch: 'Delivery record',
  sync_report: 'Phone check-in',
  client_error: 'App error report',
};

/** How a piece of incoming data was sorted out. */
export const ENVELOPE_RESOLUTION_LABEL: Record<EnvelopeResolution, string> = {
  reprocessed: 'Being tried again',
  attached: 'Added to a job',
  resolved: 'Closed with a reason',
};

/** Steps in the delivery record (custody_events.event). */
export const CUSTODY_EVENT_LABEL: Record<string, string> = {
  landed: 'Arrived',
  started: 'Visit started',
  abandoned: 'Visit stopped',
  uploaded: 'Photo uploaded',
  verified: 'Photo checked',
  quarantined: 'Held back: failed a check',
  replicated: 'Backup copy made',
  meta_committed: 'Photo details saved',
  submission_committed: 'Visit saved',
  conflict: 'Clash found',
  reprocess_requested: 'Asked to try again',
  resolved: 'Sorted out',
  reviewed: 'Reviewed',
  amended: 'Corrected',
};

/** Who recorded a delivery step. */
export const CUSTODY_SOURCE_LABEL: Record<string, string> = {
  device: 'Phone',
  server: 'Our system',
};

/** Background work queues (pgmq). */
export const QUEUE_LABEL: Record<string, string> = {
  export: 'Preparing exports',
  notify: 'Sending notifications',
  replicate_evidence: 'Making backup copies of photos',
  verify_evidence: 'Checking photos',
  reprocess_envelopes: 'Trying incoming data again',
};

/** Audited tables, as the thing that changed. */
export const AUDIT_TABLE_LABEL: Record<string, string> = {
  agent_card_tokens: 'Agent ID card check',
  alerts: 'Alert',
  api_keys: 'Bank API key',
  banks: 'Bank',
  definition_drafts: 'Set-up draft',
  definition_families: 'Set-up piece',
  definition_test_cases: 'Set-up test',
  device_sync_status: 'Phone check-in',
  devices: 'Phone',
  evidence: 'Photo or file',
  exports: 'Export',
  external_identities: 'Linked sign-in',
  ingest_envelopes: 'Incoming data',
  inspections: 'Visit',
  job_assignments: 'Agent assignment',
  jobs: 'Job',
  lookup_lists: 'Drop-down list',
  mcc_codes: 'Business type',
  module_releases: 'App version',
  notifications: 'Notification',
  pos_sessions: 'Sign-in',
  pos_users: 'Person',
  reason_codes: 'Reason',
  server_epoch: 'Re-send marker',
  session_tokens: 'Visit security key',
  settings: 'App setting',
  trusted_issuers: 'Sign-in source',
};

/** Audit actions. */
export const AUDIT_ACTION_LABEL = { INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Removed' } as const;
