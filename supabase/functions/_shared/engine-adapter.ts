// The one place the POS API and workers touch the TS engine (@fess-pos/engine), vendored into ./engine by
// `node tools/vendor-engine.mjs`. Keeping every engine call behind these names means an engine refactor changes
// this file only.
import {
  analyseDefinition as engineAnalyse,
  type AnalysisBundle,
  canonicalHash as engineCanonicalHash,
  definitionHash as engineDefinitionHash,
  integrityRelevantChanges,
  type JsonObject,
  parseDefinitionOfKind,
  RemoteConfigLayerSchema,
  type ResolveLists,
  runTestCases as engineRunTestCases,
  submissionHashForPayload,
  type TestCase,
  validateFormAnswers as engineValidateFormAnswers,
  validatePayload as engineValidatePayload,
} from './engine/index.ts';

/** sha256(JCS(value)), lower-case hex — stored_hash, answers_hash, definition_hash (docs/12 §11). */
export function canonicalHash(value: unknown): Promise<string> {
  return engineCanonicalHash(value);
}

export function definitionHash(definition: unknown): Promise<string> {
  return engineDefinitionHash(definition);
}

/** Payload shape per (type, type_version). `unknown: true` → no schema: land and hold, never refuse. */
export function validatePayload(type: string, typeVersion: number, payload: unknown): { unknown: boolean; ok: boolean; errors: unknown[] } {
  return engineValidatePayload(type, typeVersion, payload);
}

/** Server-authoritative re-validation of answers against the pinned form and the recorded context snapshot. */
export function validateFormAnswers(definition: unknown, payload: unknown, contextSnapshot: unknown, lists: ResolveLists = {}): { ok: boolean; errors: unknown[] } {
  return engineValidateFormAnswers(definition, payload, contextSnapshot, lists);
}

/** Recomputed submission hash (docs/07 §4 step 9); null when the payload lacks the inputs. */
export function submissionHashOf(payload: unknown, deviceId: string): Promise<string | null> {
  return submissionHashForPayload(payload, deviceId);
}

export interface DefinitionAnalysis {
  ok: boolean;
  errors: unknown[];
  warnings: unknown[];
  requires: unknown;
}

/** Publish-time static analysis (docs/04 §9). `kind` must match the definition's own kind. */
export function analyseDefinition(kind: string, definition: unknown, bundle: AnalysisBundle = {}): DefinitionAnalysis {
  const res = engineAnalyse(definition, bundle);
  const declared = definition && typeof definition === 'object' ? (definition as { kind?: unknown }).kind : undefined;
  const errors: unknown[] = [...res.errors];
  if (declared !== kind) errors.push({ code: 'KIND_MISMATCH', path: '/kind', message: `expected a ${kind} definition`, severity: 'error' });
  return { ok: res.ok && declared === kind, errors, warnings: res.warnings, requires: res.requires ?? null };
}

/** Definition test cases (forms). Other kinds have no answer-level test cases yet. */
export function runTestCases(definition: unknown, testCases: unknown[]): { passed: boolean; results: unknown[] } {
  const parsed = parseDefinitionOfKind(definition, 'form');
  if (!parsed.ok) return { passed: true, results: [] };
  return engineRunTestCases(parsed.definition, testCases as TestCase[]);
}

/**
 * A remote-config layer document: every present key typed and bounded (schema/config). `integrityRelevantKeys` lists
 * integrity-relevant paths whose value differs from `previous` (four-eyes + diff highlighting, docs/07 §6).
 */
export function validateRemoteConfig(values: unknown, previous: unknown = {}): { ok: boolean; errors: unknown[]; integrityRelevantKeys: string[] } {
  const res = RemoteConfigLayerSchema.safeParse(values);
  const errors = res.success ? [] : res.error.issues.map((i) => ({ path: '/' + i.path.join('/'), message: i.message }));
  const isObj = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);
  const integrityRelevantKeys = isObj(values) ? integrityRelevantChanges(isObj(previous) ? previous : {}, values) : [];
  return { ok: res.success, errors, integrityRelevantKeys };
}
