import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/renderer/cards.dart';
import 'package:fess_pos/src/renderer/render_context.dart';
import 'package:fess_pos/src/renderer/view_renderer.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const Map<String, Object?> _agent = {
  'first_name': 'Gugu',
  'last_name': 'Dlamini',
  'employee_number': 'SEED-AG01',
  'role': 'pos_agent',
};

const String _qr = 'https://pos.test/v1/public/verify/abc';

Future<void> _render(
  WidgetTester tester,
  List<Object?> items,
  Map<String, Object?> data, {
  void Function(Map<String, Object?> target)? onNavigate,
}) => tester.pumpWidget(
  MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView(
        child: ViewRenderer(
          items: items,
          context: RenderContext(
            data: data,
            onNavigate: onNavigate == null ? null : (t, _) => onNavigate(t),
          ),
        ),
      ),
    ),
  ),
);

String _copy(String key) => BundledCopy.text(key);

void main() {
  testWidgets('a valid agent card: who, their status, and the QR', (
    tester,
  ) async {
    await _render(
      tester,
      const [
        {'type': 'agent_card'},
      ],
      {
        'agent': _agent,
        'card': {
          'state': 'valid',
          'qr': _qr,
          'valid_to': '2026-09-15T10:00:00Z',
        },
      },
    );
    expect(find.text('Gugu Dlamini'), findsOneWidget);
    expect(find.text('Employee no. SEED-AG01'), findsOneWidget);
    expect(find.text('POS agent'), findsOneWidget);
    expect(find.text('GD'), findsOneWidget, reason: 'initials without a photo');
    expect(find.text(_copy('card.status_active')), findsOneWidget);
    expect(tester.widget<QrCodeView>(find.byType(QrCodeView)).data, _qr);
    expect(find.textContaining('Valid until 15 Sep 2026'), findsOneWidget);
  });

  testWidgets('an expired job card shows no QR and says why', (tester) async {
    await _render(
      tester,
      const [
        {'type': 'job_card'},
      ],
      {
        'agent': _agent,
        'job': {
          'reference': 'POS-2026-000031',
          'bank': {'name': 'Ubuntu Bank'},
        },
        'job_card': {'state': 'expired', 'valid_to': '2026-09-13T10:00:00Z'},
      },
    );
    expect(find.text(_copy('card.job_heading')), findsOneWidget);
    expect(find.text('POS-2026-000031'), findsOneWidget);
    expect(find.text('Ubuntu Bank'), findsOneWidget);
    expect(find.text(_copy('card.status_expired')), findsOneWidget);
    expect(find.text(_copy('card.expired')), findsOneWidget);
    expect(find.byType(QrCodeView), findsNothing);
  });

  testWidgets('before the first pull: not issued yet', (tester) async {
    await _render(
      tester,
      const [
        {'type': 'agent_card'},
      ],
      {'agent': _agent},
    );
    expect(find.text(_copy('card.status_pending')), findsOneWidget);
    expect(find.text(_copy('card.not_ready')), findsOneWidget);
  });

  testWidgets("the item's switches hide parts of the card", (tester) async {
    await _render(
      tester,
      const [
        {
          'type': 'agent_card',
          'show_qr': false,
          'show_photo': false,
          'show_status': false,
        },
      ],
      {
        'agent': _agent,
        'card': {'state': 'valid', 'qr': _qr},
      },
    );
    expect(find.byType(QrCodeView), findsNothing);
    expect(find.byType(AgentAvatar), findsNothing);
    expect(find.byType(CardStatus), findsNothing);
    expect(find.text('Gugu Dlamini'), findsOneWidget);
  });

  testWidgets('the home summary opens the card', (tester) async {
    final opened = <Map<String, Object?>>[];
    await _render(
      tester,
      const [
        {
          'type': 'agent_card_summary',
          'on_tap': {'page': 'agent_card'},
        },
      ],
      {
        'agent': _agent,
        'card': {'state': 'valid', 'qr': _qr},
      },
      onNavigate: opened.add,
    );
    expect(find.text('Gugu Dlamini'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('agent-card-summary')));
    expect(opened, [
      {'page': 'agent_card'},
    ]);
  });
}
