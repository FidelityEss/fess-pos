# schema/ — the language-agnostic contract

JSON Schema (draft 2020-12) and fixtures shared by the Dart engine (`fess_pos_engine`), the TS engine (`@fess-pos/engine`), the POS API and the admin panel. **The fixtures are the contract:** CI fails if the engines disagree on any of them.

| Path | What |
|------|------|
| `definitions/` | Definition kinds for spec 1.0 (docs/04 §3): `form`, `flow`, `job_schema`, `view`, `content`, `app`, plus `components.schema.json` (every wave 1–2 component, docs/11), `common.schema.json`, and `definition.schema.json` (dispatch on `kind`) |
| `rules/` | `operators.json` — the rules-engine operator spec (names, arity, argument types, null behaviour, semantics, error codes, limits; D-29) — and `expression.schema.json` (structure, operator names, arity, literal-only arguments) |
| `api/` | POS API v1: envelope wrapper, receipt, error, ingest, sync pull, auth, upload grant, answers document, `payloads/<type>.v<n>.schema.json`. See `api/README.md` |
| `config/` | `remote-config.schema.json` (every key: type, default, bounds, `x-integrity-relevant`, `x-host-overridable`, `x-client-safe`) and `defaults.json` (the global default document) |
| `fixtures/` | Valid and invalid examples with expected results (below) |

`$id`s live under `https://fess-pos.invalid/schema/…` (a reserved, non-resolvable host); cross-file `$ref`s are relative. Load every `*.schema.json` into one validator (ajv 2020 with `ajv-formats`; register the `x-*` annotation keywords as vocabulary).

## Definition conventions (spec 1.0)

- **Placement.** Common props (docs/11 §2) are top-level on a field. Type-specific props go in `props`. Choice components also carry `options` / `options_source` / `options_filter` at top level (exactly one of `options` or `options_source`). The display components `info`, `callout`, `divider` and `image` carry their few props (`text`, `tone`, `asset`, `caption`) at top level. Flow steps, view items and pages carry their props at top level.
- **R (rule-able)** props are `anyOf: [literal, operation]`. An operation is an object with exactly one operator key. There is no literal-object syntax, so every object in an expression position is an operator.
- **Keys.** Field keys are unique across a form, including group children. A repeatable group's children have their own namespace. Group children answer at top level; a repeatable group's value is an array of item objects.
- **Rule data roots** (docs/04 §4.2): `answers`, `job`, `agent`, `inspection`, `stats`, `previous`, `config`, and `derived.<key>.{dob,gender}` for `za_id` numbers. Scoped roots: `item`/`index` (repeatable children and `item_label`), `option` (`options_filter`), `current`/`current_index` (inside `some`/`all`/`none`/`count`), and `record`/`job`/`inspection` (list filters).
- **Flows** submit to `action` (default `inspection.submit`). For inspection flows, `location_check`, `declaration` and `submit` must be present, in order before `submit`, and not bypassable. `next` is a step id, `flow:<family>`, `page:<key>`, or an expression yielding one.
- **Apps.** `form_page` and `flow` pages name an outcome set (`outcome_sets.<name>` → success/saved/failure outcome pages; docs/04 §3.7). A `{flow: x}` target uses the `default` set.
- **Answer entries** are `{v, prefilled?, flagged_differs?, computed?, rendered_as?, other_text?, unknown?}`:
  - `other_text` goes with an `allow_other` choice;
  - `unknown` with `v: null` goes with a `date` that has `allow_unknown`;
  - `validate[]` rules run only on visible, non-empty answers;
  - `min_items` applies once at least one item exists (use `required` for "at least one").

## Versioning

- `spec_version` is `major.minor`. Engines reject unknown majors and minors newer than they support (TS engine: 1.0).
- New optional capability → minor bump. New operator → minor bump plus an `operators.json` entry, both engines and fixtures (docs/04 §12). New component → the docs/11 §8 checklist plus a catalogue entry here.
- Components carry integer versions (all `1` today). Publish computes `requires` (spec + component / step / view / page versions).
- API payloads change only by adding a `type_version` with a converter (docs/13 §2). The envelope wrapper never changes incompatibly.
- Remote-config bounds change only through a reviewed schema change (docs/07 §6).

## Fixtures (`fixtures/`)

| Folder | Format | Asserted |
|--------|--------|----------|
| `rules/<op>.json` | `{operator, cases:[{name, expression, data?, env?:{today?, option_meta?}, expected \| error}]}`; also `_limits`, `_syntax`, `_dependencies` | Every operator has cases. Each case gives the expected value, or throws the expected `RULE_*` code. `expression.schema.json` rejects exactly the structural errors (`RULE_MALFORMED`, `_UNKNOWN_OPERATOR`, `_ARITY`, `_INVALID_ARGUMENT`, `_REGEX_TOO_LONG`) |
| `jcs/*.json` | `{input_json \| ieee754_hex, canonical, sha256}` or `{…, error}` | RFC 8785 examples, Appendix B number table, extra edge cases |
| `submission_hash/vectors.json` | `{input, preimage, sha256}` | Submission-hash encoding (`api/README.md`) |
| `definitions/valid/*.json` | a definition | JSON Schema, Zod and publish analysis all accept it. Together they use every component, step type, view component and page type. `_support.json` lists the supporting data they reference |
| `definitions/invalid/*.json` | `{expected_errors, definition}` | JSON Schema **and** the engine parser reject it with those `DEF_*` codes |
| `definitions/analysis/*.json` | `{definition, bundle?, expected_errors, expected_warnings?, expected_requires?}` | Schema-valid; publish analysis reports exactly those codes |
| `submissions/{valid,invalid}/*.json` | `{form, lists?, document, expected:{ok, errors:[{field_key, code}]}}` | Server re-validation (docs/04 §5–6) yields exactly those errors |
| `testcases/*.json` | `{form, lists?, cases:[TestCase & {expect_pass?}]}` | Definition test-case runner |
| `envelopes/{valid,invalid}/*.json` | `{envelope, unknown_type?}` / `{expected: wrapper\|payload, envelope}` | Wrapper and payload schemas, JSON Schema and Zod, correct `payload_hash` |
| `api/{valid,invalid}/*.json` | `{schema, value}` | Every API message, JSON Schema and Zod |
| `config/{valid,invalid}/*.json` | `{layers, expect_values?}` / `{layers, schema_valid}` | Layer merge and bounds; cross-key rules that only the engines check |

Expected values were written from the specs. Hashes and haversine distances were computed with independent code. Nothing was produced by the engine under test.

## Keeping things in sync

- `packages/fess_pos_engine_ts` mirrors these schemas in Zod, and its component / step / view / page catalogue mirrors `definitions/`.
- Tests fail on drift in props, rule-able flags, required props, display variants, operators, arity, remote-config keys, flags, defaults and bounds.
- Every valid fixture must pass, and every invalid fixture must fail, under both ajv and Zod.
- T1-06 (codegen) will generate the Dart and TS types from this folder.
