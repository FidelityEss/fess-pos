@TestOn('vm')
library;

import 'package:drift/native.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_cache.dart';
import 'package:fess_pos/src/core/config/remote_config.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/outbox/outbox_sender.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/data/sync/sync_engine.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show payloadHash;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../../support/fake_pos_api.dart';
import '../../support/pull_pages.dart';

const EnvelopeOrigin _u1 = EnvelopeOrigin(
  deviceId: testDeviceId,
  clientType: 'native',
  userId: 'u-1',
);

const EnvelopeOrigin _device = EnvelopeOrigin(
  deviceId: testDeviceId,
  clientType: 'native',
);

/// Lands every envelope once; a copy comes back as a duplicate.
http.Response Function(http.Request) _landing(Set<String> landed) => (request) {
  final envelopes = (bodyOf(request)['envelopes']! as List)
      .cast<Map<String, Object?>>();
  return jsonResponse(200, {
    'receipts': [
      for (final e in envelopes)
        {
          'id': e['id'],
          'state': landed.add(e['id']! as String) ? 'committed' : 'duplicate',
          'durable': true,
          'stored_hash': payloadHash(e['payload']),
        },
    ],
    'server_time': DateTime.now().toUtc().toIso8601String(),
  });
};

void main() {
  late FakePosApi api;
  late TestClock clock;
  late PosApiClient client;
  late PosDatabase db;
  late OutboxStore outbox;
  late SyncEngine engine;
  late Set<String> landed;
  late bool canPull;
  late List<RemoteConfig> reverified;

  setUp(() async {
    api = FakePosApi();
    clock = TestClock();
    client = testApiClient(api, clock: clock);
    landed = {};
    canPull = true;
    reverified = [];
    api
      ..on(
        '/auth/exchange',
        (_) => jsonResponse(200, sessionAnswer(serverTime: clock.now)),
      )
      ..on(
        '/auth/refresh',
        (_) => jsonResponse(
          200,
          sessionAnswer(serverTime: clock.now, refreshToken: refreshToken2),
        ),
      )
      ..on('/ingest', _landing(landed))
      ..on(
        '/sync/pull',
        (_) => jsonResponse(200, pullPage(serverTime: clock.now)),
      );
    await client.exchange({
      'issuer': 'pos_dev',
      'token': 'host-token',
      'device': {'device_id': testDeviceId},
    }, issuer: 'pos_dev');
    db = PosDatabase(NativeDatabase.memory());
    outbox = OutboxStore(db, clock: clock.call);
    engine = SyncEngine(
      sender: OutboxSender(store: outbox, client: client),
      puller: PullEngine(
        db: db,
        client: client,
        outbox: outbox,
        bootstrapCache: MemoryBootstrapCache(),
        capabilities: const {},
        clock: clock.call,
      ),
      outbox: outbox,
      deviceOrigin: () async => _device,
      canPull: () => canPull,
      reverify: (config) async => reverified.add(config),
      clock: clock.call,
    );
  });

  tearDown(() => db.close());

  List<String> paths() => api.requests.map(FakePosApi.pathOf).toList();

  test(
    're-verify, send, pull, then clear out what is past retention',
    () async {
      await outbox.add(
        _u1,
        type: 'job_event',
        typeVersion: 1,
        payload: {'a': 1},
      );
      final report = await engine.syncNow();
      expect(report.ok, isTrue);
      expect(report.drained!.outcomes, {OutboxState.committed: 1});
      expect(report.pulled!.pages, 1);
      expect(paths().skip(1), ['/ingest', '/sync/pull']);
      expect(reverified, hasLength(1));

      clock.advance(const Duration(days: 31));
      await engine.syncNow();
      expect(await db.select(db.outbox).get(), isEmpty);
    },
  );

  test('after sign-out it keeps uploading but does not pull', () async {
    canPull = false;
    await outbox.add(_u1, type: 'job_event', typeVersion: 1, payload: {'a': 1});
    final report = await engine.syncNow();
    expect(report.pulled, isNull);
    expect(paths(), isNot(contains('/sync/pull')));
    expect(report.drained!.outcomes, {OutboxState.committed: 1});
  });

  test('a restore sends everything kept again, in the same run', () async {
    await outbox.add(_u1, type: 'job_event', typeVersion: 1, payload: {'a': 1});
    await engine.syncNow();
    api
      ..reset('/sync/pull')
      ..on(
        '/sync/pull',
        (_) => jsonResponse(
          200,
          pullPage(
            serverTime: clock.now,
            epoch: 'e2222222-2222-4222-8222-222222222222',
          ),
        ),
      );
    final report = await engine.syncNow();
    expect(report.pulled!.resent, 1);
    expect(api.calls('/ingest'), hasLength(2));
    expect(report.drained!.outcomes, {OutboxState.committed: 1});
  });

  test('a failed pull is reported, never thrown', () async {
    api
      ..reset('/sync/pull')
      ..on(
        '/sync/pull',
        (_) => jsonResponse(503, apiError('UNAVAILABLE', retryable: true)),
      );
    final report = await engine.syncNow();
    expect(report.error, 'UNAVAILABLE');
    expect(report.drained, isNotNull);
  });

  test('one run at a time', () async {
    final runs = await Future.wait([engine.syncNow(), engine.syncNow()]);
    expect(identical(runs[0], runs[1]), isTrue);
    expect(api.calls('/sync/pull'), hasLength(1));
  });

  test('stores moved into quarantine are reported in a run', () async {
    await db.recordQuarantine(['fess_pos-20260914T080000Z.db']);
    await engine.syncNow();
    final sent = api.calls('/ingest').single.body;
    expect(sent, contains('LOCAL_STORE_QUARANTINED'));
  });

  test('the next run is sooner while work waits', () {
    expect(
      SyncEngine.nextDelay(config: RemoteConfig.bundled, pendingWork: true),
      const Duration(seconds: 60),
    );
    expect(
      SyncEngine.nextDelay(config: RemoteConfig.bundled, pendingWork: false),
      const Duration(seconds: 900),
    );
    expect(
      SyncEngine.nextDelay(
        config: const RemoteConfig({
          'sync': {'foreground_interval_s': 30},
        }),
        pendingWork: true,
      ),
      const Duration(seconds: 30),
    );
  });
}
