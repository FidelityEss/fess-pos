/// How the preview talks to the page that embeds the module's web build
/// (T3-08, docs/03 §5): `postMessage` both ways.
abstract interface class PreviewBridge {
  /// The embedding page's messages, from an allowed origin only.
  Stream<Map<String, Object?>> get messages;

  /// Sends [message] to the embedding page.
  void send(Map<String, Object?> message);

  void close();
}

/// A value decoded from JavaScript, as JSON: maps with string keys, lists,
/// strings, booleans and null, and numbers, whole ones as `int`.
Object? jsonLike(Object? v) => switch (v) {
  final Map<Object?, Object?> m => {
    for (final e in m.entries) '${e.key}': jsonLike(e.value),
  },
  final List<Object?> l => [for (final x in l) jsonLike(x)],
  final double d when d.isFinite && d == d.truncateToDouble() => d.toInt(),
  _ => v,
};
