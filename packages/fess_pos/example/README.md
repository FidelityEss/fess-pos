# fess_pos_example — harness host

A minimal host app for the `fess_pos` module, for development and device tests (`docs/03` §2). It does what a real
host does: `PosModule.initialize` at startup, `PosModule.signIn` with the user's identity, then push
`PosModule.entryPoint()`.

Point it at **fess-pos-qa** only. Nothing is compiled in: the address, key and identity come from `--dart-define`s.
To sign in as a QA agent, first mint a host token with `tools/scenarios/module-harness.ts` (planning pack `docs/15`
§8); it writes `~/.fess-pos/module-harness-qa.json`, which the commands below read.

## Testing on your own phone

The harness opens on a **simulated FESS login**: pick a QA agent, tap **Log in as …**, and POS opens. **Log out**
signs out of POS.

1. On the Mac, from `fess-pos/`, mint logins for the agents you want (each valid 24 hours). The QA seed admin's
   credentials stay on the Mac; only the agents' host tokens go into the build:

   ```bash
   POS_PUBLISHABLE_KEY=<QA publishable key> deno run -A --node-modules-dir=none --config tools/scenarios/deno.json tools/scenarios/module-harness.ts SEED-AG01 SEED-AG02
   ```

2. Give an agent a job to work on: `tools/scenarios/skeleton.ts setup SEED-AG01` (below) adds one to the test bank.
3. Connect the phone (Android: USB debugging on; iPhone: trust the Mac and set signing in Xcode) and run:

   ```bash
   flutter run -d <phone> --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json
   ```

When the logins expire the app says so: repeat steps 1 and 3. For an Android phone without a cable, build
`flutter build apk --debug --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json` and send
`build/app/outputs/flutter-apk/app-debug.apk`. It holds that day's logins, so share it like a password.

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
| QA inspection (`qa_inspection_test.dart`) | the walking-skeleton inspection (T4-27) in three phases: `start` (online: accept, begin, first step, a camera photo), `finish` (airplane mode, after a real app restart: resume, signature, declaration, submit, saved on the phone) and `deliver` (online: sync until every item is verified and the job is under review) |

The QA jobs and sign-in tests are skipped without the harness defines. They print what each screen shows
(`POS_SCREEN` lines). They sign in as a QA agent (a device registration and session on QA) and never submit anything.

The inspection test does submit, to a QA test bank of its own. Set it up first, from `fess-pos/`:

```bash
deno run -A --node-modules-dir=none --config tools/scenarios/deno.json tools/scenarios/skeleton.ts setup
```

That creates the `SKEL` bank with its minimal inspection form and flow, plus one new job for SEED-AG01;
`skeleton.ts check` shows what reached the server. `flutter test` and `flutter drive` uninstall the app
after a run, and with it the phone's data. So a real restart between phases needs one debug APK per phase,
installed over the last with data kept and permissions granted:

```bash
flutter build apk --debug --target integration_test/qa_inspection_test.dart --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json --dart-define=POS_SKELETON_PHASE=start
```

```bash
adb install -r -g build/app/outputs/flutter-apk/app-debug.apk
```

```bash
adb shell am start -n com.fidelityess.fess_pos_example/.MainActivity
```

Read the results with `adb logcat -s flutter:I` (`POS_SKELETON` lines), then `adb shell am force-stop` before the
next phase. Before `finish`, switch airplane mode on (`adb shell cmd connectivity airplane-mode enable`); switch
it off again before `deliver`.

Still to come: Android, iOS and web runs in CI (T1-02).
