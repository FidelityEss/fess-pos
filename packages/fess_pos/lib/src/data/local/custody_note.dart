import 'dart:convert';

import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart' show OutboxStatus;
import 'package:fess_pos/src/platform/io/files.dart';
import 'package:path/path.dart' as p;

/// The note of unsent work kept beside the encrypted store (T5-13, D-93):
/// plain numbers and times, nothing personal. If the store can never be
/// opened again, it says what was on it when it was lost (C10.12).
const String custodyNoteFile = 'custody.json';

/// Where stores that can never be opened again go (D-52).
const String _quarantine = 'quarantine';

/// Writes the note for [status], as of [now], in the module's folder [dir].
Future<void> writeCustodyNote(
  String dir,
  OutboxStatus status,
  DateTime now,
) {
  final oldest = status.oldestPendingAt;
  return writeBytes(
    p.join(dir, custodyNoteFile),
    utf8.encode(
      jsonEncode({
        'waiting': status.waiting,
        'needs_attention': status.needsAttention,
        'oldest_pending_at': oldest == null ? null : isoWithOffset(oldest),
        'updated_at': isoWithOffset(now),
      }),
    ),
  );
}

/// What the quarantine kept beside each of the stores [names] moved aside
/// in [dir]: why it was moved (`reason`) and the note as it stood
/// (`custody`), where they were kept.
Future<Map<String, Map<String, Object?>>> readQuarantineDetails(
  String dir,
  List<String> names,
) async => {
  for (final name in names)
    name: {
      'reason': ?(await _json(
        p.join(dir, _quarantine, '$name.json'),
      ))?['reason'],
      'custody': ?await _json(
        p.join(dir, _quarantine, '$name.$custodyNoteFile'),
      ),
    },
};

Future<Map<String, Object?>?> _json(String path) async {
  final bytes = await readBytes(path);
  if (bytes == null) return null;
  try {
    final value = jsonDecode(utf8.decode(bytes));
    return value is Map<String, Object?> ? value : null;
  } on FormatException {
    return null;
  }
}
