// The home card's status chip fits on one line on a 360-point-wide phone,
// measured with the bundled Montserrat rather than the test font (whose
// glyphs are all 1 em wide). T3-34 follow-up, docs/17 §3.
@TestOn('vm')
library;

import 'dart:io';

import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/renderer/render_context.dart';
import 'package:fess_pos/src/renderer/view_renderer.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _loadMontserrat() async {
  final loader = FontLoader('packages/fess_pos/Montserrat');
  for (final w in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    final bytes = File(
      'assets/fonts/montserrat/Montserrat-$w.ttf',
    ).readAsBytesSync();
    loader.addFont(Future.value(ByteData.sublistView(bytes)));
  }
  await loader.load();
}

/// The home card on a 360 × 800 phone, with a long name, and its chip.
Future<RenderParagraph> _homeChip(
  WidgetTester tester,
  String state,
  String key,
) async {
  tester.view
    ..physicalSize = const Size(360, 800)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildPosThemeData(PosBrand.resolve()),
      // ViewRenderer adds the page's side margins (its gutter), as on home.
      home: Scaffold(
        body: ViewRenderer(
          items: const [
            {'type': 'agent_card_summary'},
          ],
          context: RenderContext(
            data: {
              'agent': const {
                'first_name': 'Nomvula',
                'last_name': 'Mahlangu-Dlamini',
                'employee_number': 'SEED-AG01',
                'role': 'pos_agent',
              },
              'card': {'state': state},
            },
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return tester.renderObject<RenderParagraph>(
    find.text(BundledCopy.text(key)),
  );
}

/// One line: its height is what the text needs with no width limit.
bool _oneLine(RenderParagraph p) =>
    p.size.height <= p.getMaxIntrinsicHeight(double.infinity) + 0.5;

void main() {
  setUpAll(_loadMontserrat);

  for (final (state, key) in [
    ('valid', 'card.status_active_short'),
    ('expired', 'card.status_expired'),
    ('missing', 'card.status_pending'),
  ]) {
    testWidgets('the home chip ($state) fits one line on a 360-point phone', (
      tester,
    ) async {
      final chip = await _homeChip(tester, state, key);
      expect(
        _oneLine(chip),
        isTrue,
        reason:
            '"${BundledCopy.text(key)}" needs '
            '${chip.getMaxIntrinsicWidth(double.infinity).round()} points; '
            'the chip has ${chip.constraints.maxWidth.round()}',
      );
    });
  }
}
