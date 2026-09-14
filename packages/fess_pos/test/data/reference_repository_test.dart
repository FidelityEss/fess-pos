import 'dart:convert';

import 'package:drift/native.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/local/repositories.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/domain/forms/reason_codes.dart';
import 'package:flutter_test/flutter_test.dart';

/// Reason codes as the pull sends them (`reason_codes.items`).
List<Map<String, Object?>> _items() => [
  {
    'id': 'r1',
    'category': 'assignment_reject',
    'code': 'unavailable',
    'label': 'Not available',
    'description': null,
    'requires_note': false,
    'requires_photo': false,
    'bank_id': null,
    'sort_order': 1,
  },
  {
    'id': 'r2',
    'category': 'assignment_reject',
    'code': 'conflict',
    'label': 'Conflict of interest',
    'description': 'You know the merchant',
    'requires_note': true,
    'requires_photo': false,
    'bank_id': null,
    'sort_order': 2,
  },
  {
    'id': 'r3',
    'category': 'assignment_reject',
    'code': 'unavailable',
    'label': 'On leave',
    'requires_note': false,
    'requires_photo': false,
    'bank_id': 'bank-a',
    'sort_order': 1,
  },
  {
    'id': 'r4',
    'category': 'assignment_reject',
    'code': 'bank_b_only',
    'label': 'Bank B reason',
    'bank_id': 'bank-b',
    'sort_order': 3,
  },
  {
    'id': 'r5',
    'category': 'unable_to_complete',
    'code': 'incorrect_address',
    'label': 'Incorrect address',
    'requires_note': true,
    'requires_photo': true,
    'bank_id': null,
    'sort_order': 1,
  },
  {'category': 'broken'},
];

void main() {
  group('reasonCodeLists', () {
    final codes = [for (final i in _items()) ?ReasonCode.tryParse(i)];

    test('a malformed code is left out', () {
      expect(codes, hasLength(5));
    });

    test('global codes by category, in the server order, with meta', () {
      final lists = reasonCodeLists(codes);
      final reject = lists.reasonCodes['assignment_reject']!;
      expect(reject.map((o) => o.value), ['unavailable', 'conflict']);
      expect(reject[1].label, 'Conflict of interest');
      expect(reject[1].helpText, 'You know the merchant');
      expect(reject[1].meta, {'requires_note': true, 'requires_photo': false});
      expect(lists.reasonCodes['unable_to_complete']!.single.meta, {
        'requires_note': true,
        'requires_photo': true,
      });
    });

    test(
      "a bank's own code replaces the global one; other banks' stay out",
      () {
        final reject = reasonCodeLists(
          codes,
          bankId: 'bank-a',
        ).reasonCodes['assignment_reject']!;
        expect(reject.map((o) => o.label), [
          'On leave',
          'Conflict of interest',
        ]);
      },
    );
  });

  group('DriftReferenceRepository', () {
    late PosDatabase db;

    setUp(() => db = PosDatabase(NativeDatabase.memory()));
    tearDown(() => db.close());

    Future<void> put(String body) => db
        .into(db.cachedDocuments)
        .insertOnConflictUpdate(
          CachedDocumentsCompanion.insert(
            key: DocKeys.reasonCodes,
            body: body,
            updatedAt: '2026-09-14T10:00:00+02:00',
          ),
        );

    test('reads the cached list, live', () async {
      final repo = DriftReferenceRepository(db);
      final seen = <int>[];
      final sub = repo.watchReasonCodes().listen((l) => seen.add(l.length));
      await pumpEventQueue();
      await put(jsonEncode(_items()));
      await pumpEventQueue();
      await sub.cancel();
      expect(seen, [0, 5]);
    });

    test('a damaged document reads as no codes', () async {
      await put('{not json');
      expect(
        await DriftReferenceRepository(db).watchReasonCodes().first,
        isEmpty,
      );
    });
  });
}
