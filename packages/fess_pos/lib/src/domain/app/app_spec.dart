import 'package:meta/meta.dart';

/// How the app's top-level pages are reached (`app.navigation.style`).
enum NavigationStyle { bottomTabs, drawer, none }

const Map<String, NavigationStyle> _styles = {
  'bottom_tabs': NavigationStyle.bottomTabs,
  'drawer': NavigationStyle.drawer,
  'none': NavigationStyle.none,
};

/// The props each page type can't do without (`11` §7.1).
const Map<String, List<String>> _required = {
  'view_page': ['view'],
  'list_page': ['source', 'item_view'],
  'form_page': ['form', 'action', 'outcomes'],
  'flow': ['flow', 'outcomes'],
  'outcome_page': ['outcome'],
};

const List<String> _outcomes = ['success', 'saved', 'failure'];

/// One navigation entry: its label (a template), an icon name and the page
/// it shows.
@immutable
class NavItem {
  const NavItem({required this.label, required this.page, this.icon});

  final String label;
  final String page;
  final String? icon;
}

/// One page of the app (`11` §7.1): its key and its definition.
@immutable
class AppPage {
  const AppPage(this.key, this.definition);

  final String key;
  final Map<String, Object?> definition;

  /// `view_page`, `list_page`, `form_page`, `flow` or `outcome_page`.
  String get type => string('type') ?? '';

  String? string(String prop) {
    final v = definition[prop];
    return v is String ? v : null;
  }

  String? get title => string('title');

  /// A `view_page`'s buttons, each a label and a target.
  List<Map<String, Object?>> get actions {
    final a = definition['actions'];
    return a is List<Object?>
        ? a.whereType<Map<String, Object?>>().toList()
        : const [];
  }
}

/// An `app` definition the module can run (docs/04 §3.6), checked: the
/// home page, every navigation item, button, tap target and outcome set
/// leads to a page, and every page is of a type this build shows, with
/// the props that type needs.
@immutable
class AppSpec {
  const AppSpec._({
    required this.definition,
    required this.home,
    required this.style,
    required this.navigation,
    required this.pages,
    required this.outcomeSets,
  });

  /// Checks [definition]; throws an [AppSpecError] listing every problem.
  /// [pageTypes] are the page types this build shows.
  factory AppSpec.parse(
    Map<String, Object?> definition, {
    required Set<String> pageTypes,
  }) {
    final problems = <String>[];
    final raw = definition['pages'];
    final known = raw is Map<String, Object?> ? raw.keys.toSet() : <String>{};
    final pages = <String, AppPage>{};
    if (raw is! Map<String, Object?> || raw.isEmpty) {
      problems.add('the app has no pages');
    } else {
      for (final e in raw.entries) {
        final page = e.value;
        if (page is! Map<String, Object?>) {
          problems.add('page ${e.key} is not an object');
          continue;
        }
        final type = page['type'];
        if (type is! String || !pageTypes.contains(type)) {
          problems.add('page ${e.key}: type $type is not in this build');
          continue;
        }
        for (final prop in _required[type] ?? const <String>[]) {
          if (page[prop] is! String) problems.add('page ${e.key}: no $prop');
        }
        pages[e.key] = AppPage(e.key, page);
      }
    }

    void target(String where, Object? t) {
      if (t == null) return;
      if (t is! Map<String, Object?>) {
        problems.add('$where: the target is not an object');
        return;
      }
      final page = t['page'];
      if (page is String) {
        if (!known.contains(page)) problems.add('$where: no page $page');
      } else if (t['flow'] is! String) {
        problems.add('$where: the target names no page or flow');
      }
    }

    final home = definition['home'];
    if (home is! String || !known.contains(home)) {
      problems.add('home $home is not a page');
    }

    var style = NavigationStyle.none;
    final items = <NavItem>[];
    final nav = definition['navigation'];
    if (nav is Map<String, Object?>) {
      final found = _styles[nav['style']];
      if (found == null) {
        problems.add('navigation style ${nav['style']} is not in this build');
      } else {
        style = found;
      }
      final list = nav['items'];
      if (list is List<Object?>) {
        for (final (i, item) in list.indexed) {
          if (item case {
            'label': final String label,
            'page': final String page,
          }) {
            if (!known.contains(page)) {
              problems.add('navigation item $i: no page $page');
            }
            final icon = item['icon'];
            items.add(
              NavItem(
                label: label,
                page: page,
                icon: icon is String ? icon : null,
              ),
            );
          } else {
            problems.add('navigation item $i needs a label and a page');
          }
        }
      }
      if (items.length > 6) problems.add('navigation has more than 6 items');
      if (style == NavigationStyle.bottomTabs && items.length < 2) {
        problems.add('bottom tabs need 2 items or more');
      }
      if (style == NavigationStyle.drawer && items.isEmpty) {
        problems.add('a drawer needs an item');
      }
    } else if (nav != null) {
      problems.add('navigation is not an object');
    }

    final sets = <String, Map<String, String>>{};
    final rawSets = definition['outcome_sets'];
    if (rawSets is Map<String, Object?>) {
      for (final e in rawSets.entries) {
        final set = e.value;
        final pagesOf = <String, String>{};
        for (final outcome in _outcomes) {
          final page = set is Map<String, Object?> ? set[outcome] : null;
          if (page is String && pages[page]?.type == 'outcome_page') {
            pagesOf[outcome] = page;
          } else {
            problems.add('outcome set ${e.key}: $outcome is no outcome page');
          }
        }
        sets[e.key] = pagesOf;
      }
    }

    for (final page in pages.values) {
      final where = 'page ${page.key}';
      for (final (i, a) in page.actions.indexed) {
        if (a['label'] is! String) problems.add('$where: button $i no label');
        target('$where: button $i', a['target'] ?? const <String, Object?>{});
      }
      target(where, page.definition['on_tap']);
      final buttons = page.definition['buttons'];
      if (buttons is List<Object?>) {
        for (final (i, b) in buttons.indexed) {
          if (b is Map<String, Object?>) {
            target('$where: button $i', b['target']);
          }
        }
      }
      final outcomes = page.string('outcomes');
      if (outcomes != null && !sets.containsKey(outcomes)) {
        problems.add('$where: no outcome set $outcomes');
      }
    }

    if (problems.isNotEmpty) throw AppSpecError(problems);
    return AppSpec._(
      definition: definition,
      home: home! as String,
      style: style,
      navigation: items,
      pages: pages,
      outcomeSets: sets,
    );
  }

  /// The definition as it came.
  final Map<String, Object?> definition;

  final String home;
  final NavigationStyle style;
  final List<NavItem> navigation;
  final Map<String, AppPage> pages;

  /// Outcome sets by key: each outcome (`success`, `saved`, `failure`) to
  /// its page.
  final Map<String, Map<String, String>> outcomeSets;

  /// Whether [page] is the home page or one the navigation shows.
  bool isTopLevel(String page) =>
      page == home || navigation.any((i) => i.page == page);
}

/// An `app` definition the module can't run, with why.
class AppSpecError implements Exception {
  const AppSpecError(this.problems);

  final List<String> problems;

  @override
  String toString() => 'AppSpecError(${problems.join('; ')})';
}
