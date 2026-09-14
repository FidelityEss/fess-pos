@TestOn('vm')
library;

import 'package:drift/native.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_cache.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_pos_api.dart';
import '../../support/pull_pages.dart';
import '../../support/test_host.dart';

const String _epoch2 = 'e2222222-2222-4222-8222-222222222222';

const EnvelopeOrigin _u1 = EnvelopeOrigin(
  deviceId: testDeviceId,
  clientType: 'native',
  userId: 'u-1',
);

class _JobsSection implements PullSection {
  final List<Map<String, Object?>> applied = [];

  @override
  Set<String> get streams => {'jobs'};

  @override
  Future<void> describeHave(Map<String, Object?> have) async =>
      have['session_token_job_ids'] = <String>[];

  @override
  Future<void> apply(Map<String, Object?> page) async => applied.add(page);
}

void main() {
  late FakePosApi api;
  late TestClock clock;
  late PosApiClient client;
  late PosDatabase db;
  late OutboxStore outbox;
  late MemoryBootstrapCache cache;

  PullEngine engine({List<PullSection> sections = const []}) => PullEngine(
    db: db,
    client: client,
    outbox: outbox,
    bootstrapCache: cache,
    capabilities: const {'module_version': '0.1.0'},
    sections: sections,
    clock: clock.call,
  );

  void answer(Map<String, Object?> Function() page) =>
      api.on('/sync/pull', (_) => jsonResponse(200, page()));

  Map<String, Object?> request([int i = -1]) {
    final calls = api.calls('/sync/pull');
    return bodyOf(calls[i < 0 ? calls.length + i : i]);
  }

  Future<String?> state(String key) async => (await (db.select(
    db.syncState,
  )..where((s) => s.key.equals(key))).getSingleOrNull())?.value;

  setUp(() async {
    api = FakePosApi();
    clock = TestClock();
    client = testApiClient(api, clock: clock);
    api.on(
      '/auth/exchange',
      (_) => jsonResponse(200, sessionAnswer(serverTime: clock.now)),
    );
    await client.exchange({
      'issuer': 'pos_dev',
      'token': 'host-token',
      'device': {'device_id': testDeviceId},
    }, issuer: 'pos_dev');
    db = PosDatabase(NativeDatabase.memory());
    outbox = OutboxStore(db, clock: clock.call);
    cache = MemoryBootstrapCache();
  });

  tearDown(() => db.close());

  test('the first pull starts from the beginning, with capabilities', () async {
    answer(() => pullPage(serverTime: clock.now));
    final report = await engine().pull();
    expect(report.pages, 1);
    expect(report.complete, isTrue);
    final r = request();
    expect(r['cursors'], isEmpty);
    expect(r['have'], {'agent_card_valid': false});
    expect(r['capabilities'], {'module_version': '0.1.0'});
    expect(r['limit'], 200);
  });

  test('keeps the config and refreshes the kill switches', () async {
    answer(
      () => pullPage(
        serverTime: clock.now,
        configVersion: 'cv-1',
        configValues: {
          'pos': {'enabled': false},
          'sync': {'foreground_interval_s': 30},
        },
      ),
    );
    final report = await engine().pull();
    expect(report.bootstrap!.posEnabled, isFalse);
    final cached = BootstrapSnapshot.fromCacheJson(await cache.read());
    expect(cached.posEnabled, isFalse);
    expect(cached.configVersionId, 'cv-1');
    final config = await readRemoteConfig(db);
    expect(config.versionId, 'cv-1');
    expect(config.foregroundSyncInterval, const Duration(seconds: 30));
  });

  test("a bank's config, and only the banks the server still sends", () async {
    answer(
      () => pullPage(
        serverTime: clock.now,
        byBank: {
          'b1': {
            'config_version_id': 'cv-b1',
            'values': {
              'sync': {'foreground_interval_s': 20},
            },
          },
          'b2': {'config_version_id': 'cv-b2', 'values': <String, Object?>{}},
        },
      ),
    );
    await engine().pull();
    expect((await readRemoteConfig(db, bankId: 'b1')).versionId, 'cv-b1');

    api
      ..reset('/sync/pull')
      ..on(
        '/sync/pull',
        (_) => jsonResponse(
          200,
          pullPage(
            serverTime: clock.now,
            byBank: {
              'b2': {
                'config_version_id': 'cv-b2',
                'values': <String, Object?>{},
              },
            },
          ),
        ),
      );
    await engine().pull();
    final b1 = await readRemoteConfig(db, bankId: 'b1');
    expect(b1.versionId, isNull, reason: 'falls back to the default context');
    expect((await readRemoteConfig(db, bankId: 'b2')).versionId, 'cv-b2');
  });

  test('reason codes come again only when their hash changes', () async {
    answer(
      () => pullPage(
        serverTime: clock.now,
        reasonItems: [
          {'code': 'closed', 'label': 'Shop closed'},
        ],
      ),
    );
    await engine().pull();
    api
      ..reset('/sync/pull')
      ..on(
        '/sync/pull',
        (_) => jsonResponse(200, pullPage(serverTime: clock.now)),
      );
    await engine().pull();
    expect((request()['have']! as Map)['reason_codes_hash'], 'rh1');
    final doc = await (db.select(
      db.cachedDocuments,
    )..where((d) => d.key.equals(DocKeys.reasonCodes))).getSingle();
    expect(doc.body, contains('Shop closed'), reason: 'kept, not cleared');
  });

  test('envelope outcomes reach the outbox, and the cursor moves', () async {
    final id = await outbox.add(
      _u1,
      type: 'job_event',
      typeVersion: 1,
      payload: {'a': 1},
    );
    final row = await db.select(db.outbox).getSingle();
    await outbox.applyReceipts(
      [row],
      [
        IngestReceipt.tryParse({
          'id': id,
          'state': 'deferred',
          'durable': true,
        })!,
      ],
    );
    answer(
      () => pullPage(
        serverTime: clock.now,
        envelopes: [
          {'id': id, 'state': 'committed'},
        ],
        envelopesCursor: '2026-09-14T08:00:00Z|$id',
      ),
    );
    await engine().pull();
    expect((await db.select(db.outbox).getSingle()).state, 'committed');
    await engine().pull();
    expect(request()['cursors'], {'envelopes': '2026-09-14T08:00:00Z|$id'});
  });

  test('pages until every stream it keeps is complete', () async {
    var page = 0;
    api.on('/sync/pull', (_) {
      page++;
      return jsonResponse(
        200,
        pullPage(
          serverTime: clock.now,
          envelopesMore: page == 1,
          envelopesCursor: 'c$page',
          jobsMore: true, // not kept yet: ignored
        ),
      );
    });
    final report = await engine().pull();
    expect(report.pages, 2);
    expect(report.complete, isTrue);
    expect(request(1)['cursors'], {'envelopes': 'c1'});
  });

  test('a section owns its stream and its part of have', () async {
    final jobs = _JobsSection();
    var page = 0;
    api.on('/sync/pull', (_) {
      page++;
      return jsonResponse(
        200,
        pullPage(serverTime: clock.now, jobsMore: page == 1),
      );
    });
    await engine(sections: [jobs]).pull();
    expect(jobs.applied, hasLength(2));
    expect(
      request(0)['have'],
      containsPair('session_token_job_ids', <Object>[]),
    );
    expect(
      (request(1)['cursors']! as Map)['jobs'],
      '2026-09-14T08:00:00Z|j',
    );
  });

  test('a restored server gets every kept envelope again', () async {
    answer(() => pullPage(serverTime: clock.now));
    expect((await engine().pull()).epochChanged, isFalse);

    final id = await outbox.add(
      _u1,
      type: 'job_event',
      typeVersion: 1,
      payload: {'a': 1},
    );
    await outbox.applyReceipts(
      [await db.select(db.outbox).getSingle()],
      [
        IngestReceipt.tryParse({
          'id': id,
          'state': 'committed',
          'durable': true,
        })!,
      ],
    );
    api
      ..reset('/sync/pull')
      ..on(
        '/sync/pull',
        (_) =>
            jsonResponse(200, pullPage(serverTime: clock.now, epoch: _epoch2)),
      );
    final report = await engine().pull();
    expect(report.epochChanged, isTrue);
    expect(report.resent, 1);
    expect((await db.select(db.outbox).getSingle()).state, 'queued');
    expect(await state(SyncKeys.serverEpoch), _epoch2);
  });

  test('the server can ask for everything again', () async {
    final id = await outbox.add(
      _u1,
      type: 'job_event',
      typeVersion: 1,
      payload: {'a': 1},
    );
    await outbox.applyReceipts(
      [await db.select(db.outbox).getSingle()],
      [
        IngestReceipt.tryParse({
          'id': id,
          'state': 'committed',
          'durable': true,
        })!,
      ],
    );
    answer(
      () => pullPage(
        serverTime: clock.now,
        commands: [
          {
            'id': 'cmd-1',
            'type': 'resend_envelopes',
            'params': <String, Object?>{},
            'issued_at': clock.now.toIso8601String(),
          },
        ],
      ),
    );
    expect((await engine().pull()).resent, 1);
  });

  test('keeps the clock offset', () async {
    answer(
      () => pullPage(serverTime: clock.now.add(const Duration(seconds: 90))),
    );
    await engine().pull();
    expect(await state(SyncKeys.clockOffsetMs), '90000');
  });

  test('the agent card is kept, and reported valid while it is', () async {
    answer(
      () => pullPage(
        serverTime: clock.now,
        agentCard: {
          'token': 'a' * 32,
          'valid_to': clock.now
              .add(const Duration(hours: 24))
              .toIso8601String(),
        },
      ),
    );
    await engine().pull();
    await engine().pull();
    expect((request()['have']! as Map)['agent_card_valid'], isTrue);
  });

  test('a refused pull applies nothing and throws', () async {
    api.on(
      '/sync/pull',
      (_) => jsonResponse(403, apiError('SCOPE_INSUFFICIENT')),
    );
    await expectLater(engine().pull(), throwsPosCode('SCOPE_INSUFFICIENT'));
    expect(await db.select(db.syncState).get(), isEmpty);
  });
}
