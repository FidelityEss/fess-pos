# @fess-pos/engine

The TypeScript engine for FESS POS: canonical JSON and hashing, the rules engine, definition parsing, the form resolver, server-authoritative submission validation, the publish analyser, definition test cases, and the POS API v1 / remote-config contract as Zod schemas. The contract itself is `../../schema` (see its README); this package is its TS implementation, proven by the shared fixtures.

- **Runs unchanged in Deno (Supabase Edge Functions), Node 20+ and browsers.** It uses no Node built-ins and uses Web Crypto for SHA-256. Relative imports carry `.ts` extensions.
- **Dependencies.** The only runtime dependency is `zod` (v3, imported bare). `deno.json` maps it to `npm:zod@^3.25.76`.
- **Strict TypeScript.** No `any`, and `verbatimModuleSyntax` is on.

## Modules (`src/`)

| Module | Purpose |
|--------|---------|
| `jcs.ts`, `hash.ts` | RFC 8785 `canonicalize`; `sha256Hex`, `payloadHash` / `answersHash` / `definitionHash` = sha256(JCS(value)) |
| `rules/` | Evaluator for exactly the docs/04 §4.1 operators (`evaluate`, `evaluateBoolean`); static checks (`checkExpression`: arity, literal arguments, depth ≤ 32, nodes ≤ 500, RE2-safe regex); `dependencies`; publish-time `inferType` |
| `definitions/` | Component / step / view / page / action catalogue; Zod mirrors of `schema/definitions`; `parseDefinition` with `DEF_*` codes; templates |
| `resolver.ts` | `resolveForm(form, context, answers, lists)` → per field: visible, required, read_only, computed value, resolved props, filtered options, labels |
| `validator.ts` | `validateAnswers` / `validateSubmission` — the server rule (docs/04 §5–6) |
| `values.ts` | Value-shape checks per component type |
| `analyser.ts` | `analyseDefinition(def, bundle?)` — publish safety (docs/04 §9) plus `requires` |
| `testcases.ts` | `runTestCase(s)` — definition test cases |
| `submission.ts` | `submissionHash` (encoding in `schema/api/README.md`) |
| `api/` | Zod schemas and types for every API message and payload; `validatePayload(type, version, payload)` |
| `config/remote-config.ts` | Typed key table with bounds and flags; `resolveRemoteConfig(layers)`, `integrityRelevantChanges`, `applyHostOverrides`, `clientSafeView` |
| `server.ts` | Ingest helpers: `canonicalHash`, `validateFormAnswers`, `submissionHashForPayload` |

```ts
import { analyseDefinition, resolveForm, validateSubmission, payloadHash } from "@fess-pos/engine";

const analysis = analyseDefinition(definition, { forms, flows, views });   // publish gate
const resolved = resolveForm(form, { today: "2026-09-10", job, inspection }, rawAnswers);
const result = await validateSubmission(form, answersDocument);            // server re-validation
```

## Scripts

```bash
pnpm --filter @fess-pos/engine test        # vitest + v8 coverage (gate: 80% lines/statements/functions/branches)
pnpm --filter @fess-pos/engine typecheck   # tsc for src (no Node types) and tests
deno check --config packages/fess_pos_engine_ts/deno.json packages/fess_pos_engine_ts/src/index.ts
node tools/vendor-engine.mjs               # copy src into supabase/functions/_shared/engine (zod → npm:zod@…)
```

Tests run every fixture in `schema/fixtures`. They also check that:
- every JSON Schema compiles under ajv;
- valid fixtures pass, and invalid ones fail, under both ajv and the Zod mirrors;
- the catalogue, operator table and remote-config key table match `schema/`.

## Semantics worth knowing

- **Strict typing.** `==` never coerces. A type error in a rule raises `RULE_TYPE_ERROR`: the resolver records it and falls back safely (visible, not required); the validator reports `RULE_ERROR`.
- **Null handling.** Arithmetic propagates null, except `+`, `min` and `max`, which skip nulls. Division by zero is null. `round` rounds half away from zero.
- **Rules are pure.** `today` comes from the context (`context_snapshot.today`), never the clock.
- **Hidden ⇒ absent.** A hidden field reads as null, is not validated, and must not be submitted.
- **Evaluation order.** Resolution follows the dependency order of the `visible` / `value` rules, including section and group visibility; cycles are rejected. `derived.<key>` counts as a dependency on `<key>`.
