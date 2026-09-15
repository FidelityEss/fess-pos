import 'package:fess_pos/src/domain/sync/lost_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test("a lost store's outcome is what the note beside it said (T5-13)", () {
    final unsent = LostStore.fromJson(const {
      'name': 'fess_pos-a',
      'at': '2026-09-15T10:00:00Z',
      'reason': 'LOCAL_STORE_KEY_MISSING',
      'custody': {
        'waiting': 3,
        'oldest_pending_at': '2026-09-15T08:00:00+02:00',
        'updated_at': '2026-09-15T09:59:00+02:00',
      },
    });
    expect(unsent.outcome, LostStoreOutcome.unsentUnrecoverable);
    expect(unsent.waiting, 3);
    expect(unsent.reason, 'LOCAL_STORE_KEY_MISSING');
    expect(unsent.oldestPendingAt, '2026-09-15T08:00:00+02:00');

    expect(
      LostStore.fromJson(const {
        'name': 'b',
        'at': 'x',
        'custody': {'waiting': 0},
      }).outcome,
      LostStoreOutcome.nothingUnsent,
    );
    expect(
      LostStore.fromJson(const {'name': 'c', 'at': 'x'}).outcome,
      LostStoreOutcome.unknown,
      reason: 'no note: what was on it is unknown, never assumed empty',
    );
  });
}
