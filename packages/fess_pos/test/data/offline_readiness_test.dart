@TestOn('vm')
library;

import 'dart:convert';

import 'package:drift/drift.dart' hide isNotNull, isNull;
import 'package:drift/native.dart';
import 'package:fess_pos/src/data/local/offline_readiness.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:flutter_test/flutter_test.dart';

final DateTime _now = DateTime.utc(2026, 9, 15, 10);

void main() {
  late PosDatabase db;
  late OfflineReadiness readiness;

  Future<void> job(
    String id, {
    String status = 'accepted',
    String? bank,
    Map<String, Object?>? location,
  }) => db
      .into(db.jobs)
      .insert(
        JobsCompanion.insert(
          id: id,
          reference: 'POS-$id',
          status: status,
          updatedAt: '2026-09-15T08:00:00Z',
          assignedToMe: const Value(true),
          bankId: Value(bank),
          body: jsonEncode({'id': id, 'location': ?location}),
        ),
      );

  Future<void> doc(String key, Map<String, Object?> body) => db
      .into(db.cachedDocuments)
      .insertOnConflictUpdate(
        CachedDocumentsCompanion.insert(
          key: key,
          body: jsonEncode(body),
          updatedAt: '2026-09-15T08:00:00Z',
        ),
      );

  Future<void> token(String jobId, {String validTo = '2026-09-16T08:00:00Z'}) =>
      doc('${DocKeys.sessionTokenPrefix}$jobId', {'valid_to': validTo});

  Future<void> definition(
    String kind,
    String key,
    String versionId, {
    String context = '',
    Map<String, Object?> body = const {},
  }) async {
    await db
        .into(db.definitionVersions)
        .insertOnConflictUpdate(
          DefinitionVersionsCompanion.insert(
            versionId: versionId,
            familyId: 'fam-$key',
            kind: kind,
            key: key,
            version: 1,
            specVersion: '1.0',
            hash: 'h' * 64,
            body: jsonEncode(body),
          ),
        );
    await db
        .into(db.activeDefinitions)
        .insertOnConflictUpdate(
          ActiveDefinitionsCompanion.insert(
            context: context,
            kind: kind,
            key: key,
            versionId: versionId,
          ),
        );
  }

  Future<void> tiles(String jobId) => db
      .into(db.syncState)
      .insertOnConflictUpdate(
        SyncStateCompanion.insert(
          key: 'tiles.job.$jobId',
          value: 'done',
          updatedAt: '2026-09-15T08:00:00Z',
        ),
      );

  setUp(() async {
    db = PosDatabase(NativeDatabase.memory());
    readiness = OfflineReadiness(db, clock: () => _now);
    await definition(
      'flow',
      'site_inspection_flow',
      'flow-1',
      body: {'form_family': 'site_inspection'},
    );
    await definition('form', 'site_inspection', 'form-1');
  });

  tearDown(() => db.close());

  test(
    'a job is ready offline with its token, flow and form (T5-09)',
    () async {
      await job('j1');
      await token('j1');
      await job('j2');
      await job('j3');
      await token('j3', validTo: '2026-09-14T08:00:00Z');
      await job('j4', status: 'approved');
      await token('j4');
      expect(
        await readiness.ready(),
        {'j1'},
        reason:
            'j2 lacks a token, '
            "j3's has lapsed, j4 is no longer the agent's to work on",
      );
    },
  );

  test("a bank's own flow counts, and its form must be there too", () async {
    await job('j5', bank: 'bank-a');
    await token('j5');
    await definition(
      'flow',
      'site_inspection_flow',
      'flow-a',
      context: 'bank-a',
      body: {'form_family': 'bank_a_form'},
    );
    expect(
      await readiness.ready(),
      isEmpty,
      reason: "the bank's form is missing",
    );
    await definition('form', 'bank_a_form', 'form-a', context: 'bank-a');
    expect(await readiness.ready(), {'j5'});
  });

  test(
    'with a map provider set up, a job with a location needs its tiles',
    () async {
      await doc(DocKeys.configDefault, {
        'values': {
          'maps': {'tile_url': 'https://tiles.example/{z}/{x}/{y}.png'},
        },
      });
      await job('j6', location: {'lat': -26.2, 'lng': 28.0});
      await token('j6');
      await job('j7');
      await token('j7');
      expect(await readiness.ready(), {'j7'}, reason: 'j7 has no location');
      await tiles('j6');
      expect(await readiness.ready(), {'j6', 'j7'});
    },
  );
}
