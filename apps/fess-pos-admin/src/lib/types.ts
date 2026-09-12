// Row and response types mirroring supabase/migrations/*.sql (schema `pos`) and the /v1/admin contract.
// Timestamps are ISO strings. Geography columns read via PostgREST arrive as EWKB hex (see lib/geo.ts).

export type Uuid = string;
export type IsoDateTime = string;
/** EWKB hex string as returned by PostgREST for geography(point) columns. */
export type EwkbHex = string;
export type JsonObject = Record<string, unknown>;

export interface LatLng {
  lat: number;
  lng: number;
}

// ── Enums (pos.* types and check constraints) ──────────────────────────────────────────────────
export const POS_ROLES = ['pos_agent', 'pos_admin', 'pos_bank_reader'] as const;
export type PosRole = (typeof POS_ROLES)[number];

export const PERMISSIONS = ['review_inspections', 'approve_definitions', 'schedule_jobs'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const SESSION_SCOPES = ['full', 'ingest_only'] as const;
export type SessionScope = (typeof SESSION_SCOPES)[number];

export const ISSUER_TYPES = ['jwks', 'introspection', 'dev_stub'] as const;
export type IssuerType = (typeof ISSUER_TYPES)[number];

export const IDENTITY_LINK_VIA = ['claim', 'issuer_lookup', 'admin'] as const;
export type IdentityLinkVia = (typeof IDENTITY_LINK_VIA)[number];

export const AUTH_EVENT_TYPES = [
  'exchange', 'exchange_refused', 'refresh', 'reuse_detected', 'downgrade', 'revoke', 'link_request', 'reverify',
] as const;
export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];

export const CLIENT_TYPES = ['native', 'web'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const SCOPE_KINDS = ['global', 'bank'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const CONFIG_LAYERS = ['global', 'bank', 'agent', 'device'] as const;
export type ConfigLayer = (typeof CONFIG_LAYERS)[number];

export const RELEASE_STATUSES = ['supported', 'deprecated', 'unsupported_for_new_work'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const REASON_CATEGORIES = [
  'assignment_reject', 'unable_to_complete', 'cancel', 'geofence_override', 'review_return', 'review_reject',
  'appointment_not_secured', 'reassign', 'unschedule', 'envelope_resolution',
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export const DEFINITION_KINDS = ['form', 'flow', 'job_schema', 'view', 'content', 'app'] as const;
export type DefinitionKind = (typeof DEFINITION_KINDS)[number];

export const JOB_STATUSES = [
  'pending', 'scheduled', 'assigned', 'accepted', 'in_progress', 'paused', 'submitted', 'under_review',
  'returned', 'approved', 'rejected', 'unable_to_complete', 'appointment_not_secured', 'cancelled', 'closed',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const LOCATION_SOURCES = ['geocoded', 'pinned', 'bank_supplied'] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

export const ASSIGNMENT_RESPONSES = ['pending', 'accepted', 'rejected', 'expired', 'revoked'] as const;
export type AssignmentResponse = (typeof ASSIGNMENT_RESPONSES)[number];

export const CONTACT_CHANNELS = ['phone', 'email', 'whatsapp', 'in_person', 'other'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONTACT_OUTCOMES = ['no_answer', 'declined', 'rescheduled', 'confirmed', 'wrong_number', 'other'] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export const INSPECTION_STATUSES = [
  'in_progress', 'paused', 'abandoned', 'submitted', 'verifying', 'integrity_failed', 'under_review',
  'approved', 'returned', 'rejected',
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const EVIDENCE_TYPES = ['photo', 'signature', 'override_photo', 'unable_photo', 'document', 'video', 'audio'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const UPLOAD_STATES = ['pending', 'uploaded', 'verified', 'quarantined'] as const;
export type UploadState = (typeof UPLOAD_STATES)[number];

export const REPLICA_STATES = ['pending', 'replicated', 'failed'] as const;
export type ReplicaState = (typeof REPLICA_STATES)[number];

export const TRACE_EVENTS = ['fix', 'checkin', 'enter', 'exit', 'pause', 'resume'] as const;
export type TraceEvent = (typeof TRACE_EVENTS)[number];

export const REVIEW_DECISIONS = ['approved', 'returned', 'rejected'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const SUBJECT_TYPES = ['job', 'agent', 'none'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const ENVELOPE_STATES = ['received', 'deferred', 'committed', 'duplicate', 'rejected', 'conflict'] as const;
export type EnvelopeState = (typeof ENVELOPE_STATES)[number];

export const ENVELOPE_RESOLUTIONS = ['reprocessed', 'attached', 'resolved'] as const;
export type EnvelopeResolution = (typeof ENVELOPE_RESOLUTIONS)[number];

export const CUSTODY_SUBJECTS = ['inspection', 'evidence', 'envelope', 'job'] as const;
export type CustodySubject = (typeof CUSTODY_SUBJECTS)[number];

export const CUSTODY_SOURCES = ['device', 'server'] as const;
export type CustodySource = (typeof CUSTODY_SOURCES)[number];

export const NOTIFICATION_CHANNELS = ['push', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATES = ['queued', 'sent', 'failed', 'dead'] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];

export const EXPORT_TYPES = ['pdf', 'csv', 'xlsx', 'evidence_zip', 'spec_pdf', 'billing_csv'] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export const EXPORT_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const APPROVAL_DECISIONS = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_SUBJECT_TYPES = [
  'definition_publish', 'definition_activation', 'remote_config', 'block_in_progress',
] as const;
export type ApprovalSubjectType = (typeof APPROVAL_SUBJECT_TYPES)[number];

export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const MCC_RISK_TIERS = ['low', 'standard', 'elevated', 'high'] as const;
export type MccRiskTier = (typeof MCC_RISK_TIERS)[number];

export const JOB_ACTORS = ['admin', 'scheduler', 'reviewer', 'agent', 'system'] as const;
export type JobActor = (typeof JOB_ACTORS)[number];

export const JOB_EVENT_VERDICTS = ['applied', 'superseded', 'recorded'] as const;
export type JobEventVerdict = (typeof JOB_EVENT_VERDICTS)[number];

export const DEACTIVATION_MODES = ['ingest_only', 'hard_revoke'] as const;
export type DeactivationMode = (typeof DEACTIVATION_MODES)[number];

export const ACTIVATION_INCOMPATIBLE_POLICIES = ['block', 'fallback_version', 'field_fallback'] as const;
export type ActivationIncompatiblePolicy = (typeof ACTIVATION_INCOMPATIBLE_POLICIES)[number];

// ── Reference data & identity ──────────────────────────────────────────────────────────────────
export interface BankContact {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
}

/** billing_settings: per reason category, a default and per-code overrides (docs/06 §3, D-43). */
export type BillingSettings = Record<string, { default?: boolean; codes?: Record<string, boolean> }>;

export interface Bank {
  id: Uuid;
  code: string;
  name: string;
  active: boolean;
  contacts: BankContact[];
  export_settings: JsonObject;
  billing_settings: BillingSettings;
  four_eyes_enabled: boolean;
  request_id: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface PosUser {
  id: Uuid;
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  role: PosRole;
  permissions: Permission[];
  active: boolean;
  deactivated_at: IsoDateTime | null;
  deactivated_reason: string | null;
  /** null = all banks (D-20). */
  bank_ids: Uuid[] | null;
  attributes: JsonObject;
  profile_snapshot: JsonObject | null;
  photo_path: string | null;
  admin_auth_uid: Uuid | null;
  created_by: Uuid | null;
  request_id: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface MccCode {
  code: string;
  description: string;
  risk_tier: MccRiskTier;
  active: boolean;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ReasonCode {
  id: Uuid;
  category: ReasonCategory;
  code: string;
  label: string;
  description: string | null;
  requires_note: boolean;
  requires_photo: boolean;
  billable: boolean;
  /** null = global. */
  bank_id: Uuid | null;
  active: boolean;
  sort_order: number;
  request_id: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface LookupList {
  id: Uuid;
  key: string;
  scope: ScopeKind;
  bank_id: Uuid | null;
  title: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface LookupItem {
  value: string;
  label: string;
  meta?: JsonObject;
}

export interface LookupListVersion {
  id: Uuid;
  list_id: Uuid;
  version: number;
  items: LookupItem[];
  hash: string;
  published_by: Uuid | null;
  published_at: IsoDateTime;
}

export interface Declaration {
  id: Uuid;
  key: string;
  version: number;
  title: string;
  text: string;
  hash: string;
  published_by: Uuid | null;
  published_at: IsoDateTime;
}

export interface RemoteConfigVersion {
  id: Uuid;
  layer: ConfigLayer;
  /** bank id / pos_users id / devices.device_id; null for global. */
  subject_id: Uuid | null;
  version: number;
  values: JsonObject;
  schema_version: string;
  effective_from: IsoDateTime;
  set_by: Uuid | null;
  approved_by: Uuid | null;
  reason: string;
  created_at: IsoDateTime;
}

export interface ConfigSnapshot {
  id: Uuid;
  hash: string;
  values: JsonObject;
  source_versions: Uuid[];
  created_at: IsoDateTime;
}

export interface ModuleRelease {
  id: Uuid;
  version: string;
  released_at: IsoDateTime;
  status: ReleaseStatus;
  api_versions: string[];
  spec_range: string;
  components: JsonObject;
  page_types: JsonObject;
  notes: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface TrustedIssuer {
  id: Uuid;
  key: string;
  type: IssuerType;
  title: string;
  issuer: string | null;
  audience: string | null;
  jwks_url: string | null;
  introspection_url: string | null;
  request_template: JsonObject;
  subject_claim: string | null;
  employee_number_source: JsonObject;
  secret_name: string | null;
  primary_issuer: boolean;
  active: boolean;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ExternalIdentity {
  id: Uuid;
  user_id: Uuid;
  issuer_key: string;
  subject: string;
  linked_via: IdentityLinkVia;
  linked_by: Uuid | null;
  linked_at: IsoDateTime;
  revoked_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Device {
  id: Uuid;
  user_id: Uuid;
  /** Module-generated device id (not the row id). */
  device_id: Uuid;
  client_type: ClientType;
  platform: string | null;
  model: string | null;
  os_version: string | null;
  host_app_version: string | null;
  module_version: string | null;
  capabilities: JsonObject;
  push_provider: string | null;
  push_token: string | null;
  first_seen_at: IsoDateTime;
  last_seen_at: IsoDateTime;
  last_integrity: JsonObject | null;
  revoked_at: IsoDateTime | null;
  revoke_reason: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface PosSession {
  id: Uuid;
  user_id: Uuid;
  device_id: Uuid;
  issuer_key: string;
  family_id: Uuid;
  refresh_token_hash: string;
  scope: SessionScope;
  issued_at: IsoDateTime;
  expires_at: IsoDateTime;
  rotated_from: Uuid | null;
  rotated_at: IsoDateTime | null;
  last_used_at: IsoDateTime | null;
  revoked_at: IsoDateTime | null;
  revoke_reason: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface AuthEvent {
  id: Uuid;
  user_id: Uuid | null;
  issuer_key: string | null;
  event: AuthEventType;
  device_id: Uuid | null;
  session_id: Uuid | null;
  ip: string | null;
  user_agent: string | null;
  profile_mismatch: JsonObject | null;
  detail: JsonObject;
  request_id: string | null;
  at: IsoDateTime;
}

// ── Definitions ────────────────────────────────────────────────────────────────────────────────
export interface DefinitionFamily {
  id: Uuid;
  kind: DefinitionKind;
  key: string;
  scope: ScopeKind;
  bank_id: Uuid | null;
  title: string;
  description: string | null;
  created_by: Uuid | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface DefinitionVersion {
  id: Uuid;
  family_id: Uuid;
  version: number;
  spec_version: string;
  definition: JsonObject;
  definition_hash: string;
  requires: JsonObject;
  changelog: JsonObject;
  breaking: boolean;
  analysis: JsonObject;
  previous_version_id: Uuid | null;
  published_by: Uuid | null;
  approved_by: Uuid | null;
  published_at: IsoDateTime;
}

export interface DefinitionDraft {
  id: Uuid;
  family_id: Uuid;
  definition: JsonObject;
  base_version_id: Uuid | null;
  updated_by: Uuid | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export type ActivationAudience =
  | { type: 'all' }
  | { type: 'agents'; user_ids: Uuid[] }
  | { type: 'percent'; percent: number }
  | { type: 'attribute'; key: string; values: string[] };

export interface DefinitionActivation {
  id: Uuid;
  family_id: Uuid;
  version_id: Uuid;
  audience: ActivationAudience;
  policy: { incompatible?: ActivationIncompatiblePolicy } & JsonObject;
  effective_from: IsoDateTime;
  effective_to: IsoDateTime | null;
  activated_by: Uuid | null;
  approved_by: Uuid | null;
  reason: string;
  created_at: IsoDateTime;
}

export interface Approval {
  id: Uuid;
  subject_type: ApprovalSubjectType;
  subject_ref: Uuid | null;
  /** Set on decision rows (points at the request row). */
  request_ref: Uuid | null;
  payload: JsonObject;
  requested_by: Uuid | null;
  approved_by: Uuid | null;
  decision: ApprovalDecision;
  note: string | null;
  at: IsoDateTime;
}

export interface DefinitionTestCase {
  id: Uuid;
  family_id: Uuid;
  name: string;
  context: JsonObject;
  steps: unknown[];
  expectations: JsonObject;
  created_by: Uuid | null;
  archived_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface DefinitionTestRun {
  id: Uuid;
  version_id: Uuid;
  results: unknown;
  passed: boolean;
  run_at: IsoDateTime;
}

// ── Ingest & custody ───────────────────────────────────────────────────────────────────────────
export interface IngestEnvelope {
  id: Uuid;
  type: string;
  type_version: number;
  api_version: string;
  payload: JsonObject;
  payload_hash: string;
  stored_hash: string;
  wrapper: JsonObject;
  device_id: Uuid | null;
  user_id: Uuid | null;
  session_id: Uuid | null;
  module_version: string | null;
  client_type: ClientType | null;
  device_seq: number | null;
  created_at_device: IsoDateTime | null;
  monotonic_ms: number | null;
  first_request_id: string | null;
  received_at: IsoDateTime;
  state: EnvelopeState;
  duplicate_of: Uuid | null;
  last_request_id: string | null;
  last_seen_at: IsoDateTime;
  attempts: number;
  waiting_on: unknown;
  result: unknown;
  error: unknown;
  processed_at: IsoDateTime | null;
  resolution: EnvelopeResolution | null;
  resolved_by: Uuid | null;
  resolved_at: IsoDateTime | null;
  resolution_note: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface IngestConflict {
  id: Uuid;
  envelope_id: Uuid;
  payload: JsonObject;
  payload_hash: string;
  stored_hash: string;
  wrapper: JsonObject;
  device_id: Uuid | null;
  request_id: string | null;
  received_at: IsoDateTime;
}

export interface CustodyEvent {
  id: Uuid;
  subject_type: CustodySubject;
  subject_id: Uuid;
  event: string;
  source: CustodySource;
  at_device: IsoDateTime | null;
  monotonic_ms: number | null;
  at_server: IsoDateTime;
  device_id: Uuid | null;
  envelope_id: Uuid | null;
  request_id: string | null;
  detail: JsonObject;
}

export interface DeviceSyncReport {
  id: Uuid;
  envelope_id: Uuid | null;
  device_id: Uuid;
  user_id: Uuid | null;
  device_seq: number | null;
  reported_at_device: IsoDateTime | null;
  received_at: IsoDateTime;
  pending: JsonObject;
  oldest_pending_at: IsoDateTime | null;
  last_success_at: IsoDateTime | null;
  free_storage_mb: number | null;
  battery_restricted: boolean | null;
  module_version: string | null;
  config_version_id: Uuid | null;
  capabilities: JsonObject;
}

export interface DeviceSyncStatus {
  id: Uuid;
  device_id: Uuid;
  user_id: Uuid;
  last_report_id: Uuid | null;
  last_device_seq: number | null;
  reported_at_device: IsoDateTime | null;
  received_at: IsoDateTime;
  pending: JsonObject;
  pending_total: number;
  oldest_pending_at: IsoDateTime | null;
  last_success_at: IsoDateTime | null;
  free_storage_mb: number | null;
  battery_restricted: boolean | null;
  module_version: string | null;
  config_version_id: Uuid | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Alert {
  id: Uuid;
  kind: string;
  severity: AlertSeverity;
  subject_type: string | null;
  subject_id: Uuid | null;
  bank_id: Uuid | null;
  message: string;
  detail: JsonObject;
  dedupe_key: string | null;
  acknowledged_by: Uuid | null;
  acknowledged_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ── Jobs ───────────────────────────────────────────────────────────────────────────────────────
export interface JobAddress {
  line1: string;
  line2?: string;
  suburb?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  country?: string;
}

export interface JobContact {
  name?: string;
  phone?: string;
  email?: string;
}

export interface OnsiteContact {
  name: string;
  phone?: string;
  email?: string;
  role?: string;
}

/** A pos.jobs row as read through PostgREST (location = EWKB hex). */
export interface Job {
  id: Uuid;
  reference: string;
  bank_id: Uuid;
  external_ref: string | null;
  merchant_name: string;
  trading_name: string | null;
  address: JobAddress;
  location: EwkbHex | null;
  location_source: LocationSource | null;
  location_type: string;
  mcc_code: string | null;
  scheduled_start: IsoDateTime | null;
  scheduled_end: IsoDateTime | null;
  appointment_confirmed_by: Uuid | null;
  appointment_confirmed_at: IsoDateTime | null;
  onsite_contact: OnsiteContact | null;
  contact: JobContact | null;
  notes: string | null;
  attributes: JsonObject;
  job_schema_version_id: Uuid | null;
  status: JobStatus;
  status_changed_at: IsoDateTime;
  assigned_to: Uuid | null;
  assigned_at: IsoDateTime | null;
  geofence_radius_m: number | null;
  gps_accuracy_max_m: number | null;
  parent_job_id: Uuid | null;
  flags: string[];
  created_by: Uuid | null;
  closed_at: IsoDateTime | null;
  request_id: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/** A job as returned by /v1/admin write endpoints (location = {lat,lng}). */
export type JobRecord = Omit<Job, 'location'> & { location: LatLng | null };

export interface JobTransition {
  from_status: JobStatus;
  to_status: JobStatus;
  actor: JobActor;
  note: string | null;
}

export interface JobEvent {
  id: Uuid;
  job_id: Uuid;
  type: string;
  actor_id: Uuid | null;
  actor_role: string | null;
  from_status: JobStatus | null;
  to_status: JobStatus | null;
  verdict: JobEventVerdict;
  reason_code: string | null;
  note: string | null;
  form_version_id: Uuid | null;
  form_answers: JsonObject | null;
  payload: JsonObject;
  device_id: Uuid | null;
  envelope_id: Uuid | null;
  request_id: string | null;
  client_created_at: IsoDateTime | null;
  client_monotonic_ms: number | null;
  server_received_at: IsoDateTime;
  created_at: IsoDateTime;
}

export interface JobAssignment {
  id: Uuid;
  job_id: Uuid;
  user_id: Uuid;
  assigned_by: Uuid | null;
  assigned_at: IsoDateTime;
  response: AssignmentResponse;
  responded_at: IsoDateTime | null;
  reason_code: string | null;
  note: string | null;
  response_envelope_id: Uuid | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface AppointmentAttempt {
  id: Uuid;
  job_id: Uuid;
  attempted_by: Uuid | null;
  attempted_at: IsoDateTime;
  channel: ContactChannel;
  outcome: ContactOutcome;
  proposed_start: IsoDateTime | null;
  proposed_end: IsoDateTime | null;
  contact_name: string | null;
  note: string | null;
  request_id: string | null;
  created_at: IsoDateTime;
}

/** pos.session_tokens without token_hash (never selected by the panel). */
export interface SessionToken {
  id: Uuid;
  job_id: Uuid;
  user_id: Uuid;
  device_id: Uuid;
  valid_from: IsoDateTime;
  valid_to: IsoDateTime;
  issued_at: IsoDateTime;
  used_at: IsoDateTime | null;
  used_by_inspection_id: Uuid | null;
  revoked_at: IsoDateTime | null;
  revoke_reason: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ── Inspections & evidence ─────────────────────────────────────────────────────────────────────
export interface Inspection {
  id: Uuid;
  job_id: Uuid;
  attempt: number;
  user_id: Uuid;
  device_id: Uuid;
  client_type: ClientType;
  session_token_id: Uuid | null;
  form_version_id: Uuid | null;
  definition_hash: string | null;
  flow_version_id: Uuid | null;
  flow_hash: string | null;
  job_schema_version_id: Uuid | null;
  config_version_id: Uuid | null;
  context_snapshot: JsonObject | null;
  status: InspectionStatus;
  started_at_device: IsoDateTime | null;
  started_at_server: IsoDateTime | null;
  submitted_at_device: IsoDateTime | null;
  submitted_at_server: IsoDateTime | null;
  clock_offset_ms: number | null;
  answers: JsonObject | null;
  answers_hash: string | null;
  submission_hash: string | null;
  manifest: unknown;
  evidence_expected: number;
  evidence_received: number;
  evidence_verified: number;
  geofence_result: JsonObject | null;
  integrity: JsonObject | null;
  diagnostics: JsonObject | null;
  flags: string[];
  unable_reason_code: string | null;
  unable_answers: JsonObject | null;
  snapshot_answers: JsonObject | null;
  snapshot_device_seq: number | null;
  started_envelope_id: Uuid | null;
  submission_envelope_id: Uuid | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Evidence {
  id: Uuid;
  inspection_id: Uuid;
  job_id: Uuid;
  field_key: string | null;
  category: string | null;
  type: EvidenceType;
  sha256_client: string;
  sha256_server: string | null;
  integrity_verified: boolean | null;
  storage_path: string;
  bytes: number | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  captured_at_device: IsoDateTime | null;
  captured_at_monotonic_ms: number | null;
  gnss_time: IsoDateTime | null;
  location: EwkbHex | null;
  /** numeric(8,2) — PostgREST may return it as a number or string. */
  accuracy_m: number | string | null;
  is_mocked: boolean | null;
  session_token_id: Uuid | null;
  in_manifest: boolean;
  upload_state: UploadState;
  replica_state: ReplicaState;
  uploaded_at: IsoDateTime | null;
  verified_at: IsoDateTime | null;
  quarantined_reason: string | null;
  meta: JsonObject;
  envelope_id: Uuid | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface LocationTrace {
  id: Uuid;
  fix_id: Uuid;
  inspection_id: Uuid;
  ts_device: IsoDateTime;
  ts_monotonic_ms: number | null;
  gnss_ts: IsoDateTime | null;
  location: EwkbHex;
  accuracy_m: number | string | null;
  speed: number | string | null;
  is_mocked: boolean | null;
  inside_fence: boolean | null;
  event: TraceEvent;
  envelope_id: Uuid | null;
  created_at: IsoDateTime;
}

export interface Review {
  id: Uuid;
  inspection_id: Uuid;
  reviewer_id: Uuid;
  decision: ReviewDecision;
  reason_code: string | null;
  note: string | null;
  override_acknowledged: boolean;
  decided_at: IsoDateTime;
  request_id: string | null;
}

export interface Amendment {
  id: Uuid;
  inspection_id: Uuid;
  author_id: Uuid;
  field_key: string;
  old_value: unknown;
  new_value: unknown;
  justification: string;
  created_at: IsoDateTime;
}

// ── Async outputs & audit ──────────────────────────────────────────────────────────────────────
export interface Notification {
  id: Uuid;
  recipient_user_id: Uuid | null;
  recipient_email: string | null;
  channel: NotificationChannel;
  template_key: string;
  content_version: Uuid | null;
  payload: JsonObject;
  subject_type: string | null;
  subject_id: Uuid | null;
  state: NotificationState;
  attempts: number;
  provider: string | null;
  provider_ref: string | null;
  last_error: string | null;
  sent_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ExportScope {
  bank_id?: Uuid;
  from?: string;
  to?: string;
  job_ids?: Uuid[];
  family_id?: Uuid;
  version_id?: Uuid;
}

export interface ExportRow {
  id: Uuid;
  type: ExportType;
  scope: ExportScope;
  requested_by: Uuid | null;
  recipient: string | null;
  status: ExportStatus;
  storage_path: string | null;
  error: string | null;
  row_count: number | null;
  completed_at: IsoDateTime | null;
  request_id: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface AuditLogEntry {
  seq: number;
  id: Uuid;
  table_name: string;
  row_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  actor_id: Uuid | null;
  actor_role: string | null;
  before: JsonObject | null;
  after: JsonObject | null;
  at: IsoDateTime;
  request_id: string | null;
  prev_hash: string | null;
  hash: string;
}

// ── API responses (/v1/admin/*) ─────────────────────────────────────────────────────────────────
/** GET /v1/admin/me */
export interface Me {
  id: Uuid;
  role: 'pos_admin' | 'pos_bank_reader';
  permissions: Permission[];
  /** null = all banks ("global admin" when role is pos_admin). */
  bank_ids: Uuid[] | null;
  first_name: string;
  last_name: string;
  email: string | null;
  aal: string;
}

/** A validation issue as returned in error details / analysis results. */
export interface ValidationIssue {
  path?: string;
  field?: string;
  code?: string;
  message: string;
}

/** 202 four-eyes response. */
export interface ApprovalRequired {
  status: 'approval_required';
  approval_id: Uuid;
  changed_integrity_keys?: string[];
}

export type ConfigPublishResult = { status: 'published'; version: RemoteConfigVersion } | ApprovalRequired;
export type DefinitionPublishResult = { status: 'published'; version: DefinitionVersion } | ApprovalRequired;
export type ActivationResult = { status: 'activated'; activation: DefinitionActivation } | ApprovalRequired;

export interface ConfigValidateResult {
  ok: boolean;
  errors: ValidationIssue[];
  integrity_relevant_keys: string[];
}

export interface ResolvedConfig {
  config_version_id: Uuid | null;
  values: JsonObject;
}

export interface AnalyseResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  requires: JsonObject;
  definition_hash: string;
  changelog: { added: unknown[]; removed: unknown[]; changed: unknown[] };
  breaking: boolean;
  tests: { passed: boolean; results: { name: string; passed: boolean; failures: unknown[] }[] };
  previous_version: { id: Uuid; version: number } | null;
}

export interface ApprovalDecisionResult {
  decision_id: Uuid;
  decision: ApprovalDecision;
  executed?: JsonObject;
}

export interface DeactivateUserResult {
  user: PosUser;
  sessions_affected: number;
  pending_items: unknown;
}

export interface AdminLoginResult {
  user_id: Uuid;
  auth_uid: Uuid;
  email: string;
  /** Shown ONCE — never stored or logged. */
  temporary_password: string;
}

export interface SignedUrl {
  url: string;
  expires_in_s: number;
}

export interface JobImportRowResult {
  index: number;
  ok: boolean;
  job_id?: Uuid;
  reference?: string;
  errors?: ValidationIssue[];
}

export interface JobImportResult {
  dry_run: boolean;
  total: number;
  valid: number;
  created: number;
  failed: number;
  rows: JobImportRowResult[];
}

export interface NotSecuredResult {
  job: JobRecord;
  billable: boolean;
}

export interface ReviewResult {
  review: Review;
  inspection_status: InspectionStatus;
  job_status: JobStatus;
}

/** Envelope summary returned by reprocess / resolve (subset of the row). */
export type EnvelopeSummary = Pick<IngestEnvelope, 'id' | 'state'> & Partial<IngestEnvelope>;

export interface AlertsAckResult {
  acknowledged: number;
}

export interface SessionsRevokeResult {
  revoked: number;
}

export interface ServerEpochResult {
  epoch: Uuid;
  set_at: IsoDateTime;
}

/** GET /v1/admin/queues — queue name → depth (e.g. verify_evidence, verify_evidence_dlq, …). */
export type QueueDepths = Record<string, number>;

/** pos.admin_dashboard() */
export interface DashboardSummary {
  jobs_by_status: Partial<Record<JobStatus, number>>;
  open_alerts: number;
  open_alerts_critical: number;
  awaiting_review: number;
  custody: {
    devices_with_backlog: number;
    pending_items: number;
    oldest_pending_at: IsoDateTime | null;
  };
  incomplete_manifests: number;
  envelopes_needing_attention: number;
}

/** pos.admin_agent_load(p_from, p_to, p_bank_id) row. */
export interface AgentLoadRow {
  user_id: Uuid;
  employee_number: string;
  first_name: string;
  last_name: string;
  day: string;
  jobs: number;
}

/** POST /v1/dev/host-token */
export interface HostTokenResult {
  issuer: 'pos_dev';
  token: string;
  issued_at: string | number;
  employee_number: string;
}

/** POST /v1/auth/exchange */
export interface AuthExchangeResult {
  access_token: string;
  refresh_token: string;
  session_id: Uuid;
  scope: SessionScope;
  user: JsonObject;
  [key: string]: unknown;
}

/** GET /v1/health */
export interface HealthResult {
  ok: boolean;
  env?: string;
  [key: string]: unknown;
}
