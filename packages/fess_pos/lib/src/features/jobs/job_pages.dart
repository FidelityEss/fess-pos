import 'dart:async';

import 'package:fess_pos/src/core/content/bundled_views.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/cards/cards.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/domain/maps/map_tiles.dart';
import 'package:fess_pos/src/features/jobs/job_action_pages.dart';
import 'package:fess_pos/src/features/maps/job_map.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/platform/external_apps.dart';
import 'package:fess_pos/src/renderer/render_context.dart';
import 'package:fess_pos/src/renderer/template.dart';
import 'package:fess_pos/src/renderer/view_renderer.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens a tap target such as `{"page": "job_detail"}` for what was
/// tapped, e.g. `{"job": {...}}` (`11` §7.1); the page router supplies it.
typedef PageNavigate =
    void Function(Map<String, Object?> target, Map<String, Object?> data);

/// What views read as `job.*`: the job as pulled, plus `scheduled`
/// (`{start, end}`), which `schedule_window` binds to, and `offline_ready`
/// where the page knows it (docs/08 §8).
Map<String, Object?> jobViewData(JobRecord job, {bool? offlineReady}) => {
  ...job.data,
  'scheduled': {
    'start': job.data['scheduled_start'],
    'end': job.data['scheduled_end'],
  },
  'offline_ready': ?offlineReady,
};

String todayIso() {
  final now = DateTime.now();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${now.year}-${two(now.month)}-${two(now.day)}';
}

T? _data<T>(AsyncValue<T> value) => switch (value) {
  AsyncData(:final value) => value,
  _ => null,
};

/// The items of view [key] in force (for [bankId]), or the bundled view
/// until one arrives.
List<Object?> viewItems(WidgetRef ref, String key, {String? bankId}) {
  final definition = _data(
    ref.watch(
      activeDefinitionProvider((kind: 'view', key: key, bankId: bankId)),
    ),
  );
  final items = definition?['items'];
  return items is List<Object?> ? items : BundledViews.byKey(key) ?? const [];
}

/// What the cards show about a token (`renderer/cards.dart`): valid until
/// its expiry, when the QR opens the verify page; expired after; missing
/// before the first pull issues one.
Map<String, Object?> cardData(
  CardToken? card, {
  required DateTime now,
  required Uri Function(String token) url,
}) {
  if (card == null) return const {'state': 'missing'};
  final valid = card.validAt(now);
  return {
    'state': valid ? 'valid' : 'expired',
    'valid_to': card.validTo.toUtc().toIso8601String(),
    if (valid) 'qr': url(card.token).toString(),
  };
}

/// What `evidence_status` binds to: how many items an inspection has, how
/// many reached the server, how many wait on the phone and how many are
/// held (quarantined).
Map<String, Object?> evidenceCounts(Iterable<EvidenceItem> items) {
  var sent = 0;
  var waiting = 0;
  var held = 0;
  for (final item in items) {
    switch (item.state) {
      case 'uploaded' || 'verified':
        sent++;
      case 'quarantined':
        held++;
      default:
        waiting++;
    }
  }
  return {
    'total': sent + waiting + held,
    'sent': sent,
    'waiting': waiting,
    'held': held,
  };
}

/// Calls, texts or emails a `contact` in the phone's own app, and says so
/// when no app could.
Future<void> _openContact(
  BuildContext context,
  WidgetRef ref,
  String Function(String key) copy,
  String channel,
  String address,
) async {
  final apps = ref.read(platformServicesProvider).externalApps;
  final opened = await apps.openContact(
    ContactChannel.values.byName(channel),
    address,
  );
  if (!opened && context.mounted) {
    ScaffoldMessenger.maybeOf(
      context,
    )?.showSnackBar(SnackBar(content: Text(copy('contact.no_app'))));
  }
}

/// The copy for [key], or null where neither the server nor the bundle
/// has it.
String? _copyOrNull(String Function(String key) copy, String key) {
  final s = copy(key);
  return s == key ? null : s;
}

/// A page's title: its own (a template), else the `page.<key>.title`
/// copy, else the module's name.
String _pageTitle(
  String Function(String key) copy,
  String? title,
  String? pageKey,
  Map<String, Object?> data,
) {
  if (title != null) return fillTemplate(title, data);
  final own = pageKey == null ? null : _copyOrNull(copy, 'page.$pageKey.title');
  return own ?? copy('shell.title');
}

/// The item views a view's `job_list`s draw their jobs with.
Set<String> _itemViewKeys(List<Object?> items) => {
  for (final item in items)
    if (item case {'type': 'job_list', 'item_view': final String key}) key,
};

/// A page's buttons (`actions`), each opening its target.
Widget? _pageActions(
  List<Map<String, Object?>>? actions,
  Map<String, Object?> data,
  PageNavigate? navigate,
) {
  final buttons = [
    for (final a in actions ?? const <Map<String, Object?>>[])
      if (a case {
        'label': final String label,
        'target': final Map<String, Object?> target,
      })
        OutlinedButton(
          key: ValueKey('page-action-${a['key'] ?? label}'),
          onPressed: navigate == null ? null : () => navigate(target, data),
          child: Text(fillTemplate(label, data)),
        ),
  ];
  if (buttons.isEmpty) return null;
  return SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final b in buttons)
            Padding(padding: const EdgeInsets.only(top: 8), child: b),
        ],
      ),
    ),
  );
}

/// A `view_page` (`11` §7.1): a view definition in force, with what its
/// items bind to. That is the agent, the home tiles' totals, the card and
/// the sync status, and on a job's page the job, its card and its last
/// inspection. A job's page shows the actions the job allows; any page
/// shows its buttons. Pulling down syncs now.
class ViewPage extends ConsumerWidget {
  const ViewPage({
    required this.view,
    this.pageKey,
    this.title,
    this.actions,
    this.jobId,
    this.onBack,
    this.onMenu,
    this.onNavigate,
    super.key,
  });

  /// The view definition's key, e.g. `home` or `job_detail`.
  final String view;

  /// The app page's key, whose `page.<key>.title` copy titles the page
  /// when it has no [title].
  final String? pageKey;

  /// The page's title, a template.
  final String? title;

  /// The page's buttons (`actions`), each a label and a target.
  final List<Map<String, Object?>>? actions;

  /// The job the page is about, if it's a job's page.
  final String? jobId;
  final VoidCallback? onBack;
  final VoidCallback? onMenu;
  final PageNavigate? onNavigate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = jobId;
    final job = id == null ? null : ref.watch(jobProvider(id));
    final record = job == null ? null : _data(job);
    final bankId = record?.bankId;
    final copy = ref.watch(bankCopyProvider(bankId));
    final items = viewItems(ref, view, bankId: bankId);
    final jobs = ref.watch(myJobsProvider);
    final agent = _data(ref.watch(agentProvider));
    final totals = _data(ref.watch(agentTotalsProvider));
    final sync = _data(ref.watch(syncStatusProvider));
    final syncing = _data(ref.watch(syncingProvider)) ?? false;
    final ready =
        _data(ref.watch(offlineReadyJobsProvider)) ?? const <String>{};
    final latest = id == null
        ? null
        : _data(ref.watch(latestInspectionProvider(id)));
    final evidence = latest == null
        ? null
        : _data(ref.watch(inspectionEvidenceProvider(latest.id)));
    Map<String, Object?> card(CardToken? token) => cardData(
      token,
      now: DateTime.now(),
      url: (t) => ref.read(verifyUrlProvider)(t),
    );
    final data = <String, Object?>{
      'agent': agent ?? const <String, Object?>{},
      'stats': totals ?? const <String, Object?>{},
      'card': card(_data<CardToken?>(ref.watch(agentCardProvider))),
      // The sync status (docs/08 §8, T4-13).
      if (sync != null)
        'sync': {
          'pending': sync.pending,
          'needs_attention': sync.needsAttention,
          'photos': sync.evidenceWaiting,
          'syncing': syncing,
        },
      if (record != null) ...{
        'job': jobViewData(record, offlineReady: ready.contains(record.id)),
        'job_card': card(
          _data<CardToken?>(ref.watch(jobCardProvider(record.id))),
        ),
        // The last inspection and how its uploads are getting on
        // (`evidence_status`).
        if (latest != null)
          'inspection': {
            'status': latest.status,
            'evidence': evidenceCounts(evidence ?? const []),
            // The same counts where the seeded receipt view binds them.
            'receipt': evidenceCounts(evidence ?? const []),
          },
      },
    };
    final ctx = RenderContext(
      data: data,
      jobs: [
        for (final j in _data(jobs) ?? const <JobRecord>[])
          jobViewData(j, offlineReady: ready.contains(j.id)),
      ],
      itemViews: {
        for (final key in _itemViewKeys(items))
          key: viewItems(ref, key, bankId: bankId),
      },
      copy: copy,
      today: todayIso(),
      onNavigate: onNavigate,
      onSyncNow: () => unawaited(ref.read(moduleRuntimeProvider).runSync()),
      openContact: (channel, address) =>
          unawaited(_openContact(context, ref, copy, channel, address)),
      mapPreview: record == null
          ? null
          : (item, location) {
              final height = item['height'];
              return JobMapPreview(
                location: GeoPoint.tryParse(location),
                height: height is num ? height.toDouble() : 180,
                label: displayValue(record.data['merchant_name']),
              );
            },
    );
    Widget content() => RefreshIndicator(
      onRefresh: () async {
        await ref.read(moduleRuntimeProvider).runSync();
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [ViewRenderer(items: items, context: ctx)],
      ),
    );
    final Widget body;
    if (job != null) {
      body = switch (job) {
        AsyncData(value: JobRecord()) => content(),
        AsyncData() => _Message(copy('jobs.not_found')),
        AsyncError() => _Message(copy('shell.unavailable')),
        _ => const Center(child: CircularProgressIndicator()),
      };
    } else {
      body = switch (jobs) {
        AsyncData() => content(),
        AsyncError() => _Message(copy('shell.unavailable')),
        _ => const Center(child: CircularProgressIndicator()),
      };
    }
    final String shownTitle;
    if (title == null && record != null) {
      shownTitle =
          displayValue(record.data['merchant_name']) ?? record.reference;
    } else {
      shownTitle = _pageTitle(copy, title, pageKey, data);
    }
    return Scaffold(
      appBar: PosHeader(
        title: shownTitle,
        onBack: onBack,
        onMenu: onMenu,
        menuTooltip: copy('nav.menu'),
      ),
      body: body,
      bottomNavigationBar: record != null
          ? JobActionBar(
              job: record,
              pageActions: actions,
              onNavigate: onNavigate,
            )
          : _pageActions(actions, data, onNavigate),
    );
  }
}

/// A `list_page` (`11` §7.1): the agent's jobs, filtered, sorted and
/// grouped as the page says, each drawn with its item view; a tap opens
/// the page's `on_tap`. Lists of inspections or form submissions come
/// later.
class ListPage extends ConsumerWidget {
  const ListPage({
    required this.page,
    this.pageKey,
    this.onBack,
    this.onMenu,
    this.onNavigate,
    super.key,
  });

  /// The `list_page` definition.
  final Map<String, Object?> page;
  final String? pageKey;
  final VoidCallback? onBack;
  final VoidCallback? onMenu;
  final PageNavigate? onNavigate;

  static const List<String> _listProps = [
    'filter',
    'sort',
    'sort_direction',
    'group_by',
    'on_tap',
    'empty_content',
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final copy = ref.watch(copyProvider);
    final agent = _data(ref.watch(agentProvider));
    final data = <String, Object?>{
      'agent': agent ?? const <String, Object?>{},
    };
    final title = page['title'];
    final itemView = page['item_view'];
    final jobs = ref.watch(myJobsProvider);
    final ready =
        _data(ref.watch(offlineReadyJobsProvider)) ?? const <String>{};
    final Widget body;
    if (page['source'] != 'jobs' || itemView is! String) {
      body = _Message(copy('page.unavailable'));
    } else {
      body = switch (jobs) {
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () async {
            await ref.read(moduleRuntimeProvider).runSync();
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              ViewRenderer(
                items: [
                  {
                    'type': 'job_list',
                    'item_view': itemView,
                    for (final p in _listProps)
                      if (page[p] != null) p: page[p],
                  },
                ],
                context: RenderContext(
                  data: data,
                  jobs: [
                    for (final j in value)
                      jobViewData(j, offlineReady: ready.contains(j.id)),
                  ],
                  itemViews: {itemView: viewItems(ref, itemView)},
                  copy: copy,
                  today: todayIso(),
                  onNavigate: onNavigate,
                ),
              ),
            ],
          ),
        ),
        AsyncError() => _Message(copy('shell.unavailable')),
        _ => const Center(child: CircularProgressIndicator()),
      };
    }
    return Scaffold(
      appBar: PosHeader(
        title: _pageTitle(
          copy,
          title is String ? title : null,
          pageKey,
          data,
        ),
        onBack: onBack,
        onMenu: onMenu,
        menuTooltip: copy('nav.menu'),
      ),
      body: body,
    );
  }
}

class _Message extends StatelessWidget {
  const _Message(this.message);

  final String message;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Text(message, textAlign: TextAlign.center),
    ),
  );
}
