import 'package:fess_pos/src/contract/access.dart';
import 'package:fess_pos/src/contract/capabilities.dart';
import 'package:fess_pos/src/contract/events.dart';
import 'package:fess_pos/src/contract/host_config.dart';
import 'package:fess_pos/src/contract/identity.dart';
import 'package:fess_pos/src/contract/module_info.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/domain/navigation/pos_link.dart';
import 'package:fess_pos/src/features/preview/preview_entry.dart';
import 'package:fess_pos/src/features/shell/pos_entry_point.dart';
import 'package:fess_pos/src/platform/background_work.dart';
import 'package:flutter/widgets.dart';

const PosLogger _log = PosLogger('module');

/// The module's entire public API (docs/03 §3).
///
/// A host calls [initialize] once at startup, [signIn] when its user is
/// ready, shows its entry point when [access] says so, and pushes
/// [entryPoint]. After that the module needs nothing from the host.
abstract final class PosModule {
  /// Starts the module. Call once, at host startup.
  ///
  /// Throws `BOOTSTRAP_INVALID` for a bad API URL or a key that isn't a
  /// publishable key, and `ALREADY_INITIALIZED` for a second call with a
  /// different config.
  static Future<void> initialize(PosHostConfig config) =>
      ModuleRuntime.start(config);

  /// Exchanges the host's identity for a module-owned POS session.
  /// Call on host login, or when the user's profile is ready.
  static Future<PosAccess> signIn(PosIdentity identity) async =>
      ModuleRuntime.require.signIn(identity);

  /// Ends UI access; queued work keeps uploading. Call from every host
  /// logout path. `purge: true` isn't available yet (D-21) and deletes
  /// nothing.
  static Future<void> signOut({bool purge = false}) async {
    await ModuleRuntime.current?.signOut(purge: purge);
  }

  /// How many items haven't reached the server yet: envelopes and photos.
  /// A host can warn with it before its sign-out. Uploads carry on after
  /// sign-out, so nothing is lost either way. 0 before [initialize].
  static Future<int> pendingWork() async =>
      await ModuleRuntime.current?.pendingWork() ?? 0;

  /// Whether the host should show its POS entry point.
  static Future<PosAccess> access() async =>
      ModuleRuntime.current?.access() ??
      const PosAccess(PosAccessReason.notInitialized);

  /// The POS home. The host pushes it as a route.
  static Widget entryPoint() => const PosEntryPoint();

  /// The preview app (T3-08, docs/04 §10): what the admin's definitions
  /// studio embeds from the module's web build. It needs no [initialize]
  /// or sign-in. It draws the drafts the embedding page sends, from one of
  /// [allowedOrigins] (its own origin when none are given), in a sandbox
  /// that reads no store, calls no server and records nothing.
  static Widget previewEntryPoint({List<String> allowedOrigins = const []}) =>
      PosPreviewEntry(allowedOrigins: allowedOrigins);

  /// Push messages the host forwards: the `data` of a message tagged
  /// `source: fess_pos`. Push only hints that there is something to sync
  /// (payloads are content-free, docs/07 §8), so the module syncs soon and
  /// reads nothing more into it. Returns whether the message was the
  /// module's. Safe before [initialize] and in a background isolate: the
  /// next sync picks the change up.
  static Future<bool> handlePushPayload(Map<String, dynamic> message) async {
    if (message['source'] != 'fess_pos') return false;
    final hint = message['hint'];
    final runtime = ModuleRuntime.current;
    _log.debug('push hint received');
    runtime?.emit(
      PosEvent(
        PosEvent.pushReceived,
        properties: {
          if (hint is String && _hint.hasMatch(hint)) 'hint': hint,
        },
      ),
    );
    runtime?.syncSoon();
    return true;
  }

  static final RegExp _hint = RegExp(r'^[a-z_]{1,40}$');

  /// Deep links under `/pos/…` on either host scheme: `…/pos` (home),
  /// `…/pos/job/<id>`, `…/pos/card` and `…/pos/preview/<token>` (a draft
  /// to preview, docs/04 §10). Returns whether the link was the
  /// module's. When it was, push [entryPoint] if it isn't showing: it opens
  /// the page as soon as the agent is signed in.
  static Future<bool> handleDeepLink(Uri uri) async {
    final link = PosLink.parse(uri);
    if (link == null) return false;
    _log.debug('deep link received (${link.page})');
    ModuleRuntime.current?.openLink(link);
    return true;
  }

  /// Registers the module's background sync with the platform. The host
  /// calls it once in `main()` (D-36). Not wired yet (T5-01).
  static Future<void> registerBackgroundWork() async {
    final scheduler =
        ModuleRuntime.current?.dependencies.platform.backgroundWork ??
        const UnavailableBackgroundWork();
    if (!scheduler.supported) {
      _log.info('background work is not available yet (T5-01)');
      return;
    }
    await scheduler.register();
  }

  /// Runs one sync, for a host that owns its own background dispatcher
  /// (D-36): sends what is queued and pulls if the user is signed in. The
  /// module's own background scheduling is T5-01.
  static Future<void> runBackgroundSync() async {
    await ModuleRuntime.current?.runSync(keepRunning: false);
  }

  /// What this build of the module is and supports.
  static PosModuleInfo get info => PosModuleInfo(
    moduleVersion: PosVersions.module,
    apiVersion: PosVersions.api,
    specVersion: PosVersions.spec,
    components: supportedFormComponents,
  );
}
