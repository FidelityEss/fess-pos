// POS API client: every state change goes through /v1/admin/* (docs/03 §5). Typed helpers for each endpoint
// in the admin API contract live in `adminApi` / `devApi` below.
import { env } from './env';
import { getAccessToken } from './supabase';
import type {
  ActivationBody,
  AdminLoginBody,
  AlertsAckBody,
  AmendmentBody,
  AllocateBody,
  AnalyseBody,
  ApprovalDecideBody,
  AuthExchangeBody,
  BankCreateBody,
  BankUpdateBody,
  CloseBody,
  ConfigPublishBody,
  ConfigResolvedQuery,
  ConfigValidateBody,
  ContactAttemptBody,
  DeclarationBody,
  DefinitionPublishBody,
  DevHostTokenBody,
  EnvelopeReprocessBody,
  EnvelopeResolveBody,
  ExportCreateBody,
  FamilyCreateBody,
  FamilyUpdateBody,
  IdentityLinkCreateBody,
  IssuerActiveBody,
  IssuerCreateBody,
  IssuerUpdateBody,
  JobCreateBody,
  JobImportBody,
  JobUpdateBody,
  LookupListCreateBody,
  LookupListUpdateBody,
  LookupListVersionBody,
  MccCreateBody,
  MccUpdateBody,
  ReasonBody,
  ReasonCodeActionBody,
  ReasonCodeCreateBody,
  ReasonCodeUpdateBody,
  ReassignBody,
  ReleaseCreateBody,
  ReleaseUpdateBody,
  ReviewBody,
  ScheduleBody,
  TestCaseCreateBody,
  TestCaseUpdateBody,
  UserCreateBody,
  UserDeactivateBody,
  UserPhotoBody,
  UserUpdateBody,
} from './schemas';
import type {
  ActivationResult,
  AdminLoginResult,
  AlertsAckResult,
  Amendment,
  AnalyseResult,
  AppointmentAttempt,
  ApprovalDecisionResult,
  ApprovalRequired,
  AuthExchangeResult,
  Bank,
  ConfigPublishResult,
  ConfigValidateResult,
  Declaration,
  DeactivateUserResult,
  DefinitionFamily,
  DefinitionPublishResult,
  DefinitionTestCase,
  Device,
  EnvelopeSummary,
  ExportRow,
  ExternalIdentity,
  HealthResult,
  HostTokenResult,
  JobImportResult,
  JobRecord,
  LookupList,
  LookupListVersion,
  MccCode,
  Me,
  ModuleRelease,
  NotSecuredResult,
  PosUser,
  QueueDepths,
  ReasonCode,
  ResolvedConfig,
  ReviewResult,
  ServerEpochResult,
  SessionsRevokeResult,
  SignedUrl,
  TrustedIssuer,
  ValidationIssue,
} from './types';
import { isPlainObject } from './utils';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type QueryValue = string | number | boolean | null | undefined;

export interface ApiOptions {
  /** Query-string parameters; null/undefined/'' values are dropped. */
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** Send the Supabase bearer token (default true). */
  auth?: boolean;
  headers?: Record<string, string>;
}

/** Error codes the POS API returns (plus NETWORK_ERROR / HTTP_<status> synthesised by the client). */
export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'MFA_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TRANSITION'
  | 'ALREADY_EXISTS'
  | 'INVALID_REQUEST'
  | 'VALIDATION_FAILED'
  | 'INVALID_REASON'
  | 'NOTE_REQUIRED'
  | 'NETWORK_ERROR'
  | (string & {});

/** A non-2xx POS API response (or a network failure) as an Error. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(init: {
    code: ApiErrorCode;
    message: string;
    status: number;
    retryable?: boolean;
    details?: unknown;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable ?? false;
    this.details = init.details;
    this.requestId = init.requestId ?? null;
  }

  /** `details` normalised to a flat list of issues (empty when details has another shape). */
  get issues(): ValidationIssue[] {
    return normaliseIssues(this.details);
  }
}

/** Type guard for ApiError, optionally matching a code. */
export function isApiError(e: unknown, code?: ApiErrorCode): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

function toIssue(v: unknown): ValidationIssue | null {
  if (typeof v === 'string') return { message: v };
  if (!isPlainObject(v)) return null;
  const message = typeof v.message === 'string' ? v.message : JSON.stringify(v);
  const issue: ValidationIssue = { message };
  if (typeof v.path === 'string') issue.path = v.path;
  else if (Array.isArray(v.path)) issue.path = v.path.join('.');
  if (typeof v.field === 'string') issue.field = v.field;
  if (typeof v.code === 'string') issue.code = v.code;
  return issue;
}

/**
 * Normalise error details into issues. Accepts an array of {path|field|code|message}, or
 * `{errors:[…], warnings:[…]}` (definition analysis) — warnings are returned with code prefixed "warning".
 */
export function normaliseIssues(details: unknown): ValidationIssue[] {
  if (Array.isArray(details)) return details.map(toIssue).filter((i): i is ValidationIssue => i !== null);
  if (isPlainObject(details)) {
    const errors = Array.isArray(details.errors) ? normaliseIssues(details.errors) : [];
    const warnings = Array.isArray(details.warnings)
      ? normaliseIssues(details.warnings).map((w) => ({ ...w, code: w.code ? `warning:${w.code}` : 'warning' }))
      : [];
    return [...errors, ...warnings];
  }
  return [];
}

/** Best human-readable message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (isPlainObject(e) && typeof e.message === 'string') return e.message;
  return 'Something went wrong';
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${env.posApiUrl}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export interface ApiResult<T> {
  /** HTTP status — distinguish 201 (applied) from 202 (four-eyes approval required). */
  status: number;
  data: T;
  requestId: string;
}

/** Call the POS API and return status + data. Throws ApiError on non-2xx or network failure. */
export async function apiWithStatus<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  options: ApiOptions = {},
): Promise<ApiResult<T>> {
  const requestId = newRequestId();
  const headers: Record<string, string> = {
    apikey: env.publishableKey,
    'x-pos-request-id': requestId,
    accept: 'application/json',
    ...options.headers,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (options.auth !== false) {
    const token = await getAccessToken();
    if (!token) {
      throw new ApiError({ code: 'UNAUTHENTICATED', message: 'You are signed out.', status: 401, requestId });
    }
    headers.authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: `Could not reach the POS API (${env.posApiUrl}). ${errorMessage(e)}`,
      status: 0,
      retryable: true,
      requestId,
    });
  }

  const data = await parseBody(res);
  const responseRequestId = res.headers.get('x-pos-request-id') ?? requestId;
  if (!res.ok) {
    const errObj = isPlainObject(data) && isPlainObject(data.error) ? data.error : null;
    const bodyRequestId = isPlainObject(data) && typeof data.request_id === 'string' ? data.request_id : null;
    throw new ApiError({
      code: errObj && typeof errObj.code === 'string' ? errObj.code : `HTTP_${res.status}`,
      message:
        errObj && typeof errObj.message === 'string'
          ? errObj.message
          : typeof data === 'string' && data.length < 300
            ? data || res.statusText
            : `Request failed (${res.status} ${res.statusText})`,
      status: res.status,
      retryable: errObj && typeof errObj.retryable === 'boolean' ? errObj.retryable : res.status >= 500,
      details: errObj ? errObj.details : undefined,
      requestId: bodyRequestId ?? responseRequestId,
    });
  }
  return { status: res.status, data: data as T, requestId: responseRequestId };
}

/** Call the POS API and return just the data. Throws ApiError on non-2xx or network failure. */
export async function api<T>(method: HttpMethod, path: string, body?: unknown, options?: ApiOptions): Promise<T> {
  const { data } = await apiWithStatus<T>(method, path, body, options);
  return data;
}

/** True when a four-eyes endpoint answered 202 (approval required) instead of applying the change. */
export function isApprovalRequired(v: { status: string }): v is ApprovalRequired {
  return v.status === 'approval_required';
}

const id = encodeURIComponent;
const A = '/v1/admin';

/** Typed helpers for every /v1/admin endpoint. Four-eyes endpoints return ApiResult (check 201 vs 202). */
export const adminApi = {
  me: () => api<Me>('GET', `${A}/me`),

  banks: {
    create: (body: BankCreateBody) => api<Bank>('POST', `${A}/banks`, body),
    update: (bankId: string, body: BankUpdateBody) => api<Bank>('PATCH', `${A}/banks/${id(bankId)}`, body),
  },

  users: {
    create: (body: UserCreateBody) => api<PosUser>('POST', `${A}/users`, body),
    update: (userId: string, body: UserUpdateBody) => api<PosUser>('PATCH', `${A}/users/${id(userId)}`, body),
    deactivate: (userId: string, body: UserDeactivateBody) =>
      api<DeactivateUserResult>('POST', `${A}/users/${id(userId)}/deactivate`, body),
    reactivate: (userId: string, body: ReasonBody) => api<PosUser>('POST', `${A}/users/${id(userId)}/reactivate`, body),
    /** Creates the Supabase Auth login; the temporary password is shown once. */
    adminLogin: (userId: string, body: AdminLoginBody) =>
      api<AdminLoginResult>('POST', `${A}/users/${id(userId)}/admin-login`, body),
    uploadPhoto: (userId: string, body: UserPhotoBody) => api<PosUser>('POST', `${A}/users/${id(userId)}/photo`, body),
    photoUrl: (userId: string) => api<SignedUrl>('GET', `${A}/users/${id(userId)}/photo-url`),
  },

  issuers: {
    create: (body: IssuerCreateBody) => api<TrustedIssuer>('POST', `${A}/issuers`, body),
    update: (issuerId: string, body: IssuerUpdateBody) =>
      api<TrustedIssuer>('PATCH', `${A}/issuers/${id(issuerId)}`, body),
    setActive: (issuerId: string, body: IssuerActiveBody) =>
      api<TrustedIssuer>('POST', `${A}/issuers/${id(issuerId)}/active`, body),
  },

  identityLinks: {
    create: (body: IdentityLinkCreateBody) => api<ExternalIdentity>('POST', `${A}/identity-links`, body),
    revoke: (linkId: string, body: ReasonBody) =>
      api<ExternalIdentity>('POST', `${A}/identity-links/${id(linkId)}/revoke`, body),
  },

  reasonCodes: {
    create: (body: ReasonCodeCreateBody) => api<ReasonCode>('POST', `${A}/reason-codes`, body),
    update: (reasonCodeId: string, body: ReasonCodeUpdateBody) =>
      api<ReasonCode>('PATCH', `${A}/reason-codes/${id(reasonCodeId)}`, body),
  },

  mcc: {
    create: (body: MccCreateBody) => api<MccCode>('POST', `${A}/mcc`, body),
    update: (code: string, body: MccUpdateBody) => api<MccCode>('PATCH', `${A}/mcc/${id(code)}`, body),
  },

  lookupLists: {
    create: (body: LookupListCreateBody) => api<LookupList>('POST', `${A}/lookup-lists`, body),
    update: (listId: string, body: LookupListUpdateBody) =>
      api<LookupList>('PATCH', `${A}/lookup-lists/${id(listId)}`, body),
    publishVersion: (listId: string, body: LookupListVersionBody) =>
      api<LookupListVersion>('POST', `${A}/lookup-lists/${id(listId)}/versions`, body),
  },

  declarations: {
    /** Publishes a new immutable version of the declaration `key`. */
    publish: (body: DeclarationBody) => api<Declaration>('POST', `${A}/declarations`, body),
  },

  releases: {
    create: (body: ReleaseCreateBody) => api<ModuleRelease>('POST', `${A}/releases`, body),
    update: (releaseId: string, body: ReleaseUpdateBody) =>
      api<ModuleRelease>('PATCH', `${A}/releases/${id(releaseId)}`, body),
  },

  config: {
    validate: (body: ConfigValidateBody) => api<ConfigValidateResult>('POST', `${A}/config/validate`, body),
    /** 201 published | 202 approval_required. VALIDATION_FAILED (422) details = [{path,message}]. */
    publish: (body: ConfigPublishBody) => apiWithStatus<ConfigPublishResult>('POST', `${A}/config`, body),
    resolved: (query: ConfigResolvedQuery) =>
      api<ResolvedConfig>('GET', `${A}/config/resolved`, undefined, { query: { ...query } }),
  },

  definitions: {
    createFamily: (body: FamilyCreateBody) => api<DefinitionFamily>('POST', `${A}/definitions/families`, body),
    updateFamily: (familyId: string, body: FamilyUpdateBody) =>
      api<DefinitionFamily>('PATCH', `${A}/definitions/families/${id(familyId)}`, body),
    /** Omit `definition` to analyse the saved draft. */
    analyse: (familyId: string, body: AnalyseBody = {}) =>
      api<AnalyseResult>('POST', `${A}/definitions/families/${id(familyId)}/analyse`, body),
    /** 201 published | 202 approval_required | 422 VALIDATION_FAILED (details = analyse result). */
    publish: (familyId: string, body: DefinitionPublishBody = {}) =>
      apiWithStatus<DefinitionPublishResult>('POST', `${A}/definitions/families/${id(familyId)}/publish`, body),
    /** 201 activated | 202 approval_required. Rollback = activate an older version. */
    activate: (familyId: string, body: ActivationBody) =>
      apiWithStatus<ActivationResult>('POST', `${A}/definitions/families/${id(familyId)}/activations`, body),
    createTestCase: (familyId: string, body: TestCaseCreateBody) =>
      api<DefinitionTestCase>('POST', `${A}/definitions/families/${id(familyId)}/test-cases`, body),
    updateTestCase: (testCaseId: string, body: TestCaseUpdateBody) =>
      api<DefinitionTestCase>('PATCH', `${A}/definitions/test-cases/${id(testCaseId)}`, body),
    archiveTestCase: (testCaseId: string) =>
      api<DefinitionTestCase>('POST', `${A}/definitions/test-cases/${id(testCaseId)}/archive`, {}),
  },

  approvals: {
    decide: (approvalId: string, body: ApprovalDecideBody) =>
      api<ApprovalDecisionResult>('POST', `${A}/approvals/${id(approvalId)}/decide`, body),
  },

  jobs: {
    create: (body: JobCreateBody) => api<JobRecord>('POST', `${A}/jobs`, body),
    update: (jobId: string, body: JobUpdateBody) => api<JobRecord>('PATCH', `${A}/jobs/${id(jobId)}`, body),
    import: (body: JobImportBody) => api<JobImportResult>('POST', `${A}/jobs/import`, body),
    contactAttempt: (jobId: string, body: ContactAttemptBody) =>
      api<AppointmentAttempt>('POST', `${A}/jobs/${id(jobId)}/contact-attempts`, body),
    schedule: (jobId: string, body: ScheduleBody) => api<JobRecord>('POST', `${A}/jobs/${id(jobId)}/schedule`, body),
    unschedule: (jobId: string, body: ReasonCodeActionBody) =>
      api<JobRecord>('POST', `${A}/jobs/${id(jobId)}/unschedule`, body),
    notSecured: (jobId: string, body: ReasonCodeActionBody) =>
      api<NotSecuredResult>('POST', `${A}/jobs/${id(jobId)}/not-secured`, body),
    allocate: (jobId: string, body: AllocateBody) => api<JobRecord>('POST', `${A}/jobs/${id(jobId)}/allocate`, body),
    revoke: (jobId: string, body: ReasonCodeActionBody) =>
      api<JobRecord>('POST', `${A}/jobs/${id(jobId)}/revoke`, body),
    reassign: (jobId: string, body: ReassignBody) => api<JobRecord>('POST', `${A}/jobs/${id(jobId)}/reassign`, body),
    cancel: (jobId: string, body: ReasonCodeActionBody) =>
      api<JobRecord>('POST', `${A}/jobs/${id(jobId)}/cancel`, body),
    close: (jobId: string, body: CloseBody = {}) => api<JobRecord>('POST', `${A}/jobs/${id(jobId)}/close`, body),
  },

  inspections: {
    review: (inspectionId: string, body: ReviewBody) =>
      api<ReviewResult>('POST', `${A}/inspections/${id(inspectionId)}/review`, body),
    amend: (inspectionId: string, body: AmendmentBody) =>
      api<Amendment>('POST', `${A}/inspections/${id(inspectionId)}/amendments`, body),
  },

  evidence: {
    /** Short-lived signed URL (≤ 900 s). */
    url: (evidenceId: string) => api<SignedUrl>('GET', `${A}/evidence/${id(evidenceId)}/url`),
  },

  envelopes: {
    reprocess: (envelopeId: string, body: EnvelopeReprocessBody) =>
      api<EnvelopeSummary>('POST', `${A}/envelopes/${id(envelopeId)}/reprocess`, body),
    resolve: (envelopeId: string, body: EnvelopeResolveBody) =>
      api<EnvelopeSummary>('POST', `${A}/envelopes/${id(envelopeId)}/resolve`, body),
  },

  alerts: {
    ack: (body: AlertsAckBody) => api<AlertsAckResult>('POST', `${A}/alerts/ack`, body),
  },

  sessions: {
    /** Revokes the whole rotation family. */
    revoke: (sessionId: string, body: ReasonBody) =>
      api<SessionsRevokeResult>('POST', `${A}/sessions/${id(sessionId)}/revoke`, body),
  },

  devices: {
    /** deviceId = pos.devices.id (the row id). */
    revoke: (deviceId: string, body: ReasonBody) => api<Device>('POST', `${A}/devices/${id(deviceId)}/revoke`, body),
    restore: (deviceId: string, body: ReasonBody) => api<Device>('POST', `${A}/devices/${id(deviceId)}/restore`, body),
  },

  exports: {
    create: (body: ExportCreateBody) => api<ExportRow>('POST', `${A}/exports`, body),
  },

  queues: () => api<QueueDepths>('GET', `${A}/queues`),

  serverEpoch: {
    /** Break-glass: devices re-send retained envelopes (global admin). */
    rotate: (body: ReasonBody) => api<ServerEpochResult>('POST', `${A}/server-epoch/rotate`, body),
  },
} as const;

/** Helpers for endpoints outside /v1/admin (Dev tools, health). */
export const devApi = {
  hostToken: (body: DevHostTokenBody) => api<HostTokenResult>('POST', '/v1/dev/host-token', body),
  /** No bearer — apikey only. */
  exchange: (body: AuthExchangeBody) =>
    api<AuthExchangeResult>('POST', '/v1/auth/exchange', body, { auth: false }),
  health: () => api<HealthResult>('GET', '/v1/health', undefined, { auth: false }),
} as const;
