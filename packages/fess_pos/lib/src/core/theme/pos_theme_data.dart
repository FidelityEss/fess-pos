// Token values are passed even where they equal Flutter's defaults, so that
// a change to tokens.json always reaches the theme.
// ignore_for_file: avoid_redundant_argument_values

import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/contract/theme.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// The effective brand after overrides (docs/14 §2, docs/13 §5):
/// the host's [PosTheme], then remote config `theme.*`, then the design
/// tokens. Only these two values can be overridden (D-45).
@immutable
class PosBrand {
  const PosBrand({required this.primary, required this.fontFamily});

  factory PosBrand.resolve({PosTheme? host, BootstrapSnapshot? config}) =>
      PosBrand(
        primary:
            host?.primaryColor ??
            _parseHex(config?.themePrimaryColor) ??
            PosTokens.colorBrandPrimary,
        fontFamily: _family(
          host?.fontFamily ?? config?.themeFontFamily ?? PosTokens.fontFamily,
        ),
      );

  /// The bundled Montserrat is a package font, so Flutter knows it as
  /// `packages/fess_pos/Montserrat`. It never depends on, or clashes with, a
  /// font the host loads under the same name.
  static const String bundledFontFamily =
      'packages/fess_pos/${PosTokens.fontFamily}';

  final Color primary;

  /// The family as the theme names it: the bundled font for the token
  /// family, any other family (a host or config override) as given.
  final String fontFamily;

  static String _family(String name) =>
      name == PosTokens.fontFamily ? bundledFontFamily : name;

  static Color? _parseHex(String? hex) {
    if (hex == null || hex.length != 7 || !hex.startsWith('#')) return null;
    final rgb = int.tryParse(hex.substring(1), radix: 16);
    return rgb == null ? null : Color(0xFF000000 | rgb);
  }

  @override
  bool operator ==(Object other) =>
      other is PosBrand &&
      other.primary == primary &&
      other.fontFamily == fontFamily;

  @override
  int get hashCode => Object.hash(primary, fontFamily);
}

/// The module's own, scoped theme: the FESS look from the design tokens
/// (docs/14). It's applied with a `Theme` inside the entry point and never
/// touches the host's theme.
ThemeData buildPosThemeData(PosBrand brand) {
  TextStyle style(double size, FontWeight weight, Color color) => TextStyle(
    fontFamily: brand.fontFamily,
    fontFamilyFallback: PosTokens.fontFallback,
    fontSize: size,
    fontWeight: weight,
    color: color,
  );

  final controlShape = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(PosTokens.componentButtonRadius),
  );
  final buttonText = style(
    PosTokens.componentButtonTextSize,
    PosTokens.componentButtonTextWeight,
    PosTokens.componentButtonPrimaryText,
  );
  const buttonSize = Size(64, PosTokens.componentButtonHeight);
  OutlineInputBorder inputBorder(Color color, [double width = 1]) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(PosTokens.componentInputRadius),
        borderSide: BorderSide(color: color, width: width),
      );

  return ThemeData(
    useMaterial3: PosTokens.materialUseMaterial3,
    brightness: Brightness.light,
    primaryColor: brand.primary,
    colorScheme: ColorScheme.light(
      primary: brand.primary,
      onPrimary: PosTokens.colorTextOnPrimary,
      secondary: PosTokens.colorBrandGold,
      onSecondary: PosTokens.colorTextOnPrimary,
      error: PosTokens.colorStatusError,
      onError: PosTokens.colorTextOnPrimary,
      surface: PosTokens.colorBackgroundPage,
      onSurface: PosTokens.colorTextPrimary,
    ),
    scaffoldBackgroundColor: PosTokens.colorBackgroundPage,
    fontFamily: brand.fontFamily,
    fontFamilyFallback: PosTokens.fontFallback,
    dividerColor: PosTokens.colorLineDivider,
    textTheme: TextTheme(
      headlineSmall: style(
        PosTokens.typePhoneHeadlineSize,
        PosTokens.typePhoneHeadlineWeight,
        PosTokens.colorTextPrimary,
      ),
      titleLarge: style(
        PosTokens.typePhoneTitleLargeSize,
        PosTokens.typePhoneTitleLargeWeight,
        PosTokens.colorTextPrimary,
      ),
      titleMedium: style(
        PosTokens.typePhoneTitleSize,
        PosTokens.typePhoneTitleWeight,
        PosTokens.colorTextPrimary,
      ),
      bodyLarge: style(
        PosTokens.typePhoneBodyRegularSize,
        PosTokens.typePhoneBodyRegularWeight,
        PosTokens.colorTextBody,
      ),
      bodyMedium: style(
        PosTokens.typePhoneBodySize,
        PosTokens.typePhoneBodyWeight,
        PosTokens.colorTextBody,
      ),
      bodySmall: style(
        PosTokens.typePhoneCaptionSize,
        PosTokens.typePhoneCaptionWeight,
        PosTokens.colorTextBody,
      ),
      labelLarge: style(
        PosTokens.typePhoneButtonSize,
        PosTokens.typePhoneButtonWeight,
        PosTokens.colorTextPrimary,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: brand.primary,
      foregroundColor: PosTokens.componentHeaderTitleColor,
      elevation: 0,
      toolbarHeight: PosTokens.componentHeaderHeight,
      centerTitle: false,
      titleTextStyle: style(
        PosTokens.componentHeaderTitleSize,
        PosTokens.componentHeaderTitleWeight,
        PosTokens.componentHeaderTitleColor,
      ),
      // Applies only while a module page is showing (an AnnotatedRegion).
      systemOverlayStyle: SystemUiOverlayStyle.light.copyWith(
        statusBarColor: brand.primary,
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: brand.primary,
        foregroundColor: PosTokens.componentButtonPrimaryText,
        minimumSize: buttonSize,
        shape: controlShape,
        textStyle: buttonText,
        elevation: 0,
      ),
    ),
    // docs/14 §3: POS secondary buttons are outlined green, not white on
    // gold (≈2.4:1 contrast).
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: brand.primary,
        side: BorderSide(color: brand.primary),
        minimumSize: buttonSize,
        shape: controlShape,
        textStyle: buttonText,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: brand.primary),
    ),
    cardTheme: CardThemeData(
      color: PosTokens.componentCardBackground,
      elevation: 2,
      shadowColor: PosTokens.shadowCard.color,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PosTokens.componentCardRadius),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: inputBorder(PosTokens.componentInputBorder),
      enabledBorder: inputBorder(PosTokens.componentInputBorder),
      focusedBorder: inputBorder(brand.primary, 2),
      errorBorder: inputBorder(PosTokens.colorStatusError),
      focusedErrorBorder: inputBorder(PosTokens.colorStatusError, 2),
    ),
    bottomNavigationBarTheme: BottomNavigationBarThemeData(
      backgroundColor: PosTokens.componentBottomNavBackground,
      selectedItemColor: brand.primary,
      unselectedItemColor: PosTokens.componentBottomNavInactive,
    ),
  );
}
