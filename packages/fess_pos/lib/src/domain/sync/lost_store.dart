import 'package:meta/meta.dart';

/// What a local store moved aside means for the work on it (docs/12 §3,
/// C10.12, T5-13, D-93).
enum LostStoreOutcome {
  /// The note kept beside it said the server held everything.
  nothingUnsent,

  /// Items the server didn't hold were on it. Its encrypted bytes are kept,
  /// but with its key gone they can't be read, so they can't be sent.
  unsentUnrecoverable,

  /// No note was kept beside it: what was on it is unknown.
  unknown,
}

/// A local store that could never be opened again, moved aside intact
/// (D-52), as the phone recorded it.
@immutable
class LostStore {
  const LostStore({
    required this.name,
    required this.at,
    this.reason,
    this.waiting,
    this.oldestPendingAt,
    this.noteAt,
  });

  /// Reads one entry of the quarantine log (`module_meta`).
  factory LostStore.fromJson(Map<String, Object?> json) {
    final custody = json['custody'];
    final note = custody is Map<String, Object?> ? custody : null;
    String? text(Object? v) => v is String ? v : null;
    final waiting = note?['waiting'];
    return LostStore(
      name: text(json['name']) ?? '',
      at: text(json['at']) ?? '',
      reason: text(json['reason']),
      waiting: waiting is int ? waiting : null,
      oldestPendingAt: text(note?['oldest_pending_at']),
      noteAt: text(note?['updated_at']),
    );
  }

  /// Its name in `quarantine/`.
  final String name;

  /// When it was moved aside.
  final String at;

  /// Why: `LOCAL_STORE_KEY_MISSING` or `LOCAL_STORE_KEY_REJECTED`.
  final String? reason;

  /// Items the server didn't hold yet, as last noted; null with no note.
  final int? waiting;

  /// When the oldest of them was saved.
  final String? oldestPendingAt;

  /// When the note was last written.
  final String? noteAt;

  LostStoreOutcome get outcome => switch (waiting) {
    null => LostStoreOutcome.unknown,
    0 => LostStoreOutcome.nothingUnsent,
    _ => LostStoreOutcome.unsentUnrecoverable,
  };
}
