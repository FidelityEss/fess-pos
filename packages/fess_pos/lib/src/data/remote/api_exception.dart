import 'package:fess_pos/src/contract/errors.dart';

/// A POS API call that failed, with what the transport knows about it.
///
/// Still a [PosException], so a host sees one error type. [status] is null
/// when no answer arrived (no network, a timeout, a captive portal): nothing
/// is known about what the server did, so the call is retried (docs/12 §4).
class PosApiException extends PosException {
  const PosApiException(
    super.code,
    super.message, {
    required super.kind,
    required super.retryable,
    required this.endpoint,
    this.status,
    this.retryAfter,
    super.requestId,
    super.details,
    super.cause,
  });

  /// An error answer. A body that isn't a POS API error didn't come from the
  /// POS API (a proxy, a captive portal, a CDN page), so it counts as no
  /// answer and is retryable whatever its status.
  factory PosApiException.fromResponse(
    Object? body, {
    required int status,
    required String endpoint,
    String? requestId,
    Duration? retryAfter,
  }) {
    final e = PosException.fromApiError(
      body,
      status: status,
      requestId: requestId,
    );
    final notFromApi = e.code == PosErrorCodes.apiErrorMalformed;
    return PosApiException(
      e.code,
      e.message,
      kind: notFromApi ? PosErrorKind.network : e.kind,
      retryable: notFromApi || e.retryable,
      endpoint: endpoint,
      status: status,
      retryAfter: retryAfter,
      requestId: e.requestId,
      details: e.details,
    );
  }

  /// The API path, e.g. `/sync/pull`.
  final String endpoint;

  /// The HTTP status, or null when no answer arrived.
  final int? status;

  /// The server's `Retry-After`, when it sent one.
  final Duration? retryAfter;

  @override
  String toString() =>
      'PosApiException($code, $endpoint, status: ${status ?? '-'}, '
      'retryable: $retryable): $message';
}

/// Reads a `Retry-After` header given in seconds, the form the POS API
/// sends. An HTTP date isn't read (it would need `dart:io`); the caller's
/// backoff applies instead.
Duration? parseRetryAfter(String? header) {
  final seconds = int.tryParse(header?.trim() ?? '');
  if (seconds == null || seconds < 0) return null;
  return Duration(seconds: seconds);
}
