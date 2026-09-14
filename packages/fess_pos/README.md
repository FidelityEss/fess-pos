# fess_pos

The FESS POS merchant site-verification module: a host-agnostic Flutter package, and the only package a host depends on
(`docs/03` §3). The host passes a bootstrap, the user's identity and optional theme and push settings, mounts the entry
point, and forwards push messages and deep links. Everything else comes from the POS API at runtime.

```dart
await PosModule.initialize(PosHostConfig(bootstrap: PosBootstrap(
  apiBaseUrl: Uri.parse('https://<ref>.supabase.co/functions/v1/api'),
  publishableKey: 'sb_publishable_…',
  environment: PosEnvironment.qa,
)));
final access = await PosModule.signIn(identity);   // on host login
if (access.visible) Navigator.of(context).push(MaterialPageRoute(builder: (_) => PosModule.entryPoint()));
```

What a host must declare (permissions, plist keys, ProGuard rules, minimum SDKs) is in `HOST_INTEGRATION.md`.

## Rules the code keeps

- **Public API:** only `lib/fess_pos.dart`; nothing in `lib/src/` is part of the contract.
- **No global side effects:** no `Supabase`, no global error handlers, no `Sentry.init` (the module has its own Sentry
  `Hub`), no root `ProviderScope`, no host globals. `test/no_global_side_effects_test.dart` and
  `test/architecture_test.dart` enforce this.
- **Web-ready:** `dart:io` and `dart:ffi` only under `lib/src/platform/`.
- **Configuration, not code:** copy, thresholds and switches come from the server. The shell's few strings are bundled
  defaults (`core/content/bundled_copy.dart`) until content definitions arrive (T3-05).
- **The FESS look** comes from `schema/design/tokens.json` via the generated `lib/src/core/theme/tokens.g.dart`
  (`docs/14`).

## Layout (`docs/03` §2)

| Folder | What it holds |
|--------|---------------|
| `lib/src/contract/` | The public types: bootstrap, identity, host config, theme, events, access, errors, module info |
| `lib/src/bootstrap/` | Tiny defensive startup: cached kill switches and client mode, bootstrap validation. No feature imports |
| `lib/src/core/` | Runtime and DI (Riverpod, in a module-owned container), logging, observability, theme, bundled copy |
| `lib/src/domain/` | Entities and interfaces (the session gateway so far) |
| `lib/src/data/local/` | The local store: drift schema and migrations (`pos_database.dart`), opening and its failure handling |
| `lib/src/data/remote/` | The POS API client: transport, failure classes and backoff, circuit breakers, sessions in secure storage, signing in. Nothing else talks HTTP |
| `lib/src/platform/` | Every plugin, behind interfaces: secure storage, connectivity, location, camera, device info, module files, integrity and background work (stand-ins until T4-09 / T5-01), and opening the encrypted database. `dart:io` lives only here |
| `lib/src/features/` | Screens: the shell and its placeholder home for now |
| `lib/src/renderer/`, `evidence/`, `location/` | Arrive with their tasks |
| `drift_schemas/` | One schema dump per released database version, for migration tests |
| `tool/generate_tokens.dart` | Regenerates the design tokens |
| `example/` | The harness host |

## Working on it

```bash
flutter pub get
flutter analyze
flutter test
dart run tool/generate_tokens.dart                     # after changing schema/design/tokens.json
dart run build_runner build --delete-conflicting-outputs   # after changing the drift schema
dart run drift_dev make-migrations                     # after bumping the schema version
cd example && flutter test integration_test -d <device>    # on a device or emulator: SQLCipher, store recovery, camera
```

Against QA (never production), with a QA host token from `tools/scenarios/module-harness.ts` (`docs/15` §8 in the
planning pack):

```bash
POS_LIVE_CONFIG=$HOME/.fess-pos/module-harness-qa.json flutter test test/live/qa_live_test.dart   # the API client, end to end
cd example && flutter run --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json         # the harness, signed in
cd example && flutter test integration_test -d <device> --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json
cd example && flutter build apk --release --target lib/self_check.dart   # release (R8) build checks:
# install it, start it, then read `adb logcat -d -s flutter | grep POS_SELF_CHECK` (see lib/self_check.dart)
```

Generated code (`*.g.dart`) is committed: a host consumes the package from git and never runs codegen.

Flutter must run outside the agent sandbox (`docs/15` §4). The dependency floor is the FESS app's: Dart ≥ 3.8,
Flutter ≥ 3.29, with lower bounds at or below FESS's locked versions (`docs/03` §7).

## Status

Built (2026-09-13, in review):
- **T1-18, skeleton:** the public contract, bootstrap layer, DI, error model, scoped Sentry hub and theme;
- **T1-19, platform adapters:** native implementations that also build for web, plus explicit stand-ins where the real
  one comes later;
- **T1-20, local store:** drift + SQLCipher, key in secure storage, fail-closed checks, WAL + `synchronous=FULL`,
  migrations. Its policy is D-52 in the planning pack.

Also built (T1-42, T2-33): the module needs nothing from the host beyond wiring it in (D-55).
- **Montserrat** is bundled (`assets/fonts/montserrat`, SIL OFL 1.1).
- **Camera:** the camera's platform packages are used directly, so Android gets Camera2, whose `minSdk` always matches the host's Flutter default (D-54).
- **Local store:** it lives outside Android backups, and a store that can never be opened again is moved aside intact while a new one starts (D-52).
- **iOS:** the package is also an iOS pod with link settings only (`ios/fess_pos.podspec`). It forces SQLCipher to link even when the host links the system SQLite, as FESS does (T1-41).

Also built (T1-21, 2026-09-14): the POS API client and signing in (D-56). There is no sign-in screen: `signIn` swaps
the host's token for the module's own session, works offline for a user who signed in on the phone before, and keeps
each user's session so their captured work uploads under it. The harness app signs in to QA with the stand-in issuer.

Also built (T1-22, T1-23, T1-29, 2026-09-14; D-57, D-58):
- **Outbox** (`lib/src/data/outbox/`, local schema 2): every agent action is written with its envelope in one
  transaction, guarded against double taps; sent in lane order, kept until a receipt says the server holds it,
  retried forever with backoff, parked and reported if the server can never take it.
- **Pull and sync** (`lib/src/data/sync/`): the resolved remote config (checked against the config schema, bundled
  defaults behind it, kill switches refreshed), envelope outcomes, restore re-send; the sync engine runs after sign-in,
  on the config's intervals, when the network returns and on a push hint.

Next: jobs on the phone (T2-14).
