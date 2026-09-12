/**
 * Submission hash (docs/07 §4 step 9): binds answers, evidence, session token and timestamps.
 *
 * Encoding (unambiguous, reuses RFC 8785): the pre-image is the JCS serialisation of the JSON array
 *   ["fess-pos/submission-hash/v1", answers_hash, [sorted evidence sha256 hex…], session_token_id,
 *    started_at_device, submitted_at_device, device_id]
 * and submission_hash = lower-case hex SHA-256 of its UTF-8 bytes.
 * - evidence hashes: lower-case hex, sorted ascending (code-unit order), duplicates kept;
 * - timestamps: exactly the strings sent in the payload (no normalisation);
 * - session_token_id: null when absent (itself an integrity failure flagged by the server).
 * The leading tag gives domain separation and lets a future encoding bump to /v2.
 */
import { EngineError } from "./errors.ts";
import { canonicalize } from "./jcs.ts";
import { sha256Hex, SHA256_HEX } from "./hash.ts";
import type { JsonValue } from "./json.ts";

export const SUBMISSION_HASH_TAG = "fess-pos/submission-hash/v1";

export interface SubmissionHashInput {
  readonly answers_hash: string;
  readonly evidence_hashes: readonly string[];
  readonly session_token_id: string | null;
  readonly started_at_device: string;
  readonly submitted_at_device: string;
  readonly device_id: string;
}

export function submissionHashPreimage(input: SubmissionHashInput): string {
  if (!SHA256_HEX.test(input.answers_hash)) {
    throw new EngineError("SUBMISSION_HASH_INVALID_INPUT", "answers_hash must be lower-case sha256 hex");
  }
  for (const h of input.evidence_hashes) {
    if (!SHA256_HEX.test(h)) throw new EngineError("SUBMISSION_HASH_INVALID_INPUT", "evidence hashes must be lower-case sha256 hex");
  }
  const sorted = [...input.evidence_hashes].sort();
  const parts: JsonValue[] = [
    SUBMISSION_HASH_TAG,
    input.answers_hash,
    sorted,
    input.session_token_id,
    input.started_at_device,
    input.submitted_at_device,
    input.device_id,
  ];
  return canonicalize(parts);
}

export async function submissionHash(input: SubmissionHashInput): Promise<string> {
  return sha256Hex(submissionHashPreimage(input));
}

/** Evidence hashes listed in a submission manifest (docs/12 §7). */
export function manifestEvidenceHashes(manifest: { evidence: readonly { sha256: string }[] }): string[] {
  return manifest.evidence.map((e) => e.sha256);
}
