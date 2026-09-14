import 'dart:math' as math;

import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/renderer/form/form_controller.dart';
import 'package:fess_pos/src/renderer/form/form_services.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

part 'form_inputs.dart';
part 'form_summary.dart';

/// Draws a `form` definition (docs/04 §3.2, `11` §3–5) from its
/// [FormController]: each visible section's title and visible fields, in
/// order, each field's problems under it. Labels, options, what is
/// required and what shows all come from the definition and its rules.
///
/// A field this build can't draw shows a notice in its place; a form the
/// engine can't read at all shows only a notice.
class FormView extends StatelessWidget {
  const FormView({
    required this.controller,
    this.copy = BundledCopy.text,
    this.sections,
    this.services,
    this.fieldFilter,
    this.padding = const EdgeInsets.all(16),
    super.key,
  });

  final FormController controller;

  /// The inspection's camera, signature pad and declarations; null outside
  /// an inspection, where evidence and legal fields can't be answered.
  final FormFieldServices? services;

  /// Only fields this accepts (a flow step's); a section left with none is
  /// not shown.
  final bool Function(ResolvedField field)? fieldFilter;

  /// Content by key: the server's `core` strings over the bundled ones.
  final String Function(String key) copy;

  /// Only these sections (a flow step's), in the definition's order; null
  /// for all.
  final List<String>? sections;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final resolved = controller.resolved;
      if (resolved == null) {
        return Padding(
          padding: padding,
          child: _Notice(text: copy('form.unavailable'), tone: _Tone.warning),
        );
      }
      final children = <Widget>[];
      for (final section in _maps(controller.definition['sections'])) {
        final key = section['key'];
        if (key is! String) continue;
        if (sections != null && !sections!.contains(key)) continue;
        final rs = resolved.sections[key];
        if (rs == null || !rs.visible) continue;
        final fields = <Widget>[];
        _addFields(fields, _maps(section['fields']), resolved);
        if (fields.isEmpty && fieldFilter != null) continue;
        final title = rs.title;
        if (title != null && title.trim().isNotEmpty) {
          children.add(_SectionTitle(title));
        }
        final description = section['description'];
        if (description is String) {
          children.add(
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(renderTemplate(description, resolved.data)),
            ),
          );
        }
        children.addAll(fields);
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

  void _addFields(
    List<Widget> out,
    List<Map<String, Object?>> defs,
    ResolvedForm resolved,
  ) {
    for (final def in defs) {
      final f = resolved.fields[def['key']];
      if (f == null || !f.visible) continue;
      if (f.type != 'group') {
        if (fieldFilter?.call(f) ?? true) out.add(_field(def, f));
        continue;
      }
      final inner = <Widget>[];
      _addFields(inner, _maps(def['fields']), resolved);
      if (inner.isEmpty) continue;
      final label = f.label;
      if (label != null && label.trim().isNotEmpty) {
        out.add(_GroupTitle(label));
      }
      final props = def['props'];
      if (props is Map<String, Object?> && props['layout'] == 'two_column') {
        out.add(_TwoColumn(key: ValueKey('form-group-${f.key}'), inner));
      } else {
        out.addAll(inner);
      }
    }
  }

  Widget _field(Map<String, Object?> def, ResolvedField f) {
    final b = _Binding(
      field: f,
      def: def,
      controller: controller,
      copy: copy,
      errors: [
        for (final e in controller.errorsFor(f.key))
          _errorText(e, f, def, copy),
      ],
    );
    final key = ValueKey('form-field-${f.key}');
    // A value a rule works out is shown, not asked for.
    if (f.computed && supportedFormComponents.containsKey(f.type)) {
      return _Frame(
        b,
        key: key,
        child: _ReadOnlyBox(_displayValue(f.value, copy)),
      );
    }
    return switch (f.type) {
      'text' || 'textarea' => _TextInput(b, key: key),
      'number' || 'percentage' => _NumberInput(b, key: key),
      'phone' => _PhoneInput(b, key: key),
      'boolean' => _BooleanInput(b, key: key),
      'tri_state' => _TriStateInput(b, key: key),
      'single_select' => _SingleSelect(b, key: key),
      'multi_select' => _MultiSelect(b, key: key),
      'date' => _DateInput(b, key: key),
      'time' => _TimeInput(b, key: key),
      'duration' => _DurationInput(b, key: key),
      'business_hours' => _BusinessHoursInput(b, key: key),
      'prefilled' => _PrefilledView(b, key: key),
      'acknowledgement' => _AcknowledgementInput(b, key: key),
      'info' => Padding(
        key: key,
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(f.text ?? ''),
      ),
      'callout' => Padding(
        key: key,
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: _Notice(text: f.text ?? '', tone: _tone(def['tone'])),
      ),
      'divider' => Divider(key: key, height: 24),
      'photo' when services != null => _PhotoInput(b, services!, key: key),
      'signature' when services != null => _SignatureInput(
        b,
        services!,
        key: key,
      ),
      'declaration' when services != null => _DeclarationInput(
        b,
        services!,
        key: key,
      ),
      _ => _Frame(
        b,
        key: key,
        child: _Notice(
          text: copy('form.unsupported_field'),
          tone: _Tone.warning,
        ),
      ),
    };
  }
}

List<Map<String, Object?>> _maps(Object? v) => v is List<Object?>
    ? v.whereType<Map<String, Object?>>().toList()
    : const [];

String? _string(Object? v) => v is String ? v : null;

/// The copy for a problem: a definition's own `validate` message as
/// written (`VALIDATION_RULE_FAILED`, or the rule's own `code`); otherwise
/// `form.error.<type>.<code>`, then `form.error.<code>`, filled from the
/// field's props; otherwise the message as given.
String _errorText(
  ValidationError e,
  ResolvedField f,
  Map<String, Object?> def,
  String Function(String key) copy,
) {
  final ruleCodes = {
    'VALIDATION_RULE_FAILED',
    for (final rule in _maps(def['validate']))
      if (rule['code'] case final String code) code,
  };
  if (ruleCodes.contains(e.code) && e.message.isNotEmpty) return e.message;
  for (final key in [
    'form.error.${f.type}.${e.code}',
    'form.error.${e.code}',
  ]) {
    final text = copy(key);
    if (text != key) return renderTemplate(text, f.props);
  }
  return e.message;
}

/// What each field widget needs.
class _Binding {
  const _Binding({
    required this.field,
    required this.def,
    required this.controller,
    required this.copy,
    required this.errors,
  });

  final ResolvedField field;
  final Map<String, Object?> def;
  final FormController controller;
  final String Function(String key) copy;
  final List<String> errors;

  String get key => field.key;
  Map<String, Object?> get props => field.props;
  Object? get display => def['display'];
  String? get helpText => _string(def['help_text']);

  /// What the rules see: the answers, `job`, `agent`, …
  Map<String, Object?> get data => controller.resolved?.data ?? const {};

  /// A template (e.g. a prop) filled in from [data]; null when absent.
  String? template(Object? t) => t is String ? renderTemplate(t, data) : null;

  String get otherValue => _string(props['other_value']) ?? 'other';
  bool get allowOther => props['allow_other'] == true;

  /// The options, plus "other" when the field allows it.
  List<OptionDef> get choices {
    final options = field.options ?? const <OptionDef>[];
    return [
      ...options,
      if (allowOther && !options.any((o) => o.value == otherValue))
        OptionDef(
          value: otherValue,
          label: _string(props['other_label']) ?? copy('form.other'),
        ),
    ];
  }
}

/// A field's label (with `*` when required), help, input and problems.
class _Frame extends StatelessWidget {
  const _Frame(this.b, {required this.child, this.showLabel = true, super.key});

  final _Binding b;
  final Widget child;
  final bool showLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = b.field.label;
    final help = b.helpText;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (showLabel && label != null && label.isNotEmpty)
            Text(
              b.field.required ? '$label *' : label,
              style: theme.textTheme.titleSmall,
            ),
          if (help != null)
            Text(
              help,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          const SizedBox(height: 4),
          child,
          for (final e in b.errors)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                e,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _TextInput extends StatefulWidget {
  const _TextInput(this.b, {super.key});

  final _Binding b;

  @override
  State<_TextInput> createState() => _TextInputState();
}

class _TextInputState extends State<_TextInput> {
  late final TextEditingController _text = TextEditingController(
    text: _string(widget.b.controller.value(widget.b.key)),
  );
  late final FocusNode _focus = FocusNode()..addListener(_onFocus);

  void _onFocus() {
    if (!_focus.hasFocus) widget.b.controller.touch(widget.b.key);
  }

  @override
  void dispose() {
    _focus
      ..removeListener(_onFocus)
      ..dispose();
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.b;
    final multiline = b.field.type == 'textarea';
    final rows = b.props['rows'] is int ? b.props['rows']! as int : 3;
    final max = b.props['max_length'];
    return _Frame(
      b,
      child: TextField(
        controller: _text,
        focusNode: _focus,
        readOnly: b.field.readOnly,
        minLines: multiline ? rows : 1,
        maxLines: multiline ? math.max(rows, 8) : 1,
        maxLength: max is int ? max : null,
        keyboardType: multiline
            ? TextInputType.multiline
            : _keyboard(b.props['keyboard']),
        textCapitalization: _capitalise(b.props['capitalise']),
        decoration: InputDecoration(
          hintText: _string(b.props['placeholder']),
          border: const OutlineInputBorder(),
          isDense: true,
        ),
        onChanged: (v) => b.controller.setValue(b.key, v, touch: false),
      ),
    );
  }
}

TextInputType _keyboard(Object? keyboard) => switch (keyboard) {
  'number' => TextInputType.number,
  'phone' => TextInputType.phone,
  'email' => TextInputType.emailAddress,
  'url' => TextInputType.url,
  _ => TextInputType.text,
};

TextCapitalization _capitalise(Object? capitalise) => switch (capitalise) {
  'words' => TextCapitalization.words,
  'characters' => TextCapitalization.characters,
  'none' => TextCapitalization.none,
  _ => TextCapitalization.sentences,
};

class _BooleanInput extends StatelessWidget {
  const _BooleanInput(this.b, {super.key});

  final _Binding b;

  @override
  Widget build(BuildContext context) {
    final value = b.controller.value(b.key);
    final current = value is bool ? value : null;
    final yes = _string(b.props['true_label']) ?? b.copy('form.yes');
    final no = _string(b.props['false_label']) ?? b.copy('form.no');
    final readOnly = b.field.readOnly;
    // The shape of Flutter's onChanged callbacks.
    // ignore: avoid_positional_boolean_parameters
    void set(bool? v) {
      if (!readOnly && v != null) b.controller.setValue(b.key, v);
    }

    final label = b.field.label ?? '';
    return switch (b.display) {
      'toggle' => _Frame(
        b,
        child: SwitchListTile(
          value: current ?? false,
          onChanged: readOnly ? null : set,
          title: Text(current ?? false ? yes : no),
          contentPadding: EdgeInsets.zero,
        ),
      ),
      'checkbox' => _Frame(
        b,
        showLabel: false,
        child: CheckboxListTile(
          value: current ?? false,
          onChanged: readOnly ? null : set,
          title: Text(b.field.required ? '$label *' : label),
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
        ),
      ),
      _ => _Frame(
        b,
        child: IgnorePointer(
          ignoring: readOnly,
          child: RadioGroup<bool>(
            groupValue: current,
            onChanged: set,
            child: Column(
              children: [
                for (final (v, text) in [(true, yes), (false, no)])
                  RadioListTile<bool>(
                    value: v,
                    title: Text(text),
                    contentPadding: EdgeInsets.zero,
                  ),
              ],
            ),
          ),
        ),
      ),
    };
  }
}

class _SingleSelect extends StatelessWidget {
  const _SingleSelect(this.b, {super.key});

  final _Binding b;

  @override
  Widget build(BuildContext context) {
    final choices = b.choices;
    final current = _string(b.controller.value(b.key));
    final readOnly = b.field.readOnly;
    void set(String? v) {
      if (!readOnly) b.controller.setValue(b.key, v);
    }

    final input = switch (b.display) {
      'dropdown' => InputDecorator(
        decoration: const InputDecoration(
          border: OutlineInputBorder(),
          isDense: true,
        ),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            value: choices.any((c) => c.value == current) ? current : null,
            isExpanded: true,
            isDense: true,
            hint: Text(b.copy('form.select')),
            items: [
              for (final c in choices)
                DropdownMenuItem(value: c.value, child: Text(c.label)),
            ],
            onChanged: readOnly ? null : set,
          ),
        ),
      ),
      'chips' || 'segmented' => Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final c in choices)
            ChoiceChip(
              label: Text(c.label),
              selected: c.value == current,
              onSelected: readOnly ? null : (on) => set(on ? c.value : null),
            ),
        ],
      ),
      _ => IgnorePointer(
        ignoring: readOnly,
        child: RadioGroup<String>(
          groupValue: current,
          onChanged: set,
          child: Column(
            children: [
              for (final c in choices)
                RadioListTile<String>(
                  value: c.value,
                  title: Text(c.label),
                  subtitle: c.helpText == null ? null : Text(c.helpText!),
                  contentPadding: EdgeInsets.zero,
                ),
            ],
          ),
        ),
      ),
    };
    return _Frame(
      b,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          input,
          if (b.allowOther && current == b.otherValue) _OtherText(b),
        ],
      ),
    );
  }
}

class _MultiSelect extends StatelessWidget {
  const _MultiSelect(this.b, {super.key});

  final _Binding b;

  @override
  Widget build(BuildContext context) {
    final value = b.controller.value(b.key);
    final current = [
      if (value is List<Object?>)
        for (final v in value)
          if (v is String) v,
    ];
    final exclusive = [
      if (b.props['exclusive_options'] case final List<Object?> list)
        for (final v in list)
          if (v is String) v,
    ];
    final readOnly = b.field.readOnly;
    // "None of the above" stands alone: choosing it clears the rest, and
    // choosing anything else clears it.
    void toggle(String v, {required bool on}) {
      if (readOnly) return;
      final next = !on
          ? [
              for (final x in current)
                if (x != v) x,
            ]
          : exclusive.contains(v)
          ? [v]
          : [
              for (final x in current)
                if (!exclusive.contains(x) && x != v) x,
              v,
            ];
      b.controller.setValue(b.key, next);
    }

    final choices = b.choices;
    final input = b.display == 'chips'
        ? Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final c in choices)
                FilterChip(
                  label: Text(c.label),
                  selected: current.contains(c.value),
                  onSelected: readOnly ? null : (on) => toggle(c.value, on: on),
                ),
            ],
          )
        : Column(
            children: [
              for (final c in choices)
                CheckboxListTile(
                  value: current.contains(c.value),
                  onChanged: readOnly
                      ? null
                      : (on) => toggle(c.value, on: on ?? false),
                  title: Text(c.label),
                  subtitle: c.helpText == null ? null : Text(c.helpText!),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: EdgeInsets.zero,
                ),
            ],
          );
    return _Frame(
      b,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          input,
          if (b.allowOther && current.contains(b.otherValue)) _OtherText(b),
        ],
      ),
    );
  }
}

/// The description of an "other" choice.
class _OtherText extends StatefulWidget {
  _OtherText(this.b) : super(key: ValueKey('form-other-${b.key}'));

  final _Binding b;

  @override
  State<_OtherText> createState() => _OtherTextState();
}

class _OtherTextState extends State<_OtherText> {
  late final TextEditingController _text = TextEditingController(
    text: widget.b.controller.otherText(widget.b.key),
  );

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 8),
    child: TextField(
      controller: _text,
      readOnly: widget.b.field.readOnly,
      textCapitalization: TextCapitalization.sentences,
      decoration: InputDecoration(
        hintText: widget.b.copy('form.other_text'),
        border: const OutlineInputBorder(),
        isDense: true,
      ),
      onChanged: (v) =>
          widget.b.controller.setOtherText(widget.b.key, v, touch: false),
    ),
  );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 8, bottom: 8),
    child: Text(
      title,
      style: Theme.of(
        context,
      ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
    ),
  );
}

enum _Tone { info, warning, danger }

_Tone _tone(Object? tone) => switch (tone) {
  'warning' => _Tone.warning,
  'danger' || 'error' => _Tone.danger,
  _ => _Tone.info,
};

class _Notice extends StatelessWidget {
  const _Notice({required this.text, required this.tone});

  final String text;
  final _Tone tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (background, foreground) = switch (tone) {
      _Tone.info => (scheme.secondaryContainer, scheme.onSecondaryContainer),
      _Tone.warning => (scheme.tertiaryContainer, scheme.onTertiaryContainer),
      _Tone.danger => (scheme.errorContainer, scheme.onErrorContainer),
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(PosTokens.radiusControl),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Text(text, style: TextStyle(color: foreground)),
      ),
    );
  }
}

List<String> _evidenceIds(Object? v) => [
  if (v is List<Object?>)
    for (final x in v)
      if (x is String) x,
];

/// Photos (`11` §3.5): the ones taken so far and a button for the next,
/// up to `max_count`. The camera stores each photo before it shows here.
/// Retakes, captions and guided sequences come with T4-04.
class _PhotoInput extends StatefulWidget {
  const _PhotoInput(this.b, this.services, {super.key});

  final _Binding b;
  final FormFieldServices services;

  @override
  State<_PhotoInput> createState() => _PhotoInputState();
}

class _PhotoInputState extends State<_PhotoInput> {
  bool _busy = false;

  Future<void> _take() async {
    setState(() => _busy = true);
    try {
      final id = await widget.services.takePhoto(context, widget.b.field);
      if (id != null) {
        final b = widget.b;
        b.controller.setValue(b.key, [
          ..._evidenceIds(b.controller.value(b.key)),
          id,
        ]);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.b;
    final ids = _evidenceIds(b.controller.value(b.key));
    final max = b.props['max_count'];
    final full = max is num && ids.length >= max;
    return _Frame(
      b,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (ids.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final id in ids)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(
                        PosTokens.radiusControl,
                      ),
                      child: SizedBox.square(
                        dimension: 88,
                        child: widget.services.evidenceImage(id, 88),
                      ),
                    ),
                ],
              ),
            ),
          OutlinedButton.icon(
            key: ValueKey('photo-take-${b.key}'),
            onPressed: b.field.readOnly || full || _busy ? null : _take,
            icon: const Icon(Icons.photo_camera),
            label: Text(b.copy('inspection.take_photo')),
          ),
          if (_busy) _Saving(b.copy('inspection.saving')),
        ],
      ),
    );
  }
}

/// A signature (`11` §3.5): drawn on the pad, stored, then shown here.
class _SignatureInput extends StatefulWidget {
  const _SignatureInput(this.b, this.services, {super.key});

  final _Binding b;
  final FormFieldServices services;

  @override
  State<_SignatureInput> createState() => _SignatureInputState();
}

class _SignatureInputState extends State<_SignatureInput> {
  bool _busy = false;

  Future<void> _sign() async {
    setState(() => _busy = true);
    try {
      final id = await widget.services.drawSignature(context, widget.b.field);
      if (id != null) widget.b.controller.setValue(widget.b.key, id);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.b;
    final id = _string(b.controller.value(b.key));
    return _Frame(
      b,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (id != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SizedBox(
                height: 120,
                child: widget.services.evidenceImage(id, 120),
              ),
            ),
          OutlinedButton.icon(
            key: ValueKey('signature-sign-${b.key}'),
            onPressed: b.field.readOnly || _busy ? null : _sign,
            icon: const Icon(Icons.draw),
            label: Text(
              b.copy(id == null ? 'inspection.sign' : 'inspection.sign_again'),
            ),
          ),
          if (_busy) _Saving(b.copy('inspection.saving')),
        ],
      ),
    );
  }
}

/// Shown while a capture is being stored: it waits briefly for a location
/// fix to go with it, and the answer counts only once it's stored.
class _Saving extends StatelessWidget {
  const _Saving(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 8),
    child: Row(
      children: [
        const SizedBox.square(
          dimension: 16,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
        const SizedBox(width: 8),
        Text(text),
      ],
    ),
  );
}

/// A declaration (`11` §3.6): its exact wording, and acceptance of that
/// version, which goes into the answers hash (docs/07 §4). A newer version
/// must be accepted again.
class _DeclarationInput extends StatelessWidget {
  const _DeclarationInput(this.b, this.services, {super.key});

  final _Binding b;
  final FormFieldServices services;

  @override
  Widget build(BuildContext context) {
    final declarationKey = _string(b.props['declaration_key']) ?? b.key;
    final declaration = services.declaration(declarationKey);
    if (declaration == null) {
      return _Frame(
        b,
        child: _Notice(
          text: b.copy('inspection.declaration_missing'),
          tone: _Tone.warning,
        ),
      );
    }
    final value = b.controller.value(b.key);
    final accepted =
        value is Map<String, Object?> &&
        value['accepted'] == true &&
        value['declaration_version_id'] == declaration.id;
    final theme = Theme.of(context);
    return _Frame(
      b,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(PosTokens.radiusControl),
            ),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Text(declaration.text),
            ),
          ),
          CheckboxListTile(
            key: ValueKey('declaration-accept-${b.key}'),
            value: accepted,
            onChanged: b.field.readOnly
                ? null
                : (on) => b.controller.setValue(
                    b.key,
                    on ?? false
                        ? {
                            'accepted': true,
                            'declaration_version_id': declaration.id,
                            'accepted_at': isoWithOffset(services.now()),
                          }
                        : null,
                  ),
            title: Text(b.copy('inspection.declaration_accept')),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
          ),
        ],
      ),
    );
  }
}
