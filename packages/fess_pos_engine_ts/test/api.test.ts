import { describe, expect, it } from "vitest";
import { join } from "node:path";
import type { z } from "zod";
import {
  AnswersSchema,
  AuthExchangeRequestSchema,
  AuthExchangeResponseSchema,
  AuthRefreshRequestSchema,
  AuthRefreshResponseSchema,
  ContextSnapshotSchema,
  DefinitionRefSchema,
  DeviceUpdateRequestSchema,
  DeviceUpdateResponseSchema,
  EnvelopeSchema,
  ErrorResponseSchema,
  IngestRequestSchema,
  IngestResponseSchema,
  KNOWN_ENVELOPE_TYPES,
  ReceiptSchema,
  SyncPullRequestSchema,
  SyncPullResponseSchema,
  UploadGrantRequestSchema,
  UploadGrantResponseSchema,
  isKnownEnvelopeType,
  payloadSchema,
  validatePayload,
} from "../src/api/index.ts";
import { payloadHash } from "../src/hash.ts";
import { canonicalHash, submissionHashForPayload, validateFormAnswers } from "../src/server.ts";
import type { JsonObject } from "../src/json.ts";
import { FIXTURES, SCHEMA_DIR, fixtures, readJson, schemaFor } from "./helpers.ts";
import { z as zod } from "zod";

const AnswersDocumentSchema = zod
  .object({
    definition_refs: zod.object({ form: DefinitionRefSchema, flow: DefinitionRefSchema.optional(), job_schema: DefinitionRefSchema.nullable().optional() }).strict(),
    config_version_id: zod.string().nullable().optional(),
    context_snapshot: ContextSnapshotSchema,
    answers: AnswersSchema,
    field_timings: zod.record(zod.unknown()).optional(),
    answers_hash: zod.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const ZOD: Record<string, z.ZodTypeAny> = {
  receipt: ReceiptSchema,
  error: ErrorResponseSchema,
  "ingest-request": IngestRequestSchema,
  "ingest-response": IngestResponseSchema,
  "sync-pull-request": SyncPullRequestSchema,
  "sync-pull-response": SyncPullResponseSchema,
  "auth-exchange-request": AuthExchangeRequestSchema,
  "auth-exchange-response": AuthExchangeResponseSchema,
  "auth-refresh-request": AuthRefreshRequestSchema,
  "auth-refresh-response": AuthRefreshResponseSchema,
  "upload-grant-request": UploadGrantRequestSchema,
  "upload-grant-response": UploadGrantResponseSchema,
  "device-update-request": DeviceUpdateRequestSchema,
  "device-update-response": DeviceUpdateResponseSchema,
  "answers-document": AnswersDocumentSchema,
};

const wrapper = schemaFor("api/envelope.schema.json");
type Env = { type: string; type_version: number; payload: JsonObject; payload_hash: string; device_id: string };

describe("envelopes/valid", () => {
  for (const f of fixtures<{ envelope: Env; unknown_type?: boolean }>("envelopes/valid")) {
    it(f.name, async () => {
      const e = f.data.envelope;
      expect(wrapper(e), JSON.stringify(wrapper.errors)).toBe(true);
      expect(EnvelopeSchema.safeParse(e).success).toBe(true);
      expect(await payloadHash(e.payload)).toBe(e.payload_hash);
      const pv = validatePayload(e.type, e.type_version, e.payload);
      if (f.data.unknown_type) {
        expect(pv.unknown).toBe(true);
        return;
      }
      expect(pv, JSON.stringify(pv.errors)).toMatchObject({ unknown: false, ok: true });
      const js = schemaFor(`api/payloads/${e.type}.v${e.type_version}.schema.json`);
      expect(js(e.payload), JSON.stringify(js.errors)).toBe(true);
      if (e.type === "submission") expect(await submissionHashForPayload(e.payload, e.device_id)).toBe(e.payload["submission_hash"]);
    });
  }
});

describe("envelopes/invalid", () => {
  for (const f of fixtures<{ expected: "wrapper" | "payload"; envelope: Env }>("envelopes/invalid")) {
    it(`${f.name} (${f.data.expected})`, () => {
      const e = f.data.envelope;
      if (f.data.expected === "wrapper") {
        expect(wrapper(e)).toBe(false);
        expect(EnvelopeSchema.safeParse(e).success).toBe(false);
        return;
      }
      expect(wrapper(e), JSON.stringify(wrapper.errors)).toBe(true);
      expect(EnvelopeSchema.safeParse(e).success).toBe(true);
      const js = schemaFor(`api/payloads/${e.type}.v${e.type_version}.schema.json`);
      expect(js(e.payload)).toBe(false);
      const pv = validatePayload(e.type, e.type_version, e.payload);
      expect(pv.ok).toBe(false);
      expect(pv.errors.length).toBeGreaterThan(0);
    });
  }
});

for (const dir of ["valid", "invalid"] as const) {
  describe(`api/${dir}`, () => {
    for (const f of fixtures<{ schema: string; value: unknown }>(`api/${dir}`)) {
      it(`${f.name} (${f.data.schema})`, () => {
        const js = schemaFor(`api/${f.data.schema}.schema.json`);
        const zs = ZOD[f.data.schema];
        expect(zs, f.data.schema).toBeDefined();
        const zr = zs?.safeParse(f.data.value);
        expect(js(f.data.value), JSON.stringify(js.errors)).toBe(dir === "valid");
        expect(zr?.success, JSON.stringify(zr?.success ? null : zr?.error.issues)).toBe(dir === "valid");
      });
    }
  });
}

describe("payload registry", () => {
  it("has a v1 schema file and a Zod mirror for every known type", () => {
    for (const t of KNOWN_ENVELOPE_TYPES) {
      expect(payloadSchema(t, 1)).toBeDefined();
      expect(schemaFor(`api/payloads/${t}.v1.schema.json`)).toBeTypeOf("function");
    }
    const known = readJson<{ "x-known-types": string[] }>(join(SCHEMA_DIR, "api", "envelope.schema.json"))["x-known-types"];
    expect([...known].sort()).toEqual([...KNOWN_ENVELOPE_TYPES].sort());
  });
  it("unknown types and versions are held, not refused", () => {
    expect(isKnownEnvelopeType("lead_created")).toBe(false);
    expect(validatePayload("lead_created", 1, {})).toEqual({ unknown: true, ok: false, errors: [] });
    expect(validatePayload("submission", 2, {})).toEqual({ unknown: true, ok: false, errors: [] });
  });
});

describe("server facade", () => {
  const siteForm = readJson(join(FIXTURES, "definitions", "valid", "form_site_inspection.json"));
  const mall = readJson<{ document: JsonObject }>(join(FIXTURES, "submissions", "valid", "site_mall.json")).document;
  it("canonicalHash is sha256(JCS)", async () => {
    expect(await canonicalHash(mall["answers"])).toBe(mall["answers_hash"]);
  });
  it("validateFormAnswers re-validates a payload against a pinned definition", () => {
    expect(validateFormAnswers(siteForm, mall, mall["context_snapshot"]).ok).toBe(true);
    const bad = validateFormAnswers(siteForm, { answers: { colour: { v: 1 } } }, mall["context_snapshot"]);
    expect(bad.errors.map((e) => e.code)).toContain("UNKNOWN_FIELD");
    const broken = validateFormAnswers({ kind: "form" }, mall, {});
    expect(broken.errors[0]?.code).toBe("FORM_DEFINITION_INVALID");
    expect(validateFormAnswers(siteForm, null, null).ok).toBe(false);
  });
  it("submissionHashForPayload returns null for incomplete payloads", async () => {
    expect(await submissionHashForPayload(null, "d")).toBeNull();
    expect(await submissionHashForPayload({ answers_hash: "x" }, "d")).toBeNull();
    expect(await submissionHashForPayload({ answers_hash: "a".repeat(64), manifest: { items: [{}] }, started_at_device: "t", submitted_at_device: "t", session_token_id: null }, "d")).toBeNull();
    expect(await submissionHashForPayload({ answers_hash: "BAD", manifest: { items: [] }, started_at_device: "t", submitted_at_device: "t", session_token_id: null }, "d")).toBeNull();
  });
});
