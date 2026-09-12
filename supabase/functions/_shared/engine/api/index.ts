// GENERATED — do not edit. Source: packages/fess_pos_engine_ts/src/api/index.ts (run: node tools/vendor-engine.mjs)
/**
 * POS API v1 contract (schema/api) — Zod schemas, TS types and payload validation.
 */
import type { z } from "npm:zod@^3.25.76";
import { pointer } from "../definitions/parse.ts";
import { KNOWN_ENVELOPE_TYPES, PAYLOAD_SCHEMAS } from "./schemas.ts";
import type { EnvelopeType } from "./schemas.ts";

export * from "./schemas.ts";

export interface PayloadIssue {
  readonly code: "PAYLOAD_INVALID";
  readonly path: string;
  readonly message: string;
}

export interface PayloadValidation {
  /** True when the (type, type_version) pair has no schema: land it and hold it, never refuse (docs/12 §5). */
  readonly unknown: boolean;
  readonly ok: boolean;
  readonly errors: PayloadIssue[];
}

export function isKnownEnvelopeType(t: string): t is EnvelopeType {
  return (KNOWN_ENVELOPE_TYPES as readonly string[]).includes(t);
}

export function payloadSchema(type: string, typeVersion: number): z.ZodTypeAny | undefined {
  if (!isKnownEnvelopeType(type)) return undefined;
  return PAYLOAD_SCHEMAS[type][typeVersion];
}

/** Validate a payload against schema/api/payloads/<type>.v<version>. */
export function validatePayload(type: string, typeVersion: number, payload: unknown): PayloadValidation {
  const schema = payloadSchema(type, typeVersion);
  if (!schema) return { unknown: true, ok: false, errors: [] };
  const res = schema.safeParse(payload);
  if (res.success) return { unknown: false, ok: true, errors: [] };
  return {
    unknown: false,
    ok: false,
    errors: res.error.issues.map((i) => ({ code: "PAYLOAD_INVALID" as const, path: pointer(i.path), message: i.message })),
  };
}
