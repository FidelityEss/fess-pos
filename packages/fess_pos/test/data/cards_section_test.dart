@TestOn('vm')
library;

import 'dart:convert';

import 'package:drift/native.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/local/repositories.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/data/sync/sections.dart';
import 'package:flutter_test/flutter_test.dart';

final DateTime _now = DateTime.utc(2026, 9, 14, 10);

Map<String, Object?> _card(String job, String hex, String validTo) => {
  'job_id': job,
  'token': hex * 32,
  'valid_to': validTo,
};

void main() {
  late PosDatabase db;
  late CardsSection section;

  setUp(() {
    db = PosDatabase(NativeDatabase.memory());
    section = CardsSection(db, clock: () => _now);
  });

  tearDown(() => db.close());

  Future<List<String>> keys() async => [
    for (final r in await db.select(db.cachedDocuments).get()) r.key,
  ]..sort();

  test('job cards are kept; lapsed ones go; the rest are reported', () async {
    await section.apply({
      'job_cards': [
        _card('j1', 'a', '2026-09-15T10:00:00Z'),
        _card('j2', 'b', '2026-09-14T10:30:00Z'), // half an hour left
        _card('j3', 'c', '2026-09-14T09:00:00Z'), // already lapsed
        {'job_id': 'j4'},
      ],
    });
    expect(await keys(), ['job_card:j1', 'job_card:j2']);
    final have = <String, Object?>{};
    await section.describeHave(have);
    expect(
      (have['job_card_job_ids']! as List<Object?>).toSet(),
      {'j1', 'j2'},
      reason: 'every valid card is held, so the server issues no new token',
    );

    // Once j2 lapses it goes, and isn't reported: the next pull brings one.
    final later = CardsSection(db, clock: () => DateTime.utc(2026, 9, 14, 11));
    await later.apply({'job_cards': <Object?>[]});
    final after = <String, Object?>{};
    await later.describeHave(after);
    expect(after['job_card_job_ids'], ['j1']);
    expect(await keys(), ['job_card:j1']);
  });

  test('a card the server issues again replaces the old one', () async {
    await section.apply({
      'job_cards': [_card('j1', 'a', '2026-09-15T10:00:00Z')],
    });
    await section.apply({
      'job_cards': [_card('j1', 'd', '2026-09-16T10:00:00Z')],
    });
    final card = await DriftCardRepository(db).watchJobCard('j1').first;
    expect(card?.token, 'd' * 32);
    expect(card?.validTo, DateTime.utc(2026, 9, 16, 10));
  });

  test("the agent's card reads from what the pull kept", () async {
    final repo = DriftCardRepository(db);
    expect(await repo.watchAgentCard().first, isNull);
    await db
        .into(db.cachedDocuments)
        .insert(
          CachedDocumentsCompanion.insert(
            key: DocKeys.agentCard,
            body: jsonEncode({
              'token': 'e' * 32,
              'valid_to': '2026-09-15T10:00:00Z',
            }),
            updatedAt: '2026-09-14T12:00:00+02:00',
          ),
        );
    expect((await repo.watchAgentCard().first)?.token, 'e' * 32);
  });
}
