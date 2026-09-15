import 'package:workmanager/workmanager.dart';

/// Background sync scheduling (docs/08 §7, D-36, D-94): a periodic sync,
/// and one more sync when the app is left with work the server doesn't
/// hold yet. WorkManager on Android, BGAppRefresh and a short background
/// run on iOS. Only through the host's explicit
/// `PosModule.registerBackgroundWork()` call.
abstract interface class BackgroundWorkScheduler {
  bool get supported;

  /// Registers [dispatcher], the top-level function the platform starts in
  /// the background, and the periodic sync.
  Future<void> register(void Function() dispatcher);

  /// One sync as soon as there is a network, for work the server doesn't
  /// hold yet when the app is left.
  Future<void> syncSoon();
}

/// The background tasks the module schedules. [periodicSync] is also the
/// iOS task identifier the host lists in Info.plist (HOST_INTEGRATION §6).
abstract final class BackgroundTasks {
  static const String periodicSync = 'fess_pos.sync';
  static const String syncSoon = 'fess_pos.sync_soon';
}

/// `workmanager` 0.7, the last line on the FESS toolchain floor (D-51,
/// D-94). No expedited work: 0.7 gives no foreground notification, which
/// expedited work needs before Android 12.
class WorkmanagerBackgroundWork implements BackgroundWorkScheduler {
  const WorkmanagerBackgroundWork();

  @override
  bool get supported => true;

  @override
  Future<void> register(void Function() dispatcher) async {
    await Workmanager().initialize(dispatcher);
    await Workmanager().registerPeriodicTask(
      BackgroundTasks.periodicSync,
      BackgroundTasks.periodicSync,
      // The Android minimum. iOS takes its interval from the host's
      // AppDelegate instead.
      frequency: const Duration(minutes: 15),
      constraints: Constraints(networkType: NetworkType.connected),
      existingWorkPolicy: ExistingWorkPolicy.keep,
    );
  }

  @override
  Future<void> syncSoon() => Workmanager().registerOneOffTask(
    BackgroundTasks.syncSoon,
    BackgroundTasks.syncSoon,
    constraints: Constraints(networkType: NetworkType.connected),
    existingWorkPolicy: ExistingWorkPolicy.keep,
  );
}

/// Hands each background task this isolate was started for to [handler]:
/// the body of the module's background dispatcher. [handler] says whether
/// the task is done; false has Android try it again later.
void runBackgroundTasks(Future<bool> Function(String task) handler) =>
    Workmanager().executeTask((task, _) => handler(task));

/// Where there is no background work: the web by design (docs/13 §8), and
/// tests.
class UnavailableBackgroundWork implements BackgroundWorkScheduler {
  const UnavailableBackgroundWork();

  @override
  bool get supported => false;

  @override
  Future<void> register(void Function() dispatcher) async {}

  @override
  Future<void> syncSoon() async {}
}
