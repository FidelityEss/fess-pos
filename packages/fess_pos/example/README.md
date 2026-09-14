# fess_pos_example — harness host

A minimal host app for the `fess_pos` module, for development and device tests (`docs/03` §2). It does what a real
host does: `PosModule.initialize` at startup, `PosModule.signIn` with the user's identity, then push
`PosModule.entryPoint()`.

Point it at **fess-pos-qa** only. Nothing is compiled in: the address, key and identity come from `--dart-define`s.
To sign in as a QA agent, first mint a host token with `tools/scenarios/module-harness.ts` (planning pack `docs/15`
§8); it writes `~/.fess-pos/module-harness-qa.json`, which the commands below read.

```bash
flutter run --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json      # the harness, signed in to QA
flutter test integration_test -d <device> --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json
flutter build web                                                                 # must keep building for web (docs/13 §8)
flutter build apk --release --target lib/self_check.dart                          # release (R8) build checks
```

The device tests (`integration_test/`), run on the Android emulator and the iPhone simulator:

| Test | What it checks |
|------|----------------|
| SQLCipher | the local store is really encrypted on the device |
| Store recovery | a store whose key is lost is moved aside intact and a new one starts |
| Camera | the camera opens through the module's own adapter |
| QA sign-in (`qa_sign_in_test.dart`) | the exchange with the stand-in issuer, and POS opening |
| QA jobs (`qa_jobs_test.dart`) | the job list from the pull, the agent card and its QR, a job's page (map section, job card, actions) and a reason form, opened and left without submitting |

The QA tests are skipped without the harness defines. They print what each screen shows (`POS_SCREEN` lines). They
sign in as a QA agent (a device registration and session on QA) and never submit anything.

Still to come: Android, iOS and web runs in CI (T1-02).
