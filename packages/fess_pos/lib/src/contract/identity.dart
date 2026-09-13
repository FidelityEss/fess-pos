import 'package:meta/meta.dart';

/// The signed-in user as the host knows them: a display and audit snapshot
/// ONLY. It never authorises anything; authorisation comes from the verified
/// identity token (docs/03 §3, docs/07 §2). Its final shape is D-04.
@immutable
class PosUserProfile {
  PosUserProfile({
    required this.employeeNumber,
    required this.firstName,
    required this.lastName,
    this.email,
    this.phone,
    this.photoUrl,
    Map<String, String> extra = const {},
  }) : extra = Map.unmodifiable(extra);

  final String employeeNumber;
  final String firstName;
  final String lastName;
  final String? email;
  final String? phone;
  final String? photoUrl;

  /// Forward-compatible extra fields (D-04).
  final Map<String, String> extra;

  /// Deliberately content-free: profiles hold personal data.
  @override
  String toString() => 'PosUserProfile(…)';
}

/// A token the POS API can verify with the host's identity service.
@immutable
class PosIdentityToken {
  const PosIdentityToken({
    required this.token,
    required this.issuer,
    this.issuedAt,
    this.secondaryToken,
  });

  /// The host's API token (FESS: the FESS auth API token). Required.
  final String token;

  /// Keys into the POS `trusted_issuers` list, e.g. `fess_auth_api`.
  final String issuer;

  /// When the host obtained the token, if it knows.
  final DateTime? issuedAt;

  /// An optional second signal (FESS: a Firebase ID token). Never enough on
  /// its own.
  final String? secondaryToken;

  @override
  String toString() => 'PosIdentityToken($issuer, token: …)';
}

/// What the host passes at sign-in.
@immutable
class PosIdentity {
  const PosIdentity({required this.profile, required this.getIdentityToken});

  final PosUserProfile profile;

  /// Called at sign-in and re-link only. After that the module owns its
  /// session and never needs the host again (docs/03 §3).
  final Future<PosIdentityToken> Function() getIdentityToken;
}
