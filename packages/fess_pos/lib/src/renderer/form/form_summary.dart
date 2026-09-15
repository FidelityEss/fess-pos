part of 'form_view.dart';

/// The answers so far, section by section, for the agent to check before
/// declaring (`summary_review`, `11` §6). With [onEdit] each section offers
/// a way back to change it; with [showRiskIndicators] answers that a
/// definition's `risk_indicator` flags are marked.
class FormSummary extends StatelessWidget {
  const FormSummary({
    required this.controller,
    required this.sections,
    this.copy = BundledCopy.text,
    this.showRiskIndicators = false,
    this.onEdit,
    this.padding = const EdgeInsets.all(16),
    super.key,
  });

  final FormController controller;

  /// The sections to show, in order.
  final List<String> sections;

  /// Content by key: the server's `core` strings over the bundled ones.
  final String Function(String key) copy;
  final bool showRiskIndicators;
  final void Function(String section)? onEdit;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final resolved = controller.resolved;
      if (resolved == null) return const SizedBox.shrink();
      final defs = {
        for (final s in _maps(controller.definition['sections']))
          if (s['key'] case final String key) key: s,
      };
      final children = <Widget>[];
      for (final key in sections) {
        final rs = resolved.sections[key];
        final section = defs[key];
        if (rs == null || !rs.visible || section == null) continue;
        final rows = <Widget>[
          for (final def in _inputs(_maps(section['fields'])))
            if (resolved.fields[def['key']] case final ResolvedField f
                when f.visible &&
                    (formComponentSpec(f.type)?.hasValue ?? false))
              _SummaryRow(
                field: f,
                value: _summaryValue(f, controller, copy),
                risk: showRiskIndicators ? _risk(def, resolved, copy) : null,
              ),
        ];
        if (rows.isEmpty) continue;
        children
          ..add(
            Row(
              children: [
                Expanded(child: _SectionTitle(rs.title ?? key)),
                if (onEdit != null)
                  TextButton(
                    key: ValueKey('summary-edit-$key'),
                    onPressed: () => onEdit!(key),
                    child: Text(copy('summary.change')),
                  ),
              ],
            ),
          )
          ..addAll(rows)
          ..add(const Divider(height: 24));
      }
      return Padding(
        padding: padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: children,
        ),
      );
    },
  );
}

/// The fields of [defs] with groups opened.
List<Map<String, Object?>> _inputs(List<Map<String, Object?>> defs) => [
  for (final d in defs)
    if (d['type'] == 'group') ..._inputs(_maps(d['fields'])) else d,
];

/// A flag a definition's `risk_indicator` raises now, or null.
({String level, String label})? _risk(
  Map<String, Object?> def,
  ResolvedForm resolved,
  String Function(String key) copy,
) {
  final indicator = def['risk_indicator'];
  if (indicator is! Map<String, Object?>) return null;
  final when = indicator['when'];
  bool holds;
  try {
    holds = when is bool
        ? when
        : evaluateRule(when, resolved.data, env: resolved.env) == true;
  } on RuleError {
    holds = false;
  }
  if (!holds) return null;
  final level = _string(indicator['level']) ?? 'info';
  final label = _string(indicator['label']);
  return (
    level: level,
    label: label == null
        ? copy('summary.risk.$level')
        : renderTemplate(label, resolved.data),
  );
}

/// An answer in words.
String _summaryValue(
  ResolvedField f,
  FormController c,
  String Function(String key) copy,
) {
  if (f.computed || f.type == 'prefilled') return _displayValue(f.value, copy);
  if (c.isUnknown(f.key)) return copy('summary.unknown');
  final v = c.value(f.key);
  if (isEmptyAnswer(v)) return copy('summary.unanswered');
  final otherValue = _string(f.props['other_value']) ?? 'other';
  String option(Object? x) {
    for (final o in f.options ?? const <OptionDef>[]) {
      if (o.value == x) return o.label;
    }
    return x == otherValue
        ? c.otherText(f.key) ?? copy('form.other')
        : _displayValue(x, copy);
  }

  return switch (f.type) {
    'photo' => renderTemplate(copy('summary.photos'), {
      'n': v is List<Object?> ? v.length : 0,
    }),
    'signature' => copy('summary.signed'),
    'declaration' || 'acknowledgement' => copy('summary.accepted'),
    'single_select' || 'lookup' => option(v),
    'multi_select' when v is List<Object?> => v.map(option).join(', '),
    'boolean' when v is bool =>
      _string(f.props[v ? 'true_label' : 'false_label']) ??
          copy(v ? 'form.yes' : 'form.no'),
    'tri_state' => switch (v) {
      'yes' => copy('form.yes'),
      'no' => copy('form.no'),
      'na' => copy('form.not_applicable'),
      _ => _displayValue(v, copy),
    },
    'date' when _day(v) != null => _formatDay(_day(v)!, copy),
    'duration' when v is Map<String, Object?> =>
      '${_numberText(v['value'])} ${copy('form.duration.${v['unit']}')}',
    'business_hours' when v is Map<String, Object?> => [
      for (final e in v.entries)
        '${copy('form.hours.${e.key}')}: ${_hours(e.value, copy)}',
    ].join('; '),
    _ => _displayValue(v, copy),
  };
}

/// One day group's business hours in words.
String _hours(Object? h, String Function(String key) copy) => switch (h) {
  'closed' => copy('form.hours.closed'),
  '24h' => copy('form.hours.24h'),
  final Map<String, Object?> m => '${m['open'] ?? '?'}–${m['close'] ?? '?'}',
  _ => '$h',
};

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.field, required this.value, this.risk});

  final ResolvedField field;
  final String value;
  final ({String level, String label})? risk;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final flag = risk;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            field.label ?? field.key,
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
          Row(
            children: [
              Expanded(
                child: Text(
                  value,
                  key: ValueKey('summary-${field.key}'),
                  style: theme.textTheme.bodyLarge,
                ),
              ),
              if (flag != null)
                DecoratedBox(
                  key: ValueKey('summary-risk-${field.key}'),
                  decoration: BoxDecoration(
                    color: switch (flag.level) {
                      'high' => scheme.errorContainer,
                      'elevated' => scheme.tertiaryContainer,
                      _ => scheme.secondaryContainer,
                    },
                    borderRadius: BorderRadius.circular(
                      PosTokens.radiusControl,
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    child: Text(flag.label, style: theme.textTheme.labelSmall),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
