// GENERATED — do not edit. Source: packages/fess_pos_engine_ts/src/server.ts (run: node tools/vendor-engine.mjs)
/**
 * Server-side conveniences for the POS API ingest pipeline (docs/12 §5 step 5 VALIDATE):
 * canonical hashing, payload validation, form-answer re-validation and submission-hash recomputation.
 */
import type { JsonObject } from "./json.ts";
import { isPlainObject } from "./json.ts";
import { payloadHash } from "./hash.ts";
import { parseDefinitionOfKind } from "./definitions/parse.ts";
import { contextFromSnapshot, validateAnswers } from "./validator.ts";
import type { ValidationError } from "./validator.ts";
import type { ResolveLists } from "./resolver.ts";
import { submissionHash } from "./submission.ts";

export { validatePayload } from "./api/index.ts";

/** sha256(JCS(value)) — used for stored_hash, answers_hash and definition_hash checks. */
export function canonicalHash(value: unknown): Promise<string> {
  return payloadHash(value);
}

/**
 * Re-validate `payload.answers` against a pinned form definition and the recorded context snapshot.
 * A definition that fails to parse is reported as FORM_DEFINITION_INVALID (the submission is kept, never lost).
 */
export function validateFormAnswers(
  definition: unknown,
  payload: unknown,
  contextSnapshot: unknown,
  lists: ResolveLists = {},
): { ok: boolean; errors: ValidationError[] } {
  const parsed = parseDefinitionOfKind(definition, "form");
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors.map((e) => ({ field_key: "", code: "FORM_DEFINITION_INVALID", message: `${e.code} at ${e.path}: ${e.message}` })) };
  }
  const answers = isPlainObject(payload) ? payload["answers"] : undefined;
  const ctx = contextFromSnapshot(isPlainObject(contextSnapshot) ? (contextSnapshot as JsonObject) : undefined);
  const res = validateAnswers(parsed.definition, answers ?? {}, ctx, lists);
  return { ok: res.ok, errors: res.errors };
}

/**
 * Recompute submission_hash from a submission payload and the envelope's device_id (docs/07 §4 step 9).
 * Returns null when the payload lacks the inputs (the payload schema reports that separately).
 */
export async function submissionHashForPayload(payload: unknown, deviceId: string): Promise<string | null> {
  if (!isPlainObject(payload)) return null;
  const p = payload;
  const items = isPlainObject(p["manifest"]) && Array.isArray(p["manifest"]["items"]) ? p["manifest"]["items"] : null;
  if (
    typeof p["answers_hash"] !== "string" ||
    items === null ||
    typeof p["started_at_device"] !== "string" ||
    typeof p["submitted_at_device"] !== "string" ||
    !(typeof p["session_token_id"] === "string" || p["session_token_id"] === null)
  ) {
    return null;
  }
  const hashes: string[] = [];
  for (const it of items) {
    if (!isPlainObject(it) || typeof it["sha256"] !== "string") return null;
    hashes.push(it["sha256"]);
  }
  try {
    return await submissionHash({
      answers_hash: p["answers_hash"],
      evidence_hashes: hashes,
      session_token_id: p["session_token_id"] as string | null,
      started_at_device: p["started_at_device"],
      submitted_at_device: p["submitted_at_device"],
      device_id: deviceId,
    });
  } catch {
    return null;
  }
}
