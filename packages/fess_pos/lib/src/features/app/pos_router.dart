import 'dart:async';

import 'package:fess_pos/src/core/content/bundled_app.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:fess_pos/src/domain/app/app_spec.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/navigation/pos_link.dart';
import 'package:fess_pos/src/features/forms/record_form_page.dart';
import 'package:fess_pos/src/features/jobs/job_action_pages.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:fess_pos/src/features/preview/preview_link_page.dart';
import 'package:fess_pos/src/features/shell/needs_attention_page.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/renderer/icons.dart';
import 'package:fess_pos/src/renderer/template.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show readPath;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

const PosLogger _log = PosLogger('router');

T? _data<T>(AsyncValue<T> value) => switch (value) {
  AsyncData(:final value) => value,
  _ => null,
};

/// The page types kept on the router's stack. Forms and outcomes open
/// over it and close themselves.
const Set<String> _stackedTypes = {'view_page', 'list_page'};

/// Page [key] of [app], else the bundled app's page of that key: the job
/// page and the card are always there for links.
AppPage? pageSpec(AppSpec app, String key) =>
    app.pages[key] ?? BundledApp.spec.pages[key];

/// The module's page router (docs/04 §3.6, T3-17). The app definition in
/// force decides the home page, the navigation (bottom tabs, a drawer or
/// none) and every page, each drawn by its page type. A tapped target
/// (`{"page": key}` or `{"flow": key}`) opens: a top-level page becomes
/// the one shown, any other opens over it for the job it was tapped for.
/// It runs its own navigator on the `Navigator` pages API (docs/03 §7).
class PosRouter extends ConsumerStatefulWidget {
  const PosRouter({this.onExit, super.key});

  /// Leaves the module, from a top-level page's Back.
  final VoidCallback? onExit;

  /// Back to the home page from anywhere in the module; outside a router,
  /// back to the navigator's first page.
  static void goHome(BuildContext context) {
    final router = context.findAncestorStateOfType<PosRouterState>();
    if (router != null) {
      router.home();
      return;
    }
    Navigator.of(context).popUntil((route) => route.isFirst);
  }

  /// Home, then [target] for [data]'s job, e.g. an outcome page's "start
  /// another" button; outside a router, just back to the first page.
  static void goHomeAndOpen(
    BuildContext context,
    Map<String, Object?> target,
    Map<String, Object?> data,
  ) {
    final router = context.findAncestorStateOfType<PosRouterState>();
    goHome(context);
    router?.open(target, data);
  }

  @override
  ConsumerState<PosRouter> createState() => PosRouterState();
}

@immutable
class _Entry {
  const _Entry(this.id, this.page, this.jobId);

  final int id;
  final String page;
  final String? jobId;
}

class PosRouterState extends ConsumerState<PosRouter> {
  final GlobalKey<NavigatorState> _navigator = GlobalKey();

  /// The top-level page shown under the rest; null: home.
  String? _top;
  final List<_Entry> _stack = [];
  int _next = 0;

  /// Opens [target] for the job in [data] (`job.id`), if there is one.
  void open(
    Map<String, Object?> target, [
    Map<String, Object?> data = const {},
  ]) {
    final id = readPath(data, 'job.id');
    final jobId = id is String ? id : null;
    final page = target['page'];
    final flow = target['flow'];
    if (page is String) {
      _openPage(page, jobId);
    } else if (flow is String) {
      unawaited(_startFlow(flow, jobId));
    }
  }

  /// Opens a deep link's place (docs/03 §3), from the home page.
  void openLink(PosLink link) {
    home();
    switch (link) {
      case JobLink(:final jobId):
        _openPage('job_detail', jobId);
      case CardLink():
        _openPage('agent_card', null);
      case PreviewLink(:final token):
        _push((_) => PreviewLinkPage(token: token));
      case HomeLink():
        break;
    }
  }

  /// Back to the home page.
  void home() {
    _navigator.currentState?.popUntil((route) => route.isFirst);
    setState(() {
      _top = null;
      _stack.clear();
    });
  }

  void _openPage(String page, String? jobId) {
    if (page == 'needs_attention') {
      _push((_) => const NeedsAttentionPage());
      return;
    }
    final app = ref.read(appSpecProvider(null));
    final spec = pageSpec(app, page);
    if (spec == null) {
      _log.warning('a target names page $page, which the app lacks');
      return;
    }
    switch (spec.type) {
      case 'flow':
        unawaited(_startFlow(spec.string('flow') ?? '', jobId));
      case _ when jobId == null && app.isTopLevel(page):
        setState(() {
          _top = page == app.home ? null : page;
          _stack.clear();
        });
      case final type when _stackedTypes.contains(type):
        setState(() => _stack.add(_Entry(_next++, page, jobId)));
      case final type:
        if (type != 'form_page') {
          _log.warning('page $page is a $type, which opens only from a form');
        }
        _push((_) => _PageHost(page: page, jobId: jobId, router: this));
    }
  }

  void _push(WidgetBuilder builder) => unawaited(
    _navigator.currentState?.push(MaterialPageRoute<void>(builder: builder)),
  );

  /// Runs flow [flow] for [jobId]'s job. This build runs a job's
  /// inspection flow (D-87); any other flow says the page isn't available.
  Future<void> _startFlow(String flow, String? jobId) async {
    if (flow != inspectionFlowKey || jobId == null) {
      _log.warning(
        "flow $flow can't start here: this build runs a job's "
        'inspection flow',
      );
      final context = _navigator.currentContext;
      if (context == null) return;
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        SnackBar(content: Text(ref.read(copyProvider)('page.unavailable'))),
      );
      return;
    }
    final job = await ref.read(jobProvider(jobId).future);
    final inspections = await ref.read(inspectionsProvider.future);
    final context = _navigator.currentContext;
    if (!mounted || job == null || inspections == null) return;
    if (context == null || !context.mounted) return;
    await openInspection(
      context,
      inspections,
      job,
      ref.read(bankCopyProvider(job.bankId)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final app = ref.watch(appSpecProvider(null));
    final top = _top;
    final shown = top != null && app.pages.containsKey(top) ? top : app.home;
    return Navigator(
      key: _navigator,
      pages: [
        MaterialPage<void>(
          key: const ValueKey('pos-top'),
          child: _TopLevel(app: app, page: shown, router: this),
        ),
        for (final e in _stack)
          MaterialPage<void>(
            key: ValueKey('pos-page-${e.id}'),
            child: _PageHost(page: e.page, jobId: e.jobId, router: this),
          ),
      ],
      onDidRemovePage: (page) => setState(
        () => _stack.removeWhere(
          (e) => page.key == ValueKey('pos-page-${e.id}'),
        ),
      ),
    );
  }
}

/// The top-level page, with the app's navigation around it: bottom tabs,
/// a drawer, or none.
class _TopLevel extends ConsumerWidget {
  const _TopLevel({
    required this.app,
    required this.page,
    required this.router,
  });

  final AppSpec app;
  final String page;
  final PosRouterState router;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agent = _data(ref.watch(agentProvider));
    final data = <String, Object?>{
      'agent': agent ?? const <String, Object?>{},
    };
    final items = app.navigation;
    Widget host({VoidCallback? onMenu}) =>
        _PageHost(page: page, router: router, top: true, onMenu: onMenu);
    Icon icon(NavItem item) =>
        Icon(posIcon(item.icon) ?? Icons.circle_outlined);
    switch (app.style) {
      case NavigationStyle.bottomTabs:
        final index = items.indexWhere((i) => i.page == page);
        return Scaffold(
          body: host(),
          // FESS's bottom bar (D-97): white under a hairline, the active
          // item in the brand colour, no highlight pill.
          bottomNavigationBar: DecoratedBox(
            // Over the bar, which paints its own white.
            position: DecorationPosition.foreground,
            decoration: const BoxDecoration(
              border: Border(
                top: BorderSide(color: PosTokens.componentBottomNavBorder),
              ),
            ),
            child: BottomNavigationBar(
              key: const ValueKey('pos-tabs'),
              type: BottomNavigationBarType.fixed,
              // The same size for every label: nothing grows when chosen.
              selectedFontSize: PosTokens.componentBottomNavLabelSize,
              // From the tokens, even where it equals Flutter's default.
              // ignore: avoid_redundant_argument_values
              unselectedFontSize: PosTokens.componentBottomNavLabelSize,
              currentIndex: index < 0 ? 0 : index,
              onTap: (i) => router.open({'page': items[i].page}),
              items: [
                for (final item in items)
                  BottomNavigationBarItem(
                    icon: icon(item),
                    label: fillTemplate(item.label, data),
                  ),
              ],
            ),
          ),
        );
      case NavigationStyle.drawer:
        return Scaffold(
          drawer: Drawer(
            child: SafeArea(
              child: ListView(
                children: [
                  for (final item in items)
                    Builder(
                      builder: (context) => ListTile(
                        key: ValueKey('pos-nav-${item.page}'),
                        leading: icon(item),
                        title: Text(fillTemplate(item.label, data)),
                        selected: item.page == page,
                        onTap: () {
                          Scaffold.of(context).closeDrawer();
                          router.open({'page': item.page});
                        },
                      ),
                    ),
                ],
              ),
            ),
          ),
          body: Builder(
            builder: (context) =>
                host(onMenu: () => Scaffold.of(context).openDrawer()),
          ),
        );
      case NavigationStyle.none:
        return host();
    }
  }
}

/// One app page, drawn by its type (`11` §7.1) from the app in force for
/// its job's bank.
class _PageHost extends ConsumerWidget {
  const _PageHost({
    required this.page,
    required this.router,
    this.jobId,
    this.top = false,
    this.onMenu,
  });

  final String page;
  final PosRouterState router;
  final String? jobId;

  /// A top-level page: its Back leaves the module.
  final bool top;
  final VoidCallback? onMenu;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = jobId;
    final record = id == null ? null : _data(ref.watch(jobProvider(id)));
    final spec = pageSpec(ref.watch(appSpecProvider(record?.bankId)), page);
    final back = top
        ? router.widget.onExit
        : () => unawaited(Navigator.of(context).maybePop());
    final key = ValueKey('page-$page');
    switch (spec) {
      case AppPage(type: 'view_page'):
        return ViewPage(
          key: key,
          view: spec.string('view') ?? page,
          pageKey: page,
          title: spec.title,
          actions: spec.actions,
          jobId: id,
          onBack: back,
          onMenu: onMenu,
          onNavigate: router.open,
        );
      case AppPage(type: 'list_page'):
        return ListPage(
          key: key,
          page: spec.definition,
          pageKey: page,
          onBack: back,
          onMenu: onMenu,
          onNavigate: router.open,
        );
      case AppPage(type: 'form_page')
          when spec.string('action') == 'record.submit':
        // The generic form page (T3-19, B4.23).
        return RecordFormPage(key: key, page: spec, jobId: id, onBack: back);
      case AppPage(type: 'form_page'):
        // A job's own action (B2.3, B2.4).
        final action = JobAction.values
            .where(
              (a) =>
                  a.actionName == spec.string('action') &&
                  a.reasonCategory != null,
            )
            .firstOrNull;
        if (action != null && id != null) {
          if (record == null) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }
          return ReasonFormPage(
            key: key,
            job: record,
            action: action,
            config: JobActionConfig(
              title: spec.title,
              form: spec.string('form'),
            ),
          );
        }
    }
    return _Unavailable(key: key, onBack: back);
  }
}

class _Unavailable extends ConsumerWidget {
  const _Unavailable({this.onBack, super.key});

  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final copy = ref.watch(copyProvider);
    return Scaffold(
      appBar: PosHeader(title: copy('shell.title'), onBack: onBack),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text(copy('page.unavailable'), textAlign: TextAlign.center),
        ),
      ),
    );
  }
}
