/// The form components both engines resolve and validate (docs/11): the
/// Dart twin of `src/definitions/catalogue.ts`, every component of spec
/// 1.0, Wave 1 and Wave 2. A form with any other type fails to compile with
/// `UNSUPPORTED_COMPONENT`, so nothing is validated half-way.
///
/// What the module can *draw* is its own, smaller list
/// (`supportedFormComponents` in its renderer): a field it can't draw holds
/// the form instead of being answered wrongly.
library;

import 'package:meta/meta.dart';

/// The kind of a rule-able prop's evaluated value.
enum PropKind { integer, number, boolean, string }

@immutable
class ComponentSpec {
  const ComponentSpec(
    this.type, {
    required this.valueType,
    this.wave = 1,
    this.options = false,
    this.hasFields = false,
    this.ruleableProps = const {},
  });

  final String type;

  /// The value type rules see as `answers.<key>`; `none` for display
  /// components and groups, which carry no answer.
  final String valueType;

  /// The catalogue wave (`11` §1): 1 for the pilot set, 2 after it.
  final int wave;

  /// Has `options` / `options_source` / `options_filter` (lookup: filter
  /// only, its options come from `props.list`).
  final bool options;

  /// Holds child fields (`fields`): `group` and `repeatable_group`.
  final bool hasFields;

  /// Props that accept an expression (**R** in docs/11), and what it must
  /// evaluate to.
  final Map<String, PropKind> ruleableProps;

  bool get hasValue => valueType != 'none';
}

const Map<String, PropKind> _textProps = {
  'min_length': PropKind.integer,
  'max_length': PropKind.integer,
};

const Map<String, PropKind> _numberRange = {
  'min': PropKind.number,
  'max': PropKind.number,
};

const Map<String, PropKind> _textRange = {
  'min': PropKind.string,
  'max': PropKind.string,
};

const Map<String, ComponentSpec> formComponents = {
  // 3.1 Text & numbers
  'text': ComponentSpec('text', valueType: 'string', ruleableProps: _textProps),
  'textarea': ComponentSpec(
    'textarea',
    valueType: 'string',
    ruleableProps: _textProps,
  ),
  'number': ComponentSpec(
    'number',
    valueType: 'number',
    ruleableProps: _numberRange,
  ),
  'percentage': ComponentSpec(
    'percentage',
    valueType: 'number',
    ruleableProps: _numberRange,
  ),
  'phone': ComponentSpec('phone', valueType: 'string'),
  'currency': ComponentSpec(
    'currency',
    valueType: 'object',
    wave: 2,
    ruleableProps: {'min': PropKind.integer, 'max': PropKind.integer},
  ),
  'slider': ComponentSpec('slider', valueType: 'number', wave: 2),
  'rating': ComponentSpec('rating', valueType: 'number', wave: 2),
  'email': ComponentSpec('email', valueType: 'string', wave: 2),
  'id_number': ComponentSpec('id_number', valueType: 'string', wave: 2),
  'registration_number': ComponentSpec(
    'registration_number',
    valueType: 'string',
    wave: 2,
  ),
  // 3.2 Choice
  'boolean': ComponentSpec('boolean', valueType: 'boolean'),
  'tri_state': ComponentSpec('tri_state', valueType: 'string'),
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
  'lookup': ComponentSpec(
    'lookup',
    valueType: 'string',
    wave: 2,
    options: true,
  ),
  // 3.3 Date & time
  'date': ComponentSpec(
    'date',
    valueType: 'string',
    ruleableProps: _textRange,
  ),
  'time': ComponentSpec('time', valueType: 'string'),
  'duration': ComponentSpec('duration', valueType: 'object'),
  'business_hours': ComponentSpec('business_hours', valueType: 'object'),
  'datetime': ComponentSpec(
    'datetime',
    valueType: 'string',
    wave: 2,
    ruleableProps: _textRange,
  ),
  // 3.4 Location
  'address': ComponentSpec('address', valueType: 'object'),
  'location_pin': ComponentSpec(
    'location_pin',
    valueType: 'object',
    ruleableProps: {'max_distance_from_job_m': PropKind.number},
  ),
  'current_location': ComponentSpec(
    'current_location',
    valueType: 'object',
    wave: 2,
    ruleableProps: {'max_accuracy_m': PropKind.number},
  ),
  // 3.5 Evidence
  'photo': ComponentSpec(
    'photo',
    valueType: 'array',
    ruleableProps: {
      'min_count': PropKind.integer,
      'max_count': PropKind.integer,
    },
  ),
  'signature': ComponentSpec('signature', valueType: 'string'),
  // 3.6 Legal
  'declaration': ComponentSpec('declaration', valueType: 'object'),
  'acknowledgement': ComponentSpec('acknowledgement', valueType: 'boolean'),
  'consent': ComponentSpec('consent', valueType: 'object', wave: 2),
  // 4. Display & computed
  'info': ComponentSpec('info', valueType: 'none'),
  'callout': ComponentSpec('callout', valueType: 'none'),
  'divider': ComponentSpec('divider', valueType: 'none'),
  'image': ComponentSpec('image', valueType: 'none', wave: 2),
  'prefilled': ComponentSpec('prefilled', valueType: 'any'),
  'computed': ComponentSpec('computed', valueType: 'any', wave: 2),
  // 5. Structural
  'group': ComponentSpec('group', valueType: 'none', hasFields: true),
  'repeatable_group': ComponentSpec(
    'repeatable_group',
    valueType: 'array',
    wave: 2,
    hasFields: true,
    ruleableProps: {
      'min_items': PropKind.integer,
      'max_items': PropKind.integer,
    },
  ),
  'matrix': ComponentSpec('matrix', valueType: 'object', wave: 2),
};

ComponentSpec? formComponentSpec(String type) => formComponents[type];
