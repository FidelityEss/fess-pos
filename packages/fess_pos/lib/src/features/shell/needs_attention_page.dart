import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show renderTemplate;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What the server couldn't take (docs/08 §8, T4-13): each item in plain
/// words, when it was saved and the server's reason. The data stays on the
/// phone until the server's resolution is pulled; an administrator
/// resolves it from the envelope inbox.
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
    final body = switch (ref.watch(needsAttentionProvider)) {
      AsyncData(value: final items) when items.isEmpty => Center(
        child: Text(
          copy('attention.none'),
          key: const ValueKey('attention-none'),
        ),
      ),
      AsyncData(value: final items) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(copy('attention.explain')),
          const SizedBox(height: 12),
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
