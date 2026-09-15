@TestOn('vm')
library;

import 'dart:convert';

import 'package:drift/drift.dart' hide isNotNull, isNull;
import 'package:drift/native.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/local/repositories.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/data/sync/sections.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show sha256Hex;
import 'package:flutter_test/flutter_test.dart';

const String _text = 'I declare that I personally visited these premises.';

void main() {
  late PosDatabase db;
  var now = DateTime.utc(2026, 9, 14, 8);

  Future<Map<String, Object?>?> doc(String key) async {
    final row = await (db.select(
      db.cachedDocuments,
    )..where((d) => d.key.equals(key))).getSingleOrNull();
    return row == null ? null : jsonDecode(row.body) as Map<String, Object?>;
  }

  setUp(() {
    db = PosDatabase(NativeDatabase.memory());
    now = DateTime.utc(2026, 9, 14, 8);
  });

  tearDown(() => db.close());

  group('session tokens', () {
    Map<String, Object?> token(
      String job, {
      String validTo = '2026-09-16T08:00:00Z',
    }) => {
      'job_id': job,
      'token_id': '0192d4e0-7c1a-7b2e-9f00-0000000000a$job',
      'token': 'ab' * 32,
      'valid_from': '2026-09-13T08:00:00Z',
      'valid_to': validTo,
    };

    test('each job keeps its token, reported while it is valid', () async {
      final section = SessionTokensSection(db, clock: () => now);
      await section.apply({
        'session_tokens': [token('1'), token('2')],
      });
      expect(
        (await doc('${DocKeys.sessionTokenPrefix}1'))!['token'],
        'ab' * 32,
      );
      final have = <String, Object?>{};
      await section.describeHave(have);
      expect(have['session_token_job_ids'], unorderedEquals(['1', '2']));
    });

    test('a lapsed token is dropped, so the next pull brings one', () async {
      final section = SessionTokensSection(db, clock: () => now);
      await section.apply({
        'session_tokens': [token('1', validTo: '2026-09-14T09:00:00Z')],
      });
      now = now.add(const Duration(hours: 2));
      await section.apply({'session_tokens': <Object?>[]});
      expect(await doc('${DocKeys.sessionTokenPrefix}1'), isNull);
      final have = <String, Object?>{};
      await section.describeHave(have);
      expect(have['session_token_job_ids'], isEmpty);
    });
  });

  group('declarations', () {
    Map<String, Object?> body(
      int version, {
      String text = _text,
      String? hash,
    }) => {
      'id': '0192d4e0-7c1a-7b2e-9f00-00000000d00$version',
      'key': 'agent_declaration',
      'version': version,
      'hash': hash ?? sha256Hex(text),
      'title': 'Agent declaration',
      'text': text,
    };

    test('the latest version is kept once its text matches its hash', () async {
      final section = DeclarationsSection(db, clock: () => now);
      await section.apply({
        'declarations': {
          'manifest': <Object?>[],
          'bodies': [body(1)],
        },
      });
      final stored = await doc('${DocKeys.declarationPrefix}agent_declaration');
      expect(stored!['text'], _text);
      final have = <String, Object?>{};
      await section.describeHave(have);
      expect(have['declaration_ids'], [body(1)['id']]);

      await section.apply({
        'declarations': {
          'manifest': <Object?>[],
          'bodies': [body(2, text: 'New wording.')],
        },
      });
      expect(
        (await doc(
          '${DocKeys.declarationPrefix}agent_declaration',
        ))!['version'],
        2,
      );
      await section.apply({
        'declarations': {
          'manifest': <Object?>[],
          'bodies': [body(1)],
        },
      });
      expect(
        (await doc(
          '${DocKeys.declarationPrefix}agent_declaration',
        ))!['version'],
        2,
        reason: 'an older version never replaces a newer one',
      );
    });

    test('a pull page as the server sends it is kept and read back', () async {
      // The seeded wording (supabase/seed/10_reference.sql), em dash included,
      // through JSON as it travels, with the server's hash of its UTF-8 text.
      const seeded =
          'DRAFT — wording pending confirmation (D-12). I declare that I '
          'personally visited these premises at the time recorded.';
      final page =
          jsonDecode(
                jsonEncode({
                  'declarations': {
                    'manifest': [
                      {
                        'id': '0192d4e0-7c1a-7b2e-9f00-00000000d001',
                        'key': 'agent_declaration',
                        'version': 1,
                        'hash': sha256Hex(seeded),
                      },
                    ],
                    'bodies': [
                      {
                        'id': '0192d4e0-7c1a-7b2e-9f00-00000000d001',
                        'key': 'agent_declaration',
                        'version': 1,
                        'title': 'Agent declaration',
                        'text': seeded,
                        'hash': sha256Hex(seeded),
                      },
                    ],
                  },
                }),
              )
              as Map<String, Object?>;
      await DeclarationsSection(db, clock: () => now).apply(page);
      final read = await DriftDeclarationRepository(
        db,
      ).watch('agent_declaration').first;
      expect(read?.text, seeded);
      expect(read?.version, 1);
    });

    test('wording that does not match its hash is never kept', () async {
      await DeclarationsSection(db, clock: () => now).apply({
        'declarations': {
          'manifest': <Object?>[],
          'bodies': [body(1, hash: 'f' * 64)],
        },
      });
      expect(
        await doc('${DocKeys.declarationPrefix}agent_declaration'),
        isNull,
      );
    });
  });

  group('evidence states', () {
    Future<void> putEvidence(String id, String state) => db
        .into(db.evidence)
        .insert(
          EvidenceCompanion.insert(
            id: id,
            inspectionId: 'i1',
            jobId: 'j1',
            userId: 'u-1',
            fieldKey: 'external_photos',
            category: 'external',
            type: 'photo',
            mime: 'image/jpeg',
            sha256: 'a' * 64,
            size: 3,
            capturedAtDevice: '2026-09-14T10:00:00.000+02:00',
            capturedMonotonicMs: 1,
            bytes: Value(Uint8List.fromList([1, 2, 3])),
            state: state,
            createdAtMs: 1,
            updatedAt: '2026-09-14T10:00:00.000+02:00',
          ),
        );

    Future<EvidenceRow> row(String id) =>
        (db.select(db.evidence)..where((e) => e.id.equals(id))).getSingle();

    test('verified bytes leave the phone; the record stays', () async {
      await putEvidence('e1', 'uploaded');
      await putEvidence('e2', 'uploaded');
      await putEvidence('e3', 'local_only');
      await EvidenceSection(db, clock: () => now).apply({
        'evidence': {
          'items': [
            {'id': 'e1', 'upload_state': 'verified'},
            {'id': 'e2', 'upload_state': 'quarantined'},
            {'id': 'e3', 'upload_state': 'uploaded'},
            {'id': 'unknown', 'upload_state': 'verified'},
          ],
          'next_cursor': null,
          'has_more': false,
        },
      });
      expect((await row('e1')).state, 'verified');
      expect((await row('e1')).bytes, isNull);
      expect((await row('e2')).state, 'quarantined');
      expect((await row('e2')).bytes, isNotNull, reason: 'kept for review');
      expect((await row('e3')).state, 'uploaded');
    });
  });
}
