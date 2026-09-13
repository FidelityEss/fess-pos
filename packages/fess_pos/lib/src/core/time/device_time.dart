/// ISO-8601 with the device's UTC offset and millisecond precision, e.g.
/// `2026-09-13T10:31:02.114+02:00` — how every device time is written
/// (docs/12 §4, §11). `DateTime.toIso8601String` drops the offset of a local
/// time, so it can't be used for this.
String isoWithOffset(DateTime time) {
  final t = time.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  final offset = t.timeZoneOffset;
  final sign = offset.isNegative ? '-' : '+';
  final minutes = offset.inMinutes.abs();
  return '${t.year.toString().padLeft(4, '0')}-${two(t.month)}-${two(t.day)}'
      'T${two(t.hour)}:${two(t.minute)}:${two(t.second)}'
      '.${t.millisecond.toString().padLeft(3, '0')}'
      '$sign${two(minutes ~/ 60)}:${two(minutes % 60)}';
}
