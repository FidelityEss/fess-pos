/// Calendar arithmetic on ISO dates with pure integer algorithms (H.
/// Hinnant's days-from-civil), identical to `src/rules/dates.ts`. No time
/// zones, no wall clock.
library;

import 'package:fess_pos_engine/src/errors.dart';

typedef CivilDate = ({int y, int m, int d});

final RegExp _date = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');
final RegExp _dateTime = RegExp(
  r'^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,9})?)?'
  r'(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$',
);

/// Floor division, as JavaScript's `Math.floor(a / b)`.
int _fdiv(int a, int b) => (a / b).floor();

bool isLeapYear(int y) => (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;

int daysInMonth(int y, int m) {
  if (m == 2) return isLeapYear(y) ? 29 : 28;
  return m == 4 || m == 6 || m == 9 || m == 11 ? 30 : 31;
}

/// `YYYY-MM-DD`, or the date part of an ISO datetime with offset. Null when
/// malformed.
CivilDate? tryParseDate(String s) {
  final m = _date.firstMatch(s) ?? _dateTime.firstMatch(s);
  if (m == null) return null;
  final y = int.parse(m[1]!);
  final mo = int.parse(m[2]!);
  final d = int.parse(m[3]!);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return (y: y, m: mo, d: d);
}

bool isIsoDate(String s) => _date.hasMatch(s) && tryParseDate(s) != null;

bool isIsoDateTime(String s) =>
    _dateTime.hasMatch(s) && tryParseDate(s) != null;

CivilDate parseDate(String s, String op) =>
    tryParseDate(s) ??
    (throw RuleError('RULE_INVALID_DATE', '$op: "$s" is not an ISO date'));

int daysFromCivil(CivilDate date) {
  final y = date.m <= 2 ? date.y - 1 : date.y;
  final era = _fdiv(y, 400);
  final yoe = y - era * 400;
  final mp = (date.m + 9) % 12;
  final doy = _fdiv(153 * mp + 2, 5) + date.d - 1;
  final doe = yoe * 365 + _fdiv(yoe, 4) - _fdiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

CivilDate civilFromDays(int z0) {
  final z = z0 + 719468;
  final era = _fdiv(z, 146097);
  final doe = z - era * 146097;
  final yoe = _fdiv(
    doe - _fdiv(doe, 1460) + _fdiv(doe, 36524) - _fdiv(doe, 146096),
    365,
  );
  final y = yoe + era * 400;
  final doy = doe - (365 * yoe + _fdiv(yoe, 4) - _fdiv(yoe, 100));
  final mp = _fdiv(5 * doy + 2, 153);
  final d = doy - _fdiv(153 * mp + 2, 5) + 1;
  final m = mp < 10 ? mp + 3 : mp - 9;
  return (y: m <= 2 ? y + 1 : y, m: m, d: d);
}

String formatDate(CivilDate date) =>
    '${date.y.toString().padLeft(4, '0')}-'
    '${date.m.toString().padLeft(2, '0')}-'
    '${date.d.toString().padLeft(2, '0')}';

int _compare(CivilDate a, CivilDate b) =>
    a.y != b.y ? a.y - b.y : (a.m != b.m ? a.m - b.m : a.d - b.d);

int _monthsBetween(CivilDate a, CivilDate b) {
  if (_compare(b, a) < 0) return -_monthsBetween(b, a);
  var months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return months;
}

/// Whole units from [a] to [b] (negative when [b] is earlier).
int dateDiff(CivilDate a, CivilDate b, String unit) => switch (unit) {
  'days' => daysFromCivil(b) - daysFromCivil(a),
  'months' => _monthsBetween(a, b),
  _ => _monthsBetween(a, b) ~/ 12,
};

/// Adds whole units; month and year arithmetic clamps the day to the end of
/// the target month.
CivilDate dateAdd(CivilDate a, int amount, String unit) {
  CivilDate out;
  if (unit == 'days') {
    out = civilFromDays(daysFromCivil(a) + amount);
  } else {
    final months = unit == 'months' ? amount : amount * 12;
    final total = a.y * 12 + (a.m - 1) + months;
    final y = _fdiv(total, 12);
    final m = total - y * 12 + 1;
    final d = a.d < daysInMonth(y, m) ? a.d : daysInMonth(y, m);
    out = (y: y, m: m, d: d);
  }
  if (out.y < 0 || out.y > 9999) {
    throw const RuleError(
      'RULE_INVALID_DATE',
      'date_add: result outside years 0000–9999',
    );
  }
  return out;
}
