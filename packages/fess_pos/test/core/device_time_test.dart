import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'isoWithOffset writes local time with its offset, to the millisecond',
    () {
      final t = DateTime.utc(2026, 9, 13, 8, 31, 2, 114, 567);
      final text = isoWithOffset(t);
      expect(
        text,
        matches(
          RegExp(
            r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$',
          ),
        ),
      );
      // The same instant, to the millisecond, whatever the machine's zone.
      expect(
        DateTime.parse(text).millisecondsSinceEpoch,
        t.millisecondsSinceEpoch,
      );
    },
  );
}
