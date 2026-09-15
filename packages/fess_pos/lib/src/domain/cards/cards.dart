import 'package:fess_pos/src/core/version.dart';
import 'package:meta/meta.dart';

final RegExp _hexToken = RegExp(r'^[0-9a-f]{32,128}$');

/// An authorisation card's QR token as the server issued it (docs/07 §10):
/// the QR opens the public verify page for it. Short-lived, rotated while
/// online, and valid offline until [validTo], so a screenshot goes stale.
@immutable
class CardToken {
  const CardToken({required this.token, required this.validTo});

  /// From `{token, valid_to}`; null when malformed.
  static CardToken? tryParse(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final token = json['token'];
    final validTo = json['valid_to'];
    if (token is! String || !_hexToken.hasMatch(token) || validTo is! String) {
      return null;
    }
    final at = DateTime.tryParse(validTo);
    return at == null ? null : CardToken(token: token, validTo: at);
  }

  final String token;
  final DateTime validTo;

  bool validAt(DateTime now) => validTo.isAfter(now);

  Map<String, Object?> toJson() => {
    'token': token,
    'valid_to': validTo.toUtc().toIso8601String(),
  };

  // The token is a bearer secret for the verify page: never in logs.
  @override
  String toString() => 'CardToken(valid to $validTo)';
}

/// The public verify page for [token] on the POS API
/// (`GET /v1/public/verify/{token}`, docs/07 §10).
Uri verifyUrl(Uri apiBase, String token) {
  final base = apiBase.path.endsWith('/')
      ? apiBase.path.substring(0, apiBase.path.length - 1)
      : apiBase.path;
  return apiBase.replace(
    path: '$base/v${PosVersions.api}/public/verify/$token',
  );
}

/// The authorisation cards on this device (B2.6).
abstract interface class CardRepository {
  /// The agent's card token from the last pull, live.
  Stream<CardToken?> watchAgentCard();

  /// The card token for the job [jobId], live.
  Stream<CardToken?> watchJobCard(String jobId);
}
