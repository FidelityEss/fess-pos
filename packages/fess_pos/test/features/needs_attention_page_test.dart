import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/sync/attention.dart';
import 'package:fess_pos/src/domain/sync/lost_store.dart';
import 'package:fess_pos/src/features/shell/needs_attention_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

String _copy(String key) => BundledCopy.text(key);

Future<void> _show(WidgetTester tester, List<AttentionItem> items) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        activeDefinitionProvider.overrideWith((ref, key) => Stream.value(null)),
        needsAttentionProvider.overrideWith((ref) => Stream.value(items)),
      ],
      child: const MaterialApp(home: NeedsAttentionPage()),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('what the server refused, in plain words, with its reason '
      '(T4-13)', (tester) async {
    await _show(tester, const [
      AttentionItem(
        id: 'env-1',
        type: 'submission',
        createdAt: '2026-09-14T10:00:00.000+02:00',
        reason: 'VALIDATION_FAILED',
      ),
      AttentionItem(
        id: 'env-2',
        type: 'something_new',
        createdAt: '2026-09-14T10:05:00.000+02:00',
      ),
    ]);
    expect(find.text(_copy('attention.explain')), findsOneWidget);
    expect(find.text(_copy('attention.type.submission')), findsOneWidget);
    expect(find.text(_copy('attention.type.other')), findsOneWidget);
    expect(find.textContaining('Reason: VALIDATION_FAILED'), findsOneWidget);
  });

  testWidgets('a store that could never be opened again, with work on it, '
      'is shown until the agent acknowledges it (T5-13)', (tester) async {
    var acknowledged = 0;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          activeDefinitionProvider.overrideWith(
            (ref, key) => Stream.value(null),
          ),
          needsAttentionProvider.overrideWith((ref) => Stream.value(const [])),
          lostStoresProvider.overrideWith(
            (ref) => Stream.value(const [
              LostStore(
                name: 'fess_pos-a',
                at: '2026-09-15T10:00:00Z',
                waiting: 2,
                oldestPendingAt: '2026-09-15T08:00:00Z',
              ),
            ]),
          ),
          acknowledgeLostStoresProvider.overrideWithValue(
            () async => acknowledged++,
          ),
        ],
        child: const MaterialApp(home: NeedsAttentionPage()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(_copy('attention.lost.title')), findsOneWidget);
    expect(find.textContaining('2 items saved since'), findsOneWidget);
    expect(find.byKey(const ValueKey('attention-none')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('lost-acknowledge')));
    expect(acknowledged, 1);
  });

  testWidgets('nothing waiting: it says so', (tester) async {
    await _show(tester, const []);
    expect(find.byKey(const ValueKey('attention-none')), findsOneWidget);
  });

  test("the reason is the receipt's error code, else the last error", () {
    expect(attentionReason('{"error_code":"CONFLICT"}', 'X'), 'CONFLICT');
    expect(
      attentionReason('{"error":{"code":"VALIDATION_FAILED"}}', null),
      'VALIDATION_FAILED',
    );
    expect(
      attentionReason('not json', 'STORED_HASH_MISMATCH'),
      'STORED_HASH_MISMATCH',
    );
    expect(attentionReason(null, ''), isNull);
  });
}
