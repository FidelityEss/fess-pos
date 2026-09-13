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
cd example && flutter test integration_test -d <device>    # real SQLCipher, on a device or emulator
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

Signing in waits for the POS API client (T1-21): until then `signIn` fails with `AUTH_UNAVAILABLE`.
