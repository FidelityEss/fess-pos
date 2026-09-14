import 'dart:math';

import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/data/remote/api_exception.dart';
import 'package:fess_pos/src/data/remote/retry_policy.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_pos_api.dart';

PosApiException _api(String code, {int? status, bool retryable = false}) =>
    PosApiException(
      code,
      'test',
      kind: PosErrorKind.server,
      retryable: retryable,
      endpoint: '/ingest',
      status: status,
    );

class _FixedRandom implements Random {
  _FixedRandom(this.value);

  final double value;

  @override
  double nextDouble() => value;

  @override
  int nextInt(int max) => (value * max).floor();

  @override
  bool nextBool() => value >= 0.5;
}

void main() {
  group('classifyFailure (docs/12 §4)', () {
    final cases = <PosException, FailureAction>{
      _api(PosErrorCodes.networkUnavailable, retryable: true):
          FailureAction.retry,
      _api(PosErrorCodes.requestTimeout, retryable: true): FailureAction.retry,
      _api('UNAVAILABLE', status: 503, retryable: true): FailureAction.retry,
      _api('RATE_LIMITED', status: 429, retryable: true): FailureAction.retry,
      _api('EVIDENCE_NOT_LANDED', status: 409, retryable: true):
          FailureAction.retry,
      _api('TOKEN_EXPIRED', status: 401, retryable: true):
          FailureAction.refreshSession,
      _api('UNAUTHENTICATED', status: 401): FailureAction.refreshSession,
      _api('PAYLOAD_TOO_LARGE', status: 413): FailureAction.splitBatch,
      _api('SESSION_REVOKED', status: 403): FailureAction.signInAgain,
      _api('DEVICE_REVOKED', status: 403): FailureAction.signInAgain,
      _api('INVALID_REFRESH', status: 401): FailureAction.signInAgain,
      _api('SESSION_EXPIRED', status: 401): FailureAction.signInAgain,
      _api('SCOPE_INSUFFICIENT', status: 403): FailureAction.denied,
      _api('FORBIDDEN', status: 403): FailureAction.denied,
      _api('INVALID_REQUEST', status: 400): FailureAction.park,
      _api('INVALID_ENVELOPE', status: 400): FailureAction.park,
      const PosException(
        PosErrorCodes.secureStoreUnavailable,
        'locked',
        kind: PosErrorKind.localStore,
        retryable: true,
      ): FailureAction.retry,
    };
    for (final c in cases.entries) {
      test('${c.key.code} → ${c.value.name}', () {
        expect(classifyFailure(c.key), c.value);
      });
    }
  });

  group('Backoff', () {
    const backoff = Backoff();

    test('full jitter, doubling from 2 s', () {
      expect(backoff.delay(1, random: _FixedRandom(0.5)), seconds(1));
      expect(backoff.delay(3, random: _FixedRandom(0.5)), seconds(4));
      expect(backoff.delay(1, random: _FixedRandom(0)), Duration.zero);
    });

    test('never beyond 15 minutes, however many attempts', () {
      for (final attempt in [10, 31, 1000]) {
        expect(
          backoff.delay(attempt, random: _FixedRandom(0.999999)),
          lessThanOrEqualTo(const Duration(minutes: 15)),
        );
      }
    });

    test("never sooner than the server's Retry-After, itself capped", () {
      expect(
        backoff.delay(1, retryAfter: seconds(30), random: _FixedRandom(0.1)),
        seconds(30),
      );
      expect(
        backoff.delay(
          1,
          retryAfter: const Duration(hours: 2),
          random: _FixedRandom(0.1),
        ),
        const Duration(minutes: 15),
      );
    });
  });

  group('CircuitBreaker', () {
    late TestClock clock;
    late CircuitBreaker breaker;

    setUp(() {
      clock = TestClock();
      breaker = CircuitBreaker(clock: clock.call);
    });

    test('opens after five failures in a row', () {
      for (var i = 0; i < 4; i++) {
        breaker.recordFailure();
      }
      expect(breaker.blockedFor(), isNull);
      breaker.recordFailure();
      expect(breaker.state, CircuitState.open);
      expect(breaker.blockedFor(), seconds(30));
    });

    test('a success in between starts the count again', () {
      for (var i = 0; i < 4; i++) {
        breaker.recordFailure();
      }
      breaker
        ..recordSuccess()
        ..recordFailure();
      expect(breaker.state, CircuitState.closed);
    });

    test('one trial when the wait is over; success closes it', () {
      for (var i = 0; i < 5; i++) {
        breaker.recordFailure();
      }
      clock.advance(seconds(30));
      expect(breaker.state, CircuitState.halfOpen);
      expect(breaker.blockedFor(), isNull);
      expect(breaker.blockedFor(), isNotNull, reason: 'one trial at a time');
      breaker.recordSuccess();
      expect(breaker.state, CircuitState.closed);
      expect(breaker.blockedFor(), isNull);
    });

    test('a failed trial waits twice as long, up to 5 minutes', () {
      for (var i = 0; i < 5; i++) {
        breaker.recordFailure();
      }
      var wait = seconds(30);
      for (final next in [60, 120, 240, 300, 300]) {
        clock.advance(wait);
        expect(breaker.blockedFor(), isNull);
        breaker.recordFailure();
        wait = seconds(next);
        expect(breaker.blockedFor(), wait);
      }
    });

    test('a trial that ends without a verdict frees the next trial', () {
      for (var i = 0; i < 5; i++) {
        breaker.recordFailure();
      }
      clock.advance(seconds(30));
      expect(breaker.blockedFor(), isNull);
      breaker.recordNeutral();
      expect(breaker.blockedFor(), isNull);
    });
  });

  test('Retry-After is read in seconds only', () {
    expect(parseRetryAfter('30'), seconds(30));
    expect(parseRetryAfter(' 5 '), seconds(5));
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT'), isNull);
    expect(parseRetryAfter('-1'), isNull);
    expect(parseRetryAfter(null), isNull);
  });
}

Duration seconds(int s) => Duration(seconds: s);
