import 'package:fess_pos/src/contract/access.dart';
import 'package:fess_pos/src/contract/host_config.dart';
import 'package:fess_pos/src/contract/identity.dart';
import 'package:fess_pos/src/contract/module_info.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/core/version.dart';
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
  /// logout path. `purge: true` isn't available yet and deletes nothing.
  static Future<void> signOut({bool purge = false}) async {
    await ModuleRuntime.current?.signOut(purge: purge);
  }

  /// Whether the host should show its POS entry point.
  static Future<PosAccess> access() async =>
      ModuleRuntime.current?.access() ??
      const PosAccess(PosAccessReason.notInitialized);

  /// The POS home. The host pushes it as a route.
  static Widget entryPoint() => const PosEntryPoint();

  /// Push messages tagged `source: fess_pos`. Returns whether the message
  /// was the module's. Push is only a hint to sync soon; opening a job from
  /// it arrives with T2-19.
  static Future<bool> handlePushPayload(Map<String, dynamic> message) async {
    if (message['source'] != 'fess_pos') return false;
    _log.debug('push hint received');
    ModuleRuntime.current?.nudgeSync();
    return true;
  }

  /// Deep links under `<host-scheme>/pos/…`. Returns whether the link was
  /// the module's (navigation from T2-19).
  static Future<bool> handleDeepLink(Uri uri) async {
    final segments = uri.pathSegments;
    final isPos =
        (segments.isNotEmpty && segments.first == 'pos') || uri.host == 'pos';
    if (isPos) _log.debug('deep link received');
    return isPos;
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
  );
}
