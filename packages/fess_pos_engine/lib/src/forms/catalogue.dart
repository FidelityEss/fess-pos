/// The form components this engine resolves and validates (docs/11), a
/// subset of the TypeScript catalogue (`src/definitions/catalogue.ts`)
/// that grows with the module. A form using any other component fails to
/// compile with `UNSUPPORTED_COMPONENT`, so nothing is validated half-way.
library;

import 'package:meta/meta.dart';

/// The kind of a rule-able prop's evaluated value.
enum PropKind { integer, number, boolean, string }

@immutable
class ComponentSpec {
  const ComponentSpec(
    this.type, {
    required this.valueType,
    this.options = false,
    this.ruleableProps = const {},
  });

  final String type;

  /// The value type rules see as `answers.<key>`; `none` for display
  /// components and groups, which carry no answer.
  final String valueType;

  /// Has `options` / `options_source` / `options_filter`.
  final bool options;

  /// Props that accept an expression (**R** in docs/11), and what it must
  /// evaluate to.
  final Map<String, PropKind> ruleableProps;

  bool get hasValue => valueType != 'none';
}

const Map<String, PropKind> _textProps = {
  'min_length': PropKind.integer,
  'max_length': PropKind.integer,
};

const Map<String, ComponentSpec> formComponents = {
  'text': ComponentSpec('text', valueType: 'string', ruleableProps: _textProps),
  'textarea': ComponentSpec(
    'textarea',
    valueType: 'string',
    ruleableProps: _textProps,
  ),
  'boolean': ComponentSpec('boolean', valueType: 'boolean'),
  'single_select': ComponentSpec(
    'single_select',
    valueType: 'string',
    options: true,
  ),
  'multi_select': ComponentSpec(
    'multi_select',
    valueType: 'array',
    options: true,
    ruleableProps: {
      'min_select': PropKind.integer,
      'max_select': PropKind.integer,
    },
  ),
  'photo': ComponentSpec(
    'photo',
    valueType: 'array',
    ruleableProps: {
      'min_count': PropKind.integer,
      'max_count': PropKind.integer,
    },
  ),
  'signature': ComponentSpec('signature', valueType: 'string'),
  'prefilled': ComponentSpec('prefilled', valueType: 'any'),
  'info': ComponentSpec('info', valueType: 'none'),
  'callout': ComponentSpec('callout', valueType: 'none'),
  'divider': ComponentSpec('divider', valueType: 'none'),
  'group': ComponentSpec('group', valueType: 'none'),
};

ComponentSpec? formComponentSpec(String type) => formComponents[type];
