# Host integration — fess_pos

The module adapts to the host, never the reverse (planning pack D-55). A host **wires the module in** and changes
nothing else: no build settings, permissions, SDK levels, backup rules, linker flags or dependency overrides. This file
lists that wiring, and what the module takes care of by itself so the host doesn't have to.

## 1. Dependency

One line, from git:

```yaml
dependencies:
  fess_pos:
    git:
      url: https://github.com/FidelityEss/fess-pos.git
      path: packages/fess_pos
      ref: <release tag>
```

- Pub fetches `fess_pos_engine` from the same repository and commit automatically (verified).
- The module builds on FESS's toolchain floor (Dart ≥ 3.8, Flutter ≥ 3.29) and accepts FESS's pinned and overridden
  versions (`geolocator 14.0.1`, `flutter_secure_storage 9.2.4`, `device_info_plus 11.5.0`, `package_info_plus 8.0.2`,
  `http 1.4.0`, `uuid ^4`). No `dependency_overrides` are needed.

## 2. Wiring (the only host code)

Keep it in one hand-written file (FESS: e.g. `lib/custom_code/pos_integration.dart`) with one-line calls from the
generated files, so FlutterFlow regeneration can't lose it.

| When | Call |
|------|------|
| Startup, after `WidgetsFlutterBinding.ensureInitialized()` | `await PosModule.initialize(PosHostConfig(bootstrap: …, onUserActivity: …, onEvent: …))` |
| Once in `main()` | `PosModule.registerBackgroundWork()` (a no-op until T5-01) |
| Only if the host already runs its own background dispatcher (D-36) | `PosModule.runBackgroundSync()` from it: one sync pass (send what is queued, pull if signed in) |
| Login, at startup once the user is known, and whenever the host token is refreshed | `PosModule.signIn(PosIdentity(profile: …, getIdentityToken: …))` |
| Every logout path, including forced and 401 sign-outs | `PosModule.signOut()` |
| Showing the POS tile | only when `(await PosModule.access()).visible` |
| Opening POS | push a route with `PosModule.entryPoint()` |
| A push message with `data.source == 'fess_pos'` | `PosModule.handlePushPayload(data)` (optional: push is only a hint) |
| A deep link under `/pos/…` | `PosModule.handleDeepLink(uri)` |

- **Bootstrap:** the API URL, the **publishable** key and the environment come from the build flavour
  (`--dart-define`). `initialize` refuses a non-HTTPS URL and anything that looks like a secret or service-role key.
- **Signing in has no screen.** `signIn` hands the module the identity the host already holds; the module swaps the
  host's token for its own session with the POS API and never needs the host again. Offline, a user who signed in on
  the phone before gets straight in. If `access()` says `notSignedIn` while your user is signed in (the server ended
  the session, e.g. a revoked device), call `signIn` again, e.g. when the app resumes.
- **Idle timer (optional):** `onUserActivity` fires, at most every 5 s, while the agent uses the module, so the host can
  reset its own PIN or idle lock. If the host locks anyway, nothing is lost.
- Don't wrap the entry point in a `ProviderScope`: the module brings its own.

## 3. What the module handles itself

| Concern | How the module handles it |
|---------|---------------------------|
| Android `minSdk` | Every Android plugin the module uses needs no more than the host's Flutter default. The camera uses Camera2 (`camera_android`) rather than CameraX, which can need more (D-54) |
| Android backups | The local store lives in the app's `no_backup` folder, which backups always skip. No backup rules needed |
| Restores, reinstalls, lost keys (any platform) | A store that can never be opened again is moved aside intact and a new one starts; the move is reported. Nothing is deleted, and the module never gets stuck (D-52) |
| Secure storage | The module's own Android preferences file (`fess_pos_secure_store`), its own iOS Keychain service (`fess_pos`) and web prefix. It never reads, writes or wipes the host's entries |
| Global state | No global error handlers, no app-wide Sentry, no Supabase or Firebase access, no host navigator or app state |
| Font | Montserrat is bundled as a package font; it never clashes with the host's copy |
| Permissions wording | The host's existing camera and location usage strings stay. The module explains each permission on its own screen before the system prompt (with T4-01 / T4-07) |
| Microphone | Not used: the camera opens with audio off, and no audio permission is requested |
| R8 / ProGuard | No rules needed: checked with a release build |
| iOS SQLCipher | When the host also links the system SQLite (FESS does, through `sqflite` and Firebase), SQLCipher would never be linked. The module's own pod (`ios/fess_pos.podspec`, link settings only) makes the linker require a function only SQLCipher has, so SQLCipher is always linked; `pod install` applies it, and the host's project is untouched. Verified in a FESS-shaped app. **Effect on the host:** the app's other SQLite users (FESS's `sqflite`, Firebase) then run on SQLCipher's SQLite engine — still plain and unencrypted, with compatible files, because SQLCipher encrypts only with a key. If anything ever regressed, the module refuses to store anything in clear (`LOCAL_STORE_NOT_ENCRYPTED`) |

## 4. Web (preview now, fallback later)

- The web build must serve `sqlite3.wasm` (from the `sqlite3` 2.9.x release) and `drift_worker.js` (drift 2.31's web
  worker) next to `index.html`. The module will bundle them (T3-24); until then the web build compiles but the local
  store can't open.
- The web store isn't encrypted, and every web record carries `client_type = web` (planning pack `docs/13` §8).

## 5. Files the module keeps

| What | Where |
|------|-------|
| Local database (SQLCipher) | Android: `<app data>/no_backup/fess_pos/fess_pos.db`; elsewhere `<app support dir>/fess_pos/fess_pos.db`; plus `-wal` and `-shm` |
| Stores moved aside | `…/fess_pos/quarantine/` |
| Database key, bootstrap cache, device id, POS sessions | Secure storage, keys prefixed `fess_pos.` |
