// GENERATED — do not edit. Source: packages/fess_pos_engine_ts/src/api/schemas.ts (run: node tools/vendor-engine.mjs)
/**
 * Zod mirrors of `schema/api` (POS API v1). Requests and device payloads are strict
 * (unknown properties rejected; new fields mean a new `type_version`). Server responses allow
 * unknown properties so older modules ignore additions. The envelope wrapper allows unknown
 * properties too: landing refuses only an unparseable wrapper (docs/12 §4).
 */
import { z } from "npm:zod@^3.25.76";
import { DATE_RE, DATETIME_RE, KEY_RE, SHA256_RE, UUID_RE, zJson, zJsonObject } from "../definitions/schemas.ts";

export const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
export const ENVELOPE_TYPE_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const API_ERROR_CODE_RE = /^[A-Z][A-Z0-9_]*$/;
export const MIME_RE = /^(image|video|audio|application)\/[a-z0-9.+-]+$/;
export const HEX_TOKEN_RE = /^[0-9a-f]{32,128}$/;

const uuid = z.string().regex(UUID_RE);
const dt = z.string().regex(DATETIME_RE);
const date = z.string().regex(DATE_RE);
const sha = z.string().regex(SHA256_RE);
const semver = z.string().regex(SEMVER_RE);
const key = z.string().regex(KEY_RE);
const nonneg = z.number().int().min(0);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const note = z.string().max(2000);

export const ClientTypeSchema = z.enum(["native", "web"]);
export const PointSchema = z.object({ lat, lng }).strict();

export const GeoFixSchema = z
  .object({
    lat,
    lng,
    accuracy_m: z.number().min(0),
    ts: dt,
    gnss_ts: dt.nullable().optional(),
    is_mocked: z.boolean(),
    altitude_m: z.number().nullable().optional(),
    speed_mps: z.number().nullable().optional(),
  })
  .strict();

export const AnswerEntrySchema = z
  .object({
    v: zJson,
    prefilled: z.boolean().optional(),
    flagged_differs: z.boolean().optional(),
    computed: z.boolean().optional(),
    rendered_as: z.string().min(1).max(50).optional(),
    other_text: z.string().max(2000).optional(),
    unknown: z.boolean().optional(),
  })
  .strict();
export const AnswersSchema = z.record(key, AnswerEntrySchema);

export const DefinitionRefSchema = z.object({ version_id: uuid, hash: sha }).strict();

export const ContextSnapshotSchema = z
  .object({
    today: date,
    job: zJsonObject.optional(),
    agent: zJsonObject.optional(),
    inspection: zJsonObject.optional(),
    stats: zJsonObject.optional(),
    config: zJsonObject.optional(),
    previous: zJsonObject.nullable().optional(),
  })
  .strict();

export const FieldTimingsSchema = z.record(key, z.object({ first_touch: dt.optional(), last_change: dt.optional() }).strict());

export const IntegritySnapshotSchema = z
  .object({
    mock_location: z.boolean(),
    rooted: z.boolean(),
    hooked: z.boolean().optional(),
    debugger: z.boolean().optional(),
    emulator: z.boolean().optional(),
    tampered: z.boolean().optional(),
    dev_options: z.boolean().optional(),
    rasp_provider: z.string().max(60).nullable().optional(),
    attestation: z
      .object({ provider: z.enum(["play_integrity", "app_attest", "none"]), verdict: z.string().max(200).nullable(), obtained_at: dt.nullable() })
      .strict()
      .nullable()
      .optional(),
    clock_offset_ms: z.number().int().nullable().optional(),
    checked_at: dt,
    extra: zJsonObject.optional(),
  })
  .strict();

export const DiagnosticsSchema = z
  .object({
    module_version: semver,
    platform: z.enum(["android", "ios", "web"]),
    host_app_version: z.string().max(60).optional(),
    os_version: z.string().max(60).optional(),
    model: z.string().max(120).optional(),
    free_storage_mb: nonneg.optional(),
    battery_restricted: z.boolean().optional(),
    background_restricted: z.boolean().optional(),
    network: z.enum(["none", "wifi", "cellular", "other", "unknown"]).optional(),
    extra: zJsonObject.optional(),
  })
  .strict();

export const GeofenceResultSchema = z
  .object({
    profile: key,
    profile_params: z
      .object({
        radius_m: z.number().min(0),
        max_accuracy_m: z.number().min(0),
        exit_consecutive_fixes: z.number().int().min(1),
        prompt_checkin_on_arrival: z.boolean(),
      })
      .strict(),
    method: z.enum(["inside_fix", "outside_fix"]),
    passed: z.boolean(),
    relaxed: z.boolean(),
    override: z.boolean(),
    override_detail: z
      .object({
        reason_code: key,
        note: note,
        form_version_id: uuid,
        definition_hash: sha,
        answers: AnswersSchema,
        answers_hash: sha,
        photo_evidence_ids: z.array(uuid),
        distance_m: z.number().min(0),
        allowed_max_m: z.number().min(0),
      })
      .strict()
      .nullable()
      .optional(),
    job_location: PointSchema.nullable(),
    fix: GeoFixSchema.nullable(),
    checkin_fix: GeoFixSchema.nullable().optional(),
    distance_m: z.number().min(0).nullable(),
    sampled_seconds: z.number().int().min(0).nullable().optional(),
    config_version_id: uuid.nullable().optional(),
    evaluated_at_device: dt,
  })
  .strict();

const versionMap = z.record(z.string(), z.number().int().min(1));
export const CapabilityReportSchema = z
  .object({
    module_version: semver.optional(),
    api_versions: z.array(z.string()).optional(),
    spec_versions: z.array(z.string()).optional(),
    components: versionMap.optional(),
    page_types: versionMap.optional(),
    step_types: versionMap.optional(),
    view_components: versionMap.optional(),
    client_type: ClientTypeSchema.optional(),
    platform: z.string().max(40).optional(),
  })
  .passthrough();

// ------------------------------------------------------------------ envelope, receipt, error

export const KNOWN_ENVELOPE_TYPES = [
  "job_event",
  "inspection_started",
  "inspection_snapshot",
  "evidence_meta",
  "evidence_uploaded",
  "traces_batch",
  "submission",
  "form_submission",
  "custody_batch",
  "sync_report",
  "client_error",
] as const;
export type EnvelopeType = (typeof KNOWN_ENVELOPE_TYPES)[number];

export const EnvelopeSchema = z
  .object({
    api_version: z.literal("1"),
    id: uuid,
    type: z.string().regex(ENVELOPE_TYPE_RE),
    type_version: z.number().int().min(1),
    payload_hash: sha,
    device_id: uuid,
    session_id: uuid.nullable(),
    device_seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    module_version: semver,
    client_type: ClientTypeSchema,
    created_at_device: dt,
    monotonic_ms: nonneg,
    payload: zJsonObject,
  })
  .passthrough();

export const ErrorDetailSchema = z
  .object({ code: z.string().regex(API_ERROR_CODE_RE), message: z.string(), retryable: z.boolean(), details: z.unknown().optional() })
  .passthrough();

export const ErrorResponseSchema = z.object({ error: ErrorDetailSchema, request_id: z.string().min(1) }).passthrough();

export const RECEIPT_STATES = ["received", "committed", "duplicate", "deferred", "rejected", "conflict"] as const;

export const ReceiptSchema = z
  .object({
    id: uuid.nullable(),
    state: z.enum(RECEIPT_STATES).nullable(),
    durable: z.boolean(),
    stored_hash: sha.nullable().optional(),
    server_received_at: dt.nullable().optional(),
    committed_at: dt.nullable().optional(),
    result: zJsonObject.nullable().optional(),
    error: ErrorDetailSchema.nullable().optional(),
    waiting_on: zJsonObject.nullable().optional(),
    duplicate_of: uuid.nullable().optional(),
  })
  .passthrough();

export const IngestRequestSchema = z.object({ envelopes: z.array(EnvelopeSchema).min(1).max(50) }).strict();
export const IngestResponseSchema = z.object({ receipts: z.array(ReceiptSchema), server_time: dt, request_id: z.string().optional() }).passthrough();

// ------------------------------------------------------------------ sync pull

export const SyncPullRequestSchema = z
  .object({
    cursors: z.record(z.string(), z.string().max(200)).optional(),
    have: z
      .object({
        definition_version_ids: z.array(uuid).max(2000).optional(),
        pinned_version_ids: z.array(uuid).max(500).optional(),
        lookup_version_ids: z.array(uuid).max(2000).optional(),
        declaration_ids: z.array(uuid).max(500).optional(),
        reason_codes_hash: z.string().max(128).optional(),
        session_token_job_ids: z.array(uuid).max(2000).optional(),
        job_card_job_ids: z.array(uuid).max(2000).optional(),
        agent_card_valid: z.boolean().optional(),
      })
      .strict()
      .optional(),
    capabilities: CapabilityReportSchema.optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const page = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), next_cursor: z.string().nullable(), has_more: z.boolean() }).passthrough();

export const JOB_STATUSES = [
  "pending",
  "scheduled",
  "assigned",
  "accepted",
  "in_progress",
  "paused",
  "submitted",
  "under_review",
  "returned",
  "approved",
  "rejected",
  "unable_to_complete",
  "appointment_not_secured",
  "cancelled",
  "closed",
] as const;

export const SyncJobSchema = z
  .object({
    id: uuid,
    reference: z.string(),
    status: z.enum(JOB_STATUSES),
    updated_at: dt,
    bank: z.object({ id: uuid, code: z.string(), name: z.string() }).passthrough().nullable().optional(),
    merchant_name: z.string().optional(),
    address: zJsonObject.nullable().optional(),
    location: PointSchema.nullable().optional(),
    location_type: key.optional(),
    scheduled_start: dt.nullable().optional(),
    scheduled_end: dt.nullable().optional(),
    attributes: zJsonObject.optional(),
    job_schema_version_id: uuid.nullable().optional(),
  })
  .passthrough();

const DefinitionManifestEntry = z
  .object({ kind: z.string(), key, family_id: uuid, version_id: uuid, version: z.number().int().min(1), spec_version: z.string(), definition_hash: sha })
  .passthrough();
const DefinitionBody = z
  .object({ id: uuid, family_id: uuid, kind: z.string(), key, version: z.number().int().min(1), spec_version: z.string(), definition: zJsonObject, definition_hash: sha })
  .passthrough();
const LookupManifestEntry = z.object({ list_id: uuid, key, version_id: uuid, version: z.number().int().min(1), hash: sha }).passthrough();
const LookupBody = LookupManifestEntry.extend({
  items: z.array(z.object({ value: z.string(), label: z.string() }).passthrough()),
}).passthrough();
const DeclarationManifestEntry = z.object({ id: uuid, key, version: z.number().int().min(1), hash: sha }).passthrough();
const DeclarationBody = DeclarationManifestEntry.extend({ text: z.string() }).passthrough();
const ReasonCode = z
  .object({ id: uuid, category: key, code: key, label: z.string(), requires_note: z.boolean(), requires_photo: z.boolean() })
  .passthrough();
const ReviewOutcome = z
  .object({ id: uuid, inspection_id: uuid, job_id: uuid, attempt: z.number().int().min(1), decision: z.enum(["approved", "returned", "rejected"]), decided_at: dt })
  .passthrough();
const EvidenceStatus = z.object({ id: uuid, upload_state: z.enum(["pending", "uploaded", "verified", "quarantined"]) }).passthrough();
const EnvelopeOutcome = z.object({ id: uuid, state: z.enum(RECEIPT_STATES) }).passthrough();
export const ResolvedConfigSchema = z.object({ config_version_id: uuid.nullable(), values: zJsonObject }).passthrough();
export const SessionTokenSchema = z.object({ job_id: uuid, token_id: uuid, token: z.string().regex(HEX_TOKEN_RE), valid_from: dt, valid_to: dt }).passthrough();
const CardToken = z.object({ token: z.string().regex(HEX_TOKEN_RE), valid_to: dt }).passthrough();
const Command = z
  .object({ id: uuid, type: z.enum(["resend_evidence", "resend_envelopes", "purge", "re_sign_in", "upload_logs"]), params: zJsonObject, issued_at: dt })
  .passthrough();

export const SyncPullResponseSchema = z
  .object({
    server_time: dt,
    server_epoch: uuid,
    me: z.object({ id: uuid, employee_number: z.string(), first_name: z.string(), last_name: z.string(), role: z.string() }).passthrough(),
    jobs: page(SyncJobSchema),
    definitions: z.object({ manifest: z.array(DefinitionManifestEntry), bodies: z.array(DefinitionBody) }).passthrough(),
    lookup_lists: z.object({ manifest: z.array(LookupManifestEntry), bodies: z.array(LookupBody) }).passthrough(),
    declarations: z.object({ manifest: z.array(DeclarationManifestEntry), bodies: z.array(DeclarationBody) }).passthrough(),
    reason_codes: z.object({ hash: z.string(), items: z.array(ReasonCode).nullable() }).passthrough(),
    reviews: page(ReviewOutcome),
    evidence: page(EvidenceStatus),
    envelopes: page(EnvelopeOutcome),
    agent_totals: z.record(z.string(), z.number().int().min(0)),
    commands: z.array(Command),
    session_tokens: z.array(SessionTokenSchema),
    job_cards: z.array(CardToken.extend({ job_id: uuid }).passthrough()),
    agent_card: CardToken.nullable(),
    config: z.object({ default: ResolvedConfigSchema, by_bank: z.record(uuid, ResolvedConfigSchema) }).passthrough(),
  })
  .passthrough();

// ------------------------------------------------------------------ auth

const DeviceInfo = z
  .object({
    device_id: uuid,
    client_type: ClientTypeSchema.optional(),
    platform: z.string().max(40).optional(),
    model: z.string().max(120).optional(),
    os_version: z.string().max(60).optional(),
    host_app_version: z.string().max(60).optional(),
    module_version: z.string().max(60).optional(),
    capabilities: CapabilityReportSchema.optional(),
    push_provider: z.string().max(40).optional(),
    push_token: z.string().max(4096).optional(),
  })
  .strict();

const HostProfile = z
  .object({
    employee_number: z.string().max(32).optional(),
    first_name: z.string().max(120).optional(),
    last_name: z.string().max(120).optional(),
    email: z.string().max(320).optional(),
    phone: z.string().max(40).optional(),
    photo_url: z.string().max(2048).optional(),
    extra: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const AuthExchangeRequestSchema = z
  .object({
    issuer: z.string().min(1).max(64),
    token: z.string().min(1).max(16384),
    issued_at: dt.optional(),
    secondary_token: z.string().max(16384).optional(),
    device: DeviceInfo,
    profile: HostProfile.optional(),
  })
  .strict();

export const AuthExchangeResponseSchema = z
  .object({
    access_token: z.string().min(1),
    access_expires_at: dt,
    refresh_token: z.string().min(20),
    refresh_expires_at: dt,
    session_id: uuid,
    scope: z.enum(["full", "ingest_only"]),
    user: z.object({ id: uuid, employee_number: z.string(), first_name: z.string(), last_name: z.string(), role: z.string(), active: z.boolean() }).passthrough(),
    server_time: dt,
    profile_mismatch: zJsonObject.nullable().optional(),
  })
  .passthrough();

export const AuthRefreshRequestSchema = z.object({ refresh_token: z.string().min(20).max(200), device_id: uuid }).strict();
export const AuthRefreshResponseSchema = AuthExchangeResponseSchema;

// ------------------------------------------------------------------ evidence upload grant

export const UploadGrantRequestSchema = z.object({ evidence_id: uuid }).strict();
export const UploadGrantResponseSchema = z
  .object({
    state: z.enum(["upload", "already_uploaded", "already_verified", "quarantined"]),
    evidence_id: uuid,
    bucket: z.string().optional(),
    path: z.string().optional(),
    content_type: z.string().nullable().optional(),
    signed_url: z.string().optional(),
    token: z.string().optional(),
    expires_in_s: z.number().int().min(1).optional(),
    resumable: z.object({ endpoint: z.string(), headers: z.record(z.string(), z.string()) }).passthrough().optional(),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (v.state === "upload") {
      for (const k of ["bucket", "path", "signed_url", "token", "expires_in_s"] as const) {
        if (v[k] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `${k} is required when state is upload` });
      }
    }
  });

// ------------------------------------------------------------------ device update (T2-31)

export const DeviceUpdateRequestSchema = z
  .object({
    push_provider: z.string().min(1).max(40).optional(),
    push_token: z.string().min(1).max(4096).nullable().optional(),
    platform: z.string().max(40).optional(),
    model: z.string().max(120).optional(),
    os_version: z.string().max(60).optional(),
    host_app_version: z.string().max(60).optional(),
    module_version: z.string().max(60).optional(),
    capabilities: CapabilityReportSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Object.keys(v).length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "send at least one field" });
    if (typeof v.push_token === "string" && v.push_provider === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["push_provider"], message: "push_provider is required with a push_token" });
    }
  });
export const DeviceUpdateResponseSchema = z
  .object({
    device_id: uuid,
    push_provider: z.string().nullable().optional(),
    push_registered: z.boolean(),
    module_version: z.string().nullable().optional(),
    host_app_version: z.string().nullable().optional(),
    last_seen_at: dt,
  })
  .passthrough();

// ------------------------------------------------------------------ payloads (schema/api/payloads/<type>.v1)

const requireWhen = (cond: boolean, value: unknown, ctx: z.RefinementCtx, path: string, why: string): void => {
  if (cond && (value === undefined || value === null)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: why });
};

export const JobEventV1 = z
  .object({
    job_id: uuid,
    action: z.enum(["accept", "reject", "unable", "pause", "resume"]),
    trigger: z.enum(["agent", "geofence_exit", "geofence_enter"]).optional(),
    inspection_id: uuid.nullable().optional(),
    reason_code: key.nullable().optional(),
    note: note.nullable().optional(),
    form_version_id: uuid.nullable().optional(),
    definition_hash: sha.nullable().optional(),
    form_answers: AnswersSchema.nullable().optional(),
    answers_hash: sha.nullable().optional(),
    evidence_ids: z.array(uuid).max(20).optional(),
    fix: GeoFixSchema.nullable().optional(),
    config_version_id: uuid.nullable().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const reasoned = p.action === "reject" || p.action === "unable";
    requireWhen(reasoned, p.reason_code, ctx, "reason_code", "reject and unable need a reason_code");
    requireWhen(p.action === "pause" || p.action === "resume", p.inspection_id, ctx, "inspection_id", "pause and resume need an inspection_id");
    const hasForm = p.form_answers !== undefined && p.form_answers !== null;
    requireWhen(hasForm, p.form_version_id, ctx, "form_version_id", "reason-form answers need form_version_id");
    requireWhen(hasForm, p.definition_hash, ctx, "definition_hash", "reason-form answers need definition_hash");
    requireWhen(hasForm, p.answers_hash, ctx, "answers_hash", "reason-form answers need answers_hash");
  });

export const InspectionStartedV1 = z
  .object({
    inspection_id: uuid,
    job_id: uuid,
    attempt: z.number().int().min(1),
    session_token_id: uuid.nullable(),
    session_token: z.string().regex(HEX_TOKEN_RE).nullable().optional(),
    form_version_id: uuid,
    definition_hash: sha,
    flow_version_id: uuid,
    flow_hash: sha,
    job_schema_version_id: uuid.nullable().optional(),
    config_version_id: uuid.nullable(),
    context_snapshot: ContextSnapshotSchema,
    geofence_result: GeofenceResultSchema,
    integrity: IntegritySnapshotSchema,
    started_at_device: dt,
    monotonic_ms: nonneg.optional(),
    clock_offset_ms: z.number().int().nullable().optional(),
    gnss_time: dt.nullable().optional(),
  })
  .strict();

export const InspectionSnapshotV1 = z
  .object({
    inspection_id: uuid,
    job_id: uuid,
    attempt: z.number().int().min(1).optional(),
    answers: AnswersSchema,
    field_timings: FieldTimingsSchema.optional(),
    current_step: z.string().max(100).nullable().optional(),
    snapshot_at_device: dt,
  })
  .strict();

export const EvidenceMetaV1 = z
  .object({
    evidence_id: uuid,
    inspection_id: uuid,
    job_id: uuid,
    session_token_id: uuid.nullable(),
    field_key: key,
    category: key,
    type: z.enum(["photo", "signature", "override_photo", "unable_photo", "document", "video", "audio"]),
    sha256: sha,
    bytes: z.number().int().min(1),
    mime: z.string().regex(MIME_RE),
    width: z.number().int().min(1).nullable().optional(),
    height: z.number().int().min(1).nullable().optional(),
    captured_at_device: dt,
    captured_at_monotonic_ms: nonneg,
    gnss_time: dt.nullable().optional(),
    location: PointSchema.nullable().optional(),
    accuracy_m: z.number().min(0).nullable().optional(),
    is_mocked: z.boolean(),
    meta: z
      .object({
        item_index: z.number().int().min(0).nullable().optional(),
        caption: z.string().max(500).nullable().optional(),
        strokes_sha256: sha.nullable().optional(),
        local_hash_mismatch: z.boolean().optional(),
        integrity: IntegritySnapshotSchema.nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .strict();

export const EvidenceUploadedV1 = z
  .object({ evidence_id: uuid, object_key: z.string().min(1).max(500).optional(), sha256: sha, bytes: z.number().int().min(1), uploaded_at_device: dt })
  .strict();

export const TraceFixSchema = z
  .object({
    fix_id: uuid,
    ts_device: dt,
    ts_monotonic_ms: nonneg,
    gnss_ts: dt.nullable().optional(),
    lat,
    lng,
    accuracy_m: z.number().min(0),
    speed: z.number().nullable().optional(),
    heading: z.number().min(0).max(360).nullable().optional(),
    altitude_m: z.number().nullable().optional(),
    is_mocked: z.boolean(),
    inside_fence: z.boolean().nullable().optional(),
    event: z.enum(["fix", "checkin", "enter", "exit", "pause", "resume"]).optional(),
  })
  .strict();

export const TracesBatchV1 = z
  .object({ inspection_id: uuid, job_id: uuid.optional(), batch_seq: nonneg.optional(), fixes: z.array(TraceFixSchema).min(1).max(500) })
  .strict();

export const ManifestSchema = z
  .object({
    items: z.array(
      z
        .object({ evidence_id: uuid, field_key: key, item_index: z.number().int().min(0).nullable().optional(), category: key, sha256: sha, bytes: z.number().int().min(1) })
        .strict(),
    ),
    trace_batch_count: nonneg,
    last_trace_at: dt.nullable(),
  })
  .strict();

export const SubmissionV1 = z
  .object({
    inspection_id: uuid,
    job_id: uuid,
    attempt: z.number().int().min(1),
    definition_refs: z.object({ form: DefinitionRefSchema, flow: DefinitionRefSchema, job_schema: DefinitionRefSchema.nullable().optional() }).strict(),
    config_version_id: uuid.nullable(),
    context_snapshot: ContextSnapshotSchema,
    answers: AnswersSchema,
    field_timings: FieldTimingsSchema.optional(),
    answers_hash: sha,
    manifest: ManifestSchema,
    session_token_id: uuid.nullable(),
    session_token: z.string().regex(HEX_TOKEN_RE).nullable().optional(),
    geofence: GeofenceResultSchema,
    integrity: IntegritySnapshotSchema,
    diagnostics: DiagnosticsSchema,
    submission_hash: sha,
    started_at_device: dt,
    submitted_at_device: dt,
    submitted_monotonic_ms: nonneg.optional(),
    clock_offset_ms: z.number().int().nullable().optional(),
  })
  .strict();

export const FormSubmissionV1 = z
  .object({
    form_submission_id: uuid,
    form_version_id: uuid,
    definition_hash: sha,
    subject_type: z.enum(["job", "agent", "none"]),
    subject_id: uuid.nullable(),
    config_version_id: uuid.nullable().optional(),
    context_snapshot: ContextSnapshotSchema,
    answers: AnswersSchema,
    field_timings: FieldTimingsSchema.optional(),
    answers_hash: sha,
    submitted_at_device: dt,
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.subject_type === "none" && p.subject_id !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["subject_id"], message: "subject_id must be null when subject_type is none" });
    if (p.subject_type !== "none" && p.subject_id === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["subject_id"], message: "subject_id is required" });
  });

export const CustodyBatchV1 = z
  .object({
    events: z
      .array(
        z
          .object({
            subject_type: z.enum(["inspection", "evidence", "envelope", "job"]),
            subject_id: uuid,
            event: z.enum(["captured", "persisted_local", "queued", "first_attempt", "receipt_received", "local_bytes_deleted"]),
            at_device: dt,
            monotonic_ms: nonneg,
            detail: zJsonObject.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const SyncReportV1 = z
  .object({
    reported_at_device: dt,
    pending: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), nonneg),
    needs_attention: nonneg.optional(),
    oldest_pending_at: dt.nullable(),
    last_success_at: dt.nullable(),
    evidence: z.record(z.enum(["local_only", "uploading", "uploaded", "verified_retained"]), nonneg).optional(),
    free_storage_mb: nonneg,
    battery_restricted: z.boolean(),
    background_restricted: z.boolean().optional(),
    module_version: semver,
    config_version_id: uuid.nullable(),
    server_epoch_seen: uuid.nullable().optional(),
    clock_offset_ms: z.number().int().nullable().optional(),
    capabilities: CapabilityReportSchema,
  })
  .strict();

export const ClientErrorV1 = z
  .object({
    errors: z
      .array(
        z
          .object({
            code: z.string().regex(API_ERROR_CODE_RE),
            kind: z.enum(["parked_item", "recovery_anomaly", "local_hash_mismatch", "wrapper_rejected", "unsupported_definition", "other"]).optional(),
            about_envelope_id: uuid.nullable().optional(),
            message: z.string().max(2000).optional(),
            detail: zJsonObject,
            at: dt,
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

/** Payload schemas by envelope type and type_version. */
export const PAYLOAD_SCHEMAS: Readonly<Record<EnvelopeType, Readonly<Record<number, z.ZodTypeAny>>>> = {
  job_event: { 1: JobEventV1 },
  inspection_started: { 1: InspectionStartedV1 },
  inspection_snapshot: { 1: InspectionSnapshotV1 },
  evidence_meta: { 1: EvidenceMetaV1 },
  evidence_uploaded: { 1: EvidenceUploadedV1 },
  traces_batch: { 1: TracesBatchV1 },
  submission: { 1: SubmissionV1 },
  form_submission: { 1: FormSubmissionV1 },
  custody_batch: { 1: CustodyBatchV1 },
  sync_report: { 1: SyncReportV1 },
  client_error: { 1: ClientErrorV1 },
};

export type Envelope = z.infer<typeof EnvelopeSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type IngestRequest = z.infer<typeof IngestRequestSchema>;
export type IngestResponse = z.infer<typeof IngestResponseSchema>;
export type SyncPullRequest = z.infer<typeof SyncPullRequestSchema>;
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;
export type AuthExchangeRequest = z.infer<typeof AuthExchangeRequestSchema>;
export type AuthExchangeResponse = z.infer<typeof AuthExchangeResponseSchema>;
export type AuthRefreshRequest = z.infer<typeof AuthRefreshRequestSchema>;
export type UploadGrantRequest = z.infer<typeof UploadGrantRequestSchema>;
export type UploadGrantResponse = z.infer<typeof UploadGrantResponseSchema>;
export type JobEventPayload = z.infer<typeof JobEventV1>;
export type InspectionStartedPayload = z.infer<typeof InspectionStartedV1>;
export type InspectionSnapshotPayload = z.infer<typeof InspectionSnapshotV1>;
export type EvidenceMetaPayload = z.infer<typeof EvidenceMetaV1>;
export type EvidenceUploadedPayload = z.infer<typeof EvidenceUploadedV1>;
export type TracesBatchPayload = z.infer<typeof TracesBatchV1>;
export type SubmissionPayload = z.infer<typeof SubmissionV1>;
export type FormSubmissionPayload = z.infer<typeof FormSubmissionV1>;
export type CustodyBatchPayload = z.infer<typeof CustodyBatchV1>;
export type SyncReportPayload = z.infer<typeof SyncReportV1>;
export type ClientErrorPayload = z.infer<typeof ClientErrorV1>;
export type GeofenceResult = z.infer<typeof GeofenceResultSchema>;
export type IntegritySnapshot = z.infer<typeof IntegritySnapshotSchema>;
export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>;
