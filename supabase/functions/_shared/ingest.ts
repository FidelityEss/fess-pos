// Ingest pipeline shared by POST /v1/ingest and the reprocessor worker (docs/12 §5):
//   wrapper check → server hash → LAND (own transaction) → validate (TS engine) → APPLY (one transaction) → receipt.
// Landing never refuses for version, schema or business reasons; only an unparseable wrapper is refused, and the
// device parks that item and reports it via client_error (docs/12 §4).
import { z } from 'zod';
import { asService, rpc } from './db.ts';
import { canonicalHash, submissionHashOf, validateFormAnswers, validatePayload } from './engine-adapter.ts';
import { log } from './log.ts';

export const EnvelopeWrapper = z.object({
  api_version: z.string().max(8).default('1'),
  id: z.string().uuid(),
  type: z.string().min(1).max(64),
  type_version: z.number().int().positive(),
  payload_hash: z.string().regex(/^[0-9a-f]{64}$/),
  device_id: z.string().uuid(),
  session_id: z.string().uuid().nullish(),
  device_seq: z.number().int().nonnegative(),
  module_version: z.string().max(64),
  client_type: z.enum(['native', 'web']).default('native'),
  created_at_device: z.string().datetime({ offset: true }),
  monotonic_ms: z.number().int().nonnegative(),
  payload: z.record(z.unknown()),
}).passthrough();

export type Envelope = z.infer<typeof EnvelopeWrapper>;
export type Receipt = Record<string, unknown>;

export interface IngestContext {
  userId: string;
  sessionId: string;
  deviceId: string;
  requestId: string;
}

interface LandResult {
  outcome: 'new' | 'retry' | 'duplicate' | 'shortcut' | 'conflict';
  state?: string;
  receipt?: Receipt;
}

export interface Validation {
  ok: boolean;
  errors?: unknown[];
  computed?: Record<string, unknown>;
}

export async function processEnvelope(raw: unknown, ctx: IngestContext): Promise<Receipt> {
  const parsed = EnvelopeWrapper.safeParse(raw);
  if (!parsed.success) {
    const id = raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : null;
    return {
      id,
      state: null,
      durable: false,
      error: {
        code: 'INVALID_ENVELOPE',
        retryable: false,
        message: 'envelope wrapper failed validation — park the item and report it with a client_error envelope',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    };
  }
  const envelope = parsed.data;
  const storedHash = await canonicalHash(envelope.payload);
  const actor = { id: ctx.userId, role: 'pos_agent', requestId: ctx.requestId };

  const landed = await asService(actor, (tx) =>
    rpc<LandResult>(tx, 'ingest_land', [
      [envelope, 'jsonb'],
      [storedHash, 'text'],
      [ctx.userId, 'uuid'],
      [ctx.sessionId, 'uuid'],
      [ctx.requestId, 'text'],
    ]));
  if (landed.outcome === 'duplicate' || landed.outcome === 'shortcut' || landed.outcome === 'conflict') {
    return landed.receipt ?? { id: envelope.id, state: 'deferred', durable: true, stored_hash: storedHash };
  }
  return await applyLanded(envelope, storedHash, ctx.requestId);
}

/** Validate then apply an envelope that is already durable. Never throws: a failure leaves it for the reprocessor. */
export async function applyLanded(envelope: Envelope, storedHash: string, requestId: string): Promise<Receipt> {
  const actor = { id: null, role: 'system', requestId };
  try {
    const validation = await validateEnvelope(envelope, requestId);
    return await asService(actor, (tx) => rpc<Receipt>(tx, 'ingest_apply', [[envelope.id, 'uuid'], [validation, 'jsonb']]));
  } catch (e) {
    log('error', 'ingest apply failed; envelope stays landed for the reprocessor', { request_id: requestId, envelope_id: envelope.id, error: String(e) });
    return { id: envelope.id, state: 'deferred', durable: true, stored_hash: storedHash, waiting_on: { reprocess: true }, error: null };
  }
}

interface PinnedVersion {
  id: string;
  kind: string;
  definition: Record<string, unknown>;
  definition_hash: string;
}

async function pinned(versionId: unknown, requestId: string): Promise<PinnedVersion | null> {
  if (typeof versionId !== 'string') return null;
  return await asService({ id: null, role: 'system', requestId }, (tx) => rpc<PinnedVersion | null>(tx, 'definition_version_get', [[versionId, 'uuid']]));
}

/** Payload validation (schema per type/version, then deep checks). Unknown types are held, never refused. */
export async function validateEnvelope(envelope: Envelope, requestId: string): Promise<Validation> {
  const shape = validatePayload(envelope.type, envelope.type_version, envelope.payload);
  if (shape.unknown) return { ok: true, computed: { unknown_type: true } };
  if (!shape.ok) return { ok: false, errors: shape.errors };

  const p = envelope.payload as Record<string, unknown>;
  if (envelope.type === 'submission') {
    const refs = (p.definition_refs ?? {}) as Record<string, { version_id?: string; hash?: string } | undefined>;
    const form = await pinned(refs.form?.version_id, requestId);
    if (!form || form.kind !== 'form') return { ok: false, errors: [{ code: 'UNKNOWN_FORM_VERSION', message: 'pinned form version not found' }] };
    const answersHash = await canonicalHash(p.answers ?? {});
    const submissionHash = await submissionHashOf(p, envelope.device_id);
    const result = validateFormAnswers(form.definition, p, p.context_snapshot ?? {});
    return {
      ok: result.ok,
      errors: result.errors,
      computed: {
        // integrity signals, recorded as flags on the inspection — the data is kept either way (docs/07 §4)
        answers_hash_matches: answersHash === p.answers_hash,
        submission_hash_matches: submissionHash !== null && submissionHash === p.submission_hash,
        definition_hash_matches: refs.form?.hash === undefined || refs.form.hash === form.definition_hash,
      },
    };
  }
  if (envelope.type === 'form_submission') {
    const form = await pinned(p.form_version_id, requestId);
    if (!form || form.kind !== 'form') return { ok: false, errors: [{ code: 'UNKNOWN_FORM_VERSION', message: 'form version not found' }] };
    const result = validateFormAnswers(form.definition, p, p.context_snapshot ?? {});
    return { ok: result.ok, errors: result.errors, computed: { answers_hash_matches: (await canonicalHash(p.answers ?? {})) === p.answers_hash } };
  }
  return { ok: true };
}
