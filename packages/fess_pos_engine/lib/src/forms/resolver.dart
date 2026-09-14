/// The form resolver (docs/04 §4.3–4.4), the Dart twin of
/// `src/resolver.ts`: given a form, a context and the raw answers, it works
/// out each field's visibility, required and read-only state, effective (or
/// computed) value, rule-able props, filtered options and rendered labels,
/// and the same for every item of a repeatable group. Hidden ⇒ absent: a
/// hidden field's value is null for every rule.
///
/// Fields are evaluated in the order of their hard dependencies (what their
/// own `visible` / `value` rules and those of their section and groups read
/// through `answers.*` or `derived.*`), so a value is final before anything
/// reads it; a repeatable group's children likewise on `item.*`. A cycle is
/// refused (`RESOLVER_CYCLE`).
///
/// The compiled form is the render plan (docs/03 §8): the fields flattened
/// in document order, their evaluation order, and which answers each part
/// of each field reads. [IncrementalResolution] uses it to re-evaluate,
/// after answers change, only what reads them; [resolveForm] runs the same
/// steps over every field, so the two agree by construction.
library;

import 'package:fess_pos_engine/src/errors.dart';
import 'package:fess_pos_engine/src/forms/catalogue.dart';
import 'package:fess_pos_engine/src/forms/model.dart';
import 'package:fess_pos_engine/src/forms/templates.dart';
import 'package:fess_pos_engine/src/forms/values.dart' show zaIdDerived;
import 'package:fess_pos_engine/src/json.dart';
import 'package:fess_pos_engine/src/rules/check.dart';
import 'package:fess_pos_engine/src/rules/evaluate.dart';

/// Marks a property the definition doesn't have (JSON has no `undefined`).
const Object _absent = Object();

/// Stands for every answer: something reads `answers` or `derived` whole.
const String anyAnswer = '*';

Object? _prop(Map<String, Object?> m, String key) =>
    m.containsKey(key) ? m[key] : _absent;

List<Map<String, Object?>> _maps(Object? v) => v is List<Object?>
    ? v.whereType<Map<String, Object?>>().toList()
    : const [];

/// A field after compilation.
class CompiledField {
  CompiledField(
    this.def,
    this.spec,
    this.section,
    this.containers,
    this.hardDeps, {
    this.softDeps = const {},
    this.itemDeps = const {},
    this.children,
  });

  final Map<String, Object?> def;
  final ComponentSpec spec;
  final String section;

  /// `visible` of the section and enclosing groups, outermost first.
  final List<Object?> containers;

  /// Answer keys its visibility and effective value read (`answers.*`,
  /// `derived.*`, [anyAnswer]), a repeatable group's children's included.
  final Set<String> hardDeps;

  /// Answer keys the rest of it reads: required, read-only, labels and
  /// text, rule-able props, the options filter, the default and `validate`
  /// rules, a repeatable group's children's included.
  final Set<String> softDeps;

  /// Keys under `item.` (a repeatable group's children only).
  final Set<String> itemDeps;

  /// A repeatable group's children, in evaluation order.
  final List<CompiledField>? children;

  String get key => def['key']! as String;
}

/// A compiled form: the render plan.
class CompiledForm {
  CompiledForm._(
    this.form,
    this.fields,
    this.byKey,
    this.order,
    this.staticOptionMeta,
    this.sectionDeps,
  ) : keys = [for (final f in fields) f.key],
      incremental = !fields.any((f) => f.hardDeps.contains(anyAnswer));

  final Map<String, Object?> form;

  /// Every top-level field (groups opened) in document order.
  final List<CompiledField> fields;
  final Map<String, CompiledField> byKey;

  /// The keys of [fields].
  final List<String> keys;

  /// Evaluation order.
  final List<CompiledField> order;
  final Map<String, Map<String, Object?>> staticOptionMeta;

  /// Answer keys each section's visibility and title read.
  final Map<String, Set<String>> sectionDeps;

  /// Whether an answer change can re-evaluate only what reads it. Not when
  /// a visibility or value rule reads every answer at once, which has no
  /// place in the evaluation order.
  final bool incremental;
}

final Expando<CompiledForm> _compiled = Expando();

typedef _Flat = ({Map<String, Object?> def, List<Object?> containers});

/// Fields in document order with groups opened (their `visible` joins the
/// containers). A repeatable group's children stay inside it.
void _flatten(
  List<Map<String, Object?>> defs,
  List<Object?> containers,
  List<_Flat> out,
) {
  for (final def in defs) {
    if (def['type'] is! String || def['key'] is! String) {
      throw const EngineError(
        'INVALID_DEFINITION',
        'every field needs a type and a key',
      );
    }
    out.add((def: def, containers: containers));
    if (def['type'] == 'group') {
      final visible = _prop(def, 'visible');
      _flatten(
        _maps(def['fields']),
        identical(visible, _absent) ? containers : [...containers, visible],
        out,
      );
    }
  }
}

ComponentSpec _specOf(Map<String, Object?> def) {
  final type = def['type']! as String;
  return formComponentSpec(type) ??
      (throw EngineError(
        'UNSUPPORTED_COMPONENT',
        'unsupported component "$type"',
        details: {'key': def['key'], 'type': type},
      ));
}

List<String> _deps(Object? expr) {
  if (expr is! Map<Object?, Object?> && expr is! List<Object?>) return const [];
  try {
    return ruleDependencies(expr);
  } on RuleError {
    return const [];
  }
}

/// The answer keys among var paths: `answers.<key>` and `derived.<key>`
/// (derived facts come from that field); [anyAnswer] for a path that reads
/// them all.
Set<String> _answerKeys(Iterable<String> paths) {
  final out = <String>{};
  for (final p in paths) {
    final parts = p.split('.');
    if (p.isEmpty) {
      out.add(anyAnswer);
    } else if (parts[0] == 'answers' || parts[0] == 'derived') {
      out.add(parts.length > 1 ? parts[1] : anyAnswer);
    }
  }
  return out;
}

/// The answer keys an expression reads.
Set<String> _ruleRefs(Object? expr) => _answerKeys(_deps(expr));

/// The answer keys a label, text or message reads: a template's
/// placeholders, or an expression's vars.
Set<String> _textRefs(Object? t) =>
    t is String ? _answerKeys(templatePaths(t)) : _ruleRefs(t);

/// The keys an expression reads under `item.`.
Set<String> _itemRefs(Object? expr) => {
  for (final d in _deps(expr))
    if (d.split('.') case ['item', final key, ...]) key,
};

List<Object?> _hardExprs(Map<String, Object?> def, List<Object?> containers) =>
    [...containers, _prop(def, 'visible'), _prop(def, 'value')];

Set<String> _hardRefs(Map<String, Object?> def, List<Object?> containers) => {
  for (final e in _hardExprs(def, containers)) ..._ruleRefs(e),
};

Set<String> _softRefs(Map<String, Object?> def, ComponentSpec spec) {
  final out = <String>{
    for (final p in const [
      'required',
      'read_only',
      'default',
      'options_filter',
    ])
      ..._ruleRefs(_prop(def, p)),
    for (final p in const ['label', 'text', 'caption'])
      ..._textRefs(_prop(def, p)),
  };
  final props = def['props'];
  if (props is Map<String, Object?>) {
    for (final e in props.entries) {
      if (spec.ruleableProps.containsKey(e.key)) out.addAll(_ruleRefs(e.value));
    }
  }
  for (final rule in _maps(def['validate'])) {
    out
      ..addAll(_ruleRefs(_prop(rule, 'rule')))
      ..addAll(_textRefs(_prop(rule, 'message')));
  }
  return out;
}

/// Compiles (cached per form object). Throws [EngineError]:
/// `UNSUPPORTED_COMPONENT`, `INVALID_DEFINITION` or `RESOLVER_CYCLE`.
CompiledForm compileForm(Map<String, Object?> form) {
  final hit = _compiled[form];
  if (hit != null) return hit;
  final fields = <CompiledField>[];
  final sectionDeps = <String, Set<String>>{};
  for (final section in _maps(form['sections'])) {
    final sectionKey = section['key'];
    if (sectionKey is! String) {
      throw const EngineError(
        'INVALID_DEFINITION',
        'every section needs a key',
      );
    }
    final visible = _prop(section, 'visible');
    sectionDeps[sectionKey] = {
      ..._ruleRefs(visible),
      ..._textRefs(_prop(section, 'title')),
    };
    final flat = <_Flat>[];
    _flatten(
      _maps(section['fields']),
      identical(visible, _absent) ? const [] : [visible],
      flat,
    );
    for (final (:def, :containers) in flat) {
      final spec = _specOf(def);
      final hard = _hardRefs(def, containers);
      final soft = _softRefs(def, spec);
      List<CompiledField>? children;
      if (spec.type == 'repeatable_group') {
        final kidsFlat = <_Flat>[];
        _flatten(_maps(def['fields']), const [], kidsFlat);
        final kids = <CompiledField>[];
        for (final kid in kidsFlat) {
          final kidSpec = _specOf(kid.def);
          hard.addAll(_hardRefs(kid.def, kid.containers));
          soft.addAll(_softRefs(kid.def, kidSpec));
          kids.add(
            CompiledField(
              kid.def,
              kidSpec,
              sectionKey,
              kid.containers,
              const {},
              itemDeps: {
                for (final e in _hardExprs(kid.def, kid.containers))
                  ..._itemRefs(e),
              },
            ),
          );
        }
        children = _topoSort(
          kids,
          (n) => n.itemDeps,
          'children of ${def['key']}',
        );
      }
      fields.add(
        CompiledField(
          def,
          spec,
          sectionKey,
          containers,
          hard,
          softDeps: soft,
          children: children,
        ),
      );
    }
  }
  final byKey = {for (final f in fields) f.key: f};
  final compiled = CompiledForm._(
    form,
    fields,
    byKey,
    _topoSort(fields, (n) => n.hardDeps, 'fields'),
    _staticOptionMeta(_maps(form['sections'])),
    sectionDeps,
  );
  _compiled[form] = compiled;
  return compiled;
}

List<CompiledField> _topoSort(
  List<CompiledField> nodes,
  Set<String> Function(CompiledField node) depsOf,
  String what,
) {
  final byKey = {for (final n in nodes) n.key: n};
  final pending = {
    for (final n in nodes)
      n.key: {
        for (final d in depsOf(n))
          if (byKey.containsKey(d)) d,
      },
  };
  final order = <CompiledField>[];
  final done = <String>{};
  while (order.length < nodes.length) {
    CompiledField? next;
    for (final n in nodes) {
      if (done.contains(n.key)) continue;
      if (pending[n.key]!.every(done.contains)) {
        next = n;
        break;
      }
    }
    if (next == null) {
      final stuck = [
        for (final n in nodes)
          if (!done.contains(n.key)) n.key,
      ];
      throw EngineError(
        'RESOLVER_CYCLE',
        'rule dependency cycle among $what: ${stuck.join(', ')}',
        details: {'keys': stuck},
      );
    }
    done.add(next.key);
    order.add(next);
  }
  return order;
}

Map<String, Map<String, Object?>> _staticOptionMeta(
  List<Map<String, Object?>> sections,
) {
  final out = <String, Map<String, Object?>>{};
  void visit(List<Map<String, Object?>> defs) {
    for (final d in defs) {
      final options = d['options'];
      if (options is List<Object?>) {
        out[d['key']! as String] = {
          for (final o
              in options.map(OptionDef.tryParse).whereType<OptionDef>())
            o.value: o.meta,
        };
      }
      visit(_maps(d['fields']));
    }
  }

  for (final s in sections) {
    visit(_maps(s['fields']));
  }
  return out;
}

List<OptionDef> _baseOptions(
  Map<String, Object?> def,
  ComponentSpec spec,
  Map<String, Object?> props,
  FormLists lists,
) {
  final options = def['options'];
  if (options is List<Object?>) {
    return options.map(OptionDef.tryParse).whereType<OptionDef>().toList();
  }
  final source = def['options_source'];
  if (source is Map<String, Object?>) {
    if (source['type'] == 'lookup_list') {
      return lists.lookupLists[source['key']] ?? const [];
    }
    if (source['type'] == 'reason_codes') {
      return lists.reasonCodes[source['category']] ?? const [];
    }
  }
  final list = props['list'];
  if (spec.type == 'lookup' && list is String) {
    return lists.lookupLists[list] ?? const [];
  }
  return const [];
}

/// Option meta for `option_meta` rules: static options, and those from
/// lists and reason codes, for every field including group children.
Map<String, Object?> _optionMeta(CompiledForm compiled, FormLists lists) {
  final out = <String, Object?>{...compiled.staticOptionMeta};
  void visit(List<Map<String, Object?>> defs) {
    for (final d in defs) {
      final type = d['type'];
      final spec = type is String ? formComponentSpec(type) : null;
      if (d['options'] is! List<Object?> && spec != null) {
        final props = d['props'];
        final options = _baseOptions(
          d,
          spec,
          props is Map<String, Object?> ? props : const {},
          lists,
        );
        if (options.isNotEmpty) {
          out[d['key']! as String] = {for (final o in options) o.value: o.meta};
        }
      }
      visit(_maps(d['fields']));
    }
  }

  for (final s in _maps(compiled.form['sections'])) {
    visit(_maps(s['fields']));
  }
  return out;
}

class _Evaluator {
  _Evaluator(this.env);

  final RuleEnv env;

  /// Where the next problems go: the list of the field being evaluated.
  List<RuleIssue> sink = [];

  ({bool ok, Object? value}) eval(
    Object? expr,
    Object? data,
    String path,
    String property,
  ) {
    try {
      return (ok: true, value: evaluateRule(expr, data, env: env));
    } on RuleError catch (e) {
      sink.add(RuleIssue(path, property, e.code, e.message));
      return (ok: false, value: null);
    }
  }

  bool boolean(
    Object? expr, {
    required bool fallback,
    required bool onError,
    required Object? data,
    required String path,
    required String property,
  }) {
    if (identical(expr, _absent)) return fallback;
    if (expr is bool) return expr;
    final r = eval(expr, data, path, property);
    if (!r.ok) return onError;
    final value = r.value;
    if (value == null) return false;
    if (value is bool) return value;
    sink.add(
      RuleIssue(
        path,
        property,
        'RULE_TYPE_ERROR',
        '$property must evaluate to a boolean',
      ),
    );
    return onError;
  }

  String? text(Object? t, Object? data, String path, String property) {
    if (identical(t, _absent)) return null;
    if (t is String) return renderTemplate(t, data);
    final r = eval(t, data, path, property);
    if (!r.ok) return null;
    final value = r.value;
    if (value == null) return '';
    if (value is String) return value;
    sink.add(
      RuleIssue(
        path,
        property,
        'RULE_TYPE_ERROR',
        '$property must evaluate to a string',
      ),
    );
    return null;
  }
}

bool _kindMatches(PropKind kind, Object? v) => switch (kind) {
  _ when v == null => true,
  PropKind.integer => isIntegral(v),
  PropKind.number => v is num,
  PropKind.boolean => v is bool,
  PropKind.string => v is String,
};

/// A repeatable group's item while resolving.
typedef _ItemState = ({
  Map<String, Object?> data,
  Map<String, Object?> values,
  Map<String, bool> visible,
});

/// Resolves [form] against [context] and the raw answer values by key (a
/// repeatable group's value is a list of item objects of raw values).
ResolvedForm resolveForm(
  Map<String, Object?> form, {
  ResolveContext context = const ResolveContext(),
  Map<String, Object?> answers = const {},
  FormLists lists = const FormLists(),
}) =>
    (IncrementalResolution(compileForm(form), context: context, lists: lists)
          ..raw = answers
          ..runAll())
        .snapshot();

/// A form's resolution kept up to date as its answers change (docs/03 §8,
/// C2): [update] re-evaluates, in dependency order, only the fields and
/// sections that read a changed answer. [runAll] does every one, as
/// [resolveForm] does.
class IncrementalResolution {
  IncrementalResolution(
    this.plan, {
    this.context = const ResolveContext(),
    FormLists lists = const FormLists(),
  }) : env = RuleEnv(
         today: context.today,
         optionMeta: _optionMeta(plan, lists),
       ),
       _lists = lists {
    data = {
      'answers': values,
      'job': context.job,
      'agent': context.agent,
      'inspection': context.inspection,
      'stats': context.stats,
      'config': context.config,
      'previous': context.previous,
      'derived': _derived,
    };
  }

  final CompiledForm plan;
  final ResolveContext context;
  final FormLists _lists;
  final RuleEnv env;

  /// The effective answers (what `answers.*` reads); hidden fields absent.
  final Map<String, Object?> values = {};
  final Map<String, Object?> _derived = {};

  /// What rules read.
  late final Map<String, Object?> data;

  /// The raw answers by key (a repeatable group's as a list of item
  /// objects). A change takes effect at the next [runAll] or [update].
  Map<String, Object?> raw = const {};

  /// Every field as resolved now, by key.
  final Map<String, ResolvedField> fields = {};
  final Map<String, ResolvedSection> _sections = {};
  final Map<String, bool> _visible = {};
  final Map<String, List<_ItemState>> _items = {};
  final Map<String, List<RuleIssue>> _valueIssues = {};
  final Map<String, List<RuleIssue>> _fieldIssues = {};
  final Map<String, List<RuleIssue>> _sectionIssues = {};
  late final _Evaluator _ev = _Evaluator(env);

  /// Evaluates everything.
  void runAll() {
    for (final cf in plan.order) {
      _evaluateValue(cf);
    }
    for (final cf in plan.fields) {
      _resolveField(cf);
    }
    for (final s in _maps(plan.form['sections'])) {
      _resolveSection(s);
    }
  }

  /// After the raw answers of [changed] changed: re-evaluates what reads
  /// them, in dependency order. Returns the keys of the fields resolved
  /// again.
  Set<String> update(Set<String> changed) {
    if (!plan.incremental) {
      runAll();
      return plan.byKey.keys.toSet();
    }
    // The keys whose visibility or effective value changed; the changed
    // answers themselves count, whatever became of them.
    final moved = {...changed};
    final again = <String>{};
    bool reads(Set<String> deps) =>
        deps.isNotEmpty &&
        (deps.contains(anyAnswer)
            ? moved.isNotEmpty
            : deps.any(moved.contains));
    for (final cf in plan.order) {
      final key = cf.key;
      if (!changed.contains(key) && !reads(cf.hardDeps)) continue;
      final wasVisible = _visible[key];
      final had = values.containsKey(key);
      final before = values[key];
      _evaluateValue(cf);
      if (wasVisible != _visible[key] ||
          had != values.containsKey(key) ||
          !deepEqual(before, values[key])) {
        moved.add(key);
      }
      // A repeatable group's children may have changed without its value.
      if (moved.contains(key) || cf.spec.type == 'repeatable_group') {
        again.add(key);
      }
    }
    for (final cf in plan.fields) {
      if (again.contains(cf.key) || reads(cf.softDeps)) {
        _resolveField(cf);
        again.add(cf.key);
      }
    }
    for (final s in _maps(plan.form['sections'])) {
      if (reads(plan.sectionDeps[s['key']] ?? const {})) _resolveSection(s);
    }
    return again;
  }

  /// The form as resolved now. Its [ResolvedForm.values] and
  /// [ResolvedForm.data] are live.
  ResolvedForm snapshot() {
    final seen = <String>{};
    final issues = [
      for (final cf in plan.order) ...?_valueIssues[cf.key],
      for (final cf in plan.fields) ...?_fieldIssues[cf.key],
      for (final s in _sections.keys) ...?_sectionIssues[s],
    ];
    return ResolvedForm(
      sections: Map.unmodifiable(_sections),
      fields: Map.unmodifiable(fields),
      order: plan.keys,
      values: values,
      data: data,
      env: env,
      errors: [
        for (final i in issues)
          if (seen.add('${i.path} ${i.property} ${i.code}')) i,
      ],
    );
  }

  bool _shown(CompiledField cf, Map<String, Object?> scope, String path) =>
      cf.containers.every(
        (c) => _ev.boolean(
          c,
          fallback: true,
          onError: true,
          data: scope,
          path: path,
          property: 'container.visible',
        ),
      ) &&
      _ev.boolean(
        _prop(cf.def, 'visible'),
        fallback: true,
        onError: true,
        data: scope,
        path: path,
        property: 'visible',
      );

  Object? _effective(
    CompiledField cf,
    Object? rawValue,
    Map<String, Object?> scope,
    String path,
  ) {
    final valueRule = _prop(cf.def, 'value');
    if (!identical(valueRule, _absent)) {
      return _ev.eval(valueRule, scope, path, 'value').value;
    }
    if (cf.spec.type == 'prefilled') {
      final props = cf.def['props'];
      final source = props is Map<String, Object?> ? props['source'] : null;
      return source is String ? readPath(scope, source) : null;
    }
    return rawValue;
  }

  /// Visibility and effective value (phase 1).
  void _evaluateValue(CompiledField cf) {
    final key = cf.key;
    _ev.sink = _valueIssues[key] = [];
    final vis = _shown(cf, data, key);
    _visible[key] = vis;
    if (!cf.spec.hasValue) return;
    _derived.remove(key);
    _items.remove(key);
    if (!vis) {
      values.remove(key);
      return;
    }
    if (cf.spec.type == 'repeatable_group') {
      final rawItems = raw[key];
      if (rawItems is! List<Object?>) {
        values[key] = rawItems;
        _items[key] = const [];
        return;
      }
      final states = <_ItemState>[];
      final effective = <Object?>[];
      for (var index = 0; index < rawItems.length; index++) {
        final item = rawItems[index];
        final itemValues = <String, Object?>{};
        final itemData = <String, Object?>{
          ...data,
          'item': itemValues,
          'index': index,
        };
        final kidVisible = <String, bool>{};
        final rawItem = item is Map<String, Object?>
            ? item
            : const <String, Object?>{};
        for (final kid in cf.children ?? const <CompiledField>[]) {
          final path = '$key[$index].${kid.key}';
          final kv = _shown(kid, itemData, path);
          kidVisible[kid.key] = kv;
          if (kid.spec.hasValue && kv) {
            itemValues[kid.key] = _effective(
              kid,
              rawItem[kid.key],
              itemData,
              path,
            );
          }
        }
        states.add((data: itemData, values: itemValues, visible: kidVisible));
        effective.add(itemValues);
      }
      _items[key] = states;
      values[key] = effective;
      return;
    }
    final v = _effective(cf, raw[key], data, key);
    values[key] = v;
    final props = cf.def['props'];
    if (cf.spec.type == 'id_number' &&
        props is Map<String, Object?> &&
        props['scheme'] == 'za_id' &&
        v is String) {
      final facts = zaIdDerived(v, context.today);
      if (facts != null) _derived[key] = facts;
    }
  }

  /// Everything that reads the final values (phase 2).
  void _resolveField(CompiledField cf) {
    final key = cf.key;
    _ev.sink = _fieldIssues[key] = [];
    final vis = _visible[key] ?? false;
    List<ResolvedItem>? items;
    if (cf.spec.type == 'repeatable_group' && vis) {
      final states = _items[key] ?? const <_ItemState>[];
      items = [
        for (var index = 0; index < states.length; index++)
          ResolvedItem(
            index: index,
            data: states[index].data,
            fields: {
              for (final kid in cf.children ?? const <CompiledField>[])
                kid.key: _resolveOne(
                  kid,
                  states[index].data,
                  '$key[$index].${kid.key}',
                  isVisible: states[index].visible[kid.key] ?? false,
                  value:
                      (states[index].visible[kid.key] ?? false) &&
                          kid.spec.hasValue
                      ? states[index].values[kid.key]
                      : null,
                ),
            },
          ),
      ];
    }
    fields[key] = _resolveOne(
      cf,
      data,
      key,
      isVisible: vis,
      value: vis && cf.spec.hasValue ? values[key] : null,
      items: items,
    );
  }

  void _resolveSection(Map<String, Object?> s) {
    final key = s['key']! as String;
    _ev.sink = _sectionIssues[key] = [];
    final vis = _ev.boolean(
      _prop(s, 'visible'),
      fallback: true,
      onError: true,
      data: data,
      path: '§$key',
      property: 'visible',
    );
    _sections[key] = ResolvedSection(
      key,
      visible: vis,
      title: vis ? _ev.text(_prop(s, 'title'), data, '§$key', 'title') : null,
    );
  }

  ResolvedField _resolveOne(
    CompiledField cf,
    Map<String, Object?> scope,
    String path, {
    required bool isVisible,
    required Object? value,
    List<ResolvedItem>? items,
  }) {
    final computed = !identical(_prop(cf.def, 'value'), _absent);
    if (!isVisible) {
      return ResolvedField(
        key: cf.key,
        path: path,
        type: cf.spec.type,
        section: cf.section,
        visible: false,
        required: false,
        readOnly: computed,
        value: null,
        computed: computed,
        props: const {},
      );
    }
    final props = <String, Object?>{};
    final rawProps = cf.def['props'];
    if (rawProps is Map<String, Object?>) {
      for (final e in rawProps.entries) {
        final kind = cf.spec.ruleableProps[e.key];
        if (kind != null && e.value is Map<String, Object?>) {
          final r = _ev.eval(e.value, scope, path, 'props.${e.key}');
          if (!r.ok) continue;
          if (!_kindMatches(kind, r.value)) {
            _ev.sink.add(
              RuleIssue(
                path,
                'props.${e.key}',
                'RULE_TYPE_ERROR',
                'props.${e.key} evaluated to the wrong type',
              ),
            );
            continue;
          }
          if (r.value != null) props[e.key] = r.value;
        } else {
          props[e.key] = e.value;
        }
      }
    }
    List<OptionDef>? options;
    if (cf.spec.options) {
      final base = _baseOptions(cf.def, cf.spec, props, _lists);
      final filter = _prop(cf.def, 'options_filter');
      options = identical(filter, _absent)
          ? List.of(base)
          : [
              for (final o in base)
                if (_ev.boolean(
                  filter,
                  fallback: true,
                  onError: true,
                  data: {...scope, 'option': o.toRuleData()},
                  path: path,
                  property: 'options_filter',
                ))
                  o,
            ];
    }
    final defaultRule = _prop(cf.def, 'default');
    final defaultValue = identical(defaultRule, _absent)
        ? null
        : _ev.eval(defaultRule, scope, path, 'default');
    final text = _prop(cf.def, 'text');
    return ResolvedField(
      key: cf.key,
      path: path,
      type: cf.spec.type,
      section: cf.section,
      visible: true,
      required:
          cf.spec.hasValue &&
          _ev.boolean(
            _prop(cf.def, 'required'),
            fallback: false,
            onError: false,
            data: scope,
            path: path,
            property: 'required',
          ),
      readOnly:
          computed ||
          cf.spec.type == 'prefilled' ||
          _ev.boolean(
            _prop(cf.def, 'read_only'),
            fallback: false,
            onError: false,
            data: scope,
            path: path,
            property: 'read_only',
          ),
      value: value,
      computed: computed,
      props: props,
      label: _ev.text(_prop(cf.def, 'label'), scope, path, 'label'),
      text: _ev.text(
        identical(text, _absent) ? _prop(cf.def, 'caption') : text,
        scope,
        path,
        'text',
      ),
      hasDefault: defaultValue?.ok ?? false,
      defaultValue: defaultValue?.value,
      options: options,
      items: items,
    );
  }
}
