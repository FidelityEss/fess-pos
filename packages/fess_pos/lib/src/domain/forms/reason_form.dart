import 'package:fess_pos/src/domain/forms/reason_codes.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:meta/meta.dart';

/// The longest note a `job_event` carries (`job_event.v1` schema).
const int maxReasonNoteLength = 2000;

/// Which fields of a reason form feed the `job_event` (D-61): the reason is
/// the choice whose options are the action's reason codes, and the note is
/// the text field keyed `note`. Everything else travels only in the
/// answers.
@immutable
class ReasonFormFields {
  const ReasonFormFields({required this.reasonKey, this.noteKey});

  /// The fields of [form] for reason-code [category]; null when the form
  /// has no choice over that category, so it can't give a reason.
  static ReasonFormFields? of(Map<String, Object?> form, String category) {
    String? reason;
    String? note;
    void visit(Object? fields) {
      if (fields is! List<Object?>) return;
      for (final f in fields.whereType<Map<String, Object?>>()) {
        final key = f['key'];
        final type = f['type'];
        final source = f['options_source'];
        if (key is String &&
            reason == null &&
            type == 'single_select' &&
            source is Map<String, Object?> &&
            source['type'] == 'reason_codes' &&
            source['category'] == category) {
          reason = key;
        }
        if (key == 'note' && (type == 'text' || type == 'textarea')) {
          note = 'note';
        }
        visit(f['fields']);
      }
    }

    final sections = form['sections'];
    if (sections is List<Object?>) {
      for (final s in sections.whereType<Map<String, Object?>>()) {
        visit(s['fields']);
      }
    }
    final found = reason;
    return found == null
        ? null
        : ReasonFormFields(reasonKey: found, noteKey: note);
  }

  final String reasonKey;
  final String? noteKey;

  /// The chosen reason code in [answers] (`{key: {v, …}}`).
  String? reasonCode(Map<String, Object?> answers) =>
      _value(answers, reasonKey);

  /// The note in [answers], trimmed; null when empty or absent.
  String? note(Map<String, Object?> answers) {
    final key = noteKey;
    final text = key == null ? null : _value(answers, key)?.trim();
    return text == null || text.isEmpty ? null : text;
  }

  /// What the server checks beyond the form (`require_reason`): a reason is
  /// given, a reason that needs a note has one, and the note fits the
  /// envelope. [message] gives the wording by copy key.
  List<ValidationError> check(
    Map<String, Object?> answers,
    List<ReasonCode> codes, {
    required String category,
    required String Function(String key) message,
  }) {
    final code = reasonCode(answers);
    final chosen = codes
        .where((c) => c.category == category && c.code == code)
        .firstOrNull;
    final text = note(answers);
    return [
      if (code == null)
        ValidationError(
          reasonKey,
          'REQUIRED',
          message('form.error.REQUIRED'),
        ),
      if (chosen != null && chosen.requiresNote && text == null)
        ValidationError(
          noteKey ?? reasonKey,
          'NOTE_REQUIRED',
          message('form.error.NOTE_REQUIRED'),
        ),
      if (text != null && text.runes.length > maxReasonNoteLength)
        ValidationError(
          noteKey!,
          'NOTE_TOO_LONG',
          message('form.error.NOTE_TOO_LONG'),
        ),
    ];
  }

  static String? _value(Map<String, Object?> answers, String key) {
    final entry = answers[key];
    final v = entry is Map<String, Object?> ? entry['v'] : null;
    return v is String ? v : null;
  }
}
