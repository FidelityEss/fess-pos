import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/sync/lost_store.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show renderTemplate;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What needs attention (docs/08 §8): what the server couldn't take
/// (T4-13), each item in plain words, when it was saved and the server's
/// reason; the data stays on the phone until the server's resolution is
/// pulled, and an administrator resolves it from the envelope inbox. Above
/// them, battery settings that can hold background sending back, with the
/// way to change them (T5-02), and any store that could never be opened
/// again with work on it (T5-13): what was lost as far as the phone knows,
/// until the agent acknowledges it.
class NeedsAttentionPage extends ConsumerWidget {
  const NeedsAttentionPage({super.key});

  /// Envelope types with a name of their own in the copy.
  static const Set<String> _named = {
    'submission',
    'inspection_started',
    'job_event',
    'form_submission',
    'evidence_meta',
    'evidence_uploaded',
    'traces_batch',
    'inspection_snapshot',
    'custody_batch',
    'sync_report',
    'client_error',
  };

  static String _when(String iso) {
    final at = DateTime.tryParse(iso)?.toLocal();
    if (at == null) return iso;
    String two(int n) => n.toString().padLeft(2, '0');
    return '${at.year}-${two(at.month)}-${two(at.day)} '
        '${two(at.hour)}:${two(at.minute)}';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final copy = ref.watch(copyProvider);
    final restricted = switch (ref.watch(powerStatusProvider)) {
      AsyncData(:final value) => value.restricted,
      _ => false,
    };
    final lost = switch (ref.watch(lostStoresProvider)) {
      AsyncData(:final value) => value,
      _ => const <LostStore>[],
    };
    final lostCards = [
      for (final store in lost)
        Card(
          key: ValueKey('lost-${store.name}'),
          child: ListTile(
            leading: const Icon(Icons.report_outlined),
            title: Text(copy('attention.lost.title')),
            subtitle: Text(
              store.outcome == LostStoreOutcome.unsentUnrecoverable
                  ? renderTemplate(copy('attention.lost.unsent'), {
                      'count': store.waiting,
                      'at': _when(store.oldestPendingAt ?? store.at),
                    })
                  : renderTemplate(copy('attention.lost.unknown'), {
                      'at': _when(store.at),
                    }),
            ),
          ),
        ),
      if (lost.isNotEmpty)
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: TextButton(
            key: const ValueKey('lost-acknowledge'),
            onPressed: () => ref.read(acknowledgeLostStoresProvider)(),
            child: Text(copy('attention.lost.ok')),
          ),
        ),
    ];
    final body = switch (ref.watch(needsAttentionProvider)) {
      AsyncData(value: final items)
          when items.isEmpty && lost.isEmpty && !restricted =>
        Center(
          child: Text(
            copy('attention.none'),
            key: const ValueKey('attention-none'),
          ),
        ),
      AsyncData(value: final items) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (restricted) const _BatteryCard(),
          ...lostCards,
          if (items.isNotEmpty) ...[
            if (lost.isNotEmpty || restricted) const SizedBox(height: 12),
            Text(copy('attention.explain')),
            const SizedBox(height: 12),
          ],
          for (final item in items)
            Card(
              key: ValueKey('attention-${item.id}'),
              child: ListTile(
                leading: const Icon(Icons.error_outline),
                title: Text(
                  copy(
                    'attention.type.'
                    '${_named.contains(item.type) ? item.type : 'other'}',
                  ),
                ),
                subtitle: Text(
                  [
                    renderTemplate(copy('attention.saved_at'), {
                      'at': _when(item.createdAt),
                    }),
                    if (item.reason case final String code)
                      renderTemplate(copy('attention.reason'), {'code': code}),
                  ].join('\n'),
                ),
              ),
            ),
        ],
      ),
      AsyncError() => Center(child: Text(copy('shell.unavailable'))),
      _ => const Center(child: CircularProgressIndicator()),
    };
    return Scaffold(
      appBar: PosHeader(
        title: copy('attention.title'),
        onBack: () => Navigator.of(context).pop(),
      ),
      body: body,
    );
  }
}

/// How to let the app send in the background (T5-02, docs/12 §9). Asked
/// again when the agent comes back from the phone's settings.
class _BatteryCard extends ConsumerStatefulWidget {
  const _BatteryCard();

  @override
  ConsumerState<_BatteryCard> createState() => _BatteryCardState();
}

class _BatteryCardState extends ConsumerState<_BatteryCard> {
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(
      onResume: () => ref.invalidate(powerStatusProvider),
    );
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(copyProvider);
    return Card(
      key: const ValueKey('attention-battery'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.battery_alert_outlined),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    copy('attention.battery.title'),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(copy('attention.battery.body')),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton(
                key: const ValueKey('attention-battery-open'),
                onPressed: () =>
                    ref.read(platformServicesProvider).power.openSettings(),
                child: Text(copy('attention.battery.open')),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
