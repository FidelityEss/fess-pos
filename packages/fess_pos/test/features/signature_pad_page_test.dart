import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/features/inspections/signature_pad_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';

/// Opens [page] over a blank screen; what it returns lands in the list.
Future<List<Object?>> _show(WidgetTester tester, SignaturePadPage page) async {
  final result = <Object?>[];
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        platformServicesProvider.overrideWithValue(fakePlatform()),
        activeDefinitionProvider.overrideWith((ref, key) => Stream.value(null)),
      ],
      child: MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async => result.add(
                await Navigator.of(
                  context,
                ).push<Object?>(
                  MaterialPageRoute<Object?>(builder: (_) => page),
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return result;
}

String _copy(String key) => BundledCopy.text(key);

final Finder _pad = find.byKey(const ValueKey('signature-pad'));
final Finder _done = find.byKey(const ValueKey('signature-done'));

bool _enabled(WidgetTester tester, Finder button) =>
    tester.widget<ButtonStyleButton>(button).onPressed != null;

void main() {
  testWidgets('who signs shows first, and Done waits for the least stroke '
      'length', (tester) async {
    final result = await _show(
      tester,
      const SignaturePadPage(
        title: 'Signature',
        signerName: 'Thandi Mokoena',
        signerDesignation: 'Owner',
        minStrokeLength: 200,
      ),
    );
    expect(find.text('Thandi Mokoena'), findsOneWidget);
    expect(find.text('Owner'), findsOneWidget);

    await tester.drag(_pad, const Offset(100, 0));
    await tester.pump();
    expect(find.text(_copy('signature.too_short')), findsOneWidget);
    expect(_enabled(tester, _done), isFalse);

    await tester.drag(_pad, const Offset(0, 180));
    await tester.pump();
    expect(_enabled(tester, _done), isTrue);
    // Rendering the PNG needs real async.
    await tester.runAsync(() async {
      await tester.tap(_done);
      await Future<void>.delayed(const Duration(milliseconds: 300));
    });
    await tester.pumpAndSettle();
    final capture = result.single! as SignatureCapture;
    expect(capture.strokes, hasLength(2));
    expect(capture.padWidth, greaterThan(0));
    expect(capture.width, (capture.padWidth! * 2).round());
  });

  testWidgets('a full pad takes no more, and Clear starts again', (
    tester,
  ) async {
    await _show(
      tester,
      const SignaturePadPage(title: 'Signature', maxPoints: 2),
    );
    await tester.drag(_pad, const Offset(100, 0));
    await tester.pump();
    expect(find.text(_copy('signature.full')), findsOneWidget);
    expect(_enabled(tester, _done), isTrue, reason: 'what was drawn stays');

    await tester.tap(find.byKey(const ValueKey('signature-clear')));
    await tester.pump();
    expect(find.text(_copy('inspection.signature_hint')), findsOneWidget);
    expect(_enabled(tester, _done), isFalse);
  });
}
