@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show payloadHash;
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_pos_api.dart';

const EnvelopeOrigin _u1 = EnvelopeOrigin(
  deviceId: testDeviceId,
  clientType: 'native',
  userId: 'u-1',
  sessionId: '4f2a1b3c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
);

const EnvelopeOrigin _u2 = EnvelopeOrigin(
  deviceId: testDeviceId,
  clientType: 'native',
  userId: 'u-2',
);

const EnvelopeOrigin _device = EnvelopeOrigin(
  deviceId: testDeviceId,
  clientType: 'native',
);

void main() {
  late PosDatabase db;
  late TestClock clock;
  late OutboxStore store;

  OutboxStore storeOn(PosDatabase database) {
    var n = 0;
    return OutboxStore(
      database,
      clock: clock.call,
      newId: () =>
          '0191d3c2-7a4e-7c1b-9f10-${(++n).toString().padLeft(12, '0')}',
    );
  }

  setUp(() {
    db = PosDatabase(NativeDatabase.memory());
    clock = TestClock();
    store = storeOn(db);
  });

  tearDown(() => db.close());

  Future<OutboxRow> row(String id) =>
      (db.select(db.outbox)..where((o) => o.id.equals(id))).getSingle();

  Future<Map<String, Object?>> envelopeOf(String id) async =>
      jsonDecode((await row(id)).envelope) as Map<String, Object?>;

  Future<String> add({
    EnvelopeOrigin origin = _u1,
    String type = 'job_event',
    Map<String, Object?> payload = const {'action': 'accept'},
  }) => store.add(origin, type: type, typeVersion: 1, payload: payload);

  test('an envelope has the wrapper the API expects, hashed by JCS', () async {
    final id = await add(payload: {'job_id': 'j1', 'weight': 1.0});
    final e = await envelopeOf(id);
    expect(e.keys.toSet(), {
      'api_version',
      'id',
      'type',
      'type_version',
      'payload_hash',
      'device_id',
      'session_id',
      'device_seq',
      'module_version',
      'client_type',
      'created_at_device',
      'monotonic_ms',
      'payload',
    });
    expect(e['api_version'], PosVersions.api);
    expect(e['id'], id);
    expect(e['type'], 'job_event');
    // 1.0 and 1 are the same number in JSON, and hash the same (RFC 8785).
    expect(e['payload_hash'], payloadHash({'job_id': 'j1', 'weight': 1}));
    expect(e['device_id'], testDeviceId);
    expect(e['session_id'], _u1.sessionId);
    expect(e['module_version'], PosVersions.module);
    expect(e['created_at_device'], matches(RegExp(r'[+-]\d\d:\d\d$')));
    expect(e['monotonic_ms'], isA<int>());
    expect((await row(id)).lane, OutboxLane.actions);
  });

  test('lanes follow docs/08 §3', () {
    expect(OutboxLane.forType('submission'), OutboxLane.actions);
    expect(OutboxLane.forType('evidence_meta'), OutboxLane.evidence);
    expect(OutboxLane.forType('client_error'), OutboxLane.reports);
    expect(OutboxLane.forType('traces_batch'), OutboxLane.bulk);
    expect(OutboxLane.forType('from_a_newer_module'), OutboxLane.reports);
  });

  test('device_seq: one more per envelope, above any earlier store', () async {
    final a = await envelopeOf(await add());
    final b = await envelopeOf(await add());
    expect(a['device_seq'], clock.now.millisecondsSinceEpoch * 1000 + 1);
    expect(b['device_seq'], (a['device_seq']! as int) + 1);
  });

  test('stored with the change it records: both or neither', () async {
    await expectLater(
      db.transaction(() async {
        await add();
        await db
            .into(db.syncState)
            .insert(
              SyncStateCompanion.insert(key: 'k', value: 'v', updatedAt: 'x'),
            );
        throw StateError('the domain change failed');
      }),
      throwsStateError,
    );
    expect(await db.select(db.outbox).get(), isEmpty);
    expect(await db.select(db.syncState).get(), isEmpty);
    final next = await envelopeOf(await add());
    expect(
      next['device_seq'],
      clock.now.millisecondsSinceEpoch * 1000 + 1,
      reason: 'the rolled-back number is used again',
    );
  });

  group('batches', () {
    test('lane order, then sequence; at most 50', () async {
      for (var i = 0; i < 60; i++) {
        await add(type: 'traces_batch', payload: {'i': i});
      }
      await add();
      final batch = (await store.nextBatch(sendAs: (u) => u))!;
      expect(batch.rows.first.type, 'job_event');
      expect(batch.rows, hasLength(OutboxStore.maxBatchCount));
    });

    test('about 1 MB at most', () async {
      for (var i = 0; i < 4; i++) {
        // Three of these fit in the 900 KB budget; four don't.
        await add(payload: {'blob': 'x' * (290 * 1024)});
      }
      final batch = (await store.nextBatch(sendAs: (u) => u))!;
      expect(batch.rows, hasLength(3));
    });

    test('one user per batch; device reports go with whoever sends', () async {
      await add();
      await add(origin: _u2);
      await add(origin: _device, type: 'client_error');
      final batch = (await store.nextBatch(
        sendAs: (u) => u == 'u-1' ? null : 'u-2',
      ))!;
      expect(batch.userId, 'u-2');
      expect(batch.rows.map((r) => r.userId), ['u-2', null]);
    });

    test('nothing to send: null', () async {
      await add();
      expect(await store.nextBatch(sendAs: (_) => null), isNull);
    });

    test('a rescheduled item waits; a released one does not', () async {
      final id = await add();
      final rows = [await row(id)];
      await store.reschedule(
        rows,
        delayFor: (attempt) => Duration(minutes: attempt),
        error: 'UNAVAILABLE',
      );
      expect((await row(id)).attempts, 1);
      expect(await store.nextBatch(sendAs: (u) => u), isNull);
      clock.advance(const Duration(minutes: 1));
      expect(await store.nextBatch(sendAs: (u) => u), isNotNull);
      await store.release([await row(id)]);
      expect((await row(id)).attempts, 1);
    });
  });

  group('receipts', () {
    Map<String, Object?> receipt(
      String id,
      String? state, {
      bool durable = true,
      String? hash,
      String? error,
    }) => {
      'id': id,
      'state': state,
      'durable': durable,
      'stored_hash': hash,
      'error': error == null
          ? null
          : {'code': error, 'message': 'x', 'retryable': false},
    };

    test('decide each item: kept until the server holds it', () async {
      final ids = [
        for (var i = 0; i < 6; i++) await add(payload: {'i': i}),
      ];
      final rows = [for (final id in ids) await row(id)];
      final receipts = [
        receipt(ids[0], 'committed', hash: rows[0].payloadHash),
        receipt(ids[1], 'duplicate', hash: rows[1].payloadHash),
        receipt(ids[2], 'deferred'),
        receipt(ids[3], 'rejected', error: 'VALIDATION_FAILED'),
        receipt(ids[4], 'conflict', error: 'CONFLICT'),
        receipt(ids[5], null, durable: false, error: 'INVALID_ENVELOPE'),
      ].map(IngestReceipt.tryParse).cast<IngestReceipt>().toList();
      final counts = await store.applyReceipts(rows, receipts);
      expect(counts, {
        OutboxState.committed: 2,
        OutboxState.durable: 1,
        OutboxState.needsAttention: 3,
      });
      expect((await row(ids[3])).lastError, 'VALIDATION_FAILED');
      expect((await row(ids[5])).receiptState, 'refused');

      // The refused wrapper is reported with a client_error.
      final reports = await (db.select(
        db.outbox,
      )..where((o) => o.type.equals('client_error'))).get();
      final payload =
          (jsonDecode(reports.single.envelope)
                  as Map<String, Object?>)['payload']!
              as Map<String, Object?>;
      final error = (payload['errors']! as List).single as Map;
      expect(error['kind'], 'wrapper_rejected');
      expect(error['about_envelope_id'], ids[5]);
      expect(reports.single.state, OutboxState.queued);
    });

    test('receipts are matched by id, whatever their order', () async {
      final a = await add(payload: {'a': 1});
      final b = await add(payload: {'b': 1});
      final rows = [await row(a), await row(b)];
      await store.applyReceipts(rows, [
        IngestReceipt.tryParse(receipt(b, 'deferred'))!,
        IngestReceipt.tryParse(receipt(a, 'committed'))!,
      ]);
      expect((await row(a)).state, OutboxState.committed);
      expect((await row(b)).state, OutboxState.durable);
    });

    test('a stored hash that differs is a conflict, never committed', () async {
      final id = await add();
      await store.applyReceipts(
        [await row(id)],
        [IngestReceipt.tryParse(receipt(id, 'committed', hash: 'f' * 64))!],
      );
      final r = await row(id);
      expect(r.state, OutboxState.needsAttention);
      expect(r.lastError, 'STORED_HASH_MISMATCH');
    });
  });

  test('the pull finishes durable items', () async {
    final a = await add(payload: {'a': 1});
    final b = await add(payload: {'b': 1});
    final c = await add(payload: {'c': 1});
    await store.applyReceipts(
      [await row(a), await row(b), await row(c)],
      [
        for (final id in [a, b, c])
          IngestReceipt.tryParse({
            'id': id,
            'state': 'deferred',
            'durable': true,
          })!,
      ],
    );
    await store.applyServerOutcomes([
      ServerOutcome(a, 'committed'),
      ServerOutcome(b, 'rejected'),
      const ServerOutcome('unknown-id', 'committed'),
    ]);
    expect((await row(a)).state, OutboxState.committed);
    expect((await row(b)).state, OutboxState.needsAttention);
    expect((await row(c)).state, OutboxState.durable);

    // An admin resolves the rejected one: it is settled and can leave.
    await store.applyServerOutcomes([ServerOutcome(b, 'rejected', 'resolved')]);
    expect((await row(b)).state, OutboxState.committed);
    expect((await row(b)).receiptState, 'resolved:resolved');
  });

  test('an item not yet held by the server waits for its receipt', () async {
    final a = await add();
    await store.applyServerOutcomes([ServerOutcome(a, 'committed')]);
    expect((await row(a)).state, OutboxState.queued);
  });

  test('after a server restore every kept item goes again', () async {
    final a = await add(payload: {'a': 1});
    final b = await add(payload: {'b': 1});
    final c = await add(payload: {'c': 1});
    await store.applyReceipts(
      [await row(a), await row(b), await row(c)],
      [
        IngestReceipt.tryParse({
          'id': a,
          'state': 'committed',
          'durable': true,
        })!,
        IngestReceipt.tryParse({
          'id': b,
          'state': 'deferred',
          'durable': true,
        })!,
        IngestReceipt.tryParse({
          'id': c,
          'state': 'rejected',
          'durable': true,
        })!,
      ],
    );
    final before = (await row(a)).envelope;
    expect(await store.resendRetained(), 2);
    expect((await row(a)).state, OutboxState.queued);
    expect((await row(a)).envelope, before, reason: 'same id, same bytes');
    expect((await row(b)).state, OutboxState.queued);
    expect((await row(c)).state, OutboxState.needsAttention);
  });

  test('only committed items leave, and only after retention', () async {
    final a = await add(payload: {'a': 1});
    final b = await add(payload: {'b': 1});
    await store.applyReceipts(
      [await row(a), await row(b)],
      [
        IngestReceipt.tryParse({
          'id': a,
          'state': 'committed',
          'durable': true,
        })!,
        IngestReceipt.tryParse({
          'id': b,
          'state': 'deferred',
          'durable': true,
        })!,
      ],
    );
    const retain = Duration(days: 30);
    expect(await store.purgeCommitted(retain), 0);
    clock.advance(const Duration(days: 31));
    expect(await store.purgeCommitted(retain), 1);
    expect(
      (await db.select(db.outbox).get()).map((r) => r.id),
      [b],
    );
  });

  test('status counts states and the oldest pending item', () async {
    final first = clock.now;
    final a = await add(payload: {'a': 1});
    clock.advance(const Duration(minutes: 5));
    await add(payload: {'b': 1});
    await store.applyReceipts(
      [await row(a)],
      [
        IngestReceipt.tryParse({
          'id': a,
          'state': 'committed',
          'durable': true,
        })!,
      ],
    );
    final s = await store.status();
    expect(s.queued, 1);
    expect(s.committed, 1);
    expect(s.pending, 1);
    expect(
      s.oldestPendingAt,
      first.add(const Duration(minutes: 5)).toLocal(),
    );
  });

  test('quarantined stores are reported once', () async {
    await db.recordQuarantine(['fess_pos-20260914T080000Z.db']);
    await store.reportQuarantinedStores(_device);
    await store.reportQuarantinedStores(_device);
    final reports = await db.select(db.outbox).get();
    expect(reports, hasLength(1));
    final payload =
        (jsonDecode(reports.single.envelope)
                as Map<String, Object?>)['payload']!
            as Map<String, Object?>;
    final error = (payload['errors']! as List).single as Map;
    expect(error['code'], 'LOCAL_STORE_QUARANTINED');
    expect(error['kind'], 'recovery_anomaly');
  });

  test('an item in flight when the app stopped is queued again', () async {
    final dir = Directory.systemTemp.createTempSync('fess_pos_outbox_');
    addTearDown(() => dir.deleteSync(recursive: true));
    final file = File('${dir.path}/store.db');
    final first = PosDatabase(NativeDatabase(file));
    final s1 = storeOn(first);
    final id = await s1.add(
      _u1,
      type: 'job_event',
      typeVersion: 1,
      payload: {},
    );
    await s1.markInFlight([
      await (first.select(
        first.outbox,
      )..where((o) => o.id.equals(id))).getSingle(),
    ]);
    await first.close();

    final second = PosDatabase(NativeDatabase(file));
    addTearDown(second.close);
    final again = await (second.select(
      second.outbox,
    )..where((o) => o.id.equals(id))).getSingle();
    expect(again.state, OutboxState.queued);
  });
}
