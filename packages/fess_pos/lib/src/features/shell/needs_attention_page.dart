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
/// them, any store that could never be opened again with work on it
/// (T5-13): what was lost as far as the phone knows, until the agent
/// acknowledges it.
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
      AsyncData(value: final items) when items.isEmpty && lost.isEmpty =>
        Center(
          child: Text(
            copy('attention.none'),
            key: const ValueKey('attention-none'),
          ),
        ),
      AsyncData(value: final items) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ...lostCards,
          if (items.isNotEmpty) ...[
            if (lost.isNotEmpty) const SizedBox(height: 12),
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
