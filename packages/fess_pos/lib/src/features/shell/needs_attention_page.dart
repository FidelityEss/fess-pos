import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/theme/pos_tones.dart';
import 'package:fess_pos/src/core/theme/pos_widgets.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
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
/// until the agent acknowledges it. Items are flat rows (D-97).
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

  static const double _gutter = PosTokens.componentPagePaddingX;

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
    final problem = posToneColors(PosTone.danger).foreground;
    final lostRows = [
      if (lost.isNotEmpty) const Divider(height: 1, thickness: 1),
      for (final store in lost)
        PosListRow(
          key: ValueKey('lost-${store.name}'),
          icon: Icons.report_outlined,
          iconColor: problem,
          title: copy('attention.lost.title'),
          description: store.outcome == LostStoreOutcome.unsentUnrecoverable
              ? renderTemplate(copy('attention.lost.unsent'), {
                  'count': store.waiting,
                  'at': _when(store.oldestPendingAt ?? store.at),
                })
              : renderTemplate(copy('attention.lost.unknown'), {
                  'at': _when(store.at),
                }),
        ),
      if (lost.isNotEmpty)
        Padding(
          padding: const EdgeInsets.fromLTRB(_gutter, 16, _gutter, 8),
          child: OutlinedButton(
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
          child: Padding(
            padding: const EdgeInsets.all(_gutter),
            child: Text(
              copy('attention.none'),
              key: const ValueKey('attention-none'),
              textAlign: TextAlign.center,
            ),
          ),
        ),
      AsyncData(value: final items) => ListView(
        padding: const EdgeInsets.symmetric(vertical: 16),
        children: [
          if (restricted) const _BatteryCard(),
          ...lostRows,
          if (items.isNotEmpty) ...[
            Padding(
              padding: EdgeInsets.fromLTRB(
                _gutter,
                lost.isNotEmpty ? 16 : 0,
                _gutter,
                16,
              ),
              child: Text(copy('attention.explain')),
            ),
            const Divider(height: 1, thickness: 1),
          ],
          for (final item in items)
            PosListRow(
              key: ValueKey('attention-${item.id}'),
              icon: Icons.error_outline,
              iconColor: problem,
              title: copy(
                'attention.type.'
                '${_named.contains(item.type) ? item.type : 'other'}',
              ),
              description: [
                renderTemplate(copy('attention.saved_at'), {
                  'at': _when(item.createdAt),
                }),
                if (item.reason case final String code)
                  renderTemplate(copy('attention.reason'), {'code': code}),
              ].join('\n'),
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
/// again when the agent comes back from the phone's settings. A box, since
/// it carries a button.
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
    final tone = posToneColors(PosTone.warning);
    return PosBox(
      key: const ValueKey('attention-battery'),
      margin: const EdgeInsets.fromLTRB(
        NeedsAttentionPage._gutter,
        0,
        NeedsAttentionPage._gutter,
        16,
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: tone.background,
                  shape: BoxShape.circle,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(8),
                  child: Icon(
                    Icons.battery_alert_outlined,
                    size: 22,
                    color: tone.foreground,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  copy('attention.battery.title'),
                  style: posRowTitleStyle(context).copyWith(fontSize: 16),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(copy('attention.battery.body')),
          const SizedBox(height: 16),
          FilledButton.icon(
            key: const ValueKey('attention-battery-open'),
            onPressed: () =>
                ref.read(platformServicesProvider).power.openSettings(),
            icon: const Icon(Icons.settings_outlined),
            label: Text(copy('attention.battery.open')),
          ),
        ],
      ),
    );
  }
}
