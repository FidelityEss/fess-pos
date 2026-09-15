import 'package:meta/meta.dart';

/// Below this much free space the phone can't store another photo (a
/// canonical photo is a few MB), so the camera doesn't open. A technical
/// floor, not policy: the policy is [StorageBudget].
const int captureFloorBytes = 16 * 1024 * 1024;

/// How the phone's storage stands (docs/08 §5): what the module's folder
/// takes, and what the phone has free.
@immutable
class StorageUse {
  const StorageUse({required this.usedBytes, this.freeBytes});

  /// Nothing known: it counts as room, so an unreadable storage figure
  /// never stops work.
  static const StorageUse unknown = StorageUse(usedBytes: 0);

  final int usedBytes;

  /// Null where the platform can't say (the web).
  final int? freeBytes;
}

/// What the storage config allows (docs/08 §5): the module's cap
/// (`storage.cap_mb`) and the share of it at which new inspections stop
/// (`storage.block_new_work_at_pct`).
@immutable
class StorageBudget {
  const StorageBudget({required this.capBytes, required this.blockAtPct});

  factory StorageBudget.ofMb(int capMb, int blockAtPct) => StorageBudget(
    capBytes: capMb * 1024 * 1024,
    blockAtPct: blockAtPct,
  );

  final int capBytes;
  final int blockAtPct;

  /// New inspections stop once the module's folder reaches this.
  int get blockAtBytes => capBytes * blockAtPct ~/ 100;

  /// The room the cap keeps for work already under way.
  int get headroomBytes => capBytes - blockAtBytes;

  /// Whether a new inspection may start: the module's folder is below
  /// [blockAtBytes], and the phone has [headroomBytes] free to finish it.
  bool allowsNewWork(StorageUse use) {
    final free = use.freeBytes;
    return use.usedBytes < blockAtBytes &&
        (free == null || free >= headroomBytes);
  }
}

/// Whether the phone can store another photo.
bool canCapture(StorageUse use) {
  final free = use.freeBytes;
  return free == null || free >= captureFloorBytes;
}
