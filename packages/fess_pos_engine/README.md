# fess_pos_engine

Pure-Dart engine for the FESS POS module, and the Dart twin of `@fess-pos/engine` (`../fess_pos_engine_ts`). No Flutter,
so it's fast to test and reusable by tools.

| Area | Status |
|------|--------|
| RFC 8785 canonical JSON (`canonicalize`) | Done (T1-07) |
| Hashes: `sha256Hex`, `payloadHash`, `answersHash`, `definitionHash`, `submissionHash` | Done (T1-07) |
| Definition models, resolver, rules engine, validator | Not started (T3-01) |

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
