part of 'form_view.dart';

// The Wave-1 inputs beyond text and choices (`11` §3.1–3.3, §3.6, §4, §5;
// T3-03). Each stores exactly the value shape the engine validates, and
// keeps what the agent typed when it isn't valid, so the problem shows
// instead of the answer quietly disappearing.

num? _num(Object? v) => v is num ? v : null;

/// A number as text: whole numbers without a decimal point.
String _numberText(Object? v) => switch (v) {
  final int n => '$n',
  final double n when n.isFinite && n == n.roundToDouble() && n.abs() < 1e15 =>
    '${n.toInt()}',
  final num n => '$n',
  final String s => s,
  _ => '',
};

final RegExp _decimal = RegExp(r'^[-+]?(\d+([.,]\d*)?|[.,]\d+)$');

/// A typed number: a comma works as the decimal point and spaces separate
/// thousands. Anything else is kept as typed.
Object? _parseNumber(String text) {
  final s = text.replaceAll(RegExp(r'\s'), '');
  if (s.isEmpty) return null;
  if (!_decimal.hasMatch(s)) return text;
  final n = num.tryParse(s.replaceAll(',', '.'));
  return n != null && n.isFinite ? n : text;
}

num _round(num v, int places) =>
    places <= 0 ? v.round() : num.parse(v.toStringAsFixed(places));

/// A stored value in words, for read-only fields.
String _displayValue(Object? v, String Function(String key) copy) =>
    switch (v) {
      null => '—',
      final bool x => copy(x ? 'form.yes' : 'form.no'),
      final num n => _numberText(n),
      final String s => s.trim().isEmpty ? '—' : s,
      final List<Object?> l => [
        for (final x in l) _displayValue(x, copy),
      ].join(', '),
      // An address and the like: its written parts, in order.
      final Map<String, Object?> m => [
        for (final x in m.values)
          if ((x is String && x.trim().isNotEmpty) || x is num)
            _displayValue(x, copy),
      ].join(', '),
      _ => '$v',
    };

class _ReadOnlyBox extends StatelessWidget {
  const _ReadOnlyBox(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(PosTokens.radiusControl),
    ),
    child: Padding(padding: const EdgeInsets.all(12), child: Text(text)),
  );
}

/// Number and percentage (`11` §3.1): typed, or with − / + buttons
/// (`stepper`), or a slider for a percentage (`slider`).
class _NumberInput extends StatefulWidget {
  const _NumberInput(this.b, {super.key});

  final _Binding b;

  @override
  State<_NumberInput> createState() => _NumberInputState();
}

class _NumberInputState extends State<_NumberInput> {
  late final TextEditingController _text = TextEditingController(
    text: _numberText(widget.b.controller.value(widget.b.key)),
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

  /// One step up or down, within the limits. An empty field starts at
  /// `min` (or 0).
  void _step(int direction) {
    final b = widget.b;
    final current = b.controller.value(b.key);
    final step = _num(b.props['step']) ?? 1;
    final min = _num(b.props['min']);
    final max = _num(b.props['max']);
    var next = current is num ? current + direction * step : (min ?? 0);
    if (min != null && next < min) next = min;
    if (max != null && next > max) next = max;
    final places =
        _num(b.props['decimals'])?.toInt() ??
        math.max(
          decimalPlaces(step),
          current is num ? decimalPlaces(current) : 0,
        );
    next = _round(next, places);
    _text.text = _numberText(next);
    b.controller.setValue(b.key, next);
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.b;
    final percent = b.field.type == 'percentage';
    if (percent && b.display == 'slider') {
      return _Frame(b, child: _PercentSlider(b));
    }
    final min = _num(b.props['min']);
    final whole = b.props['integer'] == true || b.props['decimals'] == 0;
    final readOnly = b.field.readOnly;
    final field = TextField(
      key: ValueKey('number-${b.key}'),
      controller: _text,
      focusNode: _focus,
      readOnly: readOnly,
      keyboardType: TextInputType.numberWithOptions(
        decimal: !whole,
        signed: min == null || min < 0,
      ),
      inputFormatters: [
        FilteringTextInputFormatter.allow(RegExp(r'[0-9.,\- ]')),
      ],
      decoration: InputDecoration(
        hintText: b.template(b.props['placeholder']),
        suffixText: percent ? '%' : _string(b.props['unit']),
        border: const OutlineInputBorder(),
        isDense: true,
      ),
      onChanged: (v) =>
          b.controller.setValue(b.key, _parseNumber(v), touch: false),
    );
    if (percent || b.display != 'stepper') return _Frame(b, child: field);
    return _Frame(
      b,
      child: Row(
        children: [
          IconButton(
            key: ValueKey('number-down-${b.key}'),
            onPressed: readOnly ? null : () => _step(-1),
            icon: const Icon(Icons.remove),
          ),
          Expanded(child: field),
          IconButton(
            key: ValueKey('number-up-${b.key}'),
            onPressed: readOnly ? null : () => _step(1),
            icon: const Icon(Icons.add),
          ),
        ],
      ),
    );
  }
}

class _PercentSlider extends StatelessWidget {
  const _PercentSlider(this.b);

  final _Binding b;

  @override
  Widget build(BuildContext context) {
    var lo = (_num(b.props['min']) ?? 0).toDouble();
    var hi = (_num(b.props['max']) ?? 100).toDouble();
    if (hi <= lo) (lo, hi) = (0, 100);
    final places = (_num(b.props['decimals']) ?? 0).toInt().clamp(0, 2);
    final value = b.controller.value(b.key);
    final divisions = ((hi - lo) * math.pow(10, places)).round();
    final shown = value is num ? '${_numberText(value)}%' : '—';
    return Row(
      children: [
        Expanded(
          child: Slider(
            key: ValueKey('percent-${b.key}'),
            value: value is num ? value.toDouble().clamp(lo, hi) : lo,
            min: lo,
            max: hi,
            divisions: divisions > 0 && divisions <= 1000 ? divisions : null,
            label: shown,
            onChanged: b.field.readOnly
                ? null
                : (v) => b.controller.setValue(b.key, _round(v, places)),
          ),
        ),
        SizedBox(width: 56, child: Text(shown, textAlign: TextAlign.end)),
      ],
    );
  }
}

/// Calling codes for `default_region`, for numbers typed with the trunk
/// 0. Others must be typed with their `+` code.
const Map<String, String> _callingCodes = {'ZA': '27'};

/// A typed phone number in E.164: `082 123 4567` → `+27821234567`.
/// Anything that can't be turned into one is kept as typed.
String? _toE164(String text, String? region) {
  final s = text.replaceAll(RegExp(r'[\s().-]'), '');
  if (s.isEmpty) return null;
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return '+${s.substring(2)}';
  final code = _callingCodes[region ?? 'ZA'];
  if (code != null && s.startsWith('0')) return '+$code${s.substring(1)}';
  return text;
}

/// Phone (`11` §3.1): typed as the agent knows it, stored as E.164.
class _PhoneInput extends StatefulWidget {
  const _PhoneInput(this.b, {super.key});

  final _Binding b;

  @override
  State<_PhoneInput> createState() => _PhoneInputState();
}

class _PhoneInputState extends State<_PhoneInput> {
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
    return _Frame(
      b,
      child: TextField(
        key: ValueKey('phone-${b.key}'),
        controller: _text,
        focusNode: _focus,
        readOnly: b.field.readOnly,
        keyboardType: TextInputType.phone,
        inputFormatters: [
          FilteringTextInputFormatter.allow(RegExp('[0-9+() .-]')),
        ],
        decoration: InputDecoration(
          hintText: b.copy('form.phone.hint'),
          border: const OutlineInputBorder(),
          isDense: true,
        ),
        onChanged: (v) => b.controller.setValue(
          b.key,
          _toE164(v, _string(b.props['default_region'])),
          touch: false,
        ),
      ),
    );
  }
}

/// Yes / no / not applicable (`11` §3.2): segmented, or radio buttons.
class _TriStateInput extends StatelessWidget {
  const _TriStateInput(this.b, {super.key});

  final _Binding b;

  @override
  Widget build(BuildContext context) {
    final labels = b.props['labels'] is Map<String, Object?>
        ? b.props['labels']! as Map<String, Object?>
        : const <String, Object?>{};
    final options = [
      for (final (value, fallback) in const [
        ('yes', 'form.yes'),
        ('no', 'form.no'),
        ('na', 'form.not_applicable'),
      ])
        (value, b.template(labels[value]) ?? b.copy(fallback)),
    ];
    final current = _string(b.controller.value(b.key));
    final readOnly = b.field.readOnly;
    void set(String? v) {
      if (!readOnly) b.controller.setValue(b.key, v);
    }

    final input = b.display == 'radio'
        ? IgnorePointer(
            ignoring: readOnly,
            child: RadioGroup<String>(
              groupValue: current,
              onChanged: set,
              child: Column(
                children: [
                  for (final (value, text) in options)
                    RadioListTile<String>(
                      value: value,
                      title: Text(text),
                      contentPadding: EdgeInsets.zero,
                    ),
                ],
              ),
            ),
          )
        : SegmentedButton<String>(
            key: ValueKey('tri-${b.key}'),
            segments: [
              for (final (value, text) in options)
                ButtonSegment(value: value, label: Text(text)),
            ],
            selected: {?current},
            emptySelectionAllowed: true,
            showSelectedIcon: false,
            onSelectionChanged: readOnly
                ? null
                : (s) => set(s.isEmpty ? null : s.first),
          );
    return _Frame(b, child: input);
  }
}

/// `YYYY-MM-DD` (or the date of an ISO datetime) as a local day.
DateTime? _day(Object? v) {
  if (v is! String || v.length < 10 || !isIsoDate(v.substring(0, 10))) {
    return null;
  }
  final [y, m, d] = v.substring(0, 10).split('-').map(int.parse).toList();
  return DateTime(y, m, d);
}

String _two(int n) => n.toString().padLeft(2, '0');

String _isoDay(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${_two(d.month)}-${_two(d.day)}';

String _formatDay(DateTime d, String Function(String key) copy) =>
    '${d.day} ${copy('date.month.${d.month}')} ${d.year}';

/// Date (`11` §3.3): the phone's date picker, within `min` and `max`; with
/// `allow_unknown`, "I don't know" answers it.
class _DateInput extends StatelessWidget {
  const _DateInput(this.b, {super.key});

  final _Binding b;

  @override
  Widget build(BuildContext context) {
    final value = _string(b.controller.value(b.key));
    final picked = _day(value);
    final unknown = b.controller.isUnknown(b.key);
    final readOnly = b.field.readOnly;
    var first = _day(b.props['min']) ?? DateTime(1900);
    var last = _day(b.props['max']) ?? DateTime(2100, 12, 31);
    if (first.isAfter(last)) (first, last) = (DateTime(1900), DateTime(2100));

    Future<void> pick() async {
      final now = DateTime.now();
      var initial = picked ?? DateTime(now.year, now.month, now.day);
      if (initial.isBefore(first)) initial = first;
      if (initial.isAfter(last)) initial = last;
      final d = await showDatePicker(
        context: context,
        initialDate: initial,
        firstDate: first,
        lastDate: last,
      );
      if (d != null) b.controller.setValue(b.key, _isoDay(d));
    }

    return _Frame(
      b,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  key: ValueKey('date-pick-${b.key}'),
                  onPressed: readOnly || unknown ? null : pick,
                  icon: const Icon(Icons.event),
                  label: Text(
                    picked != null
                        ? _formatDay(picked, b.copy)
                        : value ?? b.copy('form.date.choose'),
                  ),
                ),
              ),
              if (value != null && !readOnly)
                IconButton(
                  tooltip: b.copy('form.clear'),
                  onPressed: () => b.controller.setValue(b.key, null),
                  icon: const Icon(Icons.clear),
                ),
            ],
          ),
          if (b.props['allow_unknown'] == true)
            CheckboxListTile(
              key: ValueKey('date-unknown-${b.key}'),
              value: unknown,
              onChanged: readOnly
                  ? null
                  : (on) =>
                        b.controller.setUnknown(b.key, unknown: on ?? false),
              title: Text(b.copy('form.date.unknown')),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
            ),
        ],
      ),
    );
  }
}

final RegExp _hhmm = RegExp(r'^([01]\d|2[0-3]):([0-5]\d)$');

TimeOfDay? _timeOfDay(Object? v) {
  final m = v is String ? _hhmm.firstMatch(v) : null;
  return m == null
      ? null
      : TimeOfDay(hour: int.parse(m[1]!), minute: int.parse(m[2]!));
}

String _timeText(TimeOfDay t) => '${_two(t.hour)}:${_two(t.minute)}';

/// A button that shows a time (`HH:mm`) and opens the phone's time picker.
class _TimeButton extends StatelessWidget {
  const _TimeButton({
    required this.value,
    required this.placeholder,
    required this.onPicked,
    this.prefix,
    this.enabled = true,
    super.key,
  });

  final String? value;
  final String placeholder;
  final String? prefix;
  final bool enabled;
  final ValueChanged<String> onPicked;

  @override
  Widget build(BuildContext context) {
    final t = _timeOfDay(value);
    final shown = t == null
        ? placeholder
        : MaterialLocalizations.of(context).formatTimeOfDay(
            t,
            alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
          );
    return OutlinedButton.icon(
      onPressed: !enabled
          ? null
          : () async {
              final r = await showTimePicker(
                context: context,
                initialTime: t ?? const TimeOfDay(hour: 8, minute: 0),
              );
              if (r != null) onPicked(_timeText(r));
            },
      icon: const Icon(Icons.schedule),
      label: Text(prefix == null || t == null ? shown : '$prefix $shown'),
    );
  }
}

/// Time (`11` §3.3): the phone's time picker; stored as `HH:mm`.
class _TimeInput extends StatelessWidget {
  const _TimeInput(this.b, {super.key});

  final _Binding b;

  @override
  Widget build(BuildContext context) => _Frame(
    b,
    child: Align(
      alignment: Alignment.centerLeft,
      child: _TimeButton(
        key: ValueKey('time-pick-${b.key}'),
        value: _string(b.controller.value(b.key)),
        placeholder: b.copy('form.time.choose'),
        enabled: !b.field.readOnly,
        onPicked: (t) => b.controller.setValue(b.key, t),
      ),
    ),
  );
}

const List<String> _durationUnits = ['days', 'months', 'years'];

/// Duration (`11` §3.3): a whole number and a unit, e.g. how long a
/// business has traded; stored as `{value, unit}`.
class _DurationInput extends StatefulWidget {
  const _DurationInput(this.b, {super.key});

  final _Binding b;

  @override
  State<_DurationInput> createState() => _DurationInputState();
}

class _DurationInputState extends State<_DurationInput> {
  late final TextEditingController _text;
  late String _unit;
  late final FocusNode _focus = FocusNode()..addListener(_onFocus);

  List<String> get _units {
    final units = [
      if (widget.b.props['units'] case final List<Object?> list)
        for (final u in list)
          if (u is String && _durationUnits.contains(u)) u,
    ];
    return units.isEmpty ? _durationUnits : units;
  }

  @override
  void initState() {
    super.initState();
    final value = widget.b.controller.value(widget.b.key);
    final map = value is Map<String, Object?> ? value : null;
    _text = TextEditingController(text: _numberText(map?['value']));
    final unit = map?['unit'];
    _unit = unit is String && _units.contains(unit) ? unit : _units.first;
  }

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

  void _set({bool touch = false}) {
    final b = widget.b;
    final t = _text.text.trim();
    b.controller.setValue(
      b.key,
      t.isEmpty ? null : {'value': int.tryParse(t) ?? t, 'unit': _unit},
      touch: touch,
    );
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.b;
    final readOnly = b.field.readOnly;
    return _Frame(
      b,
      child: Row(
        children: [
          Expanded(
            child: TextField(
              key: ValueKey('duration-${b.key}'),
              controller: _text,
              focusNode: _focus,
              readOnly: readOnly,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                isDense: true,
              ),
              onChanged: (_) => _set(),
            ),
          ),
          const SizedBox(width: 8),
          DropdownButton<String>(
            key: ValueKey('duration-unit-${b.key}'),
            value: _unit,
            items: [
              for (final u in _units)
                DropdownMenuItem(
                  value: u,
                  child: Text(b.copy('form.duration.$u')),
                ),
            ],
            onChanged: readOnly
                ? null
                : (u) {
                    if (u == null) return;
                    setState(() => _unit = u);
                    _set(touch: true);
                  },
          ),
        ],
      ),
    );
  }
}

const List<String> _hourGroups = [
  'weekdays',
  'saturday',
  'sunday',
  'public_holidays',
];

/// Business hours (`11` §3.3): per day group, open with its times, closed,
/// or (with `allow_24h`) open 24 hours.
class _BusinessHoursInput extends StatelessWidget {
  const _BusinessHoursInput(this.b, {super.key});

  final _Binding b;

  @override
  Widget build(BuildContext context) {
    final groups = [
      if (b.props['groups'] case final List<Object?> list)
        for (final g in list)
          if (g is String && _hourGroups.contains(g)) g,
    ];
    final value = b.controller.value(b.key);
    final hours = value is Map<String, Object?>
        ? value
        : const <String, Object?>{};
    final readOnly = b.field.readOnly;
    void set(String group, Object? h) {
      final next = {...hours};
      if (h == null) {
        next.remove(group);
      } else {
        next[group] = h;
      }
      b.controller.setValue(b.key, next.isEmpty ? null : next);
    }

    final theme = Theme.of(context);
    return _Frame(
      b,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final g in groups.isEmpty ? _hourGroups : groups)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _hoursRow(g, hours[g], set, readOnly, theme),
            ),
        ],
      ),
    );
  }

  Widget _hoursRow(
    String group,
    Object? h,
    void Function(String group, Object? h) set,
    bool readOnly,
    ThemeData theme,
  ) {
    final mode = switch (h) {
      'closed' => 'closed',
      '24h' => '24h',
      Map<String, Object?>() => 'open',
      _ => null,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(b.copy('form.hours.$group'), style: theme.textTheme.bodyLarge),
        const SizedBox(height: 4),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final (m, copyKey) in [
              ('open', 'form.hours.open'),
              ('closed', 'form.hours.closed'),
              if (b.props['allow_24h'] == true) ('24h', 'form.hours.24h'),
            ])
              ChoiceChip(
                key: ValueKey('hours-${b.key}-$group-$m'),
                label: Text(b.copy(copyKey)),
                selected: mode == m,
                onSelected: readOnly
                    ? null
                    : (on) => set(
                        group,
                        !on
                            ? null
                            : m == 'open'
                            ? (h is Map<String, Object?> ? h : const {})
                            : m,
                      ),
              ),
          ],
        ),
        if (h is Map<String, Object?>)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final (end, copyKey) in [
                  ('open', 'form.hours.opens'),
                  ('close', 'form.hours.closes'),
                ])
                  _TimeButton(
                    key: ValueKey('hours-${b.key}-$group-$end-time'),
                    value: _string(h[end]),
                    placeholder: b.copy(copyKey),
                    prefix: b.copy(copyKey),
                    enabled: !readOnly,
                    onPicked: (t) => set(group, {...h, end: t}),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

/// Prefilled (`11` §4): the job's or agent's value as it stood when the
/// inspection began, shown, not asked for. With `allow_flag_differs` the
/// agent can say it isn't what they see on site.
class _PrefilledView extends StatelessWidget {
  const _PrefilledView(this.b, {super.key});

  final _Binding b;

  @override
  Widget build(BuildContext context) {
    final flagged = b.controller.isFlaggedDiffers(b.key);
    final allowFlag = b.props['allow_flag_differs'] == true;
    final note = b.template(b.props['differs_note']);
    return _Frame(
      b,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ReadOnlyBox(_displayValue(b.field.value, b.copy)),
          if (allowFlag)
            CheckboxListTile(
              key: ValueKey('prefilled-differs-${b.key}'),
              value: flagged,
              onChanged: (on) =>
                  b.controller.setFlaggedDiffers(b.key, flagged: on ?? false),
              title: Text(b.copy('form.prefilled.differs')),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
            ),
          if (allowFlag && flagged && note != null && note.trim().isNotEmpty)
            Text(note, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

/// Acknowledgement (`11` §3.6): a statement the agent ticks; only `true`
/// is ever sent.
class _AcknowledgementInput extends StatelessWidget {
  const _AcknowledgementInput(this.b, {super.key});

  final _Binding b;

  @override
  Widget build(BuildContext context) {
    final text = b.template(b.props['text']) ?? '';
    final label = b.field.label;
    final starred = b.field.required && (label == null || label.isEmpty)
        ? '$text *'
        : text;
    return _Frame(
      b,
      child: CheckboxListTile(
        key: ValueKey('ack-${b.key}'),
        value: b.controller.value(b.key) == true,
        onChanged: b.field.readOnly
            ? null
            : (on) => b.controller.setValue(b.key, (on ?? false) ? true : null),
        title: Text(starred),
        controlAffinity: ListTileControlAffinity.leading,
        contentPadding: EdgeInsets.zero,
      ),
    );
  }
}

class _GroupTitle extends StatelessWidget {
  const _GroupTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 8),
    child: Text(
      title,
      style: Theme.of(
        context,
      ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
    ),
  );
}

/// A group with `layout: two_column` (`11` §5): its fields in pairs when
/// there is room, stacked on a narrow screen.
class _TwoColumn extends StatelessWidget {
  const _TwoColumn(this.children, {super.key});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: constraints.maxWidth < 560
          ? children
          : [
              for (var i = 0; i < children.length; i += 2)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: children[i]),
                    const SizedBox(width: 16),
                    Expanded(
                      child: i + 1 < children.length
                          ? children[i + 1]
                          : const SizedBox.shrink(),
                    ),
                  ],
                ),
            ],
    ),
  );
}
