@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:drift/native.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/outbox/outbox_sender.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show payloadHash;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../../support/fake_pos_api.dart';

const EnvelopeOrigin _u1 = EnvelopeOrigin(
  deviceId: testDeviceId,
  clientType: 'native',
  userId: 'u-1',
);

/// The server's landing rules (docs/12 §5, §15): the first copy of an id
/// commits; the same id and hash again is a duplicate; the same id with
/// another hash is a conflict.
class _FakeIngest {
  final Map<String, String> landed = {};
  final List<String> bodies = [];
  bool dropNextAnswer = false;
  bool reverse = false;
  String? rejectType;
  String? refuseType;
  int? tooLargeOver;

  http.Response answer(http.Request request) {
    bodies.add(request.body);
    final envelopes = (bodyOf(request)['envelopes']! as List)
        .cast<Map<String, Object?>>();
    if (tooLargeOver != null &&
        envelopes.any(
          (e) =>
              request.body.length > tooLargeOver! &&
              (envelopes.length > 1 ||
                  (e['payload']! as Map).containsKey('big')),
        )) {
      return jsonResponse(413, apiError('PAYLOAD_TOO_LARGE'));
    }
    final receipts = [for (final e in envelopes) _receipt(e)];
    if (dropNextAnswer) {
      dropNextAnswer = false;
      throw http.ClientException('connection reset after the commit');
    }
    return jsonResponse(200, {
      'receipts': reverse ? receipts.reversed.toList() : receipts,
      'server_time': DateTime.now().toUtc().toIso8601String(),
    });
  }

  Map<String, Object?> _receipt(Map<String, Object?> e) {
    final id = e['id']! as String;
    if (e['type'] == refuseType) {
      return {
        'id': id,
        'state': null,
        'durable': false,
        'error': {
          'code': 'INVALID_ENVELOPE',
          'message': 'wrapper',
          'retryable': false,
        },
      };
    }
    final hash = payloadHash(e['payload']);
    final prior = landed[id];
    if (prior == null) {
      landed[id] = hash;
      final rejected = e['type'] == rejectType;
      return {
        'id': id,
        'state': rejected ? 'rejected' : 'committed',
        'durable': true,
        'stored_hash': hash,
      };
    }
    return {
      'id': id,
      'state': prior == hash ? 'duplicate' : 'conflict',
      'durable': true,
      'stored_hash': prior,
    };
  }
}

void main() {
  late FakePosApi api;
  late _FakeIngest server;
  late TestClock clock;
  late PosApiClient client;
  late PosDatabase db;
  late OutboxStore store;
  late OutboxSender sender;

  Future<void> signIn({String userId = 'u-1'}) async {
    api
      ..reset('/auth/exchange')
      ..on(
        '/auth/exchange',
        (_) => jsonResponse(
          200,
          sessionAnswer(serverTime: clock.now, userId: userId),
        ),
      );
    await client.exchange({
      'issuer': 'pos_dev',
      'token': 'host-token',
      'device': {'device_id': testDeviceId},
    }, issuer: 'pos_dev');
  }

  OutboxSender senderOn(OutboxStore s) =>
      OutboxSender(store: s, client: client, random: Random(1));

  setUp(() async {
    api = FakePosApi();
    server = _FakeIngest();
    clock = TestClock();
    client = testApiClient(api, clock: clock);
    api
      ..on('/ingest', server.answer)
      ..on(
        '/auth/refresh',
        (_) => jsonResponse(
          200,
          sessionAnswer(serverTime: clock.now, refreshToken: refreshToken2),
        ),
      );
    db = PosDatabase(NativeDatabase.memory());
    store = OutboxStore(db, clock: clock.call);
    sender = senderOn(store);
    await signIn();
  });

  tearDown(() => db.close());

  Future<List<String>> addAll(int n, {String type = 'job_event'}) async => [
    for (var i = 0; i < n; i++)
      await store.add(_u1, type: type, typeVersion: 1, payload: {'i': i}),
  ];

  Future<Map<String, String>> states() async => {
    for (final r in await db.select(db.outbox).get()) r.id: r.state,
  };

  test('sends what is due and marks it committed', () async {
    final ids = await addAll(3);
    final report = await sender.drain();
    expect(report.sent, 3);
    expect(report.outcomes, {OutboxState.committed: 3});
    expect(api.calls('/ingest'), hasLength(1));
    expect(
      api.calls('/ingest').single.headers['authorization'],
      'Bearer access-1',
    );
    expect((await states()).values, everyElement(OutboxState.committed));
    expect(server.landed.keys, containsAll(ids));
  });

  group('fault injection (docs/12 §14)', () {
    test('answer lost after the commit: sent again, landed once', () async {
      final ids = await addAll(2);
      server.dropNextAnswer = true;
      final first = await sender.drain();
      expect(first.stoppedBy, 'NETWORK_UNAVAILABLE');
      expect((await states()).values, everyElement(OutboxState.queued));

      clock.advance(const Duration(minutes: 16));
      final second = await sender.drain();
      expect(second.outcomes, {OutboxState.committed: 2});
      expect(server.landed.keys.toSet(), ids.toSet(), reason: 'exactly once');
      expect(server.bodies[1], server.bodies[0], reason: 'same bytes again');
    });

    test('receipts in another order still match their items', () async {
      server.reverse = true;
      await addAll(4);
      await sender.drain();
      expect((await states()).values, everyElement(OutboxState.committed));
    });

    test('a copy already landed comes back as a duplicate', () async {
      final ids = await addAll(1);
      final row = await db.select(db.outbox).getSingle();
      server.landed[ids.single] = row.payloadHash;
      final report = await sender.drain();
      expect(report.outcomes, {OutboxState.committed: 1});
    });

    test('no answer: backoff, and never giving up', () async {
      api
        ..reset('/ingest')
        ..on(
          '/ingest',
          (_) => jsonResponse(503, apiError('UNAVAILABLE', retryable: true)),
        );
      await addAll(2);
      for (var i = 0; i < 12; i++) {
        await sender.drain();
        clock.advance(const Duration(minutes: 15));
      }
      final rows = await db.select(db.outbox).get();
      expect(rows.map((r) => r.state), everyElement(OutboxState.queued));
      expect(rows.first.attempts, greaterThanOrEqualTo(10));
      expect(
        rows.first.nextAttemptMs! - clock.now.millisecondsSinceEpoch,
        lessThanOrEqualTo(const Duration(minutes: 15).inMilliseconds),
      );
    });

    test("the server's Retry-After is honoured", () async {
      api
        ..reset('/ingest')
        ..on(
          '/ingest',
          (_) => jsonResponse(
            429,
            apiError('RATE_LIMITED', retryable: true),
            headers: {'retry-after': '120'},
          ),
        );
      await addAll(1);
      await sender.drain();
      final row = await db.select(db.outbox).getSingle();
      expect(
        row.nextAttemptMs! - clock.now.millisecondsSinceEpoch,
        greaterThanOrEqualTo(120000),
      );
    });

    test('an app killed mid-send sends again once on restart', () async {
      final dir = Directory.systemTemp.createTempSync('fess_pos_kill_');
      addTearDown(() => dir.deleteSync(recursive: true));
      final file = File('${dir.path}/store.db');

      final before = PosDatabase(NativeDatabase(file));
      final s1 = OutboxStore(before, clock: clock.call);
      final id = await s1.add(
        _u1,
        type: 'job_event',
        typeVersion: 1,
        payload: {'x': 1},
      );
      await s1.markInFlight(await before.select(before.outbox).get());
      // The server committed it, then the app died before the receipt.
      server.landed[id] =
          (await before.select(before.outbox).getSingle()).payloadHash;
      await before.close();

      final after = PosDatabase(NativeDatabase(file));
      addTearDown(after.close);
      final report = await senderOn(
        OutboxStore(after, clock: clock.call),
      ).drain();
      expect(report.outcomes, {OutboxState.committed: 1});
      expect(server.landed, hasLength(1));
    });
  });

  test('a batch too large is split; one too large alone is parked', () async {
    server.tooLargeOver = 0;
    await addAll(2);
    await store.add(
      _u1,
      type: 'job_event',
      typeVersion: 1,
      payload: {'big': true},
    );
    // Every multi-envelope request is "too large"; so is the big one alone.
    await sender.drain();
    final rows = await db.select(db.outbox).get();
    final big = rows.singleWhere(
      (r) =>
          (jsonDecode(r.envelope) as Map)['payload'] is Map &&
          ((jsonDecode(r.envelope) as Map)['payload'] as Map).containsKey(
            'big',
          ),
    );
    expect(big.state, OutboxState.needsAttention);
    expect(big.lastError, 'PAYLOAD_TOO_LARGE');
    final others = rows.where((r) => r.type == 'job_event' && r.id != big.id);
    expect(others.map((r) => r.state), everyElement(OutboxState.committed));
    final report = rows.singleWhere((r) => r.type == 'client_error');
    expect(report.state, OutboxState.committed, reason: 'reported too');
  });

  test('refused at the door: parked and reported', () async {
    server.refuseType = 'traces_batch';
    await addAll(1, type: 'traces_batch');
    await sender.drain();
    final rows = await db.select(db.outbox).get();
    expect(
      rows.singleWhere((r) => r.type == 'traces_batch').state,
      OutboxState.needsAttention,
    );
    expect(
      rows.singleWhere((r) => r.type == 'client_error').state,
      OutboxState.committed,
    );
  });

  test('rejected stays for the admin and is not sent again', () async {
    server.rejectType = 'form_submission';
    await addAll(1, type: 'form_submission');
    await sender.drain();
    await sender.drain();
    expect(api.calls('/ingest'), hasLength(1));
    expect(
      (await db.select(db.outbox).getSingle()).state,
      OutboxState.needsAttention,
    );
  });

  test("an ended session holds its user's items until they sign in", () async {
    api
      ..reset('/ingest')
      ..on('/ingest', (_) => jsonResponse(403, apiError('SESSION_REVOKED')));
    await addAll(2);
    final report = await sender.drain();
    expect(report.heldUsers, {'u-1'});
    final rows = await db.select(db.outbox).get();
    expect(rows.map((r) => r.state), everyElement(OutboxState.queued));
    expect(rows.map((r) => r.attempts), everyElement(0));

    await sender.drain();
    expect(api.calls('/ingest'), hasLength(1), reason: 'nothing to send with');

    api
      ..reset('/ingest')
      ..on('/ingest', server.answer);
    await signIn();
    await sender.drain();
    expect((await states()).values, everyElement(OutboxState.committed));
  });

  test('a wrong number of receipts: kept and sent again later', () async {
    api
      ..reset('/ingest')
      ..on('/ingest', (_) => jsonResponse(200, {'receipts': <Object>[]}));
    await addAll(2);
    final report = await sender.drain();
    expect(report.stoppedBy, 'RESPONSE_MALFORMED');
    expect((await states()).values, everyElement(OutboxState.queued));
  });

  test('concurrent drains share one', () async {
    await addAll(2);
    await Future.wait([sender.drain(), sender.drain()]);
    expect(api.calls('/ingest'), hasLength(1));
  });
}
