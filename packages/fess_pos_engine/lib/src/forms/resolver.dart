/// The form resolver (docs/04 §4.3–4.4), the Dart twin of
/// `src/resolver.ts` for the components in `formComponents`: given a form,
/// a context and the raw answers, it works out each field's visibility,
/// required and read-only state, effective (or computed) value, rule-able
/// props, filtered options and rendered labels. Hidden ⇒ absent: a hidden
/// field's value is null for every rule.
///
/// Fields are evaluated in the order of their hard dependencies (what their
/// own `visible` / `value` rules and those of their section and groups read
/// through `answers.*`), so a value is final before anything reads it; a
/// cycle is refused (`RESOLVER_CYCLE`).
library;

import 'package:fess_pos_engine/src/errors.dart';
import 'package:fess_pos_engine/src/forms/catalogue.dart';
import 'package:fess_pos_engine/src/forms/model.dart';
import 'package:fess_pos_engine/src/forms/templates.dart';
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
    this.hardDeps,
  );

  final Map<String, Object?> def;
  final ComponentSpec spec;
  final String section;

  /// `visible` of the section and enclosing groups, outermost first.
  final List<Object?> containers;

  /// Keys this field's effective value depends on.
  final Set<String> hardDeps;

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

  /// Every field in document order.
  final List<CompiledField> fields;
  final Map<String, CompiledField> byKey;

  /// Evaluation order.
  final List<CompiledField> order;
  final Map<String, Map<String, Object?>> staticOptionMeta;
}

final Expando<CompiledForm> _compiled = Expando();

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
    void flatten(List<Map<String, Object?>> defs, List<Object?> containers) {
      for (final def in defs) {
        final type = def['type'];
        final key = def['key'];
        if (type is! String || key is! String) {
          throw const EngineError(
            'INVALID_DEFINITION',
            'every field needs a type and a key',
          );
        }
        final spec =
            formComponentSpec(type) ??
            (throw EngineError(
              'UNSUPPORTED_COMPONENT',
              'unsupported component "$type"',
              details: {'key': key, 'type': type},
            ));
        final hard = <String>{};
        for (final e in [
          ...containers,
          _prop(def, 'visible'),
          _prop(def, 'value'),
        ]) {
          hard.addAll(_answerRefs(e));
        }
        fields.add(CompiledField(def, spec, sectionKey, containers, hard));
        if (type == 'group') {
          final visible = _prop(def, 'visible');
          flatten(
            _maps(def['fields']),
            identical(visible, _absent) ? containers : [...containers, visible],
          );
        }
      }
    }

    final visible = _prop(section, 'visible');
    flatten(
      _maps(section['fields']),
      identical(visible, _absent) ? const [] : [visible],
    );
  }
  final byKey = {for (final f in fields) f.key: f};
  final compiled = CompiledForm._(
    form,
    fields,
    byKey,
    _topoSort(fields, byKey),
    _staticOptionMeta(_maps(form['sections'])),
  );
  _compiled[form] = compiled;
  return compiled;
}

List<String> _answerRefs(Object? expr) {
  if (identical(expr, _absent)) return const [];
  final List<String> deps;
  try {
    deps = ruleDependencies(expr);
  } on RuleError {
    return const [];
  }
  return [
    for (final d in deps)
      if (d.split('.') case [('answers' || 'derived'), final key, ...]) key,
  ];
}

List<CompiledField> _topoSort(
  List<CompiledField> nodes,
  Map<String, CompiledField> byKey,
) {
  final pending = {
    for (final n in nodes)
      n.key: {
        for (final d in n.hardDeps)
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
        'rule dependency cycle among fields: ${stuck.join(', ')}',
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

List<OptionDef> _baseOptions(Map<String, Object?> def, FormLists lists) {
  final options = def['options'];
  if (options is List<Object?>) {
    return options.map(OptionDef.tryParse).whereType<OptionDef>().toList();
  }
  final source = def['options_source'];
  if (source is Map<String, Object?>) {
    return switch (source['type']) {
      'lookup_list' => lists.lookupLists[source['key']] ?? const [],
      'reason_codes' => lists.reasonCodes[source['category']] ?? const [],
      _ => const [],
    };
  }
  return const [];
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
        '$property must be a boolean',
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
        '$property must be a string',
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

/// Resolves [form] against [context] and the raw answer values by key.
ResolvedForm resolveForm(
  Map<String, Object?> form, {
  ResolveContext context = const ResolveContext(),
  Map<String, Object?> answers = const {},
  FormLists lists = const FormLists(),
}) {
  final compiled = compileForm(form);
  final optionMeta = <String, Object?>{...compiled.staticOptionMeta};
  for (final cf in compiled.fields) {
    if (cf.def['options'] is List<Object?>) continue;
    final options = _baseOptions(cf.def, lists);
    if (options.isNotEmpty) {
      optionMeta[cf.key] = {for (final o in options) o.value: o.meta};
    }
  }
  final env = RuleEnv(today: context.today, optionMeta: optionMeta);
  final ev = _Evaluator(env);
  final values = <String, Object?>{};
  final data = <String, Object?>{
    'answers': values,
    'job': context.job,
    'agent': context.agent,
    'inspection': context.inspection,
    'stats': context.stats,
    'config': context.config,
    'previous': context.previous,
    'derived': <String, Object?>{},
  };
  final visible = <String, bool>{};

  Object? effectiveValue(CompiledField cf) {
    final valueRule = _prop(cf.def, 'value');
    if (!identical(valueRule, _absent)) {
      return ev.eval(valueRule, data, cf.key, 'value').value;
    }
    if (cf.spec.type == 'prefilled') {
      final props = cf.def['props'];
      final source = props is Map<String, Object?> ? props['source'] : null;
      return source is String ? readPath(data, source) : null;
    }
    return answers[cf.key];
  }

  // Phase 1: visibility and effective values, in dependency order.
  for (final cf in compiled.order) {
    final key = cf.key;
    final vis =
        cf.containers.every(
          (c) => ev.boolean(
            c,
            fallback: true,
            onError: true,
            data: data,
            path: key,
            property: 'container.visible',
          ),
        ) &&
        ev.boolean(
          _prop(cf.def, 'visible'),
          fallback: true,
          onError: true,
          data: data,
          path: key,
          property: 'visible',
        );
    visible[key] = vis;
    if (!cf.spec.hasValue) continue;
    if (!vis) {
      values.remove(key);
      continue;
    }
    values[key] = effectiveValue(cf);
  }

  // Phase 2: everything that reads the final values, in document order.
  final fields = <String, ResolvedField>{};
  for (final cf in compiled.fields) {
    final key = cf.key;
    final vis = visible[key] ?? false;
    final computed = !identical(_prop(cf.def, 'value'), _absent);
    if (!vis) {
      fields[key] = ResolvedField(
        key: key,
        type: cf.spec.type,
        section: cf.section,
        visible: false,
        required: false,
        readOnly: computed,
        value: null,
        computed: computed,
        props: const {},
      );
      continue;
    }
    final props = <String, Object?>{};
    final rawProps = cf.def['props'];
    if (rawProps is Map<String, Object?>) {
      for (final e in rawProps.entries) {
        final kind = cf.spec.ruleableProps[e.key];
        if (kind != null && e.value is Map<String, Object?>) {
          final r = ev.eval(e.value, data, key, 'props.${e.key}');
          if (!r.ok) continue;
          if (!_kindMatches(kind, r.value)) {
            ev.issues.add(
              RuleIssue(
                key,
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
      final base = _baseOptions(cf.def, lists);
      final filter = _prop(cf.def, 'options_filter');
      options = identical(filter, _absent)
          ? List.of(base)
          : [
              for (final o in base)
                if (ev.boolean(
                  filter,
                  fallback: true,
                  onError: true,
                  data: {...data, 'option': o.toRuleData()},
                  path: key,
                  property: 'options_filter',
                ))
                  o,
            ];
    }
    final defaultRule = _prop(cf.def, 'default');
    final defaultValue = identical(defaultRule, _absent)
        ? null
        : ev.eval(defaultRule, data, key, 'default');
    final text = _prop(cf.def, 'text');
    fields[key] = ResolvedField(
      key: key,
      type: cf.spec.type,
      section: cf.section,
      visible: true,
      required:
          cf.spec.hasValue &&
          ev.boolean(
            _prop(cf.def, 'required'),
            fallback: false,
            onError: false,
            data: data,
            path: key,
            property: 'required',
          ),
      readOnly:
          computed ||
          cf.spec.type == 'prefilled' ||
          ev.boolean(
            _prop(cf.def, 'read_only'),
            fallback: false,
            onError: false,
            data: data,
            path: key,
            property: 'read_only',
          ),
      value: cf.spec.hasValue ? values[key] : null,
      computed: computed,
      props: props,
      label: ev.text(_prop(cf.def, 'label'), data, key, 'label'),
      text: ev.text(
        identical(text, _absent) ? _prop(cf.def, 'caption') : text,
        data,
        key,
        'text',
      ),
      hasDefault: defaultValue?.ok ?? false,
      defaultValue: defaultValue?.value,
      options: options,
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
