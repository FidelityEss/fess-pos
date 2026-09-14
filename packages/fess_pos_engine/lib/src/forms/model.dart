/// What the form resolver and validator take and give (`src/resolver.ts`,
/// `src/validator.ts`).
library;

import 'package:fess_pos_engine/src/rules/evaluate.dart';
import 'package:meta/meta.dart';

/// One choice of a select.
@immutable
class OptionDef {
  const OptionDef({
    required this.value,
    required this.label,
    this.meta = const {},
    this.helpText,
  });

  /// From `{value, label, help_text?, meta?}`; null when malformed.
  static OptionDef? tryParse(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final value = json['value'];
    final label = json['label'];
    if (value is! String || label is! String) return null;
    final meta = json['meta'];
    final help = json['help_text'];
    return OptionDef(
      value: value,
      label: label,
      meta: meta is Map<String, Object?> ? meta : const {},
      helpText: help is String ? help : null,
    );
  }

  final String value;
  final String label;
  final Map<String, Object?> meta;
  final String? helpText;

  Map<String, Object?> toRuleData() => {
    'value': value,
    'label': label,
    'meta': meta,
  };
}

/// Option sources: lookup lists by key, reason codes by category.
@immutable
class FormLists {
  const FormLists({this.lookupLists = const {}, this.reasonCodes = const {}});

  /// From `{lookup_lists: {key: [option…]}, reason_codes: {category:
  /// [option…]}}`, as test cases and fixtures give them.
  factory FormLists.fromJson(Object? json) {
    Map<String, List<OptionDef>> table(Object? t) => {
      if (t is Map<String, Object?>)
        for (final e in t.entries)
          e.key: [
            if (e.value case final List<Object?> items)
              for (final item in items) ?OptionDef.tryParse(item),
          ],
    };
    final m = json is Map<String, Object?> ? json : const <String, Object?>{};
    return FormLists(
      lookupLists: table(m['lookup_lists']),
      reasonCodes: table(m['reason_codes']),
    );
  }

  final Map<String, List<OptionDef>> lookupLists;
  final Map<String, List<OptionDef>> reasonCodes;
}

/// What rules read besides the answers (docs/04 §4.2).
@immutable
class ResolveContext {
  const ResolveContext({
    this.today,
    this.job,
    this.agent,
    this.inspection,
    this.stats,
    this.config,
    this.previous,
  });

  /// Frozen `YYYY-MM-DD` for `today`, normally context_snapshot.today.
  final String? today;
  final Object? job;
  final Object? agent;
  final Object? inspection;
  final Object? stats;
  final Object? config;
  final Object? previous;
}

/// A rule that failed while resolving (it doesn't stop the form).
@immutable
class RuleIssue {
  const RuleIssue(this.path, this.property, this.code, this.message);

  /// The field's path (its key, or `group[i].key` inside a repeatable
  /// group), or `§<section key>` for a section.
  final String path;
  final String property;
  final String code;
  final String message;
}

/// One field as the rules make it now.
@immutable
class ResolvedField {
  const ResolvedField({
    required this.key,
    required this.type,
    required this.section,
    required this.visible,
    required this.required,
    required this.readOnly,
    required this.value,
    required this.computed,
    required this.props,
    String? path,
    this.label,
    this.text,
    this.hasDefault = false,
    this.defaultValue,
    this.options,
    this.items,
  }) : path = path ?? key;

  final String key;

  /// Where it sits: its key, or `group[i].key` inside a repeatable group.
  final String path;
  final String type;
  final String section;
  final bool visible;
  final bool required;
  final bool readOnly;

  /// The effective value: null when hidden or unanswered.
  final Object? value;

  /// The value comes from a `value` rule (docs/04 §4.4 item 4).
  final bool computed;

  /// Props with their rule-able entries evaluated.
  final Map<String, Object?> props;
  final String? label;

  /// The rendered text of a display component.
  final String? text;
  final bool hasDefault;
  final Object? defaultValue;

  /// The options after `options_filter` (choice components).
  final List<OptionDef>? options;

  /// The items of a repeatable group.
  final List<ResolvedItem>? items;
}

/// One item of a repeatable group, as the rules make it now.
@immutable
class ResolvedItem {
  const ResolvedItem({
    required this.index,
    required this.fields,
    required this.data,
  });

  final int index;

  /// Its child fields by key; each [ResolvedField.path] is
  /// `group[index].key`.
  final Map<String, ResolvedField> fields;

  /// What its rules read: the answers, `item`, `index` and the context.
  final Map<String, Object?> data;
}

@immutable
class ResolvedSection {
  const ResolvedSection(this.key, {required this.visible, this.title});

  final String key;
  final bool visible;
  final String? title;
}

@immutable
class ResolvedForm {
  const ResolvedForm({
    required this.sections,
    required this.fields,
    required this.order,
    required this.values,
    required this.data,
    required this.env,
    required this.errors,
  });

  final Map<String, ResolvedSection> sections;

  /// Every field, group and display component by key.
  final Map<String, ResolvedField> fields;

  /// Document order of [fields].
  final List<String> order;

  /// The effective answers (what `answers.*` reads); hidden fields absent.
  final Map<String, Object?> values;
  final Map<String, Object?> data;
  final RuleEnv env;
  final List<RuleIssue> errors;
}

/// One answer problem, with the server's code (`VALIDATION_ERROR_CODES`).
@immutable
class ValidationError {
  const ValidationError(this.fieldKey, this.code, this.message);

  final String fieldKey;
  final String code;
  final String message;

  @override
  String toString() => '$fieldKey|$code';
}

@immutable
class ValidationResult {
  const ValidationResult(this.errors, {this.resolved});

  final List<ValidationError> errors;
  final ResolvedForm? resolved;

  bool get ok => errors.isEmpty;
}
