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
- **Configuration, not code:** copy, thresholds, switches and screen content come from the server. The bundled strings
  (`core/content/bundled_copy.dart`), views (`core/content/bundled_views.dart`) and remote-config defaults (generated
  from `schema/config`) only cover a first run until the server's arrive.
- **Layers:** screens (`features/`) and the renderer never import `data/`; they use domain interfaces through the
  providers in `core/di/`. Only `data/remote/` talks HTTP.
- **The FESS look** comes from `schema/design/tokens.json` via the generated `lib/src/core/theme/tokens.g.dart`
  (`docs/14`).

## Layout (`docs/03` §2)

| Folder | What it holds |
|--------|---------------|
| `lib/src/contract/` | The public types: bootstrap, identity, host config, theme, events, access, errors, module info |
| `lib/src/bootstrap/` | Tiny defensive startup: cached kill switches and client mode, bootstrap validation. No feature imports |
| `lib/src/core/` | Runtime and DI (Riverpod, in a module-owned container, with the providers screens use), logging, observability, theme, remote config (`config/`, with the generated bundled defaults and bounds), bundled copy and views |
| `lib/src/domain/` | Entities and interfaces: the session gateway, jobs and job actions, definitions, the agent, reason codes (with their mapping to form options), map tiles and authorisation cards |
| `lib/src/data/local/` | The local store: drift schema and migrations (`pos_database.dart`, schema 4), opening and its failure handling, the repositories screens read through, job actions and the map tile cache |
| `lib/src/data/remote/` | The POS API client: transport, failure classes and backoff, circuit breakers, sessions in secure storage, signing in |
| `lib/src/data/outbox/` | The transactional outbox: envelopes, the sender, receipts, parking, and the single-flight action recorder |
| `lib/src/data/sync/` | The pull engine, its sections (jobs and reviews, definitions, job cards) and the sync engine that runs send → pull → purge |
| `lib/src/platform/` | Every plugin, behind interfaces: secure storage, connectivity, location, camera, device info, module files, integrity and background work (stand-ins until T4-09 / T5-01), and opening the encrypted database. `dart:io` lives only here |
| `lib/src/renderer/` | The view renderer: draws a `view` definition's items, with `visible` rules on the Dart rules engine. `form/`: the form renderer (`FormView`) and its state (`FormController`), resolved and validated by the Dart form engine. `cards.dart`: the authorisation cards and their QR |
| `lib/src/features/` | Screens: the shell (entry point, header), jobs (home, job detail, actions, reason forms, outcomes), maps (preview, full map, directions) and cards (the agent card page) |
| `lib/src/evidence/`, `location/` | Arrive with their tasks |
| `drift_schemas/`, `test/drift/` | One schema dump per database version, and the generated migration tests |
| `tool/generate_tokens.dart`, `tool/generate_config_defaults.dart` | Regenerate the design tokens and the remote-config defaults |
| `test/live/` | Tests against QA, skipped unless `POS_LIVE_CONFIG` is set |
| `example/` | The harness host; `integration_test/` holds the device tests |

## Working on it

```bash
flutter pub get
flutter analyze
flutter test
dart run tool/generate_tokens.dart                     # after changing schema/design/tokens.json
dart run tool/generate_config_defaults.dart            # after changing schema/config/
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

## Status (2026-09-14)

Decision numbers (D-xx) are in the planning pack's `docs/09-open-decisions.md`.

Done (T1-01, T1-18 to T1-20):
- **skeleton:** the public contract, bootstrap layer, DI, error model, scoped Sentry hub and theme;
- **platform adapters:** native implementations that also build for web, plus explicit stand-ins where the real one
  comes later;
- **local store:** drift + SQLCipher, key in secure storage, fail-closed checks, WAL + `synchronous=FULL`,
  migrations (D-52).

In review (T1-41, T1-42, T2-33): the module needs nothing from the host beyond wiring it in (D-55).
- **Montserrat** is bundled (`assets/fonts/montserrat`, SIL OFL 1.1).
- **Camera:** the camera's platform packages are used directly, so Android gets Camera2, whose `minSdk` always matches the host's Flutter default (D-54).
- **Local store:** it lives outside Android backups, and a store that can never be opened again is moved aside intact while a new one starts (D-52).
- **iOS:** the package is also an iOS pod with link settings only (`ios/fess_pos.podspec`). It forces SQLCipher to link even when the host links the system SQLite, as FESS does (T1-41).

In review (T1-21, T1-24): the POS API client and signing in (D-56). There is no sign-in screen: `signIn` swaps
the host's token for the module's own session, works offline for a user who signed in on the phone before, and keeps
each user's session so their captured work uploads under it. The harness app signs in to QA with the stand-in issuer.

In review (T1-22, T1-23, T1-29; D-57, D-58):
- **Outbox** (`lib/src/data/outbox/`, local schema 2): every agent action is written with its envelope in one
  transaction, guarded against double taps; sent in lane order, kept until a receipt says the server holds it,
  retried forever with backoff, parked and reported if the server can never take it.
- **Pull and sync** (`lib/src/data/sync/`): the resolved remote config (checked against the config schema, bundled
  defaults behind it, kill switches refreshed), envelope outcomes, restore re-send; the sync engine runs after sign-in,
  on the config's intervals, when the network returns and on a push hint.

In review (T2-14; D-59): **jobs on the phone.** The pull keeps the agent's jobs, review outcomes and
the definitions in force (each checked against its hash). The home page draws the server's `home` view over the
jobs, a job opens the `job_detail` view, and bundled views cover a first run. View rules run on the Dart rules engine
(`fess_pos_engine`, the same fixture contract as the TypeScript engine). The renderer (`lib/src/renderer/`) draws
16 view components so far; maps, cards and actions come with T2-16 to T2-18.

In review (T2-15; D-60): **forms.** The form renderer (`lib/src/renderer/form/`) draws text, textarea, boolean,
single and multi select, info, callout, divider and group fields. Every answer re-resolves the form with the Dart form
engine, so what shows, what is required and which options are offered follow the rules as the agent goes. The
problems are the server's own: the engine is ported from the TypeScript one, with the same codes and the same
fixtures. Reason codes from the pull become the options of `options_source: reason_codes`, with `requires_note` and
`requires_photo` for `option_meta` rules.

In review (T2-16; D-61): **accept, "can't take this job" and "unable to complete".** The job page offers what the
job allows. Accepting records at once; the other two open the bank's reason form. Each action writes the job's new
status on the phone and its `job_event` in one transaction, once however often it's tapped, and a pull can't undo it
until the server has it. The outcome page says whether the server has it, whether it's saved on the phone to send
later, or why it wasn't done. Known gap: the unable reasons that need a photo wait for photo capture.

In review (T2-17; D-62): **the map.** The job page shows the job's location on a small map that opens a full one,
and **Directions** hands over to the phone's maps app. Tiles come from the provider in remote config
(`maps.tile_url`); the tiles around each job the agent may visit are kept on the phone after every sync, so the map
works on site without signal. Until a provider is configured the pin shows without a map, and directions still work.
`flutter_map` stays at 8.1.x until FESS moves past `http` 1.4.0 and `path_provider` 2.1.4.

In review (T2-18; D-63): **authorisation cards.** The home page shows the agent's card, which opens in full: name,
employee number, role, status and a QR that opens the public verify page for the token the server issued. Each job
page shows the card for that visit. Cards work offline until their token expires, then say so and hide the QR. The
photo waits for the server to send one (T2-34); until then the card shows initials.

Tested: 427 unit and widget tests; the live test against QA; 5 device tests against QA (SQLCipher, store recovery,
camera, QA sign-in, the QA job list), last run on the Android emulator and the iPhone 17 simulator on 2026-09-14.

Next: push and deep links (T2-19). Known gap: a session refresh whose answer is lost ends the session until the next sign-in (R-44,
backend fix T1-43).
