# Host integration — fess_pos

What a host app must add to use the module. Flutter packages can't declare these themselves, so this file is the
module's host-specific documentation (planning pack `docs/03` §3). Items marked **(later)** arrive with the task named.

## 1. Dependency

```yaml
dependencies:
  fess_pos:
    git:
      url: https://github.com/FidelityEss/fess-pos.git
      path: packages/fess_pos
      ref: <release tag>
```

- **Toolchain floor:** Dart ≥ 3.8, Flutter ≥ 3.29 (the FESS app's floor).
- **Versions:** the module accepts FESS's pins and overrides: `geolocator 14.0.1`, `flutter_secure_storage 9.2.4`,
  `device_info_plus 11.5.0`, `package_info_plus 8.0.2`, `http 1.4.0`, `uuid ^4`. No `dependency_overrides` should be needed.
- **The engine:** `fess_pos` depends on `packages/fess_pos_engine` in the same repository by relative path. If pub
  doesn't resolve that from the git checkout, add `fess_pos_engine` as a second git dependency with
  `path: packages/fess_pos_engine` and the same ref. To be confirmed in the integration spike (T7-01).

## 2. Code

Keep it in one hand-written file (FESS: e.g. `lib/custom_code/pos_integration.dart`), with one-line calls from the
generated files, so FlutterFlow regeneration can't lose it.

| When | Call |
|------|------|
| Startup, after `WidgetsFlutterBinding.ensureInitialized()` | `await PosModule.initialize(PosHostConfig(bootstrap: …, onUserActivity: …, onEvent: …))` |
| Once in `main()` | `PosModule.registerBackgroundWork()` **(later: T5-01; a no-op until then)** |
| Login, and whenever the host token is refreshed | `PosModule.signIn(PosIdentity(profile: …, getIdentityToken: …))` **(needs the POS API client, T1-21; until then it fails with `AUTH_UNAVAILABLE`)** |
| Every logout path, including forced and 401 sign-outs | `PosModule.signOut()` |
| Showing the POS tile | only when `(await PosModule.access()).visible` |
| Opening POS | push a route with `PosModule.entryPoint()` |
| A push message with `data.source == 'fess_pos'` | `PosModule.handlePushPayload(data)` |
| A deep link under `/pos/…` | `PosModule.handleDeepLink(uri)` |

- **Bootstrap:** the API URL, the **publishable** key and the environment come from the build flavour
  (`--dart-define`). `initialize` refuses a non-HTTPS URL and anything that looks like a secret or service-role key.
- **Idle timer:** `onUserActivity` fires (at most every 5 s) while the agent uses the module, so the host can reset
  its own PIN or idle lock.
- **Don't** wrap the entry point in a `ProviderScope`: the module brings its own. The module installs no global error
  handlers, doesn't initialise the app-wide Sentry hub, and never touches the host's Supabase, Firebase, navigator or
  app state.

## 3. Android

- **minSdk:** 21 or higher (camera, SQLCipher). FESS doesn't set it explicitly: confirm the effective value in T7-01.
- **Permissions:** `CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `INTERNET` (FESS already declares
  them). No `RECORD_AUDIO`: the camera is opened with audio off. **(later: T5-01)** `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_DATA_SYNC`.
- **R8 / ProGuard:** no rules are known to be needed. SQLCipher's native library is loaded through FFI. Confirm with a
  release build in T7-01.
- **Secure storage:** the module's items live in their own shared-preferences file, `fess_pos_secure_store`, with keys
  prefixed `fess_pos_`. The module never reads, writes or wipes the host's storage.
- **Backups (recommended):** exclude the module's files from Android backup. A database restored onto another device
  can't be opened without its Keystore key, so the module refuses it (`LOCAL_STORE_KEY_MISSING`) rather than replace it.

  ```xml
  <exclude domain="file" path="fess_pos/" />
  <exclude domain="sharedpref" path="fess_pos_secure_store.xml" />
  ```

## 4. iOS

- **Deployment target:** iOS 14 (as FESS).
- **Info.plist:** `NSCameraUsageDescription` and `NSLocationWhenInUseUsageDescription`, worded for site inspections. No
  microphone, no background location.
- **SQLCipher:** `sqlcipher_flutter_libs` links the SQLCipher pod. If the app also links the system SQLite (FESS does,
  through `sqflite`), the system library can shadow SQLCipher under static frameworks. The module checks
  `PRAGMA cipher_version` every time it opens its store, and refuses to store anything if SQLCipher isn't active
  (`LOCAL_STORE_NOT_ENCRYPTED`). Please drop the unused direct `sqflite` dependency. Android is verified by
  `example/integration_test/local_store_test.dart`; an iOS build shaped like FESS's is spike T1-41.
- **Keychain:** the module's items use the service `fess_pos`, readable after the first unlock following a restart
  (so background sync can run) and never restored onto another device.
- **(later: T5-01)** `BGTaskSchedulerPermittedIdentifiers` and the `processing` background mode.

## 5. Web (preview now, fallback later)

- The web build must serve `sqlite3.wasm` (from the `sqlite3` 2.9.x release matching the resolved version) and
  `drift_worker.js` (drift 2.31's web worker) next to `index.html`. They aren't bundled yet (T3-24): until they are,
  the web build compiles but the local store can't open.
- The web store isn't encrypted, and every web record carries `client_type = web` (planning pack `docs/13` §8).

## 6. Files the module keeps

| What | Where |
|------|-------|
| Local database (SQLCipher) | `<app support dir>/fess_pos/fess_pos.db`, plus `-wal` and `-shm` |
| Database key, bootstrap cache, later the session | Secure storage, keys prefixed `fess_pos.` |

The module never deletes local data to make itself start. If its store can't be opened, it reports the failure and
keeps the file.
