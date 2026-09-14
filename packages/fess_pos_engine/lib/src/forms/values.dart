/// Value-shape checks per component type, the Dart twin of `src/values.ts`
/// (docs/11 value shapes): run by the validator on every visible, non-empty
/// answer. `props` are the resolved props.
library;

import 'dart:math' as math;

import 'package:fess_pos_engine/src/errors.dart';
import 'package:fess_pos_engine/src/json.dart';
import 'package:fess_pos_engine/src/rules/check.dart' show isIntegral;
import 'package:fess_pos_engine/src/rules/dates.dart';
import 'package:fess_pos_engine/src/rules/evaluate.dart'
    show haversineM, toGeoPoint;
import 'package:fess_pos_engine/src/rules/regex.dart';
import 'package:meta/meta.dart';

@immutable
class ValueIssue {
  const ValueIssue(this.code, this.message);

  final String code;
  final String message;
}

final RegExp _uuid = RegExp(
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
  r'[0-9a-fA-F]{12}$',
);
final RegExp _time = RegExp(r'^([01]\d|2[0-3]):[0-5]\d$');
final RegExp _dateTime = RegExp(
  r'^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,9})?)?'
  r'(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$',
);
final RegExp _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
final RegExp _e164 = RegExp(r'^\+[1-9]\d{6,14}$');
final RegExp _passport = RegExp(r'^[A-Z0-9]{6,20}$');
final RegExp _cipc = RegExp(r'^\d{4}/\d{6}/\d{2}$');
final RegExp _vatZa = RegExp(r'^4\d{9}$');
final RegExp _currencyCode = RegExp(r'^[A-Z]{3}$');
final RegExp _thirteenDigits = RegExp(r'^\d{13}$');
const List<String> _pinSources = [
  'map_pin',
  'current_location',
  'geocoded',
  'job',
];
const List<String> _hourGroups = [
  'weekdays',
  'saturday',
  'sunday',
  'public_holidays',
];
const List<String> _durationUnits = ['days', 'months', 'years'];

/// JavaScript's `Number.MAX_SAFE_INTEGER`.
const int _maxSafeInteger = 9007199254740991;

/// Empty answers: null, "", [] and {} (e.g. an untouched address).
bool isEmptyAnswer(Object? v) =>
    v == null ||
    v == '' ||
    (v is List<Object?> && v.isEmpty) ||
    (v is Map<Object?, Object?> && v.isEmpty);

/// Decimal places of [n] as ECMAScript writes it (1.25 → 2, 1e-7 → 7).
int decimalPlaces(num n) {
  if (isIntegral(n)) return 0;
  final m = RegExp(
    r'^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$',
  ).firstMatch(n.abs().toString());
  if (m == null) return 0;
  final frac = m.group(2)?.length ?? 0;
  final exp = m.group(3) == null ? 0 : int.parse(m.group(3)!);
  return math.max(0, frac - exp);
}

/// South African ID number: 13 digits, a valid YYMMDD, Luhn check digit.
bool isValidZaId(String id) {
  if (!_thirteenDigits.hasMatch(id)) return false;
  final mm = int.parse(id.substring(2, 4));
  final dd = int.parse(id.substring(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > daysInMonth(2000, mm)) return false;
  var sum = 0;
  for (var i = 0; i < 13; i++) {
    var d = int.parse(id[12 - i]);
    if (i.isOdd) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 == 0;
}

/// What rules read as `derived.<field_key>` for an SA ID number: `dob`
/// (YYYY-MM-DD, the century chosen so the date isn't after [today]) and
/// `gender` (digits 7–10 below 5000: female). Null without a frozen
/// [today], because the century can't be decided without one.
Map<String, Object?>? zaIdDerived(String id, String? today) {
  if (!isValidZaId(id) || today == null || !isIsoDate(today)) return null;
  final yy = int.parse(id.substring(0, 2));
  final mm = int.parse(id.substring(2, 4));
  final dd = int.parse(id.substring(4, 6));
  final t = tryParseDate(today);
  if (t == null) return null;
  var year = 2000 + yy;
  final afterToday =
      year > t.y || (year == t.y && (mm > t.m || (mm == t.m && dd > t.d)));
  if (afterToday) year -= 100;
  if (dd > daysInMonth(year, mm)) return null;
  String two(int n) => n.toString().padLeft(2, '0');
  return {
    'dob': '${year.toString().padLeft(4, '0')}-${two(mm)}-${two(dd)}',
    'gender': int.parse(id.substring(6, 10)) < 5000 ? 'female' : 'male',
  };
}

/// Every key of [o] is one of [allowed] (`strictKeys` in `src/values.ts`).
bool _strictKeys(Map<String, Object?> o, List<String> allowed) =>
    o.keys.every(allowed.contains);

num? _num(Object? v) => v is num ? v : null;

String? _str(Object? v) => v is String ? v : null;

/// A number as JavaScript prints it: 5, not 5.0.
String _fmt(num n) => isIntegral(n) ? n.toInt().toString() : n.toString();

String _first10(String s) => s.length > 10 ? s.substring(0, 10) : s;

/// An instant in microseconds; fractions past microseconds are dropped.
int _instant(String s) => DateTime.parse(
  s.replaceFirstMapped(
    RegExp(r'\.(\d{6})\d+'),
    (m) => '.${m.group(1)}',
  ),
).microsecondsSinceEpoch;

bool _isPoint(Object? v, List<String> extraKeys) {
  if (v is! Map<String, Object?>) return false;
  if (!_strictKeys(v, ['lat', 'lng', ...extraKeys])) return false;
  try {
    return toGeoPoint(v, 'value') != null;
  } on RuleError {
    return false;
  }
}

bool _isPin(Object? v) =>
    _isPoint(v, const ['source']) &&
    _pinSources.contains('${(v! as Map<String, Object?>)['source']}');

List<String> _strings(Object? v, List<String> fallback) =>
    v is List<Object?> ? [for (final x in v) '$x'] : fallback;

/// Checks one non-empty answer [value] of a component [type]. [job] and
/// [today] are the frozen context, for checks that read it.
List<ValueIssue> validateValue(
  String type,
  Object? value,
  Map<String, Object?> props, {
  Object? job,
  String? today,
}) {
  final out = <ValueIssue>[];
  void push(String code, String message) => out.add(ValueIssue(code, message));
  List<ValueIssue> bad(String want) {
    push('INVALID_TYPE', 'expected $want');
    return out;
  }

  void range(num n, Object? min, Object? max) {
    final lo = _num(min);
    final hi = _num(max);
    if (lo != null && n < lo) push('BELOW_MIN', 'must be at least ${_fmt(lo)}');
    if (hi != null && n > hi) push('ABOVE_MAX', 'must be at most ${_fmt(hi)}');
  }

  void pattern(String s) {
    final p = _str(props['pattern']);
    if (p == null) return;
    try {
      if (!compileSafeRegex(p).hasMatch(s)) {
        push('PATTERN_MISMATCH', 'does not match the required format');
      }
    } on RuleError catch (e) {
      push('PATTERN_MISMATCH', e.message);
    }
  }

  void count(int n, Object? min, Object? max, String few, String many) {
    final lo = _num(min);
    final hi = _num(max);
    if (lo != null && n < lo) push('TOO_FEW', few.replaceAll('{n}', _fmt(lo)));
    if (hi != null && n > hi) {
      push('TOO_MANY', many.replaceAll('{n}', _fmt(hi)));
    }
  }

  switch (type) {
    case 'text' || 'textarea':
      if (value is! String) return bad('a string');
      final n = value.runes.length;
      final min = _num(props['min_length']);
      final max = _num(props['max_length']);
      if (min != null && n < min) {
        push('TOO_SHORT', 'must be at least ${_fmt(min)} characters');
      }
      if (max != null && n > max) {
        push('TOO_LONG', 'must be at most ${_fmt(max)} characters');
      }
      pattern(value);
      return out;
    case 'email':
      if (value is! String) return bad('a string');
      if (value.length > 254 || !_email.hasMatch(value)) {
        push('INVALID_FORMAT', 'not a valid email address');
      }
      return out;
    case 'phone':
      if (value is! String) return bad('an E.164 phone number string');
      if (!_e164.hasMatch(value)) {
        push(
          'INVALID_FORMAT',
          'not an E.164 phone number (e.g. +27821234567)',
        );
      }
      return out;
    case 'number' || 'percentage' || 'slider':
      if (value is! num || !value.isFinite) return bad('a number');
      if (type == 'percentage' && (value < 0 || value > 100)) {
        push('OUT_OF_RANGE', 'must be between 0 and 100');
      }
      if (type == 'number' && props['integer'] == true && !isIntegral(value)) {
        push('NOT_INTEGER', 'must be a whole number');
      }
      final d = _num(props['decimals']);
      if (d != null && decimalPlaces(value) > d) {
        push('TOO_MANY_DECIMALS', 'at most ${_fmt(d)} decimal places');
      }
      range(value, props['min'], props['max']);
      final step = _num(props['step']);
      if (type == 'slider' && step != null && step > 0) {
        final q = (value - (_num(props['min']) ?? 0)) / step;
        if ((q - q.round()).abs() > 1e-9) {
          push('INVALID_STEP', 'must be in steps of ${_fmt(step)}');
        }
      }
      return out;
    case 'rating':
      if (value is! num || !isIntegral(value)) return bad('a whole number');
      final scale = _num(props['scale']) ?? 5;
      if (value < 1 || value > scale) {
        push('OUT_OF_RANGE', 'must be between 1 and ${_fmt(scale)}');
      }
      return out;
    case 'currency':
      if (value is! Map<String, Object?> ||
          !_strictKeys(value, const ['minor', 'currency'])) {
        return bad('{minor, currency}');
      }
      final minor = value['minor'];
      final code = value['currency'];
      if (minor is! num ||
          !isIntegral(minor) ||
          minor.abs() > _maxSafeInteger) {
        return bad('integer minor units');
      }
      if (code is! String || !_currencyCode.hasMatch(code)) {
        return bad('an ISO 4217 currency code');
      }
      final want = _str(props['currency']);
      if (want != null && code != want) {
        push('CURRENCY_MISMATCH', 'currency must be $want');
      }
      range(minor, props['min'], props['max']);
      return out;
    case 'id_number':
      if (value is! String) return bad('a string');
      final scheme = _str(props['scheme']);
      if (scheme == 'za_id') {
        if (!_thirteenDigits.hasMatch(value)) {
          push('INVALID_FORMAT', 'an SA ID number has 13 digits');
        } else if (!isValidZaId(value)) {
          push('INVALID_CHECKSUM', 'not a valid SA ID number');
        }
      } else if (scheme == 'passport' && !_passport.hasMatch(value)) {
        push('INVALID_FORMAT', 'not a valid passport number');
      }
      pattern(value);
      return out;
    case 'registration_number':
      if (value is! String) return bad('a string');
      final scheme = _str(props['scheme']);
      if (scheme == 'cipc' && !_cipc.hasMatch(value)) {
        push('INVALID_FORMAT', 'CIPC numbers look like 2015/123456/07');
      }
      if (scheme == 'vat_za' && !_vatZa.hasMatch(value)) {
        push('INVALID_FORMAT', 'SA VAT numbers are 10 digits starting with 4');
      }
      pattern(value);
      return out;
    case 'boolean':
      return value is bool ? out : bad('true or false');
    case 'tri_state':
      return value == 'yes' || value == 'no' || value == 'na'
          ? out
          : bad('"yes", "no" or "na"');
    case 'single_select' || 'lookup':
      return value is String ? out : bad('an option value');
    case 'multi_select':
      if (value is! List<Object?> || !value.every((x) => x is String)) {
        return bad('a list of option values');
      }
      if (value.toSet().length != value.length) {
        push('DUPLICATE_VALUE', 'an option is selected twice');
      }
      count(
        value.length,
        props['min_select'],
        props['max_select'],
        'select at least {n}',
        'select at most {n}',
      );
      final exclusive = props['exclusive_options'];
      if (value.length > 1 &&
          exclusive is List<Object?> &&
          value.any(exclusive.contains)) {
        push(
          'EXCLUSIVE_OPTION_COMBINED',
          'this option cannot be combined with others',
        );
      }
      return out;
    case 'date':
      if (value is! String || !isIsoDate(value)) {
        return bad('an ISO date (YYYY-MM-DD)');
      }
      final min = _str(props['min']);
      final max = _str(props['max']);
      if (min != null && value.compareTo(_first10(min)) < 0) {
        push('BELOW_MIN', 'must be on or after ${_first10(min)}');
      }
      if (max != null && value.compareTo(_first10(max)) > 0) {
        push('ABOVE_MAX', 'must be on or before ${_first10(max)}');
      }
      return out;
    case 'time':
      if (value is! String || !_time.hasMatch(value)) {
        return bad('a time (HH:mm)');
      }
      final min = _str(props['min']);
      final max = _str(props['max']);
      if (min != null && value.compareTo(min) < 0) {
        push('BELOW_MIN', 'must be at or after $min');
      }
      if (max != null && value.compareTo(max) > 0) {
        push('ABOVE_MAX', 'must be at or before $max');
      }
      return out;
    case 'datetime':
      if (value is! String || !isIsoDateTime(value)) {
        return bad('an ISO datetime with offset');
      }
      final t = _instant(value);
      final min = _str(props['min']);
      final max = _str(props['max']);
      if (min != null && _dateTime.hasMatch(min) && t < _instant(min)) {
        push('BELOW_MIN', 'must be at or after $min');
      }
      if (max != null && _dateTime.hasMatch(max) && t > _instant(max)) {
        push('ABOVE_MAX', 'must be at or before $max');
      }
      return out;
    case 'duration':
      if (value is! Map<String, Object?> ||
          !_strictKeys(value, const ['value', 'unit'])) {
        return bad('{value, unit}');
      }
      final n = value['value'];
      final unit = value['unit'];
      if (n is! num || !isIntegral(n) || n < 0) {
        return bad('a whole, non-negative duration');
      }
      final allowed = _strings(props['units'], _durationUnits);
      if (unit is! String || !allowed.contains(unit)) {
        push('INVALID_UNIT', 'unit must be one of ${allowed.join(', ')}');
      }
      return out;
    case 'business_hours':
      if (value is! Map<String, Object?>) return bad('an object of day groups');
      final groups = _strings(props['groups'], _hourGroups);
      final allow24h = props['allow_24h'] == true;
      for (final k in value.keys) {
        if (!groups.contains(k)) {
          push('INVALID_FORMAT', 'unknown day group "$k"');
        }
      }
      for (final g in groups) {
        if (!value.containsKey(g)) {
          push('MISSING_GROUP', 'hours for "$g" are missing');
          continue;
        }
        final h = value[g];
        if (h == 'closed') continue;
        if (h == '24h') {
          if (!allow24h) push('INVALID_HOURS', '"24h" is not allowed for "$g"');
          continue;
        }
        final open = h is Map<String, Object?> ? h['open'] : null;
        final close = h is Map<String, Object?> ? h['close'] : null;
        final valid =
            h is Map<String, Object?> &&
            _strictKeys(h, const ['open', 'close']) &&
            open is String &&
            close is String &&
            _time.hasMatch(open) &&
            _time.hasMatch(close) &&
            open != close;
        if (!valid) {
          push(
            'INVALID_HOURS',
            'hours for "$g" must be "closed"${allow24h ? ', "24h"' : ''} '
                'or {open, close} (HH:mm)',
          );
        }
      }
      return out;
    case 'address':
      if (value is! Map<String, Object?> ||
          !_strictKeys(value, const [
            'line1',
            'line2',
            'suburb',
            'city',
            'province',
            'postal_code',
            'pin',
          ])) {
        return bad('a structured address');
      }
      for (final k in const ['line1', 'city', 'province']) {
        final s = value[k];
        if (s is! String || s.trim().isEmpty) {
          push('INVALID_FORMAT', 'address $k is required');
        }
      }
      for (final k in const [
        'line1',
        'line2',
        'suburb',
        'city',
        'province',
        'postal_code',
      ]) {
        final s = value[k];
        if (s != null && (s is! String || s.length > 200)) {
          push('INVALID_FORMAT', 'address $k must be text');
        }
      }
      final provinces = props['provinces'];
      final province = value['province'];
      if (provinces is List<Object?> &&
          province is String &&
          !provinces.contains(province)) {
        push('INVALID_OPTION', 'unknown province');
      }
      final pin = value['pin'];
      final mode = _str(props['map_pin']) ?? 'optional';
      if (pin == null) {
        if (mode == 'required') push('PIN_REQUIRED', 'a map pin is required');
      } else if (mode == 'none') {
        push('PIN_NOT_ALLOWED', 'this address takes no map pin');
      } else if (!_isPin(pin)) {
        push('INVALID_FORMAT', 'pin must be {lat, lng, source}');
      }
      return out;
    case 'location_pin':
      if (!_isPin(value)) return bad('{lat, lng, source}');
      final max = _num(props['max_distance_from_job_m']);
      final jobLocation = job == null ? null : readPath(job, 'location');
      if (max != null && jobLocation != null) {
        try {
          final a = toGeoPoint(value, 'location_pin');
          final b = toGeoPoint(jobLocation, 'job.location');
          if (a != null && b != null && haversineM(a, b) > max) {
            push(
              'TOO_FAR',
              'must be within ${_fmt(max)} m of the job location',
            );
          }
        } on RuleError {
          // A malformed job location is the context's problem, not the
          // agent's.
        }
      }
      return out;
    case 'current_location':
      if (!_isPoint(value, const [
        'accuracy_m',
        'ts',
        'gnss_ts',
        'is_mocked',
      ])) {
        return bad('a GPS fix {lat, lng, accuracy_m, ts, gnss_ts?, is_mocked}');
      }
      final fix = value! as Map<String, Object?>;
      final accuracy = _num(fix['accuracy_m']);
      if (accuracy == null || accuracy < 0) return bad('accuracy_m ≥ 0');
      final ts = fix['ts'];
      if (ts is! String || !isIsoDateTime(ts)) {
        return bad('ts as ISO datetime with offset');
      }
      final gnss = fix['gnss_ts'];
      if (gnss != null && (gnss is! String || !isIsoDateTime(gnss))) {
        return bad('gnss_ts as ISO datetime');
      }
      if (fix['is_mocked'] is! bool) return bad('is_mocked boolean');
      final max = _num(props['max_accuracy_m']);
      if (max != null && accuracy > max) {
        push(
          'ACCURACY_TOO_LOW',
          'GPS accuracy must be ${_fmt(max)} m or better',
        );
      }
      return out;
    case 'photo':
      if (value is! List<Object?> ||
          !value.every((x) => x is String && _uuid.hasMatch(x))) {
        return bad('a list of evidence ids');
      }
      if (value.toSet().length != value.length) {
        push('DUPLICATE_VALUE', 'the same photo is listed twice');
      }
      count(
        value.length,
        props['min_count'],
        props['max_count'],
        'at least {n} photos are required',
        'at most {n} photos are allowed',
      );
      return out;
    case 'signature':
      return value is String && _uuid.hasMatch(value)
          ? out
          : bad('an evidence id');
    case 'declaration':
      if (value is! Map<String, Object?> ||
          !_strictKeys(value, const [
            'accepted',
            'declaration_version_id',
            'accepted_at',
          ])) {
        return bad('{accepted, declaration_version_id, accepted_at}');
      }
      final version = value['declaration_version_id'];
      if (version is! String || !_uuid.hasMatch(version)) {
        return bad('declaration_version_id uuid');
      }
      final at = value['accepted_at'];
      if (at is! String || !isIsoDateTime(at)) {
        return bad('accepted_at ISO datetime');
      }
      if (value['accepted'] != true) {
        push('NOT_ACCEPTED', 'the declaration must be accepted');
      }
      return out;
    case 'acknowledgement':
      if (value is! bool) return bad('true');
      if (!value) push('NOT_ACCEPTED', 'must be acknowledged');
      return out;
    case 'consent':
      if (value is! Map<String, Object?> ||
          !_strictKeys(value, const [
            'given',
            'text_version_id',
            'at',
            'by_name',
          ])) {
        return bad('{given, text_version_id, at, by_name}');
      }
      if (value['given'] is! bool) return bad('given boolean');
      final version = value['text_version_id'];
      if (version is! String || !_uuid.hasMatch(version)) {
        return bad('text_version_id uuid');
      }
      final at = value['at'];
      if (at is! String || !isIsoDateTime(at)) return bad('at ISO datetime');
      final byName = value['by_name'];
      if (byName is! String || byName.trim().isEmpty) return bad('by_name');
      return out;
    case 'matrix':
      if (value is! Map<String, Object?>) return bad('an object of rows');
      final rows = [
        if (props['rows'] case final List<Object?> list)
          for (final r in list) '${r is Map<String, Object?> ? r['key'] : r}',
      ];
      final columns = [
        if (props['columns'] case final List<Object?> list)
          for (final c in list) '${c is Map<String, Object?> ? c['value'] : c}',
      ];
      final cell = _str(props['cell_type']);
      for (final e in value.entries) {
        final row = e.key;
        final v = e.value;
        if (!rows.contains(row)) {
          push('UNKNOWN_ROW', 'unknown row "$row"');
          continue;
        }
        if (cell == 'single' && !(v is String && columns.contains(v))) {
          push('INVALID_OPTION', 'row "$row": not a column value');
        }
        if (cell == 'multi' &&
            !(v is List<Object?> &&
                v.every((x) => x is String && columns.contains(x)) &&
                v.toSet().length == v.length)) {
          push('INVALID_OPTION', 'row "$row": must be distinct column values');
        }
        if (cell == 'text' && !(v is String && v.length <= 500)) {
          push('INVALID_TYPE', 'row "$row": must be text');
        }
      }
      final wanted = props['required_rows'];
      final required = wanted == 'all'
          ? rows
          : wanted is List<Object?>
          ? [for (final r in wanted) '$r']
          : const <String>[];
      for (final r in required) {
        final v = value[r];
        if (v == null || v == '' || (v is List<Object?> && v.isEmpty)) {
          push('MISSING_ROW', 'row "$r" is required');
        }
      }
      return out;
    case 'repeatable_group':
      return value is List<Object?> ? out : bad('a list of items');
    default:
      // prefilled and computed: any JSON value (checked against the
      // recomputed value instead).
      return out;
  }
}
