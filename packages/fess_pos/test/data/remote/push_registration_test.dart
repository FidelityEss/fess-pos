@TestOn('vm')
library;

import 'package:drift/native.dart';
import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/remote/push_registration.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_pos_api.dart';

void main() {
  late FakePosApi api;
  late TestClock clock;
  late PosApiClient client;
  late PosDatabase db;
  late PushRegistration registration;
  String? hostToken;
  Error? hostError;

  List<Map<String, Object?>> deviceCalls() => [
    for (final r in api.calls('/device')) bodyOf(r),
  ];

  setUp(() async {
    api = FakePosApi()
      ..on(
        '/auth/exchange',
        (_) => jsonResponse(200, sessionAnswer(serverTime: clock.now)),
      )
      ..on('/device', (_) => jsonResponse(200, {'ok': true}));
    clock = TestClock();
    client = testApiClient(api, clock: clock);
    db = PosDatabase(NativeDatabase.memory());
    hostToken = 'fcm-token-1';
    hostError = null;
    registration = PushRegistration(
      client: client,
      db: db,
      push: PosPushConfig(
        provider: 'fcm',
        getToken: () async {
          final e = hostError;
          if (e != null) throw e;
          return hostToken;
        },
      ),
      clock: clock.call,
    );
    await client.exchange({'test': true}, issuer: 'pos_dev');
  });

  tearDown(() async {
    await db.close();
    client.close();
  });

  test('registers once, then only when the host token changes', () async {
    await registration.reconcile();
    await registration.reconcile();
    expect(deviceCalls(), [
      {'push_provider': 'fcm', 'push_token': 'fcm-token-1'},
    ]);
    hostToken = 'fcm-token-2';
    await registration.reconcile();
    expect(deviceCalls().last, {
      'push_provider': 'fcm',
      'push_token': 'fcm-token-2',
    });
    expect(deviceCalls(), hasLength(2));
  });

  test('signing out clears the token, once', () async {
    await registration.reconcile();
    await client.vault.update(
      (book) => book.put(book.active!.copyWith(uiAccess: false)),
    );
    await registration.reconcile();
    await registration.reconcile();
    expect(deviceCalls().last, {'push_token': null});
    expect(deviceCalls(), hasLength(2));
  });

  test('a host without a token now unregisters', () async {
    await registration.reconcile();
    hostToken = null;
    await registration.reconcile();
    expect(deviceCalls().last, {'push_token': null});
  });

  test("a host token that can't be read changes nothing", () async {
    hostError = StateError('the plugin is not ready');
    await registration.reconcile();
    expect(deviceCalls(), isEmpty);
  });

  test('offline: nothing is recorded, and the next run tries again', () async {
    api
      ..reset('/device')
      ..on(
        '/device',
        (_) => jsonResponse(503, apiError('UNAVAILABLE', retryable: true)),
      )
      ..on('/device', (_) => jsonResponse(200, {'ok': true}));
    await expectLater(registration.reconcile(), throwsA(isA<PosException>()));
    await registration.reconcile();
    await registration.reconcile();
    expect(deviceCalls(), hasLength(2), reason: 'one failed, one sent');
  });
}
