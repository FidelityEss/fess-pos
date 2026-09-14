import 'package:fess_pos_engine/fess_pos_engine.dart' show readPath;

final RegExp _placeholder = RegExp(r'\{\{\s*([A-Za-z0-9_.]+)\s*\}\}');

/// Fills `{{path}}` placeholders from [data] (docs/04 §4.3, template
/// labels). A missing value leaves nothing, never the raw placeholder.
String fillTemplate(String text, Object? data) => text.replaceAllMapped(
  _placeholder,
  (m) => displayValue(readPath(data, m[1]!)) ?? '',
);

/// A bound value as text, or null when there's nothing to show.
String? displayValue(Object? value) => switch (value) {
  null => null,
  final String s => s.trim().isEmpty ? null : s,
  final int n => '$n',
  final double n => n == n.truncateToDouble() ? '${n.toInt()}' : '$n',
  final bool b => b ? 'Yes' : 'No',
  _ => null,
};

/// An address object as lines: street to postal code, blanks skipped.
List<String> addressLines(Object? address) {
  if (address is String) return address.trim().isEmpty ? const [] : [address];
  if (address is! Map<String, Object?>) return const [];
  final line = [
    address['suburb'],
    address['city'],
  ].map(displayValue).whereType<String>().join(', ');
  return [
    ?displayValue(address['line1']),
    ?displayValue(address['line2']),
    if (line.isNotEmpty) line,
    ?[
      address['province'],
      address['postal_code'],
    ].map(displayValue).whereType<String>().join(' ').nullIfEmpty,
  ];
}

extension on String {
  String? get nullIfEmpty => isEmpty ? null : this;
}

/// A visit window, e.g. `14 Sep 2026, 09:00–13:00`, in the phone's time
/// zone. [month] names months (content, `date.month.N`).
String? scheduleText(
  Object? start,
  Object? end, {
  required String Function(int month) month,
}) {
  final from = start is String ? DateTime.tryParse(start)?.toLocal() : null;
  if (from == null) return null;
  final to = end is String ? DateTime.tryParse(end)?.toLocal() : null;
  String two(int n) => n.toString().padLeft(2, '0');
  String time(DateTime t) => '${two(t.hour)}:${two(t.minute)}';
  String day(DateTime t) => '${t.day} ${month(t.month)} ${t.year}';
  final sameDay =
      to != null &&
      to.year == from.year &&
      to.month == from.month &&
      to.day == from.day;
  if (to == null) return '${day(from)}, ${time(from)}';
  if (sameDay) return '${day(from)}, ${time(from)}–${time(to)}';
  return '${day(from)}, ${time(from)} – ${day(to)}, ${time(to)}';
}
