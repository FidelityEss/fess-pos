import 'package:meta/meta.dart';

/// What kind of failure a [PosException] reports.
enum PosErrorKind {
  /// The host passed an invalid configuration.
  config,

  /// A call was made before `PosModule.initialize` finished.
  notInitialized,

  /// Identity or session problems: the exchange was refused, the session
  /// was revoked.
  auth,

  /// The network couldn't be reached, or a request timed out.
  network,

  /// The POS API answered with an error.
  server,

  /// The module's local store couldn't be used. Captured data is kept.
  localStore,

  /// A device capability (camera, location, storage) failed or is missing.
  platform,

  /// The operation isn't available in this build or on this platform.
  unsupported,

  /// A bug in the module.
  internal,
}

/// The one error type the module throws.
///
/// Every error says whether a retry can succeed
/// (docs/DEVELOPMENT-GUIDELINES.md §2). [message] is for developers and logs:
/// it is never shown to agents as-is and never contains personal data.
@immutable
class PosException implements Exception {
  const PosException(
    this.code,
    this.message, {
    required this.kind,
    required this.retryable,
    this.requestId,
    this.details,
    this.cause,
  });

  /// Reads a POS API error body (`schema/api/error.schema.json`):
  /// `{"error": {"code", "message", "retryable", "details"?}, "request_id"}`.
  ///
  /// A body that doesn't match gets the code
  /// [PosErrorCodes.apiErrorMalformed], and its retryability comes from the
  /// HTTP status.
  factory PosException.fromApiError(
    Object? body, {
    required int status,
    String? requestId,
  }) {
    final kind = status == 401 || status == 403
        ? PosErrorKind.auth
        : PosErrorKind.server;
    if (body is Map<Object?, Object?>) {
      final rid = body['request_id'];
      final error = body['error'];
      if (error is Map<Object?, Object?>) {
        final code = error['code'];
        final message = error['message'];
        final retryable = error['retryable'];
        if (code is String && message is String && retryable is bool) {
          return PosException(
            code,
            message,
            kind: kind,
            retryable: retryable,
            requestId: rid is String ? rid : requestId,
            details: error['details'],
          );
        }
      }
    }
    return PosException(
      PosErrorCodes.apiErrorMalformed,
      'the POS API returned HTTP $status without a valid error body',
      kind: kind,
      retryable: isRetryableStatus(status),
      requestId: requestId,
    );
  }

  /// Retryable HTTP statuses when the body doesn't say (docs/12 §4).
  static bool isRetryableStatus(int status) =>
      status == 408 || status == 429 || status >= 500;

  /// Stable, UPPER_SNAKE. The POS API's codes pass through unchanged.
  final String code;
  final String message;
  final PosErrorKind kind;
  final bool retryable;

  /// The `x-pos-request-id` of the failing request, if there was one.
  final String? requestId;
  final Object? details;
  final Object? cause;

  @override
  String toString() =>
      'PosException($code, ${kind.name}, retryable: $retryable): $message';
}

/// Codes the module raises itself. API codes are passed through as sent.
abstract final class PosErrorCodes {
  static const String notInitialized = 'NOT_INITIALIZED';
  static const String alreadyInitialized = 'ALREADY_INITIALIZED';
  static const String bootstrapInvalid = 'BOOTSTRAP_INVALID';
  static const String notSupported = 'NOT_SUPPORTED';
  static const String authUnavailable = 'AUTH_UNAVAILABLE';
  static const String apiErrorMalformed = 'API_ERROR_MALFORMED';

  /// Nothing reached the POS API: no network, or the connection failed.
  static const String networkUnavailable = 'NETWORK_UNAVAILABLE';

  /// The POS API didn't answer in time.
  static const String requestTimeout = 'REQUEST_TIMEOUT';

  /// A 2xx answer that isn't a JSON object, e.g. a captive portal's page.
  static const String responseMalformed = 'RESPONSE_MALFORMED';

  /// The POS API kept failing, so calls pause for a while (docs/08 §3).
  static const String circuitOpen = 'CIRCUIT_OPEN';

  /// No POS session on this device for that user.
  static const String notSignedIn = 'NOT_SIGNED_IN';

  /// The POS session can't be used again; the host must sign in again.
  static const String sessionEnded = 'SESSION_ENDED';

  /// The host's `getIdentityToken` callback failed.
  static const String hostTokenUnavailable = 'HOST_TOKEN_UNAVAILABLE';

  /// The module's secure storage couldn't be read or written right now.
  static const String secureStoreUnavailable = 'SECURE_STORE_UNAVAILABLE';
  static const String localStoreNotEncrypted = 'LOCAL_STORE_NOT_ENCRYPTED';
  static const String localStoreKeyMissing = 'LOCAL_STORE_KEY_MISSING';
  static const String localStoreKeyUnreadable = 'LOCAL_STORE_KEY_UNREADABLE';
  static const String localStoreKeyRejected = 'LOCAL_STORE_KEY_REJECTED';
  static const String localStoreUnavailable = 'LOCAL_STORE_UNAVAILABLE';
  static const String localStoreSchemaNewer = 'LOCAL_STORE_SCHEMA_NEWER';
  static const String cameraUnavailable = 'CAMERA_UNAVAILABLE';
  static const String cameraFailed = 'CAMERA_FAILED';
}
