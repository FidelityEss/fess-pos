import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/contract/identity.dart';
import 'package:meta/meta.dart';

/// What a POS session allows (docs/03 §3, docs/07 §2).
enum PosSessionScope {
  /// Everything the agent's permissions allow.
  full,

  /// Uploads only: after sign-out or deactivation, queued work still drains.
  ingestOnly,
}

@immutable
class PosSessionInfo {
  const PosSessionInfo({
    required this.scope,
    this.uiAccess = true,
    this.offline = false,
  });

  final PosSessionScope scope;

  /// Whether this session may show the POS UI. False after sign-out, or
  /// after the host's identity was refused; uploads carry on regardless.
  final bool uiAccess;

  /// Signed in from the session stored on the device because the POS API
  /// couldn't be reached. The exchange runs again on the next sign-in.
  final bool offline;
}

/// Turns the host's identity into a module-owned POS session.
///
/// The POS API client implements it (`data/remote/`): `POST
/// /v1/auth/exchange`, then refresh without the host.
abstract interface class SessionGateway {
  /// Exchanges the host's identity token for a POS session.
  Future<PosSessionInfo> exchange(PosIdentity identity);

  /// Ends UI access. The session drops to `ingestOnly`, so queued work keeps
  /// uploading.
  Future<void> endUiAccess();

  /// The current user's session as known now, or null when there is none or
  /// it can't be used again (the host must sign in again).
  PosSessionInfo? get current;

  /// Runs the exchange again, with the identity from the last sign-in, if
  /// the last one was longer ago than [every] (`auth.reverify_hours`,
  /// docs/07 §2). Never throws.
  Future<void> reverifyIfDue(Duration every);
}

/// For builds without the POS API client: signing in fails with
/// [PosErrorCodes.authUnavailable] and nothing else happens.
class UnavailableSessionGateway implements SessionGateway {
  const UnavailableSessionGateway();

  @override
  Future<PosSessionInfo> exchange(PosIdentity identity) => Future.error(
    const PosException(
      PosErrorCodes.authUnavailable,
      'this build has no POS API client',
      kind: PosErrorKind.unsupported,
      retryable: false,
    ),
  );

  @override
  Future<void> endUiAccess() async {}

  @override
  PosSessionInfo? get current => null;

  @override
  Future<void> reverifyIfDue(Duration every) async {}
}
