import 'package:fess_pos/src/domain/storage/storage_budget.dart';
import 'package:flutter_test/flutter_test.dart';

const int _mb = 1024 * 1024;

void main() {
  final budget = StorageBudget.ofMb(500, 80);

  test('new inspections stop at 80% of the cap, or when the phone lacks '
      'the room the cap keeps (T5-08)', () {
    expect(budget.blockAtBytes, 400 * _mb);
    expect(budget.headroomBytes, 100 * _mb);
    expect(
      budget.allowsNewWork(
        const StorageUse(usedBytes: 399 * _mb, freeBytes: 2048 * _mb),
      ),
      isTrue,
    );
    expect(
      budget.allowsNewWork(
        const StorageUse(usedBytes: 400 * _mb, freeBytes: 2048 * _mb),
      ),
      isFalse,
      reason: 'the module is at 80% of its cap',
    );
    expect(
      budget.allowsNewWork(
        const StorageUse(usedBytes: 10 * _mb, freeBytes: 99 * _mb),
      ),
      isFalse,
      reason: 'the phone lacks the room to finish one',
    );
  });

  test('an unknown figure never stops work', () {
    expect(budget.allowsNewWork(StorageUse.unknown), isTrue);
    expect(
      budget.allowsNewWork(const StorageUse(usedBytes: 10 * _mb)),
      isTrue,
    );
    expect(canCapture(StorageUse.unknown), isTrue);
  });

  test('a photo needs the capture floor free', () {
    expect(
      canCapture(const StorageUse(usedBytes: 0, freeBytes: 15 * _mb)),
      isFalse,
    );
    expect(
      canCapture(const StorageUse(usedBytes: 0, freeBytes: 16 * _mb)),
      isTrue,
    );
  });
}
