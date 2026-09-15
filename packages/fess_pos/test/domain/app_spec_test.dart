import 'package:fess_pos/src/contract/capabilities.dart';
import 'package:fess_pos/src/core/content/bundled_app.dart';
import 'package:fess_pos/src/domain/app/app_spec.dart';
import 'package:flutter_test/flutter_test.dart';

final Set<String> _types = supportedPageTypes.keys.toSet();

const Map<String, Object?> _pages = {
  'home': {'type': 'view_page', 'view': 'home'},
  'active_jobs': {
    'type': 'list_page',
    'source': 'jobs',
    'item_view': 'job_card',
    'on_tap': {'page': 'job_detail'},
  },
  'job_detail': {
    'type': 'view_page',
    'view': 'job_detail',
    'actions': [
      {
        'label': 'Start inspection',
        'target': {'page': 'inspection'},
      },
    ],
  },
  'inspection': {
    'type': 'flow',
    'flow': 'site_inspection_flow',
    'outcomes': 'default',
  },
  'outcome_success': {'type': 'outcome_page', 'outcome': 'success'},
  'outcome_saved': {'type': 'outcome_page', 'outcome': 'saved'},
  'outcome_failure': {'type': 'outcome_page', 'outcome': 'failure'},
};

const Map<String, Object?> _sets = {
  'default': {
    'success': 'outcome_success',
    'saved': 'outcome_saved',
    'failure': 'outcome_failure',
  },
};

const Map<String, Object?> _tabs = {
  'style': 'bottom_tabs',
  'items': [
    {'label': 'Home', 'icon': 'home', 'page': 'home'},
    {'label': 'Leads', 'icon': 'list', 'page': 'active_jobs'},
  ],
};

Map<String, Object?> _app({
  Object? home = 'home',
  Object? navigation = _tabs,
  Map<String, Object?> pages = _pages,
  Object? sets = _sets,
}) => {
  'kind': 'app',
  'home': home,
  'navigation': navigation,
  'pages': pages,
  'outcome_sets': sets,
};

List<String> _problems(Map<String, Object?> definition) {
  try {
    AppSpec.parse(definition, pageTypes: _types);
    return const [];
  } on AppSpecError catch (e) {
    return e.problems;
  }
}

void main() {
  test('a sound app: its home, its tabs and its pages (T3-17)', () {
    final app = AppSpec.parse(_app(), pageTypes: _types);
    expect(app.home, 'home');
    expect(app.style, NavigationStyle.bottomTabs);
    expect(app.navigation.map((i) => i.page), ['home', 'active_jobs']);
    expect(app.isTopLevel('active_jobs'), isTrue);
    expect(app.isTopLevel('job_detail'), isFalse);
    expect(
      app.pages['job_detail']!.actions.single['label'],
      'Start inspection',
    );
    expect(app.outcomeSets['default']!['saved'], 'outcome_saved');
  });

  test('every broken link and missing prop is a problem', () {
    expect(_problems(_app(home: 'nowhere')), [contains('home nowhere')]);
    expect(
      _problems(
        _app(
          navigation: {
            'style': 'bottom_tabs',
            'items': [
              {'label': 'Home', 'page': 'home'},
              {'label': 'Gone', 'page': 'gone'},
            ],
          },
        ),
      ),
      [contains('no page gone')],
    );
    expect(
      _problems(
        _app(
          pages: {
            ..._pages,
            'job_detail': {
              'type': 'view_page',
              'view': 'job_detail',
              'actions': [
                {
                  'label': 'Nowhere',
                  'target': {'page': 'missing'},
                },
              ],
            },
          },
        ),
      ),
      [contains('no page missing')],
    );
    expect(
      _problems(
        _app(
          pages: {
            ..._pages,
            'help': {'type': 'from_the_future'},
            'card': {'type': 'view_page'},
          },
        ),
      ),
      unorderedEquals([
        contains('type from_the_future is not in this build'),
        contains('page card: no view'),
      ]),
    );
    expect(_problems(_app(sets: null)), [contains('no outcome set default')]);
    expect(
      _problems(
        _app(
          sets: {
            'default': {
              'success': 'home',
              'saved': 'outcome_saved',
              'failure': 'outcome_failure',
            },
          },
        ),
      ),
      [contains('success is no outcome page')],
    );
    expect(
      _problems(
        _app(
          navigation: {
            'style': 'bottom_tabs',
            'items': [
              {'label': 'Home', 'page': 'home'},
            ],
          },
        ),
      ),
      [contains('2 items or more')],
    );
  });

  test('the bundled app is sound', () {
    expect(BundledApp.spec.home, 'home');
    expect(BundledApp.spec.style, NavigationStyle.none);
    expect(
      BundledApp.spec.pages.keys,
      containsAll(['job_detail', 'agent_card']),
    );
  });
}
