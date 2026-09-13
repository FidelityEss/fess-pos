/// Background sync scheduling (docs/08 §7, D-36): WorkManager and an
/// expedited `dataSync` foreground service on Android, BGAppRefresh and a
/// background URLSession on iOS. Only through the host's explicit
/// `PosModule.registerBackgroundWork()` call.
abstract interface class BackgroundWorkScheduler {
  bool get supported;

  Future<void> register();
}

/// Stands in until T5-01 builds the real scheduler. The web has no
/// background work by design (docs/13 §8).
class UnavailableBackgroundWork implements BackgroundWorkScheduler {
  const UnavailableBackgroundWork();

  @override
  bool get supported => false;

  @override
  Future<void> register() async {}
}
