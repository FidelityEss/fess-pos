/**
 * @fess-pos/engine — public surface. Runs unchanged in Deno (Supabase Edge Functions), Node 20+ and browsers.
 */
export type { JsonValue, JsonObject, JsonPrimitive } from "./json.ts";
export { deepEqual, isJsonValue, isPlainObject } from "./json.ts";
export { EngineError, RuleError, JcsError } from "./errors.ts";

// Canonical JSON + hashing (docs/12 §11)
export { canonicalize } from "./jcs.ts";
export { sha256Hex, payloadHash, answersHash, definitionHash, toHex, utf8 } from "./hash.ts";
export { submissionHash, submissionHashPreimage, manifestEvidenceHashes, SUBMISSION_HASH_TAG } from "./submission.ts";
export type { SubmissionHashInput } from "./submission.ts";

// Rules engine (docs/04 §4)
export * from "./rules/index.ts";

// Definitions (docs/04 §3, docs/11)
export * from "./definitions/index.ts";

// Resolver, validator, analyser, test cases
export { resolveForm, compileForm } from "./resolver.ts";
export type { ResolveContext, ResolveLists, RawAnswers, ResolvedForm, ResolvedField, ResolvedItem, ResolvedSection, RuleIssue, CompiledForm } from "./resolver.ts";
export { validateAnswers, validateSubmission, contextFromSnapshot, VALIDATION_ERROR_CODES } from "./validator.ts";
export type { AnswerEntry, AnswersMap, AnswersDocument, ValidationError, ValidationResult } from "./validator.ts";
export { validateValue, isEmptyAnswer, isValidZaId, zaIdDerived, decimalPlaces, VALUE_ERROR_CODES } from "./values.ts";
export type { ValueIssue, ValueEnv } from "./values.ts";
export { analyseDefinition, computeRequires, ANALYSIS_ERROR_CODES, ANALYSIS_WARNING_CODES } from "./analyser.ts";
export type { AnalysisIssue, AnalysisResult, AnalysisBundle } from "./analyser.ts";
export { runTestCase, runTestCases, buildAnswers } from "./testcases.ts";
export type { TestCase, TestStep, TestExpectation, TestFailure, TestCaseResult } from "./testcases.ts";

// POS API v1 contract (schema/api)
export * from "./api/index.ts";

// Remote config (schema/config)
export {
  REMOTE_CONFIG_KEYS,
  REMOTE_CONFIG_DEFAULTS,
  DEFAULT_GEOFENCE_PROFILES,
  PROFILE_BOUNDS,
  RemoteConfigLayerSchema,
  remoteConfigDefaults,
  resolveRemoteConfig,
  integrityRelevantChanges,
  applyHostOverrides,
  clientSafeView,
} from "./config/remote-config.ts";
export type { ConfigKeySpec, ConfigLeafType, ConfigIssue } from "./config/remote-config.ts";

// Server-side ingest conveniences
export { canonicalHash, validateFormAnswers, submissionHashForPayload } from "./server.ts";
