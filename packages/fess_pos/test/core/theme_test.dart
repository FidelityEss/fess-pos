@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
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
    test('tokens by default', () {
      expect(
        PosBrand.resolve(),
        const PosBrand(
          primary: PosTokens.colorBrandPrimary,
          fontFamily: PosTokens.fontFamily,
        ),
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
    expect(theme.textTheme.bodyMedium!.fontFamily, 'Montserrat');
    expect(theme.textTheme.bodyMedium!.fontWeight, FontWeight.w600);
  });
}
