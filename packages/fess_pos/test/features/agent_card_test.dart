import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/cards/cards.dart';
import 'package:fess_pos/src/features/app/pos_router.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:fess_pos/src/renderer/cards.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

final String _token = 'f' * 32;

Widget _home(CardToken? card) => ProviderScope(
  overrides: [
    myJobsProvider.overrideWith((ref) => Stream.value(const [])),
    agentProvider.overrideWith(
      (ref) => Stream.value({
        'first_name': 'Gugu',
        'last_name': 'Dlamini',
        'employee_number': 'SEED-AG01',
        'role': 'pos_agent',
      }),
    ),
    agentTotalsProvider.overrideWith((ref) => Stream.value(null)),
    activeDefinitionProvider.overrideWith((ref, key) => Stream.value(null)),
    agentCardProvider.overrideWith((ref) => Stream.value(card)),
    verifyUrlProvider.overrideWithValue(
      (token) => Uri.parse('https://pos.test/v1/public/verify/$token'),
    ),
  ],
  child: const MaterialApp(home: PosRouter()),
);

String _copy(String key) => BundledCopy.text(key);

void main() {
  testWidgets('from the home page to the card, with its QR', (tester) async {
    await tester.pumpWidget(
      _home(
        CardToken(
          token: _token,
          validTo: DateTime.now().add(const Duration(hours: 20)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    // Home: the short chip, which fits one line (card_chip_fit_test.dart).
    expect(find.text(_copy('card.status_active_short')), findsOneWidget);
    expect(find.text(_copy('card.status_active')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('agent-card-summary')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('page-agent_card')), findsOneWidget);
    expect(find.text(_copy('card.title')), findsOneWidget);
    // The card page keeps the full wording.
    expect(find.text(_copy('card.status_active')), findsOneWidget);
    expect(
      tester.widget<QrCodeView>(find.byType(QrCodeView)).data,
      'https://pos.test/v1/public/verify/$_token',
    );
  });

  testWidgets('an expired card shows no QR', (tester) async {
    await tester.pumpWidget(
      _home(
        CardToken(
          token: _token,
          validTo: DateTime.now().subtract(const Duration(minutes: 1)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('agent-card-summary')));
    await tester.pumpAndSettle();
    expect(find.text(_copy('card.expired')), findsOneWidget);
    expect(find.byType(QrCodeView), findsNothing);
  });

  test('card data: the QR only while the card is valid', () {
    Uri url(String t) => Uri.parse('https://pos.test/v1/public/verify/$t');
    final now = DateTime.utc(2026, 9, 14, 10);
    expect(cardData(null, now: now, url: url), {'state': 'missing'});
    final card = CardToken(token: _token, validTo: DateTime.utc(2026, 9, 15));
    expect(cardData(card, now: now, url: url), {
      'state': 'valid',
      'valid_to': '2026-09-15T00:00:00.000Z',
      'qr': 'https://pos.test/v1/public/verify/$_token',
    });
    expect(
      cardData(card, now: DateTime.utc(2026, 9, 16), url: url)['state'],
      'expired',
    );
  });
}
