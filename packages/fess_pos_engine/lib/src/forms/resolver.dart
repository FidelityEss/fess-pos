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
    this.itemDeps = const {},
    this.children,
  });

  final Map<String, Object?> def;
  final ComponentSpec spec;
  final String section;

  /// `visible` of the section and enclosing groups, outermost first.
  final List<Object?> containers;

  /// Keys under `answers.` / `derived.` its effective value depends on.
  final Set<String> hardDeps;

  /// Keys under `item.` (a repeatable group's children only).
  final Set<String> itemDeps;

  /// A repeatable group's children, in evaluation order.
  final List<CompiledField>? children;

  String get key => def['key']! as String;
}

class CompiledForm {
  CompiledForm._(
    this.form,
    this.fields,
    this.byKey,
    this.order,
    this.staticOptionMeta,
  );

  final Map<String, Object?> form;

  /// Every top-level field (groups opened) in document order.
  final List<CompiledField> fields;
  final Map<String, CompiledField> byKey;

  /// Evaluation order.
  final List<CompiledField> order;
  final Map<String, Map<String, Object?>> staticOptionMeta;
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

List<Object?> _hardExprs(Map<String, Object?> def, List<Object?> containers) =>
    [...containers, _prop(def, 'visible'), _prop(def, 'value')];

/// Compiles (cached per form object). Throws [EngineError]:
/// `UNSUPPORTED_COMPONENT`, `INVALID_DEFINITION` or `RESOLVER_CYCLE`.
CompiledForm compileForm(Map<String, Object?> form) {
  final hit = _compiled[form];
  if (hit != null) return hit;
  final fields = <CompiledField>[];
  for (final section in _maps(form['sections'])) {
    final sectionKey = section['key'];
    if (sectionKey is! String) {
      throw const EngineError(
        'INVALID_DEFINITION',
        'every section needs a key',
      );
    }
    final visible = _prop(section, 'visible');
    final flat = <_Flat>[];
    _flatten(
      _maps(section['fields']),
      identical(visible, _absent) ? const [] : [visible],
      flat,
    );
    for (final (:def, :containers) in flat) {
      final spec = _specOf(def);
      final hard = <String>{
        for (final e in _hardExprs(def, containers)) ..._answerRefs(e),
      };
      List<CompiledField>? children;
      if (spec.type == 'repeatable_group') {
        final kidsFlat = <_Flat>[];
        _flatten(_maps(def['fields']), const [], kidsFlat);
        final kids = <CompiledField>[];
        for (final kid in kidsFlat) {
          final itemDeps = <String>{};
          for (final e in _hardExprs(kid.def, kid.containers)) {
            itemDeps.addAll(_refsUnder(e, 'item'));
            hard.addAll(_answerRefs(e));
          }
          kids.add(
            CompiledField(
              kid.def,
              _specOf(kid.def),
              sectionKey,
              kid.containers,
              const {},
              itemDeps: itemDeps,
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
  );
  _compiled[form] = compiled;
  return compiled;
}

/// The keys an expression reads under `root.` (`answers.x` → `x`).
List<String> _refsUnder(Object? expr, String root) {
  if (identical(expr, _absent)) return const [];
  final List<String> deps;
  try {
    deps = ruleDependencies(expr);
  } on RuleError {
    return const [];
  }
  return [
    for (final d in deps)
      if (d.split('.') case [final r, final key, ...] when r == root) key,
  ];
}

/// Field keys read through `answers.<key>` or `derived.<key>` (derived
/// facts come from that field).
List<String> _answerRefs(Object? expr) => [
  ..._refsUnder(expr, 'answers'),
  ..._refsUnder(expr, 'derived'),
];

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
  final List<RuleIssue> issues = [];

  ({bool ok, Object? value}) eval(
    Object? expr,
    Object? data,
    String path,
    String property,
  ) {
    try {
      return (ok: true, value: evaluateRule(expr, data, env: env));
    } on RuleError catch (e) {
      issues.add(RuleIssue(path, property, e.code, e.message));
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
    issues.add(
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
    issues.add(
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
}) {
  final compiled = compileForm(form);
  final env = RuleEnv(
    today: context.today,
    optionMeta: _optionMeta(compiled, lists),
  );
  final ev = _Evaluator(env);
  final values = <String, Object?>{};
  final derived = <String, Object?>{};
  final data = <String, Object?>{
    'answers': values,
    'job': context.job,
    'agent': context.agent,
    'inspection': context.inspection,
    'stats': context.stats,
    'config': context.config,
    'previous': context.previous,
    'derived': derived,
  };
  final visible = <String, bool>{};
  final itemsState = <String, List<_ItemState>>{};

  bool shown(CompiledField cf, Map<String, Object?> scope, String path) =>
      cf.containers.every(
        (c) => ev.boolean(
          c,
          fallback: true,
          onError: true,
          data: scope,
          path: path,
          property: 'container.visible',
        ),
      ) &&
      ev.boolean(
        _prop(cf.def, 'visible'),
        fallback: true,
        onError: true,
        data: scope,
        path: path,
        property: 'visible',
      );

  Object? effectiveValue(
    CompiledField cf,
    Object? raw,
    Map<String, Object?> scope,
    String path,
  ) {
    final valueRule = _prop(cf.def, 'value');
    if (!identical(valueRule, _absent)) {
      return ev.eval(valueRule, scope, path, 'value').value;
    }
    if (cf.spec.type == 'prefilled') {
      final props = cf.def['props'];
      final source = props is Map<String, Object?> ? props['source'] : null;
      return source is String ? readPath(scope, source) : null;
    }
    return raw;
  }

  // Phase 1: visibility and effective values, in dependency order.
  for (final cf in compiled.order) {
    final key = cf.key;
    final vis = shown(cf, data, key);
    visible[key] = vis;
    if (!cf.spec.hasValue) continue;
    if (!vis) {
      values.remove(key);
      continue;
    }
    if (cf.spec.type == 'repeatable_group') {
      final raw = answers[key];
      if (raw is! List<Object?>) {
        values[key] = raw;
        itemsState[key] = const [];
        continue;
      }
      final states = <_ItemState>[];
      final effective = <Object?>[];
      for (var index = 0; index < raw.length; index++) {
        final item = raw[index];
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
          final kv = shown(kid, itemData, path);
          kidVisible[kid.key] = kv;
          if (kid.spec.hasValue && kv) {
            itemValues[kid.key] = effectiveValue(
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
      itemsState[key] = states;
      values[key] = effective;
      continue;
    }
    final v = effectiveValue(cf, answers[key], data, key);
    values[key] = v;
    final props = cf.def['props'];
    if (cf.spec.type == 'id_number' &&
        props is Map<String, Object?> &&
        props['scheme'] == 'za_id' &&
        v is String) {
      final facts = zaIdDerived(v, context.today);
      if (facts != null) derived[key] = facts;
    }
  }

  // Phase 2: everything that reads the final values.
  ResolvedField resolveOne(
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
          final r = ev.eval(e.value, scope, path, 'props.${e.key}');
          if (!r.ok) continue;
          if (!_kindMatches(kind, r.value)) {
            ev.issues.add(
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
      final base = _baseOptions(cf.def, cf.spec, props, lists);
      final filter = _prop(cf.def, 'options_filter');
      options = identical(filter, _absent)
          ? List.of(base)
          : [
              for (final o in base)
                if (ev.boolean(
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
        : ev.eval(defaultRule, scope, path, 'default');
    final text = _prop(cf.def, 'text');
    return ResolvedField(
      key: cf.key,
      path: path,
      type: cf.spec.type,
      section: cf.section,
      visible: true,
      required:
          cf.spec.hasValue &&
          ev.boolean(
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
          ev.boolean(
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
      label: ev.text(_prop(cf.def, 'label'), scope, path, 'label'),
      text: ev.text(
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

  final fields = <String, ResolvedField>{};
  for (final cf in compiled.fields) {
    final key = cf.key;
    final vis = visible[key] ?? false;
    List<ResolvedItem>? items;
    if (cf.spec.type == 'repeatable_group' && vis) {
      final states = itemsState[key] ?? const <_ItemState>[];
      items = [
        for (var index = 0; index < states.length; index++)
          ResolvedItem(
            index: index,
            data: states[index].data,
            fields: {
              for (final kid in cf.children ?? const <CompiledField>[])
                kid.key: resolveOne(
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
    fields[key] = resolveOne(
      cf,
      data,
      key,
      isVisible: vis,
      value: vis && cf.spec.hasValue ? values[key] : null,
      items: items,
    );
  }

  final sections = <String, ResolvedSection>{};
  for (final s in _maps(form['sections'])) {
    final key = s['key']! as String;
    final vis = ev.boolean(
      _prop(s, 'visible'),
      fallback: true,
      onError: true,
      data: data,
      path: '§$key',
      property: 'visible',
    );
    sections[key] = ResolvedSection(
      key,
      visible: vis,
      title: vis ? ev.text(_prop(s, 'title'), data, '§$key', 'title') : null,
    );
  }

  final seen = <String>{};
  return ResolvedForm(
    sections: sections,
    fields: fields,
    order: [for (final f in compiled.fields) f.key],
    values: values,
    data: data,
    env: env,
    errors: [
      for (final i in ev.issues)
        if (seen.add('${i.path} ${i.property} ${i.code}')) i,
    ],
  );
}
