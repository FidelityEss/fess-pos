# fess_pos_engine

Pure-Dart engine for the FESS POS module, and the Dart twin of `@fess-pos/engine` (`../fess_pos_engine_ts`). No Flutter,
so it's fast to test and reusable by tools.

| Area | Status |
|------|--------|
| RFC 8785 canonical JSON (`canonicalize`) | Done (T1-07) |
| Hashes: `sha256Hex`, `payloadHash`, `answersHash`, `definitionHash`, `submissionHash` | Done (T1-07) |
| Rules evaluator: operators, static checks (depth, nodes, arity, literals), RE2-safe regexes, dates, maths, dependencies (`evaluateRule`, `evaluateRuleBoolean`, `checkRuleExpression`, `ruleDependencies`) | Done inside T2-14 (2026-09-14), ported from the TS engine; passes every `schema/fixtures/rules` case on the VM and on Node, and a test keeps it equal to `schema/rules/operators.json` |
| Form resolver and answer validator (`resolveForm`, `validateAnswers`, `validateSubmission`, `validateValue`, `renderTemplate`) for all 38 components of spec 1.0, Wave 1 and Wave 2, including repeatable groups (`item.*`, `index`) and `za_id` derived facts | Reason-form subset in T2-15; the rest in T3-01 (2026-09-14, D-66), ported from the TS engine with the same error codes. Passes every case in `schema/fixtures/submissions`, none skipped; a test keeps `formComponents` equal to the schema's component list. A component outside the spec is refused (`UNSUPPORTED_COMPONENT`) |
| Definition test-case runner (`runTestCase`, `runTestCases`, `buildAnswers`) | Done in T3-01; passes both suites in `schema/fixtures/testcases` |
| Definition parser, publish analyser, type inference | TypeScript-only by design (D-66): the phone receives published, hash-checked definitions |

## The fixture contract

`schema/fixtures` is the contract between the two engines: every case runs in both. The tests read the fixtures straight
from `../../schema/fixtures`, so run them from this folder.

```bash
dart pub get
dart test                # Dart VM
dart test -p node        # compiled to JavaScript: the same code path as the module's web build
dart analyze
```

Numbers are serialised with the ECMAScript Number-to-String algorithm, built from the shortest round-trip digits. It
doesn't rely on `double.toString()`, which prints `100.0` on the VM and `100` on the web. An `int` that a double can't
hold exactly is rejected instead of being rounded, because hashing it would silently hash a different number.

The functions are synchronous. The module runs them in an isolate for large inputs (`docs/03` §8).
