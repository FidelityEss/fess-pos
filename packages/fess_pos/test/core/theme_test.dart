@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/core/theme/pos_tones.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../tool/generate_tokens.dart';

/// Source text modulo formatting.
String _normalise(String s) => s
    .replaceAll(RegExp(r'\s+'), '')
    .replaceAll(',)', ')')
    .replaceAll(',]', ']');

void main() {
  test('tokens.g.dart is up to date with schema/design/tokens.json', () {
    final tokens =
        jsonDecode(File('../../schema/design/tokens.json').readAsStringSync())
            as Map<String, Object?>;
    final committed = File(
      'lib/src/core/theme/tokens.g.dart',
    ).readAsStringSync();
    expect(
      _normalise(committed),
      _normalise(generateTokensDart(tokens)),
      reason: 'run: dart run tool/generate_tokens.dart',
    );
  });

  test('the tokens carry the FESS look (docs/14)', () {
    expect(PosTokens.colorBrandPrimary, const Color(0xFF006B55));
    expect(PosTokens.colorBrandGold, const Color(0xFFB79E67));
    expect(PosTokens.fontFamily, 'Montserrat');
    expect(PosTokens.componentHeaderHeight, 60);
    expect(PosTokens.componentButtonHeight, 45);
    expect(PosTokens.componentButtonRadius, PosTokens.radiusControl);
    expect(PosTokens.componentCardRadius, 12);
    expect(PosTokens.shadowCard.color, const Color(0x1A000000));
  });

  group('PosBrand.resolve: host, then remote config, then tokens', () {
    test('tokens by default, with the bundled Montserrat', () {
      expect(
        PosBrand.resolve(),
        const PosBrand(
          primary: PosTokens.colorBrandPrimary,
          fontFamily: PosBrand.bundledFontFamily,
        ),
      );
      expect(PosBrand.bundledFontFamily, 'packages/fess_pos/Montserrat');
    });

    test('a host naming Montserrat still gets the bundled font', () {
      expect(
        PosBrand.resolve(
          host: const PosTheme(fontFamily: 'Montserrat'),
        ).fontFamily,
        PosBrand.bundledFontFamily,
      );
    });

    test('remote config theme.* overrides the tokens', () {
      final brand = PosBrand.resolve(
        config: BootstrapSnapshot.fromResolvedConfig(const {
          'theme': {'primary_color': '#112233', 'font_family': 'Inter'},
        }),
      );
      expect(brand.primary, const Color(0xFF112233));
      expect(brand.fontFamily, 'Inter');
    });

    test("the host's PosTheme overrides remote config", () {
      final brand = PosBrand.resolve(
        host: const PosTheme(primaryColor: Color(0xFF445566)),
        config: BootstrapSnapshot.fromResolvedConfig(const {
          'theme': {'primary_color': '#112233', 'font_family': 'Inter'},
        }),
      );
      expect(brand.primary, const Color(0xFF445566));
      expect(brand.fontFamily, 'Inter');
    });
  });

  test('the theme applies the component specs', () {
    final theme = buildPosThemeData(PosBrand.resolve());
    expect(theme.useMaterial3, PosTokens.materialUseMaterial3);
    expect(theme.colorScheme.primary, PosTokens.colorBrandPrimary);
    expect(theme.appBarTheme.toolbarHeight, 60);
    expect(theme.appBarTheme.backgroundColor, PosTokens.colorBrandPrimary);
    final button = theme.elevatedButtonTheme.style!;
    expect(button.minimumSize!.resolve({})!.height, 45);
    final shape = button.shape!.resolve({})! as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(5));
    expect(
      theme.textTheme.bodyMedium!.fontFamily,
      'packages/fess_pos/Montserrat',
    );
    expect(theme.textTheme.bodyMedium!.fontWeight, FontWeight.w600);
  });

  test('white and flat (D-97): no shadows; FESS buttons, fields and bar', () {
    final theme = buildPosThemeData(PosBrand.resolve());
    const white = Color(0xFFFFFFFF);
    expect(theme.scaffoldBackgroundColor, white);
    expect(theme.canvasColor, white);
    expect(theme.cardTheme.elevation, 0);
    expect(
      (theme.cardTheme.shape! as RoundedRectangleBorder).side.color,
      PosTokens.colorLineBorder,
    );
    expect(theme.appBarTheme.elevation, 0);
    expect(theme.appBarTheme.centerTitle, isTrue);
    expect(theme.dialogTheme.elevation, 0);

    final primary = theme.filledButtonTheme.style!;
    expect(primary.backgroundColor!.resolve({}), PosTokens.colorBrandPrimary);
    expect(primary.foregroundColor!.resolve({}), white);
    expect(primary.elevation!.resolve({}), 0);
    expect(primary.minimumSize!.resolve({})!.height, 45);

    // The secondary button: white, a 2 px gold outline, dark text.
    final outline = theme.outlinedButtonTheme.style!;
    final side = outline.side!.resolve({})!;
    expect(side.color, PosTokens.colorBrandGold);
    expect(side.width, 2);
    expect(outline.backgroundColor!.resolve({}), white);
    expect(outline.foregroundColor!.resolve({}), PosTokens.colorTextPrimary);

    final input = theme.inputDecorationTheme;
    expect(input.filled, isTrue);
    expect(input.fillColor, white);
    final border = input.enabledBorder! as OutlineInputBorder;
    expect(border.borderRadius, BorderRadius.circular(8));
    expect(border.borderSide.width, 2);
    expect(border.borderSide.color, PosTokens.colorLineDivider);
    expect(input.prefixIconColor, PosTokens.colorTextMuted);

    final nav = theme.bottomNavigationBarTheme;
    expect(nav.backgroundColor, white);
    expect(nav.elevation, 0);
    expect(nav.selectedItemColor, PosTokens.colorBrandPrimary);
    expect(nav.unselectedItemColor, PosTokens.colorTextBody);
  });

  test("remote config's primary colour still reaches the header, buttons "
      'and the bar (D-45)', () {
    final theme = buildPosThemeData(
      PosBrand.resolve(
        config: BootstrapSnapshot.fromResolvedConfig(const {
          'theme': {'primary_color': '#112233'},
        }),
      ),
    );
    const primary = Color(0xFF112233);
    expect(theme.appBarTheme.backgroundColor, primary);
    final button = theme.filledButtonTheme.style!;
    expect(button.backgroundColor!.resolve({}), primary);
    expect(theme.bottomNavigationBarTheme.selectedItemColor, primary);
    expect(theme.inputDecorationTheme.focusedBorder!.borderSide.color, primary);
  });

  test('text reads at 4.5:1 or better: every tone on its tint, and the '
      'buttons and bar (docs/14 §3)', () {
    double contrast(Color a, Color b) {
      final la = a.computeLuminance();
      final lb = b.computeLuminance();
      return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
    }

    for (final tone in PosTone.values) {
      final colors = posToneColors(tone);
      expect(
        contrast(colors.foreground, colors.background),
        greaterThanOrEqualTo(4.5),
        reason: '$tone',
      );
    }
    const white = Color(0xFFFFFFFF);
    expect(contrast(white, PosTokens.colorBrandPrimary), greaterThan(4.5));
    expect(
      contrast(PosTokens.componentButtonOutlineText, white),
      greaterThan(4.5),
    );
    expect(
      contrast(
        PosTokens.componentButtonDangerText,
        PosTokens.componentButtonDangerBackground,
      ),
      greaterThan(4.5),
    );
    expect(
      contrast(PosTokens.componentBottomNavInactiveItem, white),
      greaterThan(4.5),
    );
  });

  testWidgets('the header: a centred title and an outlined back button', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildPosThemeData(PosBrand.resolve()),
        home: Scaffold(
          appBar: PosHeader(title: 'Leads', onBack: () {}),
        ),
      ),
    );
    final ring = tester.widget<Container>(
      find.byKey(const ValueKey('pos-back-ring')),
    );
    final decoration = ring.decoration! as BoxDecoration;
    expect(decoration.color, isNull, reason: 'a ring, not a filled circle');
    expect(decoration.border!.top.color, PosTokens.componentHeaderBackColor);
    final width = tester.getSize(find.byType(Scaffold)).width;
    expect(tester.getCenter(find.text('Leads')).dx, closeTo(width / 2, 1));
  });

  test('Montserrat is bundled for every weight the tokens use, with its '
      'licence', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    expect(pubspec, contains('- family: ${PosTokens.fontFamily}'));
    final used = <int>{
      for (final w in [
        PosTokens.typePhoneHeadlineWeight,
        PosTokens.typePhoneTitleLargeWeight,
        PosTokens.typePhoneTitleWeight,
        PosTokens.typePhoneBodyWeight,
        PosTokens.typePhoneBodyRegularWeight,
        PosTokens.typePhoneCaptionWeight,
        PosTokens.typePhoneButtonWeight,
        PosTokens.componentListRowTitleWeight,
        PosTokens.componentListRowDescriptionWeight,
      ])
        w.value,
    };
    for (final weight in used) {
      expect(pubspec, contains('weight: $weight'), reason: 'weight $weight');
    }
    final assets = RegExp(
      r'asset: (assets/fonts/\S+\.ttf)',
    ).allMatches(pubspec).map((m) => m.group(1)!);
    expect(assets, isNotEmpty);
    for (final asset in assets) {
      expect(File(asset).existsSync(), isTrue, reason: asset);
    }
    expect(File('assets/fonts/montserrat/OFL.txt').existsSync(), isTrue);
  });
}
