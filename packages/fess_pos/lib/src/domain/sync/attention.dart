/// What needs attention (docs/08 §8, T4-13): an item the server couldn't
/// take, as the needs-attention list shows it.
library;

import 'dart:convert';

import 'package:meta/meta.dart';

@immutable
class AttentionItem {
  const AttentionItem({
    required this.id,
    required this.type,
    required this.createdAt,
    this.reason,
  });

  /// The envelope's id and type (e.g. `submission`).
  final String id;
  final String type;

  /// When it was saved on the phone (ISO-8601 with the offset).
  final String createdAt;

  /// The server's reason, e.g. `VALIDATION_FAILED`; null when none came.
  final String? reason;
}

/// The server's reason for an item: the error code in its last [receipt]
/// (as the outbox keeps it), else its [lastError].
String? attentionReason(String? receipt, String? lastError) {
  if (receipt != null) {
    try {
      final json = jsonDecode(receipt);
      if (json is Map<String, Object?>) {
        final error = json['error'];
        final code =
            json['error_code'] ??
            (error is Map<String, Object?> ? error['code'] : null) ??
            json['code'];
        if (code is String && code.isNotEmpty) return code;
      }
    } on FormatException {
      // The last error, then.
    }
  }
  return lastError == null || lastError.isEmpty ? null : lastError;
}
