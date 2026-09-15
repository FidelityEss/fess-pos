import 'package:meta/meta.dart';

/// Why the host entry point is shown or hidden.
enum PosAccessReason {
  /// POS is available to this user.
  available,

  /// `PosModule.initialize` hasn't completed.
  notInitialized,

  /// Nobody is signed in to POS on this device.
  notSignedIn,

  /// Switched off remotely (`pos.enabled = false`, docs/13 §6). Uploads of
  /// captured data carry on regardless.
  disabled,
}

/// Whether the host should show its POS entry point, and why.
@immutable
class PosAccess {
  const PosAccess(this.reason);

  final PosAccessReason reason;

  bool get visible => reason == PosAccessReason.available;

  @override
  bool operator ==(Object other) =>
      other is PosAccess && other.reason == reason;

  @override
  int get hashCode => reason.hashCode;

  @override
  String toString() => 'PosAccess(${reason.name})';
}
