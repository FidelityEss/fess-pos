@TestOn('vm')
library;

import 'dart:convert';

import 'package:drift/native.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_cache.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/local/repositories.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/data/sync/sections.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show definitionHash;
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_pos_api.dart';
import '../../support/pull_pages.dart';

Map<String, Object?> _job(
  String id, {
  bool mine = true,
  String status = 'assigned',
  String? start,
  String merchant = 'Joe Spaza',
}) => {
  'id': id,
  'reference': 'POS-$id',
  'status': status,
  'updated_at': '2026-09-14T08:00:00+00:00',
  'merchant_name': merchant,
  'assigned_to_me': mine,
  'bank': {'id': 'bank-1', 'code': 'UBNK', 'name': 'Ubuntu Bank'},
  'scheduled_start': start,
};

Map<String, Object?> _body(
  String id,
  String kind,
  String key,
  Map<String, Object?> definition, {
  String? hash,
  String? bankId,
}) => {
  'id': id,
  'family_id': 'fam-$key-${bankId ?? 'global'}',
  'kind': kind,
  'key': key,
  'bank_id': bankId,
  'version': 1,
  'spec_version': '1.0',
  'definition': definition,
  'definition_hash': hash ?? definitionHash(definition),
};

Map<String, Object?> _manifest(
  String versionId,
  String kind,
  String key, {
  String? context,
}) => {
  'context_bank_id': context,
  'kind': kind,
  'key': key,
  'family_id': 'fam',
  'version_id': versionId,
  'version': 1,
  'spec_version': '1.0',
  'definition_hash': '0' * 64,
};

void main() {
  late FakePosApi api;
  late TestClock clock;
  late PosApiClient client;
  late PosDatabase db;
  late PullEngine engine;

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
    engine = PullEngine(
      db: db,
      client: client,
      outbox: OutboxStore(db, clock: clock.call),
      bootstrapCache: MemoryBootstrapCache(),
      capabilities: const {},
      sections: [JobsSection(db), DefinitionsSection(db)],
      clock: clock.call,
    );
  });

  tearDown(() => db.close());

  void answer(Map<String, Object?> Function(Map<String, Object?> base) edit) =>
      api.on(
        '/sync/pull',
        (_) => jsonResponse(200, edit(pullPage(serverTime: clock.now))),
      );

  test('jobs are kept whole; the agent sees only their own', () async {
    answer(
      (p) => p
        ..['jobs'] = {
          'items': [
            _job('j1', start: '2026-09-15T07:00:00+00:00'),
            _job('j2', mine: false),
          ],
          'next_cursor': '2026-09-14T08:00:00+00:00|j2',
          'has_more': false,
        },
    );
    await engine.pull();
    expect(await db.select(db.jobs).get(), hasLength(2));
    final mine = await DriftJobRepository(db).watchMine().first;
    expect(mine.map((j) => j.id), ['j1']);
    expect(mine.single.data['merchant_name'], 'Joe Spaza');
    expect(mine.single.bankId, 'bank-1');
    expect(
      mine.single.scheduledStart,
      DateTime.utc(2026, 9, 15, 7).toLocal(),
    );

    // The next pull asks from where the jobs stream stopped.
    await engine.pull();
    final cursors = bodyOf(api.calls('/sync/pull').last)['cursors']! as Map;
    expect(cursors['jobs'], '2026-09-14T08:00:00+00:00|j2');
  });

  test('a newer copy of a job replaces the older one', () async {
    answer(
      (p) => p
        ..['jobs'] = {
          'items': [_job('j1')],
          'next_cursor': null,
          'has_more': false,
        },
    );
    await engine.pull();
    api
      ..reset('/sync/pull')
      ..on('/sync/pull', (_) {
        final page = pullPage(serverTime: clock.now)
          ..['jobs'] = {
            'items': [_job('j1', status: 'accepted', merchant: 'Joe’s Spaza')],
            'next_cursor': null,
            'has_more': false,
          };
        return jsonResponse(200, page);
      });
    await engine.pull();
    final job = await DriftJobRepository(db).watchJob('j1').first;
    expect(job!.status, 'accepted');
    expect(job.data['merchant_name'], 'Joe’s Spaza');
  });

  test('reviews are kept', () async {
    answer(
      (p) => p
        ..['reviews'] = {
          'items': [
            {
              'id': 'r1',
              'inspection_id': 'i1',
              'job_id': 'j1',
              'attempt': 1,
              'decision': 'returned',
              'decided_at': '2026-09-14T09:00:00+00:00',
              'note': 'Photos are blurry',
            },
          ],
          'next_cursor': null,
          'has_more': false,
        },
    );
    await engine.pull();
    final review = await db.select(db.reviews).getSingle();
    expect(review.decision, 'returned');
    expect(jsonDecode(review.body), containsPair('note', 'Photos are blurry'));
  });

  group('definitions', () {
    final home = <String, Object?>{
      'kind': 'view',
      'family': 'home',
      'items': [
        {'type': 'greeting', 'text': 'Hi'},
      ],
    };
    final bankHome = <String, Object?>{
      'kind': 'view',
      'family': 'home',
      'items': [
        {'type': 'greeting', 'text': 'Hi from the bank'},
      ],
    };

    test('only a definition whose hash matches is kept', () async {
      answer(
        (p) => p
          ..['definitions'] = {
            'manifest': [_manifest('v1', 'view', 'home')],
            'bodies': [
              _body('v1', 'view', 'home', home),
              _body('v2', 'view', 'job_card', home, hash: 'f' * 64),
            ],
          },
      );
      await engine.pull();
      final kept = await db.select(db.definitionVersions).get();
      expect(kept.map((d) => d.versionId), ['v1']);
    });

    test('the manifest says what is in force; a bank overrides', () async {
      answer(
        (p) => p
          ..['definitions'] = {
            'manifest': [
              _manifest('v1', 'view', 'home'),
              _manifest('v2', 'view', 'home', context: 'bank-1'),
            ],
            'bodies': [
              _body('v1', 'view', 'home', home),
              _body('v2', 'view', 'home', bankHome, bankId: 'bank-1'),
            ],
          },
      );
      await engine.pull();
      final repo = DriftDefinitionRepository(db);
      final plain = await repo.watchActive('view', 'home').first;
      expect(plain!['items'], home['items']);
      final forBank = await repo
          .watchActive('view', 'home', bankId: 'bank-1')
          .first;
      expect(forBank!['items'], bankHome['items']);
      final otherBank = await repo
          .watchActive('view', 'home', bankId: 'bank-2')
          .first;
      expect(otherBank!['items'], home['items'], reason: 'the default');
    });

    test('what the phone holds is not sent again', () async {
      answer(
        (p) => p
          ..['definitions'] = {
            'manifest': [_manifest('v1', 'view', 'home')],
            'bodies': [_body('v1', 'view', 'home', home)],
          },
      );
      await engine.pull();
      await engine.pull();
      final have = bodyOf(api.calls('/sync/pull').last)['have']! as Map;
      expect(have['definition_version_ids'], ['v1']);
    });

    test('a version dropped from the manifest is no longer in force', () async {
      answer(
        (p) => p
          ..['definitions'] = {
            'manifest': [_manifest('v1', 'view', 'home')],
            'bodies': [_body('v1', 'view', 'home', home)],
          },
      );
      await engine.pull();
      api
        ..reset('/sync/pull')
        ..on(
          '/sync/pull',
          (_) => jsonResponse(200, pullPage(serverTime: clock.now)),
        );
      await engine.pull();
      expect(
        await DriftDefinitionRepository(db).watchActive('view', 'home').first,
        isNull,
      );
      expect(
        await db.select(db.definitionVersions).get(),
        hasLength(1),
        reason: 'kept until T3-07 decides what to evict',
      );
    });
  });
}
