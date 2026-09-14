import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/cards/cards.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/renderer/render_context.dart';
import 'package:fess_pos/src/renderer/view_renderer.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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

T? _data<T>(AsyncValue<T> value) => switch (value) {
  AsyncData(:final value) => value,
  _ => null,
};

/// The agent's authorisation card (B2.6): the `agent_card` view in force,
/// or the bundled one, with the card the last pull issued. It works
/// offline until the card expires.
class AgentCardPage extends ConsumerWidget {
  const AgentCardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final copy = ref.watch(copyProvider);
    final agent = _data(ref.watch(agentProvider));
    final card = _data(ref.watch(agentCardProvider));
    return Scaffold(
      appBar: PosHeader(
        title: copy('card.title'),
        onBack: () => Navigator.of(context).pop(),
      ),
      body: ListView(
        children: [
          ViewRenderer(
            items: viewItems(ref, 'agent_card'),
            context: RenderContext(
              data: {
                'agent': agent ?? const <String, Object?>{},
                'card': cardData(
                  card,
                  now: DateTime.now(),
                  url: (token) => ref.read(verifyUrlProvider)(token),
                ),
              },
              copy: copy,
              today: todayIso(),
            ),
          ),
        ],
      ),
    );
  }
}
