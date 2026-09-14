/// Small helpers over plain JSON values — what `jsonDecode` returns: null,
/// bool, num, String, List and Map with String keys. Everything the engine
/// reads (definitions, answers, contexts) is plain JSON.
library;

/// The JSON type name of [v]: `null`, `boolean`, `number`, `string`,
/// `array` or `object`.
String jsonTypeOf(Object? v) => switch (v) {
  null => 'null',
  bool() => 'boolean',
  num() => 'number',
  String() => 'string',
  List<Object?>() => 'array',
  Map<Object?, Object?>() => 'object',
  _ => v.runtimeType.toString(),
};

/// Strict structural equality: no type coercion, key order irrelevant.
/// Numbers compare by value, so `1` equals `1.0` as in JSON.
bool deepEqual(Object? a, Object? b) {
  if (a == null || b == null) return a == null && b == null;
  if (a is num && b is num) return a == b;
  if (a is bool && b is bool) return a == b;
  if (a is String && b is String) return a == b;
  if (a is List<Object?> && b is List<Object?>) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (a is Map<Object?, Object?> && b is Map<Object?, Object?>) {
    if (a.length != b.length) return false;
    for (final k in a.keys) {
      if (!b.containsKey(k) || !deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

final RegExp _index = RegExp(r'^(0|[1-9][0-9]*)$');

/// Reads a dotted path (`a.b.0.c`) from a JSON tree; numeric segments
/// index arrays, `''` is the whole tree. Missing → null.
Object? readPath(Object? root, String path) {
  if (path.isEmpty) return root;
  var cur = root;
  for (final seg in path.split('.')) {
    if (cur == null) return null;
    if (cur is List<Object?>) {
      if (!_index.hasMatch(seg)) return null;
      final i = int.tryParse(seg);
      cur = i != null && i < cur.length ? cur[i] : null;
    } else if (cur is Map<Object?, Object?>) {
      cur = cur[seg];
    } else {
      return null;
    }
  }
  return cur;
}
