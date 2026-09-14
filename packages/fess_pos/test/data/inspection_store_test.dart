@TestOn('vm')
library;

import 'dart:convert';

import 'package:drift/drift.dart' hide isNotNull, isNull;
import 'package:drift/native.dart';
import 'package:fess_pos/src/data/local/inspection_store.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/action_recorder.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/data/sync/sections.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:fess_pos/src/platform/integrity.dart';
import 'package:fess_pos/src/platform/location.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart'
    show
        SubmissionHashInput,
        answersHash,
        definitionHash,
        payloadHash,
        sha256HexBytes,
        submissionHash;
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

import '../support/fake_platform.dart';
import '../support/fake_pos_api.dart';

const String _bank = 'b0000000-0000-4000-8000-000000000001';
const String _tokenId = '0192d4e0-7c1a-7b2e-9f00-0000000000a1';
final String _token = 'ab' * 32;
const String _configVersion = '0192d4e0-7c1a-7b2e-9f00-0000000000c1';
const String _declarationId = '0192d4e0-7c1a-7b2e-9f00-0000000000d1';

const Map<String, Object?> _form = {
  'spec_version': '1.0',
  'kind': 'form',
  'family': 'site_inspection',
  'version': 1,
  'declaration_key': 'agent_declaration',
  'sections': [
    {
      'key': 'details',
      'fields': [
        {'key': 'merchant_confirm', 'type': 'text', 'required': true},
      ],
    },
    {
      'key': 'evidence',
      'fields': [
        {
          'key': 'external_photos',
          'type': 'photo',
          'required': true,
          'props': {'category': 'external', 'min_count': 1},
        },
      ],
    },
    {
      'key': 'agent',
      'fields': [
        {'key': 'interviewee_signature', 'type': 'signature'},
        {
          'key': 'agent_declaration',
          'type': 'declaration',
          'required': true,
          'props': {'declaration_key': 'agent_declaration'},
        },
      ],
    },
  ],
};

const Map<String, Object?> _flow = {
  'spec_version': '1.0',
  'kind': 'flow',
  'family': 'site_inspection_flow',
  'version': 1,
  'form_family': 'site_inspection',
  'steps': [
    {'type': 'location_check'},
    {
      'type': 'form',
      'sections': ['details', 'evidence', 'agent'],
    },
    {'type': 'declaration', 'declaration_key': 'agent_declaration'},
    {'type': 'submit'},
  ],
};

/// A photo that didn't come from the camera.
class _Gallery implements CapturedPhoto {
  @override
  Uint8List get bytes => Uint8List.fromList([9, 9]);

  @override
  String get mimeType => 'image/jpeg';

  @override
  DateTime get capturedAt => DateTime(2026, 9, 14, 10);

  @override
  Future<void> releaseSource() async {}
}

void main() {
  late PosDatabase db;
  late DriftInspections inspections;
  late FakeLocation location;
  var signedIn = true;
  var now = DateTime(2026, 9, 14, 10);

  JobRecord job({String status = 'accepted'}) => JobRecord(
    id: 'j1',
    reference: 'POS-j1',
    status: status,
    assignedToMe: true,
    bankId: _bank,
    data: const {
      'id': 'j1',
      'reference': 'POS-j1',
      'merchant_name': 'Joe Spaza',
      'location': {'lat': -26.2041, 'lng': 28.0473},
      'location_type': 'standalone',
      'attempts': 1,
    },
  );

  Future<void> putJob({String status = 'accepted'}) => JobsSection(db).apply({
    'jobs': {
      'items': [
        {
          ...job(status: status).data,
          'status': status,
          'assigned_to_me': true,
          'updated_at': '2026-09-14T08:00:00Z',
          'bank': {'id': _bank},
        },
      ],
    },
  });

  Future<void> putDefinition(String id, Map<String, Object?> definition) async {
    final kind = definition['kind']! as String;
    final key = definition['family']! as String;
    await db
        .into(db.definitionVersions)
        .insert(
          DefinitionVersionsCompanion.insert(
            versionId: id,
            familyId: 'fam-$key',
            kind: kind,
            key: key,
            version: 1,
            specVersion: '1.0',
            hash: definitionHash(definition),
            body: jsonEncode(definition),
          ),
        );
    await db
        .into(db.activeDefinitions)
        .insert(
          ActiveDefinitionsCompanion.insert(
            context: '',
            kind: kind,
            key: key,
            versionId: id,
          ),
        );
  }

  Future<void> putDoc(String key, Object body, {String? hash}) => db
      .into(db.cachedDocuments)
      .insertOnConflictUpdate(
        CachedDocumentsCompanion.insert(
          key: key,
          body: jsonEncode(body),
          hash: Value(hash),
          updatedAt: '2026-09-14T08:00:00+02:00',
        ),
      );

  Future<List<OutboxRow>> envelopes(String type) =>
      (db.select(db.outbox)..where((o) => o.type.equals(type))).get();

  Map<String, Object?> payloadOf(OutboxRow r) =>
      (jsonDecode(r.envelope) as Map<String, Object?>)['payload']!
          as Map<String, Object?>;

  Future<JobRow> jobRow() =>
      (db.select(db.jobs)..where((j) => j.id.equals('j1'))).getSingle();

  CameraCaptureResult photo(List<int> bytes) =>
      CameraCaptureResult.forTesting(bytes: Uint8List.fromList(bytes));

  setUp(() async {
    db = PosDatabase(NativeDatabase.memory());
    signedIn = true;
    now = DateTime(2026, 9, 14, 10);
    location = FakeLocation()
      ..fix = LocationFix(
        latitude: -26.2042,
        longitude: 28.0474,
        accuracyM: 8,
        fixTime: DateTime(2026, 9, 14, 9, 59),
        isMocked: false,
      );
    final outbox = OutboxStore(db, clock: () => now);
    inspections = DriftInspections(
      outbox: outbox,
      recorder: ActionRecorder(outbox),
      origin: () async => signedIn
          ? const EnvelopeOrigin(
              deviceId: testDeviceId,
              clientType: 'native',
              userId: 'u-1',
              sessionId: 's-1',
            )
          : null,
      send: () async {},
      location: location,
      integrity: const UnavailableIntegritySignals(),
      diagnostics: () async => {
        'module_version': '0.1.0',
        'platform': 'android',
      },
      clock: () => now,
    );
    await putJob();
    await putDefinition('0192d4e0-7c1a-7b2e-9f00-0000000000f1', _form);
    await putDefinition('0192d4e0-7c1a-7b2e-9f00-0000000000f2', _flow);
    await putDoc(DocKeys.configDefault, {
      'config_version_id': _configVersion,
      'values': {
        'geofence': {
          'profiles': {
            'standalone': {
              'radius_m': 100,
              'max_accuracy_m': 30,
              'exit_consecutive_fixes': 3,
              'prompt_checkin_on_arrival': false,
            },
          },
        },
      },
    }, hash: _configVersion);
    await putDoc('${DocKeys.sessionTokenPrefix}j1', {
      'job_id': 'j1',
      'token_id': _tokenId,
      'token': _token,
      'valid_from': '2026-09-13T08:00:00Z',
      'valid_to': '2026-09-16T08:00:00Z',
    });
    await putDoc(DocKeys.me, {'id': 'u-1', 'first_name': 'Sipho'});
  });

  tearDown(() => db.close());

  group('beginning', () {
    test(
      'pins the versions, freezes the context and records the start',
      () async {
        final result = await inspections.begin(job());
        expect(result.status, BeginStatus.begun);
        final started = (await envelopes('inspection_started')).single;
        expect(started.entityRef, 'job:j1');
        expect(started.lane, OutboxLane.actions);
        final p = payloadOf(started);
        expect(p['inspection_id'], result.inspectionId);
        expect(p['attempt'], 2, reason: 'the server says one attempt exists');
        expect(p['session_token_id'], _tokenId);
        expect(p['session_token'], _token);
        expect(p['definition_hash'], definitionHash(_form));
        expect(p['flow_hash'], definitionHash(_flow));
        expect(p['config_version_id'], _configVersion);
        final geofence = p['geofence_result']! as Map<String, Object?>;
        expect(geofence['profile'], 'standalone');
        expect(geofence['passed'], isTrue);
        expect(geofence['distance_m'], lessThan(100));
        expect(
          (geofence['profile_params']! as Map<String, Object?>)['radius_m'],
          100,
        );
        final integrity = p['integrity']! as Map<String, Object?>;
        expect(integrity['mock_location'], isFalse);
        expect(
          (integrity['extra']! as Map<String, Object?>)['signals_available'],
          isFalse,
          reason: 'no RASP yet: recorded as unknown, never as clean',
        );
        final context = p['context_snapshot']! as Map<String, Object?>;
        expect(context['today'], '2026-09-14');
        expect(
          (context['agent']! as Map<String, Object?>)['first_name'],
          'Sipho',
        );
        expect(
          (context['inspection']! as Map<String, Object?>)['attempt'],
          2,
        );
        expect((await jobRow()).status, 'in_progress');
      },
    );

    test('a second begin opens the same inspection', () async {
      final first = await inspections.begin(job());
      final second = await inspections.begin(job());
      expect(second.inspectionId, first.inspectionId);
      expect(await envelopes('inspection_started'), hasLength(1));
    });

    test('only an accepted (or returned) job of the agent may begin', () async {
      await putJob(status: 'assigned');
      expect(
        (await inspections.begin(job(status: 'assigned'))).status,
        BeginStatus.notAllowed,
      );
      expect(await envelopes('inspection_started'), isEmpty);
    });

    test('nothing begins without the definitions or a session', () async {
      await db.delete(db.activeDefinitions).go();
      expect(
        (await inspections.begin(job())).status,
        BeginStatus.definitionsMissing,
      );
      signedIn = false;
      expect(
        (await inspections.begin(job())).status,
        BeginStatus.unavailable,
      );
    });

    test('with no location fix it still begins, and says so', () async {
      location.fix = null;
      await inspections.begin(job());
      final p = payloadOf((await envelopes('inspection_started')).single);
      final geofence = p['geofence_result']! as Map<String, Object?>;
      expect(geofence['fix'], isNull);
      expect(geofence['passed'], isFalse);
    });

    test("a pull keeps the phone's status while the start waits", () async {
      await inspections.begin(job());
      await putJob();
      expect((await jobRow()).status, 'in_progress');
    });
  });

  group('evidence', () {
    late String id;

    setUp(() async {
      id = (await inspections.begin(job())).inspectionId!;
    });

    test('a photo is made canonical: upright, fitted, stripped, then '
        'hashed (T4-02)', () async {
      final taken = img.Image(width: 2600, height: 1300);
      img.fill(taken, color: img.ColorRgb8(200, 30, 30));
      taken.exif.imageIfd.orientation = 6;
      final evidenceId = await inspections.recordPhoto(
        id,
        fieldKey: 'external_photos',
        category: 'external',
        photo: photo(img.encodeJpg(taken)),
      );
      final row = await (db.select(
        db.evidence,
      )..where((e) => e.id.equals(evidenceId))).getSingle();
      expect((row.width, row.height), (1024, 2048), reason: 'upright, 2048');
      expect(row.mime, 'image/jpeg');
      expect(row.sha256, sha256HexBytes(row.bytes!), reason: 'what is kept');
      final stored = img.decodeJpg(row.bytes!)!;
      expect(stored.exif.imageIfd.hasOrientation, isFalse);
      final p = payloadOf((await envelopes('evidence_meta')).single);
      expect((p['width'], p['height']), (1024, 2048));
      expect(p['sha256'], row.sha256);
      expect(p['meta'], isEmpty);
    });

    test('a caption is kept with the photo, trimmed and at most 500 '
        'characters (T4-04)', () async {
      final evidenceId = await inspections.recordPhoto(
        id,
        fieldKey: 'external_photos',
        category: 'external',
        photo: photo(img.encodeJpg(img.Image(width: 40, height: 30))),
        caption: '  The front door  ',
      );
      final p = payloadOf((await envelopes('evidence_meta')).single);
      expect(p['meta'], {'caption': 'The front door'});
      final items = await inspections.watchEvidence(id).first;
      expect(items.single.id, evidenceId);
      expect(items.single.caption, 'The front door');

      await inspections.recordPhoto(
        id,
        fieldKey: 'external_photos',
        category: 'external',
        photo: photo(img.encodeJpg(img.Image(width: 40, height: 30))),
        caption: 'x' * 600,
      );
      await inspections.recordPhoto(
        id,
        fieldKey: 'external_photos',
        category: 'external',
        photo: photo(img.encodeJpg(img.Image(width: 40, height: 30))),
        caption: '   ',
      );
      final metas = [
        for (final e in await envelopes('evidence_meta')) payloadOf(e)['meta'],
      ];
      expect(metas.map((m) => ((m! as Map)['caption'] as String?)?.length), [
        14,
        500,
        null,
      ]);
    });

    test('a capture that is no image is kept as taken, and marked', () async {
      final bytes = [1, 2, 3, 4];
      final evidenceId = await inspections.recordPhoto(
        id,
        fieldKey: 'external_photos',
        category: 'external',
        photo: photo(bytes),
      );
      final row = await (db.select(
        db.evidence,
      )..where((e) => e.id.equals(evidenceId))).getSingle();
      expect(row.bytes, bytes);
      expect(row.sha256, sha256HexBytes(bytes));
      expect(row.state, 'local_only');
      final meta = (await envelopes('evidence_meta')).single;
      expect(meta.entityRef, 'evidence:$evidenceId');
      expect(meta.lane, OutboxLane.evidence);
      final p = payloadOf(meta);
      expect(p['sha256'], sha256HexBytes(bytes));
      expect(p['bytes'], 4);
      expect(p['session_token_id'], _tokenId);
      expect(p['location'], {'lat': -26.2042, 'lng': 28.0474});
      expect(p['is_mocked'], isFalse);
      expect(p['meta'], {'canonical': false});
      expect(await inspections.evidenceBytes(evidenceId), bytes);
    });

    test('a photo that did not come from the camera is refused', () async {
      await expectLater(
        inspections.recordPhoto(
          id,
          fieldKey: 'external_photos',
          category: 'external',
          photo: _Gallery(),
        ),
        throwsArgumentError,
      );
      expect(await db.select(db.evidence).get(), isEmpty);
    });

    test('a signature keeps the hash of its strokes', () async {
      final strokes = [
        [
          [1.0, 2.0, 0],
          [3.0, 4.0, 16],
        ],
      ];
      final evidenceId = await inspections.recordSignature(
        id,
        fieldKey: 'interviewee_signature',
        signature: SignatureCapture(
          strokes: strokes,
          png: Uint8List.fromList([137, 80, 78, 71]),
          width: 600,
          height: 300,
          capturedAt: now,
        ),
      );
      final p = payloadOf((await envelopes('evidence_meta')).single);
      expect(p['evidence_id'], evidenceId);
      expect(p['type'], 'signature');
      expect(p['mime'], 'image/png');
      expect(p['width'], 600);
      expect(
        (p['meta']! as Map<String, Object?>)['strokes_sha256'],
        payloadHash(strokes),
      );
    });

    test('the answers so far are kept, with the step and the marks', () async {
      await inspections.saveDraft(
        id,
        values: {'merchant_confirm': 'Joe'},
        otherText: const {},
        currentStep: 2,
        unknownDates: {'opened_on'},
        flaggedDiffers: {'trading_name'},
      );
      final record = await inspections.watch(id).first;
      expect(record!.values, {'merchant_confirm': 'Joe'});
      expect(record.currentStep, 2);
      expect(record.unknownDates, {'opened_on'});
      expect(record.flaggedDiffers, {'trading_name'});
    });
  });

  group('submitting', () {
    test('seals the answers and the manifest of what they name', () async {
      final id = (await inspections.begin(job())).inspectionId!;
      final a = await inspections.recordPhoto(
        id,
        fieldKey: 'external_photos',
        category: 'external',
        photo: photo([1]),
      );
      final b = await inspections.recordPhoto(
        id,
        fieldKey: 'external_photos',
        category: 'external',
        photo: photo([2]),
      );
      final signature = await inspections.recordSignature(
        id,
        fieldKey: 'interviewee_signature',
        signature: SignatureCapture(
          strokes: const [
            [
              [0, 0, 0],
              [1, 1, 5],
            ],
          ],
          png: Uint8List.fromList([3]),
          width: 2,
          height: 2,
          capturedAt: now,
        ),
      );
      final answers = <String, Object?>{
        'merchant_confirm': {'v': 'Joe Spaza'},
        'external_photos': {
          'v': [a, b],
        },
        'interviewee_signature': {'v': signature},
        'agent_declaration': {
          'v': {
            'accepted': true,
            'declaration_version_id': _declarationId,
            'accepted_at': '2026-09-14T10:30:00.000+02:00',
          },
        },
      };
      now = now.add(const Duration(minutes: 40));
      final result = await inspections.submit(id, answers: answers);
      expect(result.status, JobActionStatus.recorded);

      final submission = (await envelopes('submission')).single;
      expect(submission.id, result.envelopeId);
      expect(submission.entityRef, 'job:j1');
      final p = payloadOf(submission);
      final items =
          (p['manifest']! as Map<String, Object?>)['items']! as List<Object?>;
      expect(
        [for (final i in items) (i! as Map)['evidence_id']],
        [
          a,
          b,
          signature,
        ],
      );
      expect([for (final i in items) (i! as Map)['item_index']], [0, 1, null]);
      expect(p['answers_hash'], answersHash(answers));
      expect(
        p['submission_hash'],
        submissionHash(
          SubmissionHashInput(
            answersHash: answersHash(answers),
            evidenceHashes: [
              sha256HexBytes([1]),
              sha256HexBytes([2]),
              sha256HexBytes([3]),
            ],
            sessionTokenId: _tokenId,
            startedAtDevice: p['started_at_device']! as String,
            submittedAtDevice: p['submitted_at_device']! as String,
            deviceId: testDeviceId,
          ),
        ),
      );
      expect(
        (p['definition_refs']! as Map<String, Object?>)['form'],
        {
          'version_id': '0192d4e0-7c1a-7b2e-9f00-0000000000f1',
          'hash': definitionHash(_form),
        },
      );
      expect((await jobRow()).status, 'submitted');
      expect((await inspections.watch(id).first)!.submitted, isTrue);

      final again = await inspections.submit(id, answers: answers);
      expect(again.status, JobActionStatus.notAllowed);
      expect(await envelopes('submission'), hasLength(1));
    });
  });
}
