// Error taxonomy: every error the API returns carries an explicit `retryable` flag (DEVELOPMENT-GUIDELINES §2,
// docs/12 §4). Database functions raise SQLSTATE P0001 with HINT 'POS:<CODE>' and DETAIL = JSON details.

export interface ErrorSpec {
  status: number;
  retryable: boolean;
}

const SPECS: Record<string, ErrorSpec> = {
  INVALID_REQUEST: { status: 400, retryable: false },
  INVALID_ENVELOPE: { status: 400, retryable: false },
  UNAUTHENTICATED: { status: 401, retryable: false },
  TOKEN_EXPIRED: { status: 401, retryable: true },
  INVALID_HOST_TOKEN: { status: 401, retryable: false },
  HOST_TOKEN_TOO_OLD: { status: 401, retryable: false },
  INVALID_REFRESH: { status: 401, retryable: false },
  SESSION_EXPIRED: { status: 401, retryable: false },
  FORBIDDEN: { status: 403, retryable: false },
  MFA_REQUIRED: { status: 403, retryable: false },
  SCOPE_INSUFFICIENT: { status: 403, retryable: false },
  SESSION_REVOKED: { status: 403, retryable: false },
  DEVICE_REVOKED: { status: 403, retryable: false },
  DEVICE_MISMATCH: { status: 403, retryable: false },
  ACCOUNT_INACTIVE: { status: 403, retryable: false },
  UNKNOWN_IDENTITY: { status: 403, retryable: false },
  ISSUER_NOT_ACCEPTED: { status: 403, retryable: false },
  NOT_FOUND: { status: 404, retryable: false },
  CONFLICT: { status: 409, retryable: false },
  INVALID_TRANSITION: { status: 409, retryable: false },
  ALREADY_EXISTS: { status: 409, retryable: false },
  EVIDENCE_NOT_LANDED: { status: 409, retryable: true },
  APPROVAL_REQUIRED: { status: 409, retryable: false },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false },
  VALIDATION_FAILED: { status: 422, retryable: false },
  INVALID_REASON: { status: 422, retryable: false },
  NOTE_REQUIRED: { status: 422, retryable: false },
  RATE_LIMITED: { status: 429, retryable: true },
  INTERNAL: { status: 500, retryable: true },
  UNAVAILABLE: { status: 503, retryable: true },
  NOT_READY: { status: 503, retryable: true },
};

export class PosError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
    const spec = SPECS[code] ?? { status: 422, retryable: false };
    this.status = spec.status;
    this.retryable = spec.retryable;
  }
}

interface PgLikeError {
  code?: string;
  hint?: string;
  detail?: string;
  message?: string;
}

/** Map a postgres.js error to a PosError. Unknown database failures are retryable 5xx (the device retries). */
export function fromDbError(e: unknown): PosError {
  if (e instanceof PosError) return e;
  const err = (e ?? {}) as PgLikeError;
  if (typeof err.hint === 'string' && err.hint.startsWith('POS:')) {
    let details: unknown;
    if (err.detail) {
      try {
        details = JSON.parse(err.detail);
      } catch {
        details = err.detail;
      }
    }
    return new PosError(err.hint.slice(4), err.message ?? 'error', details);
  }
  const sqlstate = err.code ?? '';
  if (sqlstate.startsWith('08') || sqlstate.startsWith('53') || sqlstate.startsWith('57') || sqlstate === '40001' || sqlstate === '40P01') {
    return new PosError('UNAVAILABLE', 'database temporarily unavailable');
  }
  if (sqlstate === '23505') return new PosError('ALREADY_EXISTS', 'already exists', { constraint: (e as { constraint_name?: string }).constraint_name });
  if (sqlstate === 'P0001') return new PosError('CONFLICT', err.message ?? 'refused by an integrity rule');
  console.error(JSON.stringify({ level: 'error', msg: 'unmapped database error', sqlstate, message: err.message }));
  return new PosError('INTERNAL', 'internal error');
}

export function errorBody(err: PosError, requestId: string): Record<string, unknown> {
  return {
    error: { code: err.code, message: err.message, retryable: err.retryable, ...(err.details !== undefined ? { details: err.details } : {}) },
    request_id: requestId,
  };
}

export function errorResponse(e: unknown, requestId: string): Response {
  const err = e instanceof PosError ? e : fromDbError(e);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-pos-request-id': requestId };
  if (err.status === 429 || err.status === 503) headers['retry-after'] = '30';
  return new Response(JSON.stringify(errorBody(err, requestId)), { status: err.status, headers });
}
