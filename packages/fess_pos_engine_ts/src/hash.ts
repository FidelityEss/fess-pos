/**
 * SHA-256 via Web Crypto (available in Deno, Node 20+ and browsers) and the JCS hashes used across POS:
 * `payload_hash`, `answers_hash`, `definition_hash` = hex(sha256(utf8(JCS(value)))) — docs/12 §11.
 */
import { canonicalize } from "./jcs.ts";

const encoder = new TextEncoder();

export function utf8(s: string): Uint8Array {
  return encoder.encode(s);
}

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Lower-case hex SHA-256 of raw bytes or of the UTF-8 encoding of a string. */
export async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const bytes = typeof input === "string" ? utf8(input) : input;
  // Copy into a fresh ArrayBuffer so SharedArrayBuffer-backed views are accepted everywhere.
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf.buffer);
  return toHex(new Uint8Array(digest));
}

/** sha256(JCS(value)) — the envelope `payload_hash` (docs/12 §4). */
export async function payloadHash(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}

/** sha256(JCS(answers)) — the answers document `answers_hash` (docs/04 §5). */
export async function answersHash(answers: unknown): Promise<string> {
  return sha256Hex(canonicalize(answers));
}

/** sha256(JCS(definition)) — `definition_hash` written at publish (docs/04 §7). */
export async function definitionHash(definition: unknown): Promise<string> {
  return sha256Hex(canonicalize(definition));
}

export const SHA256_HEX = /^[0-9a-f]{64}$/;
