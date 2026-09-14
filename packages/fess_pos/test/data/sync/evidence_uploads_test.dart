@TestOn('vm')
library;

import 'dart:convert';

import 'package:drift/drift.dart' hide isNotNull, isNull;
import 'package:drift/native.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/remote/evidence_uploader.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/sync/evidence_uploads.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show sha256HexBytes;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../../support/fake_pos_api.dart';

const String _signedUrl =
    'https://pos-qa.example.invalid/storage/v1/object/upload/sign/evidence/'
    'bank/b/job/j/inspection/i/e1.jpg?token=t';

void main() {
  late PosDatabase db;
  late OutboxStore outbox;
  late FakePosApi api;
  late PosApiClient client;
  late List<http.Request> puts;
  late http.Response Function(http.Request) storage;
  late EvidenceUploads uploads;
  final clock = TestClock();
  final bytes = Uint8List.fromList([1, 2, 3, 4]);

  Future<void> putEvidence() => db
      .into(db.evidence)
      .insert(
        EvidenceCompanion.insert(
          id: 'e1',
          inspectionId: 'i1',
          jobId: 'j1',
          userId: 'u-1',
          fieldKey: 'external_photos',
          category: 'external',
          type: 'photo',
          mime: 'image/jpeg',
          sha256: sha256HexBytes(bytes),
          size: bytes.length,
          capturedAtDevice: '2026-09-14T10:00:00.000+02:00',
          capturedMonotonicMs: 1,
          bytes: Value(bytes),
          state: 'local_only',
          createdAtMs: 1,
          updatedAt: '2026-09-14T10:00:00.000+02:00',
        ),
      );

  /// The `evidence_meta` envelope, in [state].
  Future<void> putMeta(String state) async {
    final id = await outbox.add(
      const EnvelopeOrigin(
        deviceId: testDeviceId,
        clientType: 'native',
        userId: 'u-1',
      ),
      type: 'evidence_meta',
      typeVersion: 1,
      entityRef: 'evidence:e1',
      payload: const {'evidence_id': 'e1'},
    );
    await (db.update(db.outbox)..where((o) => o.id.equals(id))).write(
      OutboxCompanion(state: Value(state)),
    );
  }

  Future<EvidenceRow> evidence() =>
      (db.select(db.evidence)..where((e) => e.id.equals('e1'))).getSingle();

  Future<List<OutboxRow>> uploaded() => (db.select(
    db.outbox,
  )..where((o) => o.type.equals('evidence_uploaded'))).get();

  void grant(Map<String, Object?> body) {
    api
      ..reset('/evidence/upload-grant')
      ..on('/evidence/upload-grant', (_) => jsonResponse(200, body));
  }

  setUp(() async {
    db = PosDatabase(NativeDatabase.memory());
    outbox = OutboxStore(db, clock: clock.call);
    api = FakePosApi()
      ..on(
        '/auth/exchange',
        (_) => jsonResponse(200, sessionAnswer(serverTime: clock.now)),
      );
    client = testApiClient(api, clock: clock);
    await client.exchange({'token': 'host'}, issuer: 'pos_dev');
    puts = [];
    storage = (_) => http.Response('{"Key":"evidence/e1.jpg"}', 200);
    uploads = EvidenceUploads(
      outbox: outbox,
      client: client,
      uploader: EvidenceUploader(
        publishableKey: 'sb_publishable_test',
        client: MockClient((r) async {
          puts.add(r);
          return storage(r);
        }),
      ),
      originFor: (userId) async => EnvelopeOrigin(
        deviceId: testDeviceId,
        clientType: 'native',
        userId: userId,
      ),
      clock: clock.call,
    );
    await putEvidence();
  });

  tearDown(() => db.close());

  Map<String, Object?> uploadGrant() => {
    'state': 'upload',
    'evidence_id': 'e1',
    'bucket': 'evidence',
    'path': 'bank/b/job/j/inspection/i/e1.jpg',
    'signed_url': _signedUrl,
    'content_type': 'image/jpeg',
  };

  Future<List<Map<String, Object?>>> clientErrors() async => [
    for (final o in await (db.select(
      db.outbox,
    )..where((o) => o.type.equals('client_error'))).get())
      for (final e
          in ((jsonDecode(o.envelope) as Map<String, Object?>)['payload']!
                  as Map<String, Object?>)['errors']!
              as List<Object?>)
        e! as Map<String, Object?>,
  ];

  group('resumable (T4-13)', () {
    const endpoint =
        'https://pos-qa.example.invalid/storage/v1/upload/resumable/sign';

    Map<String, Object?> resumableGrant() => {
      ...uploadGrant(),
      'resumable': {
        'endpoint': endpoint,
        'headers': {'x-signature': 'sig'},
      },
    };

    test(
      'with a resumable grant the bytes go by TUS: created, then sent',
      () async {
        storage = (r) => switch (r.method) {
          'POST' => http.Response(
            '',
            201,
            headers: {'location': '/storage/v1/upload/resumable/sign/u1'},
          ),
          'PATCH' => http.Response('', 204, headers: {'upload-offset': '4'}),
          _ => http.Response('', 500),
        };
        grant(resumableGrant());
        expect(await uploads.run(), 1);
        expect(puts.map((r) => r.method), ['POST', 'PATCH']);
        final created = puts.first;
        expect(created.url.toString(), endpoint);
        expect(created.headers['upload-length'], '4');
        expect(created.headers['x-signature'], 'sig');
        expect(created.headers['tus-resumable'], '1.0.0');
        expect(
          created.headers['upload-metadata'],
          contains(
            base64Encode(utf8.encode('bank/b/job/j/inspection/i/e1.jpg')),
          ),
        );
        final sent = puts.last;
        expect(
          sent.url.toString(),
          'https://pos-qa.example.invalid/storage/v1/upload/resumable/sign/u1',
        );
        expect(sent.headers['upload-offset'], '0');
        expect(sent.bodyBytes, bytes);
        expect(await uploaded(), hasLength(1));
      },
    );

    test(
      'an interrupted upload carries on from where the storage has it',
      () async {
        var failPatch = true;
        storage = (r) {
          if (r.method == 'POST') {
            return http.Response(
              '',
              201,
              headers: {'location': '$endpoint/u1'},
            );
          }
          if (r.method == 'PATCH' && failPatch) {
            failPatch = false;
            throw http.ClientException('the line dropped');
          }
          if (r.method == 'HEAD') {
            return http.Response('', 200, headers: {'upload-offset': '2'});
          }
          return http.Response('', 204, headers: {'upload-offset': '4'});
        };
        grant(resumableGrant());
        expect(await uploads.run(), 0, reason: 'it waits for the next run');
        expect(await uploaded(), isEmpty);

        puts.clear();
        expect(await uploads.run(), 1);
        expect(puts.map((r) => r.method), ['HEAD', 'PATCH']);
        expect(puts.last.headers['upload-offset'], '2');
        expect(puts.last.bodyBytes, bytes.sublist(2));
        expect(await uploaded(), hasLength(1));
      },
    );

    test('refused as resumable, the bytes go in one PUT', () async {
      storage = (r) => r.method == 'POST'
          ? http.Response('{"message":"not allowed"}', 400)
          : http.Response('{"Key":"evidence/e1.jpg"}', 200);
      grant(resumableGrant());
      expect(await uploads.run(), 1);
      expect(puts.map((r) => r.method), ['POST', 'PUT']);
      expect(puts.last.url.toString(), _signedUrl);
    });
  });

  group('T4-03', () {
    test('a record purged after the server held it still lets the bytes go '
        'up', () async {
      grant(uploadGrant());
      expect(await uploads.run(), 1);
      expect(puts, hasLength(1));
      expect(await uploaded(), hasLength(1));
    });

    test('bytes that no longer match their hash go up anyway, and it is '
        'reported', () async {
      await (db.update(db.evidence)..where((e) => e.id.equals('e1'))).write(
        EvidenceCompanion(sha256: Value('f' * 64)),
      );
      await putMeta(OutboxState.committed);
      grant(uploadGrant());
      expect(await uploads.run(), 1);
      expect(puts, hasLength(1), reason: 'never dropped');
      final error = (await clientErrors()).single;
      expect(error['kind'], 'local_hash_mismatch');
      expect(error['code'], 'EVIDENCE_LOCAL_HASH_MISMATCH');
      expect(error['detail'], {
        'evidence_id': 'e1',
        'recorded_sha256': 'f' * 64,
        'local_sha256': sha256HexBytes(bytes),
      });
    });

    test('evidence whose bytes are gone is reported once, and kept', () async {
      await (db.update(db.evidence)..where((e) => e.id.equals('e1'))).write(
        const EvidenceCompanion(bytes: Value(null)),
      );
      const origin = EnvelopeOrigin(
        deviceId: testDeviceId,
        clientType: 'native',
      );
      await outbox.reportEvidenceAnomalies(origin);
      await outbox.reportEvidenceAnomalies(origin);
      final error = (await clientErrors()).single;
      expect(error['code'], 'EVIDENCE_BYTES_MISSING');
      expect(error['kind'], 'recovery_anomaly');
      expect((error['detail']! as Map)['evidence_id'], 'e1');
      expect(await evidence(), isA<EvidenceRow>(), reason: 'nothing deleted');
    });
  });

  test('once the record is held, the bytes go up and it is said', () async {
    await putMeta(OutboxState.committed);
    grant({
      'state': 'upload',
      'evidence_id': 'e1',
      'bucket': 'evidence',
      'path': 'bank/b/job/j/inspection/i/e1.jpg',
      'content_type': 'image/jpeg',
      'signed_url': _signedUrl,
      'token': 't',
      'expires_in_s': 7200,
    });
    expect(await uploads.run(), 1);
    final put = puts.single;
    expect(put.method, 'PUT');
    expect(put.url.toString(), _signedUrl);
    expect(put.bodyBytes, bytes);
    expect(put.headers['content-type'], 'image/jpeg');
    expect(put.headers['x-upsert'], 'false');
    expect(bodyOf(api.calls('/evidence/upload-grant').single), {
      'evidence_id': 'e1',
    });
    final envelope = (await uploaded()).single;
    final p =
        (jsonDecode(envelope.envelope) as Map<String, Object?>)['payload']!
            as Map<String, Object?>;
    expect(p['evidence_id'], 'e1');
    expect(p['sha256'], sha256HexBytes(bytes));
    expect(p['bytes'], 4);
    expect(p['object_key'], 'bank/b/job/j/inspection/i/e1.jpg');
    expect((await evidence()).state, 'uploaded');
    expect((await evidence()).bytes, bytes, reason: 'kept until verified');

    expect(await uploads.run(), 0, reason: 'nothing left to send');
    expect(puts, hasLength(1));
  });

  test('nothing goes up before the server holds the record', () async {
    await putMeta(OutboxState.queued);
    expect(await uploads.run(), 0);
    expect(api.calls('/evidence/upload-grant'), isEmpty);
  });

  test('an object already stored counts as uploaded', () async {
    await putMeta(OutboxState.durable);
    grant({
      'state': 'upload',
      'evidence_id': 'e1',
      'bucket': 'evidence',
      'path': 'p',
      'signed_url': _signedUrl,
      'token': 't',
      'expires_in_s': 7200,
    });
    storage = (_) => http.Response('{"error":"Duplicate"}', 409);
    expect(await uploads.run(), 1);
    expect((await evidence()).state, 'uploaded');
  });

  test('already verified: the phone lets its copy go', () async {
    await putMeta(OutboxState.committed);
    grant({'state': 'already_verified', 'evidence_id': 'e1'});
    expect(await uploads.run(), 0);
    expect((await evidence()).state, 'verified');
    expect((await evidence()).bytes, isNull);
    expect(await uploaded(), isEmpty);
  });

  test('a failed upload changes nothing and waits', () async {
    await putMeta(OutboxState.committed);
    grant({
      'state': 'upload',
      'evidence_id': 'e1',
      'bucket': 'evidence',
      'path': 'p',
      'signed_url': _signedUrl,
      'token': 't',
      'expires_in_s': 7200,
    });
    storage = (_) => http.Response('busy', 503);
    expect(await uploads.run(), 0);
    expect((await evidence()).state, 'local_only');
    expect((await evidence()).bytes, bytes);
    expect(await uploaded(), isEmpty);
  });
}
