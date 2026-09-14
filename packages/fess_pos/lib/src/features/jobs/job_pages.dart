import 'package:fess_pos/src/core/content/bundled_views.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/cards/cards.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/domain/maps/map_tiles.dart';
import 'package:fess_pos/src/features/cards/agent_card_page.dart';
import 'package:fess_pos/src/features/jobs/job_action_pages.dart';
import 'package:fess_pos/src/features/maps/job_map.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/renderer/render_context.dart';
import 'package:fess_pos/src/renderer/template.dart';
import 'package:fess_pos/src/renderer/view_renderer.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show readPath;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What views read as `job.*`: the job as pulled, plus `scheduled`
/// (`{start, end}`), which `schedule_window` binds to.
Map<String, Object?> jobViewData(JobRecord job) => {
  ...job.data,
  'scheduled': {
    'start': job.data['scheduled_start'],
    'end': job.data['scheduled_end'],
  },
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

/// The home page (docs/04 §3.6, B2.7): the `home` view over the agent's
/// jobs as they are on the phone. Pulling down syncs now. Until the app
/// definition drives navigation (T3-17), a tapped job opens its detail.
class JobsHomePage extends ConsumerWidget {
  const JobsHomePage({required this.onOpenJob, this.onBack, super.key});

  final void Function(String jobId) onOpenJob;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final copy = ref.watch(copyProvider);
    final jobs = ref.watch(myJobsProvider);
    final home = viewItems(ref, 'home');
    final jobCard = viewItems(ref, 'job_card');
    final agent = _data(ref.watch(agentProvider));
    final totals = _data(ref.watch(agentTotalsProvider));
    final body = switch (jobs) {
      AsyncData(:final value) => RefreshIndicator(
        onRefresh: () async {
          await ref.read(moduleRuntimeProvider).runSync();
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            ViewRenderer(
              items: home,
              context: RenderContext(
                data: {
                  'agent': agent ?? const <String, Object?>{},
                  'stats': totals ?? const <String, Object?>{},
                  'card': cardData(
                    _data<CardToken?>(ref.watch(agentCardProvider)),
                    now: DateTime.now(),
                    url: (token) => ref.read(verifyUrlProvider)(token),
                  ),
                },
                jobs: [for (final job in value) jobViewData(job)],
                itemViews: {'job_card': jobCard},
                copy: copy,
                today: todayIso(),
                onNavigate: (target, data) {
                  if (target['page'] == 'agent_card') {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const AgentCardPage(),
                      ),
                    );
                    return;
                  }
                  final id = readPath(data, 'job.id');
                  if (target['page'] == 'job_detail' && id is String) {
                    onOpenJob(id);
                  }
                },
              ),
            ),
          ],
        ),
      ),
      AsyncError() => _Message(copy('shell.unavailable')),
      _ => const Center(child: CircularProgressIndicator()),
    };
    return Scaffold(
      appBar: PosHeader(title: copy('shell.title'), onBack: onBack),
      body: body,
    );
  }
}

/// One job (docs/04 §3.4): the `job_detail` view in force for the job's
/// bank. The actions on it arrive with T2-16.
class JobDetailPage extends ConsumerWidget {
  const JobDetailPage({required this.jobId, required this.onBack, super.key});

  final String jobId;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final copy = ref.watch(copyProvider);
    final job = ref.watch(jobProvider(jobId));
    final agent = _data(ref.watch(agentProvider));
    final record = _data(job);
    final items = viewItems(ref, 'job_detail', bankId: record?.bankId);
    final title = record == null
        ? copy('shell.title')
        : displayValue(record.data['merchant_name']) ?? record.reference;
    final body = switch (job) {
      AsyncData(value: final JobRecord found) => ListView(
        children: [
          ViewRenderer(
            items: items,
            context: RenderContext(
              data: {
                'job': jobViewData(found),
                'agent': agent ?? const <String, Object?>{},
                'job_card': cardData(
                  _data<CardToken?>(ref.watch(jobCardProvider(jobId))),
                  now: DateTime.now(),
                  url: (token) => ref.read(verifyUrlProvider)(token),
                ),
              },
              copy: copy,
              today: todayIso(),
              mapPreview: (item, location) {
                final height = item['height'];
                return JobMapPreview(
                  location: GeoPoint.tryParse(location),
                  height: height is num ? height.toDouble() : 180,
                  label: displayValue(found.data['merchant_name']),
                );
              },
            ),
          ),
        ],
      ),
      AsyncData() => _Message(copy('jobs.not_found')),
      AsyncError() => _Message(copy('shell.unavailable')),
      _ => const Center(child: CircularProgressIndicator()),
    };
    return Scaffold(
      appBar: PosHeader(title: title, onBack: onBack),
      body: body,
      bottomNavigationBar: record == null ? null : JobActionBar(job: record),
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
