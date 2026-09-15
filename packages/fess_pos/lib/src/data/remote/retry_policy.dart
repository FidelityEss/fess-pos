import 'dart:math';

import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/data/remote/api_exception.dart';
import 'package:meta/meta.dart';

/// What a caller does after a failed POS API call (docs/12 §4, docs/08 §3).
///
/// None of these drops data: every local copy is kept until a durable
/// receipt says the server holds it.
enum FailureAction {
  /// Nothing is known, or the server asked to come back later. Back off and
  /// retry, forever.
  retry,

  /// The access token expired or wasn't accepted. Refresh the session, then
  /// retry.
  refreshSession,

  /// The batch was too big. Split it and send the halves.
  splitBatch,

  /// This session can't be used again. Hold everything and wait for the host
  /// to sign the user in again.
  signInAgain,

  /// The server refuses this call for this session, e.g. a pull after
  /// sign-out. Stop making this call until the session changes; uploads are
  /// allowed separately and carry on.
  denied,

  /// A retry can't fix it: a client bug, or a request the server won't
  /// take. Park the item as needs-attention and report it; never drop it.
  park,
}

/// Codes after which a session can never be used again. Only a new exchange
/// (the host signing the user in) replaces it.
const Set<String> sessionEndingCodes = {
  'INVALID_REFRESH',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'DEVICE_REVOKED',
  'DEVICE_MISMATCH',
  PosErrorCodes.sessionEnded,
  PosErrorCodes.notSignedIn,
};

/// Codes by which the POS API refuses the host's identity at the exchange.
/// The user's stored session then loses UI access (docs/07 §2).
const Set<String> identityRefusedCodes = {
  'INVALID_HOST_TOKEN',
  'HOST_TOKEN_TOO_OLD',
  'UNKNOWN_IDENTITY',
  'ACCOUNT_INACTIVE',
  'ISSUER_NOT_ACCEPTED',
};

/// Maps a failure to what to do next.
FailureAction classifyFailure(PosException e) {
  final status = e is PosApiException ? e.status : null;
  if (sessionEndingCodes.contains(e.code)) return FailureAction.signInAgain;
  if (e.code == 'TOKEN_EXPIRED' || e.code == 'UNAUTHENTICATED') {
    return FailureAction.refreshSession;
  }
  if (e.code == 'PAYLOAD_TOO_LARGE' || status == 413) {
    return FailureAction.splitBatch;
  }
  if (const {'FORBIDDEN', 'SCOPE_INSUFFICIENT'}.contains(e.code)) {
    return FailureAction.denied;
  }
  if (e.retryable) return FailureAction.retry;
  return FailureAction.park;
}

/// Exponential backoff with full jitter: 2 s doubling to a 15-minute cap,
/// never sooner than the server's `Retry-After` (docs/12 §4).
@immutable
class Backoff {
  const Backoff({
    this.base = const Duration(seconds: 2),
    this.cap = const Duration(minutes: 15),
  });

  final Duration base;
  final Duration cap;

  static final Random _random = Random();

  /// The wait before retry number [attempt] (1 = the first retry): a random
  /// time up to `min(cap, base × 2^(attempt − 1))`, and at least
  /// [retryAfter], which is itself capped at [cap] so a bad header can't
  /// stall delivery.
  Duration delay(int attempt, {Duration? retryAfter, Random? random}) {
    final exponent = min(max(attempt, 1) - 1, 30);
    final ceilingMs = min(
      cap.inMilliseconds,
      base.inMilliseconds * pow(2, exponent).toInt(),
    );
    final jittered = Duration(
      milliseconds: ((random ?? _random).nextDouble() * ceilingMs).round(),
    );
    if (retryAfter == null) return jittered;
    final floor = retryAfter > cap ? cap : retryAfter;
    return jittered > floor ? jittered : floor;
  }
}

/// The state of a [CircuitBreaker].
enum CircuitState { closed, open, halfOpen }

/// Stops calling an endpoint group that keeps failing, so an outage doesn't
/// drain the battery (docs/08 §3).
///
/// After [failureThreshold] failures in a row that say nothing reached the
/// POS API (no network, timeouts, 5xx, 429) the breaker opens for
/// [openFor]. Then one trial call may go: success closes it, failure opens
/// it again for twice as long, up to [maxOpenFor]. Any real answer from the
/// API, even an error, counts as success: the server is reachable.
class CircuitBreaker {
  CircuitBreaker({
    this.failureThreshold = 5,
    this.openFor = const Duration(seconds: 30),
    this.maxOpenFor = const Duration(minutes: 5),
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now,
       _nextOpen = openFor;

  final int failureThreshold;
  final Duration openFor;
  final Duration maxOpenFor;
  final DateTime Function() _clock;

  int _failures = 0;
  DateTime? _openUntil;
  Duration _nextOpen;
  bool _trialInFlight = false;

  CircuitState get state {
    final until = _openUntil;
    if (until == null) return CircuitState.closed;
    return _clock().isBefore(until) ? CircuitState.open : CircuitState.halfOpen;
  }

  /// Null when a call may go now, otherwise how long until the next trial.
  /// A null answer in the half-open state claims the single trial, so the
  /// caller must report the outcome.
  Duration? blockedFor() {
    final until = _openUntil;
    if (until == null) return null;
    final now = _clock();
    if (now.isBefore(until)) return until.difference(now);
    if (_trialInFlight) return const Duration(seconds: 1);
    _trialInFlight = true;
    return null;
  }

  /// The API answered.
  void recordSuccess() {
    _failures = 0;
    _openUntil = null;
    _nextOpen = openFor;
    _trialInFlight = false;
  }

  /// Nothing reached the API.
  void recordFailure() {
    if (_trialInFlight) {
      _trialInFlight = false;
      _open();
      return;
    }
    _failures++;
    if (_failures >= failureThreshold) _open();
  }

  /// The call ended without saying anything about the API (a local error).
  void recordNeutral() => _trialInFlight = false;

  void _open() {
    _openUntil = _clock().add(_nextOpen);
    final doubled = _nextOpen * 2;
    _nextOpen = doubled > maxOpenFor ? maxOpenFor : doubled;
  }
}
