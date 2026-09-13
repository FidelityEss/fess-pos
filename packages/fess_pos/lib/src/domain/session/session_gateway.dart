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
  const PosSessionInfo({required this.scope});

  final PosSessionScope scope;
}

/// Turns the host's identity into a module-owned POS session.
///
/// The POS API client implements it (T1-21): `POST /v1/auth/exchange`, then
/// refresh without the host.
abstract interface class SessionGateway {
  /// Exchanges the host's identity token for a POS session.
  Future<PosSessionInfo> exchange(PosIdentity identity);

  /// Ends UI access. The session drops to `ingestOnly`, so queued work keeps
  /// uploading.
  Future<void> endUiAccess();
}

/// Stands in until the POS API client exists (T1-21): signing in fails with
/// [PosErrorCodes.authUnavailable] and nothing else happens.
class UnavailableSessionGateway implements SessionGateway {
  const UnavailableSessionGateway();

  @override
  Future<PosSessionInfo> exchange(PosIdentity identity) => Future.error(
    const PosException(
      PosErrorCodes.authUnavailable,
      'signing in needs the POS API client, which is not built yet (T1-21)',
      kind: PosErrorKind.unsupported,
      retryable: false,
    ),
  );

  @override
  Future<void> endUiAccess() async {}
}
