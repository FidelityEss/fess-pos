import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/data/remote/api_exception.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/remote/retry_policy.dart';
import 'package:fess_pos/src/domain/session/session_gateway.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../../support/fake_pos_api.dart';
import '../../support/test_host.dart';

void main() {
  late FakePosApi api;
  late TestClock clock;
  late PosApiClient client;

  setUp(() {
    api = FakePosApi();
    clock = TestClock();
    client = testApiClient(api, clock: clock);
  });

  Future<void> signIn({
    String userId = 'u-1',
    String employeeNumber = 'E0001',
    String accessToken = 'access-1',
    DateTime? serverTime,
  }) async {
    api
      ..reset('/auth/exchange')
      ..on(
        '/auth/exchange',
        (_) => jsonResponse(
          200,
          sessionAnswer(
            serverTime: serverTime ?? clock.now,
            userId: userId,
            employeeNumber: employeeNumber,
            accessToken: accessToken,
          ),
        ),
      );
    await client.exchange({
      'issuer': 'pos_dev',
      'token': 'host-token',
      'device': {'device_id': testDeviceId},
    }, issuer: 'pos_dev');
  }

  void answerRefresh({String accessToken = 'access-2'}) => api.on(
    '/auth/refresh',
    (_) => jsonResponse(
      200,
      sessionAnswer(
        serverTime: clock.now,
        accessToken: accessToken,
        refreshToken: refreshToken2,
      ),
    ),
  );

  final ok = jsonResponse(200, <String, Object?>{});
  http.Response okAnswer(http.Request _) => ok;

  group('exchange', () {
    test('stores the session and makes its user current', () async {
      await signIn();
      final active = client.vault.cached!.active!;
      expect(active.user.id, 'u-1');
      expect(active.scope, PosSessionScope.full);
      expect(active.uiAccess, isTrue);
    });

    test('expiry is kept on the device clock', () async {
      // The phone's clock is an hour ahead of the server's.
      await signIn(serverTime: clock.now.subtract(const Duration(hours: 1)));
      expect(
        client.vault.cached!.active!.accessExpiresAt,
        clock.now.add(const Duration(minutes: 15)),
      );
    });

    test("another user's sign-in keeps the first user's session", () async {
      await signIn();
      await signIn(userId: 'u-2', employeeNumber: 'E0002');
      final book = client.vault.cached!;
      expect(book.activeUserId, 'u-2');
      final first = book.sessions['u-1']!;
      expect(first.usable, isTrue, reason: 'their uploads still need it');
      expect(first.uiAccess, isFalse);
      expect(first.signOutPending, isTrue);
    });
  });

  group('agent calls', () {
    test('carry the key, a request id and the access token', () async {
      await signIn();
      api.on('/sync/pull', okAnswer);
      await client.pull({});
      final r = api.calls('/sync/pull').single;
      expect(r.headers['apikey'], testBootstrap.publishableKey);
      expect(r.headers['authorization'], 'Bearer access-1');
      expect(
        r.headers['x-pos-request-id'],
        matches(RegExp(r'^[A-Za-z0-9._:-]{8,80}$')),
      );
    });

    test('refresh a minute before the access token expires', () async {
      await signIn();
      answerRefresh();
      api.on('/sync/pull', okAnswer);
      clock.advance(const Duration(minutes: 14, seconds: 30));
      await client.pull({});
      expect(bodyOf(api.calls('/auth/refresh').single), {
        'refresh_token': refreshToken1,
        'device_id': testDeviceId,
      });
      expect(
        api.calls('/sync/pull').single.headers['authorization'],
        'Bearer access-2',
      );
      expect(client.vault.cached!.active!.refreshToken, refreshToken2);
    });

    test('an expired token is refreshed once and the call repeated', () async {
      await signIn();
      api
        ..on(
          '/sync/pull',
          (_) => jsonResponse(401, apiError('TOKEN_EXPIRED', retryable: true)),
        )
        ..on('/sync/pull', (_) => jsonResponse(200, {'page': 1}));
      answerRefresh();
      expect(await client.pull({}), {'page': 1});
      expect(api.calls('/auth/refresh'), hasLength(1));
      expect(
        api.calls('/sync/pull').map((r) => r.headers['authorization']),
        ['Bearer access-1', 'Bearer access-2'],
      );
    });

    test('concurrent calls share one refresh', () async {
      await signIn();
      api
        ..on('/auth/refresh', (_) async {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          return jsonResponse(
            200,
            sessionAnswer(serverTime: clock.now, accessToken: 'access-2'),
          );
        })
        ..on('/sync/pull', okAnswer)
        ..on('/device', okAnswer);
      clock.advance(const Duration(minutes: 15));
      await Future.wait([
        client.pull({}),
        client.pull({}),
        client.updateDevice({'module_version': '0.1.0'}),
      ]);
      expect(api.calls('/auth/refresh'), hasLength(1));
    });

    test('a revoked session is ended, kept, and stops calling', () async {
      await signIn();
      api.on(
        '/auth/refresh',
        (_) => jsonResponse(403, apiError('SESSION_REVOKED')),
      );
      clock.advance(const Duration(minutes: 15));
      await expectLater(client.pull({}), throwsPosCode('SESSION_REVOKED'));
      final ended = client.vault.cached!.sessions['u-1']!;
      expect(ended.endedBy, 'SESSION_REVOKED');
      expect(ended.uiAccess, isFalse);
      final sent = api.requests.length;
      await expectLater(
        client.pull({}),
        throwsPosCode(PosErrorCodes.sessionEnded),
      );
      expect(api.requests, hasLength(sent));
    });

    test('a refresh with no answer leaves the session as it was', () async {
      await signIn();
      api.on('/auth/refresh', (_) => throw http.ClientException('offline'));
      clock.advance(const Duration(minutes: 15));
      await expectLater(
        client.pull({}),
        throwsPosCode(PosErrorCodes.networkUnavailable),
      );
      final s = client.vault.cached!.active!;
      expect(s.usable, isTrue);
      expect(s.refreshToken, refreshToken1);
    });

    test('SCOPE_INSUFFICIENT narrows the session to uploads', () async {
      await signIn();
      api.on(
        '/sync/pull',
        (_) => jsonResponse(403, apiError('SCOPE_INSUFFICIENT')),
      );
      try {
        await client.pull({});
        fail('expected SCOPE_INSUFFICIENT');
      } on PosException catch (e) {
        expect(classifyFailure(e), FailureAction.denied);
      }
      final s = client.vault.cached!.active!;
      expect(s.scope, PosSessionScope.ingestOnly);
      expect(s.uiAccess, isFalse);
      expect(s.usable, isTrue);
    });

    test('uploads go with the session of the user who captured them', () async {
      await signIn();
      await signIn(userId: 'u-2', employeeNumber: 'E0002', accessToken: 'b');
      api
        ..on(
          '/auth/signout',
          (_) => jsonResponse(200, {'scope': 'ingest_only'}),
        )
        ..on('/ingest', okAnswer);
      await client.ingest([
        {'id': 'e1'},
      ], userId: 'u-1');
      expect(
        api.calls('/auth/signout').single.headers['authorization'],
        'Bearer access-1',
      );
      expect(
        api.calls('/ingest').single.headers['authorization'],
        'Bearer access-1',
      );
      final first = client.vault.cached!.sessions['u-1']!;
      expect(first.signOutPending, isFalse);
      expect(first.scope, PosSessionScope.ingestOnly);
    });

    test('a sign-out that cannot be sent goes before the next call', () async {
      await signIn();
      api.on('/auth/signout', (_) => throw http.ClientException('offline'));
      await client.endUiAccess('u-1');
      var s = client.vault.cached!.active!;
      expect(s.uiAccess, isFalse);
      expect(s.signOutPending, isTrue);

      api
        ..reset('/auth/signout')
        ..on(
          '/auth/signout',
          (_) => jsonResponse(200, {'scope': 'ingest_only'}),
        )
        ..on('/ingest', okAnswer);
      await client.ingest([
        {'id': 'e1'},
      ], userId: 'u-1');
      expect(api.requests.map(FakePosApi.pathOf), [
        '/auth/exchange',
        '/auth/signout',
        '/auth/signout',
        '/ingest',
      ]);
      s = client.vault.cached!.active!;
      expect(s.signOutPending, isFalse);
    });

    test('with nobody signed in, nothing is sent', () async {
      await expectLater(
        client.pull({}),
        throwsPosCode(PosErrorCodes.notSignedIn),
      );
      expect(api.requests, isEmpty);
    });
  });

  group('circuit breaker', () {
    test('opens after five calls with no answer; one trial later', () async {
      await signIn();
      api.on(
        '/sync/pull',
        (_) => jsonResponse(503, apiError('UNAVAILABLE', retryable: true)),
      );
      for (var i = 0; i < 5; i++) {
        await expectLater(client.pull({}), throwsPosCode('UNAVAILABLE'));
      }
      final sent = api.calls('/sync/pull').length;
      await expectLater(
        client.pull({}),
        throwsA(
          isA<PosApiException>()
              .having((e) => e.code, 'code', PosErrorCodes.circuitOpen)
              .having((e) => e.retryable, 'retryable', isTrue)
              .having(
                (e) => e.retryAfter,
                'retryAfter',
                const Duration(seconds: 30),
              ),
        ),
      );
      expect(api.calls('/sync/pull'), hasLength(sent));

      // Uploads have their own breaker.
      api.on('/ingest', okAnswer);
      await client.ingest([
        {'id': 'e1'},
      ], userId: 'u-1');

      clock.advance(const Duration(seconds: 30));
      api
        ..reset('/sync/pull')
        ..on('/sync/pull', okAnswer);
      await client.pull({});
      expect(client.breaker(EndpointGroup.sync).state, CircuitState.closed);
    });

    test('an answer from the API, even an error, keeps it closed', () async {
      await signIn();
      api.on(
        '/sync/pull',
        (_) => jsonResponse(400, apiError('INVALID_REQUEST')),
      );
      for (var i = 0; i < 7; i++) {
        await expectLater(client.pull({}), throwsPosCode('INVALID_REQUEST'));
      }
    });
  });
}
