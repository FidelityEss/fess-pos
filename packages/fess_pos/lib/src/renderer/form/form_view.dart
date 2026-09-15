import 'dart:math' as math;

import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/theme/pos_tones.dart';
import 'package:fess_pos/src/core/theme/pos_widgets.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/renderer/form/form_controller.dart';
import 'package:fess_pos/src/renderer/form/form_services.dart';
import 'package:fess_pos/src/renderer/markdown.dart';
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
    this.padding = const EdgeInsets.symmetric(
      horizontal: PosTokens.componentPagePaddingX,
      vertical: 16,
    ),
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
          child: _Notice(text: copy('form.unavailable'), tone: PosTone.warning),
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

  /// [f] as drawn: as its declared fallback when this build can't draw its
  /// own type (docs/04 §8), with the fallback's display and props.
  Widget _field(Map<String, Object?> def, ResolvedField f) {
    final type = controller.renderedAs[f.key];
    final fallback = def['fallback'];
    if (type == null || fallback is! Map<String, Object?>) {
      return _drawField(def, f);
    }
    final props = fallback['props'] is Map<String, Object?>
        ? fallback['props']! as Map<String, Object?>
        : const <String, Object?>{};
    return _drawField(
      {...def, 'type': type, 'display': fallback['display'], 'props': props},
      ResolvedField(
        key: f.key,
        path: f.path,
        type: type,
        section: f.section,
        visible: f.visible,
        required: f.required,
        readOnly: f.readOnly,
        value: f.value,
        computed: f.computed,
        props: props,
        label: f.label,
        text: f.text,
        hasDefault: f.hasDefault,
        defaultValue: f.defaultValue,
      ),
    );
  }

  Widget _drawField(Map<String, Object?> def, ResolvedField f) {
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
      'address' => _AddressInput(b, services, key: key),
      'info' => Padding(
        key: key,
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: PosMarkdown(f.text ?? ''),
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
      'location_pin' when services?.pickPin != null => _LocationPinInput(
        b,
        services!,
        key: key,
      ),
      _ => _Frame(
        b,
        key: key,
        child: _Notice(
          text: copy('form.unsupported_field'),
          tone: PosTone.warning,
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
        decoration: InputDecoration(hintText: _string(b.props['placeholder'])),
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
          contentPadding: EdgeInsets.symmetric(
            horizontal: PosTokens.componentInputPaddingX,
            vertical: PosTokens.componentInputPaddingY - 2,
          ),
        ),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            value: choices.any((c) => c.value == current) ? current : null,
            isExpanded: true,
            isDense: true,
            hint: Text(
              b.copy('form.select'),
              style: Theme.of(context).inputDecorationTheme.hintStyle,
            ),
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
      decoration: InputDecoration(hintText: widget.b.copy('form.other_text')),
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
    padding: const EdgeInsets.only(top: 16, bottom: 8),
    child: Text(
      title,
      style: Theme.of(
        context,
      ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
    ),
  );
}

PosTone _tone(Object? tone) => posTone(tone, fallback: PosTone.info);

/// A notice in a form: a light tint with dark text of its tone (docs/14 §3).
class _Notice extends StatelessWidget {
  const _Notice({required this.text, required this.tone});

  final String text;
  final PosTone tone;

  @override
  Widget build(BuildContext context) {
    final colors = posToneColors(tone);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(PosTokens.componentCardInnerRadius),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Text(
          text,
          style: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(color: colors.foreground),
        ),
      ),
    );
  }
}

List<String> _evidenceIds(Object? v) => [
  if (v is List<Object?>)
    for (final x in v)
      if (x is String) x,
];

/// Photos (`11` §3.5, T4-04): the field's guidance, the photos taken so far
/// with their captions, how many it needs (`min_count`, `max_count`, which
/// rules may set) and a button for the next. The camera stores each photo
/// before it shows here.
///
/// With `display: guided_sequence` one tap takes photo after photo until
/// the field has what it asks for. Tapping a photo offers a retake or its
/// removal, as `retake` allows (`allowed`, `confirm`, `disallowed`). A photo
/// replaced or removed stays on record; it just isn't in the answer.
class _PhotoInput extends StatefulWidget {
  const _PhotoInput(this.b, this.services, {super.key});

  final _Binding b;
  final FormFieldServices services;

  @override
  State<_PhotoInput> createState() => _PhotoInputState();
}

class _PhotoInputState extends State<_PhotoInput> {
  bool _busy = false;

  _Binding get b => widget.b;

  List<String> get _ids => _evidenceIds(b.controller.value(b.key));

  int? get _min => _num(b.props['min_count'])?.toInt();

  int? get _max => _num(b.props['max_count'])?.toInt();

  String get _retake => _string(b.props['retake']) ?? 'allowed';

  void _set(List<String> ids) => b.controller.setValue(b.key, ids);

  Future<String?> _shoot(PhotoShot shot) =>
      widget.services.takePhoto(context, b.field, shot);

  Future<void> _take() async {
    setState(() => _busy = true);
    try {
      if (b.display != 'guided_sequence') {
        final id = await _shoot(PhotoShot(number: _ids.length + 1));
        if (id != null) _set([..._ids, id]);
        return;
      }
      // The camera comes back until the field has what it asks for, or the
      // agent goes back.
      var total = math.max(_min ?? 1, _ids.length + 1);
      if (_max case final int max) total = math.min(total, max);
      while (mounted && _ids.length < total) {
        final id = await _shoot(
          PhotoShot(number: _ids.length + 1, of: total),
        );
        if (id == null) break;
        _set([..._ids, id]);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _manage(int index) async {
    if (_retake == 'disallowed' || b.field.readOnly || _busy) return;
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (sheet) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              key: ValueKey('photo-retake-${b.key}-$index'),
              leading: const Icon(Icons.replay),
              title: Text(b.copy('photo.retake')),
              onTap: () => Navigator.of(sheet).pop('retake'),
            ),
            ListTile(
              key: ValueKey('photo-remove-${b.key}-$index'),
              leading: const Icon(Icons.delete_outline),
              title: Text(b.copy('photo.remove')),
              onTap: () => Navigator.of(sheet).pop('remove'),
            ),
          ],
        ),
      ),
    );
    if (choice == null || !mounted) return;
    if (_retake == 'confirm') {
      final retake = choice == 'retake';
      final ok = await showDialog<bool>(
        context: context,
        builder: (dialog) => AlertDialog(
          content: Text(
            b.copy(retake ? 'photo.retake_confirm' : 'photo.remove_confirm'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialog).pop(false),
              child: Text(b.copy('inspection.cancel')),
            ),
            FilledButton(
              key: ValueKey('photo-confirm-${b.key}'),
              // Removing is the destructive choice: FESS's red.
              style: retake ? null : posDangerButtonStyle(),
              onPressed: () => Navigator.of(dialog).pop(true),
              child: Text(b.copy(retake ? 'photo.retake' : 'photo.remove')),
            ),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }
    if (choice == 'remove') {
      _set([..._ids]..removeAt(index));
      return;
    }
    setState(() => _busy = true);
    try {
      final id = await _shoot(PhotoShot(number: index + 1));
      if (id != null && mounted) {
        final ids = [..._ids];
        if (index < ids.length) {
          ids[index] = id;
        } else {
          ids.add(id);
        }
        _set(ids);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _count(int n) {
    final (min, max) = (_min, _max);
    final key = switch ((min != null && min > 0, max != null)) {
      (true, true) => 'photo.count.range',
      (true, false) => 'photo.count.min',
      (false, true) => 'photo.count.max',
      _ => 'photo.count',
    };
    return renderTemplate(b.copy(key), {'n': n, 'min': ?min, 'max': ?max});
  }

  @override
  Widget build(BuildContext context) {
    final ids = _ids;
    final max = _max;
    final full = max != null && ids.length >= max;
    final guidance = b.props['guidance'] is Map<String, Object?>
        ? b.template((b.props['guidance']! as Map<String, Object?>)['text'])
        : null;
    final theme = Theme.of(context);
    return _Frame(
      b,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (guidance != null && guidance.trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                guidance,
                key: ValueKey('photo-guidance-${b.key}'),
                style: theme.textTheme.bodySmall,
              ),
            ),
          if (ids.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (var i = 0; i < ids.length; i++)
                    InkWell(
                      key: ValueKey('photo-thumb-${b.key}-$i'),
                      onTap: () => _manage(i),
                      child: SizedBox(
                        width: 88,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(
                                PosTokens.radiusControl,
                              ),
                              child: SizedBox.square(
                                dimension: 88,
                                child: widget.services.evidenceImage(
                                  ids[i],
                                  88,
                                ),
                              ),
                            ),
                            if (widget.services.evidence(ids[i])?.caption
                                case final String caption)
                              Text(
                                caption,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.bodySmall,
                              ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              _count(ids.length),
              key: ValueKey('photo-count-${b.key}'),
              style: theme.textTheme.bodySmall,
            ),
          ),
          OutlinedButton.icon(
            key: ValueKey('photo-take-${b.key}'),
            onPressed: b.field.readOnly || full || _busy ? null : _take,
            icon: const Icon(Icons.photo_camera),
            label: Text(
              b.copy(
                b.display == 'guided_sequence'
                    ? 'inspection.take_photos'
                    : 'inspection.take_photo',
              ),
            ),
          ),
          if (_busy) _Saving(b.copy('inspection.saving')),
        ],
      ),
    );
  }
}

/// A signature (`11` §3.5, T4-05): drawn on the pad, stored, then shown
/// here with who signed. Where the form binds the signer's name and
/// designation (`signer_name_field`, `signer_designation_field`), they are
/// filled in before signing and go into the signature's record; if either
/// changes afterwards, the field says to sign again. Signing again keeps
/// the earlier signature on record.
class _SignatureInput extends StatefulWidget {
  const _SignatureInput(this.b, this.services, {super.key});

  final _Binding b;
  final FormFieldServices services;

  @override
  State<_SignatureInput> createState() => _SignatureInputState();
}

class _SignatureInputState extends State<_SignatureInput> {
  bool _busy = false;

  _Binding get b => widget.b;

  /// The answer of the field bound by [prop], as text: null when none is
  /// bound, '' when it has no answer.
  String? _bound(String prop) {
    final key = _string(b.props[prop]);
    if (key == null) return null;
    final value = b.controller.value(key);
    return value == null ? '' : '$value'.trim();
  }

  /// A bound field that is shown and still empty: the signer is named
  /// before signing (docs/07 §4).
  bool _missing(String prop) {
    final key = _string(b.props[prop]);
    if (key == null) return false;
    final shown = b.controller.resolved?.fields[key]?.visible ?? false;
    return shown && (_bound(prop)?.isEmpty ?? false);
  }

  Future<void> _sign({required bool again}) async {
    if (again) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (dialog) => AlertDialog(
          content: Text(b.copy('signature.sign_again_confirm')),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialog).pop(false),
              child: Text(b.copy('inspection.cancel')),
            ),
            FilledButton(
              key: ValueKey('signature-confirm-${b.key}'),
              onPressed: () => Navigator.of(dialog).pop(true),
              child: Text(b.copy('inspection.sign_again')),
            ),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }
    setState(() => _busy = true);
    try {
      final id = await widget.services.drawSignature(context, b.field);
      if (id != null) b.controller.setValue(b.key, id);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final id = _string(b.controller.value(b.key));
    final item = id == null ? null : widget.services.evidence(id);
    final name = _bound('signer_name_field');
    final designation = _bound('signer_designation_field');
    final waiting =
        _missing('signer_name_field') || _missing('signer_designation_field');
    // Who signed, as recorded, against what the answers say now.
    final changed =
        item != null &&
        ((name != null && (item.signerName ?? '') != name) ||
            (designation != null &&
                (item.signerDesignation ?? '') != designation));
    final signedBy = [
      item?.signerName,
      item?.signerDesignation,
    ].whereType<String>().join(' · ');
    final small = Theme.of(context).textTheme.bodySmall;
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
          if (signedBy.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                renderTemplate(b.copy('signature.signed_by'), {
                  'who': signedBy,
                }),
                key: ValueKey('signature-signer-${b.key}'),
                style: small,
              ),
            ),
          if (changed)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                b.copy('signature.signer_changed'),
                key: ValueKey('signature-changed-${b.key}'),
                style: small?.copyWith(
                  color: Theme.of(context).colorScheme.error,
                ),
              ),
            ),
          if (waiting)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                b.copy('signature.signer_first'),
                key: ValueKey('signature-waiting-${b.key}'),
                style: small,
              ),
            ),
          OutlinedButton.icon(
            key: ValueKey('signature-sign-${b.key}'),
            onPressed: b.field.readOnly || _busy || waiting
                ? null
                : () => _sign(again: id != null),
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

Map<String, Object?>? _asMap(Object? v) => v is Map<String, Object?> ? v : null;

/// Where a pin sits, shown and set (`address`, `location_pin`; T4-11).
class _PinRow extends StatefulWidget {
  const _PinRow({
    required this.b,
    required this.services,
    required this.pin,
    required this.onPin,
  });

  final _Binding b;
  final FormFieldServices services;
  final Map<String, Object?>? pin;
  final void Function(Map<String, Object?> pin) onPin;

  @override
  State<_PinRow> createState() => _PinRowState();
}

class _PinRowState extends State<_PinRow> {
  bool _busy = false;

  Future<void> _pick() async {
    setState(() => _busy = true);
    try {
      final pin = await widget.services.pickPin!(
        context,
        widget.b.field,
        widget.pin,
      );
      if (pin != null) widget.onPin(pin);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.b;
    final pin = widget.pin;
    final lat = pin?['lat'];
    final lng = pin?['lng'];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: Text(
            lat is num && lng is num
                ? renderTemplate(b.copy('pin.at'), {
                    'lat': lat.toStringAsFixed(5),
                    'lng': lng.toStringAsFixed(5),
                  })
                : b.copy('pin.none'),
            key: ValueKey('pin-value-${b.key}'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        OutlinedButton.icon(
          key: ValueKey('pin-set-${b.key}'),
          onPressed: b.field.readOnly || _busy ? null : _pick,
          icon: const Icon(Icons.push_pin_outlined),
          label: Text(b.copy(pin == null ? 'pin.set' : 'pin.change')),
        ),
      ],
    );
  }
}

/// A pin (`location_pin`, `11` §3.4; T4-11): placed on the phone's cached
/// map, or from the current location. The rules check how far it is from
/// the job (`max_distance_from_job_m`).
class _LocationPinInput extends StatelessWidget {
  const _LocationPinInput(this.b, this.services, {super.key});

  final _Binding b;
  final FormFieldServices services;

  @override
  Widget build(BuildContext context) => _Frame(
    b,
    child: _PinRow(
      b: b,
      services: services,
      pin: _asMap(b.controller.value(b.key)),
      onPin: (pin) => b.controller.setValue(b.key, pin),
    ),
  );
}

/// A South African address (`address`, `11` §3.4; T4-11): typed, so it
/// works offline, and a pin on the map where `map_pin` asks for one and a
/// map is at hand. Geocoding (`geocode: when_online`) completes
/// server-side (D-83).
class _AddressInput extends StatefulWidget {
  const _AddressInput(this.b, this.services, {super.key});

  final _Binding b;
  final FormFieldServices? services;

  @override
  State<_AddressInput> createState() => _AddressInputState();
}

class _AddressInputState extends State<_AddressInput> {
  static const List<String> _parts = [
    'line1',
    'line2',
    'suburb',
    'city',
    'province',
    'postal_code',
  ];

  late final Map<String, TextEditingController> _text = {
    for (final k in _parts)
      k: TextEditingController(text: _string(_value?[k]) ?? ''),
  };

  _Binding get b => widget.b;

  Map<String, Object?>? get _value => _asMap(b.controller.value(b.key));

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _changed({Map<String, Object?>? pin}) {
    final keep = pin ?? _asMap(_value?['pin']);
    final next = <String, Object?>{
      for (final k in _parts)
        if (_text[k]!.text.trim().isNotEmpty) k: _text[k]!.text.trim(),
      'pin': ?keep,
    };
    b.controller.setValue(b.key, next.isEmpty ? null : next);
  }

  @override
  Widget build(BuildContext context) {
    final provinces = [
      if (b.props['provinces'] case final List<Object?> list)
        for (final p in list)
          if (p is String) p,
    ];
    final mode = _string(b.props['map_pin']) ?? 'optional';
    final services = widget.services;
    Widget line(String part) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: TextField(
        key: ValueKey('address-$part-${b.key}'),
        controller: _text[part],
        readOnly: b.field.readOnly,
        textCapitalization: TextCapitalization.words,
        keyboardType: part == 'postal_code'
            ? TextInputType.number
            : TextInputType.streetAddress,
        decoration: InputDecoration(labelText: b.copy('address.$part')),
        onChanged: (_) => _changed(),
      ),
    );
    final province = _text['province']!.text;
    return _Frame(
      b,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          line('line1'),
          line('line2'),
          line('suburb'),
          line('city'),
          if (provinces.isEmpty)
            line('province')
          else
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: b.copy('address.province'),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    key: ValueKey('address-province-${b.key}'),
                    isExpanded: true,
                    isDense: true,
                    value: provinces.contains(province) ? province : null,
                    items: [
                      for (final p in provinces)
                        DropdownMenuItem(value: p, child: Text(p)),
                    ],
                    onChanged: b.field.readOnly
                        ? null
                        : (p) {
                            setState(() => _text['province']!.text = p ?? '');
                            _changed();
                          },
                  ),
                ),
              ),
            ),
          line('postal_code'),
          if (mode != 'none' && services != null && services.pickPin != null)
            _PinRow(
              b: b,
              services: services,
              pin: _asMap(_value?['pin']),
              onPin: (pin) => _changed(pin: pin),
            ),
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
          tone: PosTone.warning,
        ),
      );
    }
    final value = b.controller.value(b.key);
    final accepted =
        value is Map<String, Object?> &&
        value['accepted'] == true &&
        value['declaration_version_id'] == declaration.id;
    // An earlier version was accepted: this one has to be, again.
    final outdated =
        value is Map<String, Object?> &&
        value['accepted'] == true &&
        value['declaration_version_id'] != declaration.id;
    final theme = Theme.of(context);
    final title = declaration.title;
    return _Frame(
      b,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (outdated)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: KeyedSubtree(
                key: ValueKey('declaration-newer-${b.key}'),
                child: _Notice(
                  text: b.copy('inspection.declaration_newer'),
                  tone: PosTone.warning,
                ),
              ),
            ),
          DecoratedBox(
            decoration: BoxDecoration(
              color: PosTokens.colorBackgroundSubtle,
              border: Border.all(color: PosTokens.colorLineBorder),
              borderRadius: BorderRadius.circular(
                PosTokens.componentCardInnerRadius,
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (title != null && title.trim().isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(title, style: theme.textTheme.titleSmall),
                    ),
                  Text(declaration.text),
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      renderTemplate(b.copy('inspection.declaration_version'), {
                        'version': declaration.version,
                      }),
                      key: ValueKey('declaration-version-${b.key}'),
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
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
