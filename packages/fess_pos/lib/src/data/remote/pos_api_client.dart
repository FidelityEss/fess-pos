import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/data/remote/api_exception.dart';
import 'package:fess_pos/src/data/remote/api_transport.dart';
import 'package:fess_pos/src/data/remote/retry_policy.dart';
import 'package:fess_pos/src/data/remote/session_vault.dart';
import 'package:fess_pos/src/domain/session/session_gateway.dart';

const PosLogger _log = PosLogger('api');

/// The endpoint groups a [CircuitBreaker] watches (docs/08 §3). Sign-in
/// calls have none: they are rare, the host starts them, and a failed one
/// falls back to the stored session.
abstract final class EndpointGroup {
  static const String sync = 'sync';
  static const String ingest = 'ingest';
  static const String device = 'device';
}

/// The POS API for the module (docs/03 §4): the session (exchange, refresh,
/// sign-out) and the agent endpoints, each call authorised with the right
/// user's session.
///
/// - The access token is refreshed a minute before it expires, and once more
///   if the server says it expired. Concurrent refreshes share one request,
///   because refresh tokens rotate and a reused one revokes the session.
/// - A session the server ends for good (revoked, expired, another device)
///   is marked ended and kept; its user's work waits for a new sign-in.
/// - Calls fail with a [PosException] whose [classifyFailure] tells the
///   caller what to do. This class never retries on its own beyond the one
///   refresh, and never drops anything.
class PosApiClient {
  PosApiClient({
    required this.transport,
    required this.vault,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  /// Refresh when the access token has less than this left.
  static const Duration refreshAhead = Duration(seconds: 60);

  final ApiTransport transport;
  final SessionVault vault;
  final DateTime Function() _clock;
  final Map<String, Future<StoredSession>> _refreshing = {};
  final Map<String, CircuitBreaker> _breakers = {};

  CircuitBreaker breaker(String group) =>
      _breakers.putIfAbsent(group, () => CircuitBreaker(clock: _clock));

  /// `POST /v1/auth/exchange`: stores the new session and makes its user the
  /// current one. A previous user's session loses UI access and is signed
  /// out (to `ingest_only`) on the server, but kept for their uploads.
  Future<StoredSession> exchange(
    Map<String, Object?> request, {
    required String issuer,
  }) async {
    final response = await transport.post('/auth/exchange', request);
    final now = _clock();
    final session = StoredSession.fromTokens(
      response.body,
      issuer: issuer,
      receivedAt: now,
      verifiedAt: now,
    );
    await vault.update((book) {
      var next = book;
      final previous = book.active;
      if (previous != null &&
          previous.user.id != session.user.id &&
          previous.usable) {
        next = next.put(
          previous.copyWith(uiAccess: false, signOutPending: true),
        );
      }
      return next.put(session).activate(session.user.id);
    });
    if (response.body['profile_mismatch'] != null) {
      _log.warning('the host profile differs from the verified identity');
    }
    return session;
  }

  /// Rotates [userId]'s refresh token. One refresh at a time per user.
  Future<StoredSession> refresh(String userId) =>
      _refreshing[userId] ??= _refresh(userId).whenComplete(() {
        // A block, not `=> remove(...)`: whenComplete would wait on the
        // removed future, which is this one.
        _refreshing.remove(userId);
      });

  /// Ends UI access for [userId]: stored at once, and sent to the server
  /// now or before that user's next call (`POST /v1/auth/signout`).
  Future<void> endUiAccess(String userId) async {
    final session = (await vault.read()).sessions[userId];
    if (session == null || !session.usable) return;
    // Always change the latest copy: a stale one could carry a refresh
    // token that has already rotated.
    await vault.update((book) {
      final latest = book.sessions[userId];
      if (latest == null) return book;
      return book.put(latest.copyWith(uiAccess: false, signOutPending: true));
    });
    await _sendSignOut(userId);
  }

  /// Sends every pending sign-out except [except]'s. Failures wait for the
  /// next attempt.
  Future<void> sendPendingSignOuts({String? except}) async {
    final book = await vault.read();
    for (final s in book.sessions.values) {
      if (s.user.id == except || !s.signOutPending || !s.usable) continue;
      await _sendSignOut(s.user.id);
    }
  }

  /// `POST /v1/sync/pull` for [userId] (default: the current user).
  Future<Map<String, Object?>> pull(
    Map<String, Object?> request, {
    String? userId,
  }) async => (await _agentCall(
    '/sync/pull',
    request,
    group: EndpointGroup.sync,
    userId: userId,
  )).body;

  /// `POST /v1/ingest`: 1–50 envelopes, sent with the session of the user
  /// who captured them.
  Future<ApiResponse> ingest(
    List<Map<String, Object?>> envelopes, {
    required String userId,
  }) => _agentCall(
    '/ingest',
    {'envelopes': envelopes},
    group: EndpointGroup.ingest,
    userId: userId,
  );

  /// `POST /v1/device`: the push token and versions (D-50).
  Future<Map<String, Object?>> updateDevice(
    Map<String, Object?> fields, {
    String? userId,
  }) async => (await _agentCall(
    '/device',
    fields,
    group: EndpointGroup.device,
    userId: userId,
  )).body;

  /// `GET /v1/health`: no session needed.
  Future<Map<String, Object?>> health() async =>
      (await transport.get('/health')).body;

  void close() => transport.close();

  Future<StoredSession> _refresh(String userId) async {
    final current = await _session(userId);
    final ApiResponse response;
    try {
      response = await transport.post('/auth/refresh', {
        'refresh_token': current.refreshToken,
        'device_id': await vault.deviceId(),
      });
    } on PosException catch (e) {
      if (sessionEndingCodes.contains(e.code)) await _end(userId, e.code);
      rethrow;
    }
    final next = current.rotated(response.body, receivedAt: _clock());
    await vault.update((book) => book.put(_merge(book, next)));
    return next;
  }

  /// Keeps flags that changed while the refresh was in flight.
  StoredSession _merge(SessionBook book, StoredSession refreshed) {
    final latest = book.sessions[refreshed.user.id];
    if (latest == null) return refreshed;
    return refreshed.copyWith(
      uiAccess: refreshed.uiAccess && latest.uiAccess,
      signOutPending: latest.signOutPending,
    );
  }

  Future<ApiResponse> _agentCall(
    String path,
    Object body, {
    required String group,
    String? userId,
  }) async {
    final id =
        userId ??
        (await vault.read()).activeUserId ??
        (throw const PosException(
          PosErrorCodes.notSignedIn,
          'no POS session on this device',
          kind: PosErrorKind.auth,
          retryable: false,
        ));
    var session = await _session(id);
    if (session.signOutPending) {
      await _sendSignOut(id);
      session = await _session(id);
    }
    final gate = breaker(group);
    final wait = gate.blockedFor();
    if (wait != null) {
      throw PosApiException(
        PosErrorCodes.circuitOpen,
        'the POS API keeps failing; waiting before the next try',
        kind: PosErrorKind.network,
        retryable: true,
        endpoint: path,
        retryAfter: wait,
      );
    }
    try {
      final response = await _withFreshToken(
        id,
        session,
        (token) => transport.post(path, body, accessToken: token),
      );
      gate.recordSuccess();
      return response;
    } on PosApiException catch (e) {
      if (_nothingReachedApi(e)) {
        gate.recordFailure();
      } else {
        gate.recordSuccess();
      }
      await _noteRefusal(id, e);
      rethrow;
    } on Object {
      gate.recordNeutral();
      rethrow;
    }
  }

  Future<ApiResponse> _withFreshToken(
    String userId,
    StoredSession session,
    Future<ApiResponse> Function(String accessToken) call,
  ) async {
    var s = session;
    if (!s.accessValidAt(_clock(), refreshAhead)) s = await refresh(userId);
    try {
      return await call(s.accessToken);
    } on PosApiException catch (e) {
      if (e.code != 'TOKEN_EXPIRED' && e.code != 'UNAUTHENTICATED') rethrow;
      // Another call may have refreshed already; only refresh if not.
      final latest = await _session(userId);
      s = latest.accessToken != s.accessToken ? latest : await refresh(userId);
      return call(s.accessToken);
    }
  }

  Future<void> _sendSignOut(String userId) async {
    final session = (await vault.read()).sessions[userId];
    if (session == null || !session.usable) return;
    try {
      await _withFreshToken(
        userId,
        session,
        (token) => transport.post(
          '/auth/signout',
          const <String, Object?>{},
          accessToken: token,
        ),
      );
      await vault.update((book) {
        final latest = book.sessions[userId];
        if (latest == null) return book;
        return book.put(
          latest.copyWith(
            scope: PosSessionScope.ingestOnly,
            uiAccess: false,
            signOutPending: false,
          ),
        );
      });
      _log.info('signed out on the server; uploads continue');
    } on PosException catch (e) {
      if (sessionEndingCodes.contains(e.code)) {
        await _end(userId, e.code);
        return;
      }
      _log.info('sign-out not sent yet (${e.code}); trying again later');
    }
  }

  Future<StoredSession> _session(String userId) async {
    final session = (await vault.read()).sessions[userId];
    if (session == null) {
      throw const PosException(
        PosErrorCodes.notSignedIn,
        'no POS session for this user on this device',
        kind: PosErrorKind.auth,
        retryable: false,
      );
    }
    if (!session.usable) {
      throw PosException(
        PosErrorCodes.sessionEnded,
        'the POS session ended (${session.endedBy}); sign in again',
        kind: PosErrorKind.auth,
        retryable: false,
      );
    }
    return session;
  }

  Future<void> _noteRefusal(String userId, PosException e) async {
    if (sessionEndingCodes.contains(e.code)) {
      await _end(userId, e.code);
    } else if (e.code == 'SCOPE_INSUFFICIENT') {
      await vault.update((book) {
        final s = book.sessions[userId];
        if (s == null) return book;
        return book.put(
          s.copyWith(scope: PosSessionScope.ingestOnly, uiAccess: false),
        );
      });
    }
  }

  Future<void> _end(String userId, String code) async {
    await vault.update((book) {
      final s = book.sessions[userId];
      if (s == null || !s.usable) return book;
      return book.put(s.ended(code));
    });
    _log.warning('POS session ended ($code); work waits for a new sign-in');
  }

  static bool _nothingReachedApi(PosApiException e) {
    final status = e.status;
    return status == null ||
        status == 429 ||
        status >= 500 ||
        e.code == PosErrorCodes.apiErrorMalformed;
  }
}
