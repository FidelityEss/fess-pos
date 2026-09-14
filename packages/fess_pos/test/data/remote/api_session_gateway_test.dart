import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/data/remote/api_session_gateway.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/remote/session_vault.dart';
import 'package:fess_pos/src/domain/session/session_gateway.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../../support/fake_platform.dart';
import '../../support/fake_pos_api.dart';
import '../../support/test_host.dart';

PosIdentity _identity({
  String employeeNumber = 'E0001',
  String? photoUrl,
  DateTime? issuedAt,
}) => PosIdentity(
  profile: PosUserProfile(
    employeeNumber: employeeNumber,
    firstName: 'Test',
    lastName: 'Agent',
    photoUrl: photoUrl,
  ),
  getIdentityToken: () async => PosIdentityToken(
    token: 'host-token',
    issuer: 'pos_dev',
    issuedAt: issuedAt,
  ),
);

void main() {
  late FakePosApi api;
  late TestClock clock;
  late MemorySecureStore store;
  late PosApiClient client;

  setUp(() {
    api = FakePosApi();
    clock = TestClock();
    store = MemorySecureStore();
    client = testApiClient(api, clock: clock, store: store);
  });

  tearDown(ModuleRuntime.reset);

  ApiSessionGateway gateway({PosPushConfig? push}) => ApiSessionGateway(
    client: client,
    deviceInfo: FakeDeviceInfo(),
    push: push,
    clock: clock.call,
  );

  void answerExchange({
    String userId = 'u-1',
    String employeeNumber = 'E0001',
  }) => api
    ..reset('/auth/exchange')
    ..on(
      '/auth/exchange',
      (_) => jsonResponse(
        200,
        sessionAnswer(
          serverTime: clock.now,
          userId: userId,
          employeeNumber: employeeNumber,
        ),
      ),
    );

  void goOffline() => api
    ..reset('/auth/exchange')
    ..on('/auth/exchange', (_) => throw http.ClientException('offline'));

  Map<String, Object?> lastExchange() =>
      bodyOf(api.calls('/auth/exchange').last);

  test('sends the host token, this device and the profile', () async {
    answerExchange();
    final info = await gateway(
      push: PosPushConfig(provider: 'fcm', getToken: () async => 'push-1'),
    ).exchange(_identity(issuedAt: DateTime.utc(2026, 9)));
    expect(info.scope, PosSessionScope.full);
    expect(info.offline, isFalse);

    final body = lastExchange();
    expect(body['issuer'], 'pos_dev');
    expect(body['token'], 'host-token');
    expect(body['issued_at'], matches(RegExp(r'[+-]\d\d:\d\d$')));
    final device = body['device']! as Map<String, Object?>;
    expect(device['device_id'], testDeviceId);
    expect(device['client_type'], 'native');
    expect(device['platform'], 'android');
    expect(device['module_version'], PosVersions.module);
    expect(device['push_provider'], 'fcm');
    expect(device['push_token'], 'push-1');
    expect(
      (device['capabilities']! as Map<String, Object?>)['api_versions'],
      [PosVersions.api],
    );
    final profile = body['profile']! as Map<String, Object?>;
    expect(profile['employee_number'], 'E0001');
  });

  test('the device id is created once and kept', () async {
    answerExchange();
    await gateway().exchange(_identity());
    await gateway().exchange(_identity());
    final ids = {
      for (final r in api.calls('/auth/exchange'))
        (bodyOf(r)['device']! as Map<String, Object?>)['device_id'],
    };
    expect(ids, {testDeviceId});
    expect(store.values[SessionVault.deviceIdKey], testDeviceId);
  });

  test('details the API would refuse are left out, not cut short', () async {
    answerExchange();
    await gateway(
      push: PosPushConfig(
        provider: 'fcm',
        getToken: () async => throw StateError('no push'),
      ),
    ).exchange(_identity(photoUrl: 'https://x.test/${'a' * 3000}'));
    final body = lastExchange();
    expect(
      (body['profile']! as Map<String, Object?>).containsKey('photo_url'),
      isFalse,
    );
    expect(
      (body['device']! as Map<String, Object?>).containsKey('push_token'),
      isFalse,
    );
  });

  test("a failing getIdentityToken is the host's error", () async {
    await expectLater(
      gateway().exchange(
        PosIdentity(
          profile: PosUserProfile(
            employeeNumber: 'E0001',
            firstName: 'T',
            lastName: 'A',
          ),
          getIdentityToken: () async => throw StateError('host bug'),
        ),
      ),
      throwsPosCode(PosErrorCodes.hostTokenUnavailable),
    );
    expect(api.requests, isEmpty);
  });

  group('offline', () {
    test('the same user signs in with the stored session', () async {
      answerExchange();
      await gateway().exchange(_identity());
      goOffline();
      final info = await gateway().exchange(_identity());
      expect(info.offline, isTrue);
      expect(info.uiAccess, isTrue);
      expect(info.scope, PosSessionScope.full);
    });

    test('whatever the case or spacing of the employee number', () async {
      answerExchange();
      await gateway().exchange(_identity());
      goOffline();
      final info = await gateway().exchange(
        _identity(employeeNumber: ' e0001 '),
      );
      expect(info.offline, isTrue);
    });

    test('another user does not', () async {
      answerExchange();
      await gateway().exchange(_identity());
      goOffline();
      await expectLater(
        gateway().exchange(_identity(employeeNumber: 'E0002')),
        throwsPosCode(PosErrorCodes.networkUnavailable),
      );
    });

    test('nobody who signed in before: the error stands', () async {
      goOffline();
      await expectLater(
        gateway().exchange(_identity()),
        throwsPosCode(PosErrorCodes.networkUnavailable),
      );
    });

    test('not with a session past its refresh expiry', () async {
      answerExchange();
      await gateway().exchange(_identity());
      goOffline();
      clock.advance(const Duration(days: 31));
      await expectLater(
        gateway().exchange(_identity()),
        throwsPosCode(PosErrorCodes.networkUnavailable),
      );
    });

    test('not with a session the server ended', () async {
      answerExchange();
      await gateway().exchange(_identity());
      api.on(
        '/auth/refresh',
        (_) => jsonResponse(403, apiError('DEVICE_REVOKED')),
      );
      clock.advance(const Duration(minutes: 15));
      await expectLater(client.pull({}), throwsPosCode('DEVICE_REVOKED'));
      goOffline();
      await expectLater(
        gateway().exchange(_identity()),
        throwsPosCode(PosErrorCodes.networkUnavailable),
      );
    });
  });

  test('a refused identity takes UI access away and keeps uploads', () async {
    answerExchange();
    await gateway().exchange(_identity());
    api
      ..reset('/auth/exchange')
      ..on(
        '/auth/exchange',
        (_) => jsonResponse(401, apiError('INVALID_HOST_TOKEN')),
      )
      ..on('/auth/signout', (_) => jsonResponse(200, {'scope': 'ingest_only'}));
    await expectLater(
      gateway().exchange(_identity()),
      throwsPosCode('INVALID_HOST_TOKEN'),
    );
    final s = client.vault.cached!.active!;
    expect(s.uiAccess, isFalse);
    expect(s.usable, isTrue);
    expect(s.scope, PosSessionScope.ingestOnly);
    expect(api.calls('/auth/signout'), hasLength(1));
  });

  test('sign-out: UI access ends now, the server hears when it can', () async {
    answerExchange();
    final g = gateway();
    await g.exchange(_identity());
    api.on('/auth/signout', (_) => throw http.ClientException('offline'));
    await g.endUiAccess();
    expect(g.current!.uiAccess, isFalse);
    expect(client.vault.cached!.active!.signOutPending, isTrue);
  });

  group('through PosModule', () {
    Future<void> start() => startTestRuntime(
      gateway: gateway(),
      platform: fakePlatform(secureStore: store),
    );

    test('signIn opens POS; a revoked device closes it', () async {
      await start();
      answerExchange();
      expect((await PosModule.signIn(_identity())).visible, isTrue);

      api.on(
        '/auth/refresh',
        (_) => jsonResponse(403, apiError('DEVICE_REVOKED')),
      );
      clock.advance(const Duration(minutes: 15));
      await expectLater(client.pull({}), throwsPosCode('DEVICE_REVOKED'));
      expect((await PosModule.access()).reason, PosAccessReason.notSignedIn);
    });

    test('offline sign-in opens POS and says so', () async {
      final events = <PosEvent>[];
      await startTestRuntime(
        config: testConfig(onEvent: events.add),
        gateway: gateway(),
      );
      answerExchange();
      await PosModule.signIn(_identity());
      goOffline();
      expect((await PosModule.signIn(_identity())).visible, isTrue);
      expect(
        events
            .where((e) => e.name == PosEvent.signedIn)
            .map((e) => e.properties['offline']),
        [false, true],
      );
    });
  });
}
