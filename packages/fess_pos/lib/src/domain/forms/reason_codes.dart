import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:meta/meta.dart';

/// One reason an agent can give (docs/06 §3), as the server sends them
/// with each pull when their list changes.
@immutable
class ReasonCode {
  const ReasonCode({
    required this.category,
    required this.code,
    required this.label,
    this.description,
    this.requiresNote = false,
    this.requiresPhoto = false,
    this.bankId,
    this.sortOrder = 0,
  });

  /// From the pull's `reason_codes.items`; null when malformed.
  static ReasonCode? tryParse(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final category = json['category'];
    final code = json['code'];
    final label = json['label'];
    if (category is! String || code is! String || label is! String) {
      return null;
    }
    final description = json['description'];
    final bankId = json['bank_id'];
    final sortOrder = json['sort_order'];
    return ReasonCode(
      category: category,
      code: code,
      label: label,
      description: description is String ? description : null,
      requiresNote: json['requires_note'] == true,
      requiresPhoto: json['requires_photo'] == true,
      bankId: bankId is String ? bankId : null,
      sortOrder: sortOrder is int ? sortOrder : 0,
    );
  }

  /// `assignment_reject`, `unable_to_complete`, `geofence_override`, …
  final String category;
  final String code;
  final String label;
  final String? description;

  /// The server refuses this reason without a note (`NOTE_REQUIRED`).
  final bool requiresNote;

  /// The server flags this reason when no photo comes with it.
  final bool requiresPhoto;

  /// The bank this reason belongs to; null for everyone.
  final String? bankId;
  final int sortOrder;

  /// As a form option: what `option_meta` rules read is `requires_note`
  /// and `requires_photo`.
  OptionDef toOption() => OptionDef(
    value: code,
    label: label,
    helpText: description,
    meta: {'requires_note': requiresNote, 'requires_photo': requiresPhoto},
  );
}

/// Reference data on this device.
// An interface, not a typedef: repositories are swapped as objects.
// ignore: one_member_abstracts
abstract interface class ReferenceRepository {
  /// The reason codes from the last pull, as each pull lands.
  Stream<List<ReasonCode>> watchReasonCodes();
}

/// The reason codes a job of [bankId] may use, as the option lists
/// `options_source: reason_codes` reads: global codes and [bankId]'s own,
/// the bank's taking the place of a global one with the same code (as the
/// server's `require_reason` picks), in the server's order.
FormLists reasonCodeLists(Iterable<ReasonCode> codes, {String? bankId}) {
  final byCategory = <String, Map<String, ReasonCode>>{};
  for (final c in codes) {
    if (c.bankId != null && c.bankId != bankId) continue;
    final category = byCategory.putIfAbsent(c.category, () => {});
    final known = category[c.code];
    if (known == null || (known.bankId == null && c.bankId != null)) {
      category[c.code] = c;
    }
  }
  return FormLists(
    reasonCodes: {
      for (final e in byCategory.entries)
        e.key: [
          for (final c in e.value.values.toList()..sort(_serverOrder))
            c.toOption(),
        ],
    },
  );
}

int _serverOrder(ReasonCode a, ReasonCode b) {
  final bySort = a.sortOrder.compareTo(b.sortOrder);
  return bySort != 0 ? bySort : a.code.compareTo(b.code);
}
