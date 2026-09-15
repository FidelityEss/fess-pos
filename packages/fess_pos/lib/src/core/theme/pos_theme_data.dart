// Token values are passed even where they equal Flutter's defaults, so that
// a change to tokens.json always reaches the theme.
// ignore_for_file: avoid_redundant_argument_values

import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/contract/theme.dart';
import 'package:fess_pos/src/core/theme/pos_tones.dart';
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
/// (docs/14, D-97). White pages, flat components with no shadow anywhere,
/// hairlines and light borders. It's applied with a `Theme` inside the
/// entry point and never touches the host's theme.
ThemeData buildPosThemeData(PosBrand brand) {
  TextStyle style(double size, FontWeight weight, Color color) => TextStyle(
    fontFamily: brand.fontFamily,
    fontFamilyFallback: PosTokens.fontFallback,
    fontSize: size,
    fontWeight: weight,
    color: color,
  );

  final primary = brand.primary;
  WidgetStateProperty<T> enabledOr<T>(T enabled, T disabled) =>
      WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.disabled) ? disabled : enabled,
      );
  WidgetStateProperty<T?> whenSelected<T>(T selected) =>
      WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected) ? selected : null,
      );

  final controlShape = WidgetStatePropertyAll<OutlinedBorder>(
    RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(PosTokens.componentButtonRadius),
    ),
  );
  final buttonText = WidgetStatePropertyAll(
    style(
      PosTokens.componentButtonTextSize,
      PosTokens.componentButtonTextWeight,
      PosTokens.componentButtonPrimaryText,
    ),
  );
  const buttonSize = WidgetStatePropertyAll(
    Size(64, PosTokens.componentButtonHeight),
  );
  const buttonPadding = WidgetStatePropertyAll(
    EdgeInsets.symmetric(horizontal: 16),
  );
  const flat = WidgetStatePropertyAll<double>(0);
  const noShadow = WidgetStatePropertyAll(Colors.transparent);
  const buttonIcon = WidgetStatePropertyAll(PosTokens.componentButtonIconSize);

  // Primary: green with white text, 5 px corners, 45 px high (FESS's
  // FFButton), an optional leading icon.
  final primaryForeground = enabledOr(
    PosTokens.componentButtonPrimaryText,
    PosTokens.componentButtonDisabledText,
  );
  final primaryButton = ButtonStyle(
    backgroundColor: enabledOr(
      primary,
      PosTokens.componentButtonDisabledBackground,
    ),
    foregroundColor: primaryForeground,
    iconColor: primaryForeground,
    overlayColor: WidgetStatePropertyAll(
      PosTokens.componentButtonPrimaryText.withValues(alpha: 0.12),
    ),
    elevation: flat,
    shadowColor: noShadow,
    minimumSize: buttonSize,
    padding: buttonPadding,
    shape: controlShape,
    textStyle: buttonText,
    iconSize: buttonIcon,
  );

  // Secondary: white with a gold outline and dark text, as FESS's "Reset
  // Passcode" (docs/14 §3: never white text on gold).
  final outlineForeground = enabledOr(
    PosTokens.componentButtonOutlineText,
    PosTokens.componentButtonDisabledText,
  );
  final outlineButton = ButtonStyle(
    backgroundColor: const WidgetStatePropertyAll(
      PosTokens.componentButtonOutlineBackground,
    ),
    foregroundColor: outlineForeground,
    iconColor: outlineForeground,
    overlayColor: WidgetStatePropertyAll(
      posTint(PosTokens.componentButtonOutlineBorder, 0.16),
    ),
    side: enabledOr(
      const BorderSide(
        color: PosTokens.componentButtonOutlineBorder,
        width: PosTokens.componentButtonOutlineBorderWidth,
      ),
      const BorderSide(
        color: PosTokens.componentButtonDisabledBackground,
        width: PosTokens.componentButtonOutlineBorderWidth,
      ),
    ),
    elevation: flat,
    shadowColor: noShadow,
    minimumSize: buttonSize,
    padding: buttonPadding,
    shape: controlShape,
    textStyle: buttonText,
    iconSize: buttonIcon,
  );

  // FESS's Account Recovery fields: white, a 2 px light grey border, 8 px
  // corners, a grey leading icon; the border turns green with focus.
  OutlineInputBorder inputBorder(Color color) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(PosTokens.componentInputRadius),
    borderSide: BorderSide(
      color: color,
      width: PosTokens.componentInputBorderWidth,
    ),
  );

  final bodySmall = style(
    PosTokens.typePhoneCaptionSize,
    PosTokens.typePhoneCaptionWeight,
    PosTokens.colorTextBody,
  );

  return ThemeData(
    useMaterial3: PosTokens.materialUseMaterial3,
    brightness: Brightness.light,
    primaryColor: primary,
    // Containers are light tints with dark text of the same family, so
    // anything drawn from the scheme stays readable (docs/14 §3).
    colorScheme: ColorScheme.light(
      primary: primary,
      onPrimary: PosTokens.colorTextOnPrimary,
      primaryContainer: posTint(primary),
      onPrimaryContainer: primary,
      secondary: PosTokens.colorBrandGold,
      onSecondary: PosTokens.colorTextOnPrimary,
      secondaryContainer: posTint(PosTokens.colorBrandGold),
      onSecondaryContainer: PosTokens.colorBrandGoldTextStrong,
      tertiary: PosTokens.colorStatusWarning,
      onTertiary: PosTokens.colorStatusWarningText,
      tertiaryContainer: posTint(PosTokens.colorStatusWarning),
      onTertiaryContainer: PosTokens.colorStatusWarningText,
      // Error text on white must read (≈5.9:1); FESS's red stays for input
      // borders below.
      error: PosTokens.colorStatusErrorText,
      onError: PosTokens.colorTextOnPrimary,
      errorContainer: posTint(PosTokens.colorStatusError),
      onErrorContainer: PosTokens.colorStatusErrorText,
      surface: PosTokens.componentPageBackground,
      onSurface: PosTokens.colorTextPrimary,
      onSurfaceVariant: PosTokens.colorTextBody,
      surfaceContainerHighest: PosTokens.colorBackgroundSubtle,
      outline: PosTokens.colorLineBorder,
      outlineVariant: PosTokens.colorLineDivider,
    ),
    scaffoldBackgroundColor: PosTokens.componentPageBackground,
    canvasColor: PosTokens.componentPageBackground,
    fontFamily: brand.fontFamily,
    fontFamilyFallback: PosTokens.fontFallback,
    dividerColor: PosTokens.colorLineDivider,
    dividerTheme: const DividerThemeData(
      color: PosTokens.colorLineDivider,
      thickness: 1,
    ),
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
      titleSmall: style(
        PosTokens.typePhoneBodySize,
        PosTokens.typePhoneBodyWeight,
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
      bodySmall: bodySmall,
      labelLarge: style(
        PosTokens.typePhoneButtonSize,
        PosTokens.typePhoneButtonWeight,
        PosTokens.colorTextPrimary,
      ),
      labelMedium: style(
        PosTokens.componentChipTextSize,
        PosTokens.componentChipTextWeight,
        PosTokens.colorTextBody,
      ),
      labelSmall: style(
        PosTokens.componentChipTextSize,
        PosTokens.componentChipTextWeight,
        PosTokens.colorTextBody,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: primary,
      foregroundColor: PosTokens.componentHeaderTitleColor,
      elevation: 0,
      scrolledUnderElevation: 0,
      shadowColor: Colors.transparent,
      toolbarHeight: PosTokens.componentHeaderHeight,
      centerTitle: PosTokens.componentHeaderTitleAlign == 'center',
      titleTextStyle: style(
        PosTokens.componentHeaderTitleSize,
        PosTokens.componentHeaderTitleWeight,
        PosTokens.componentHeaderTitleColor,
      ),
      // Applies only while a module page is showing (an AnnotatedRegion).
      systemOverlayStyle: SystemUiOverlayStyle.light.copyWith(
        statusBarColor: primary,
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(style: primaryButton),
    filledButtonTheme: FilledButtonThemeData(style: primaryButton),
    outlinedButtonTheme: OutlinedButtonThemeData(style: outlineButton),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: primary,
        textStyle: buttonText.value,
        shape: controlShape.value,
      ),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: whenSelected(posTint(primary)),
        foregroundColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? primary
              : PosTokens.colorTextPrimary,
        ),
        side: const WidgetStatePropertyAll(
          BorderSide(color: PosTokens.colorLineBorder),
        ),
        shape: controlShape,
        textStyle: WidgetStatePropertyAll(
          style(14, FontWeight.w600, PosTokens.colorTextPrimary),
        ),
      ),
    ),
    // Flat: a box only where one is needed, with a light border.
    cardTheme: CardThemeData(
      color: PosTokens.componentCardBackground,
      elevation: PosTokens.componentCardElevation,
      shadowColor: Colors.transparent,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PosTokens.componentCardRadius),
        side: const BorderSide(
          color: PosTokens.componentCardBorder,
          width: PosTokens.componentCardBorderWidth,
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: PosTokens.componentInputBackground,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: PosTokens.componentInputPaddingX,
        vertical: PosTokens.componentInputPaddingY,
      ),
      hintStyle: style(14, FontWeight.w500, PosTokens.componentInputHint),
      labelStyle: style(14, FontWeight.w500, PosTokens.componentInputHint),
      floatingLabelStyle: style(14, FontWeight.w600, primary),
      helperStyle: bodySmall,
      errorStyle: style(12, FontWeight.w500, PosTokens.colorStatusErrorText),
      suffixStyle: style(14, FontWeight.w500, PosTokens.colorTextBody),
      prefixIconColor: PosTokens.componentInputIcon,
      suffixIconColor: PosTokens.componentInputIcon,
      border: inputBorder(PosTokens.componentInputBorder),
      enabledBorder: inputBorder(PosTokens.componentInputBorder),
      disabledBorder: inputBorder(PosTokens.componentInputBorder),
      focusedBorder: inputBorder(primary),
      errorBorder: inputBorder(PosTokens.colorStatusError),
      focusedErrorBorder: inputBorder(PosTokens.colorStatusError),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: whenSelected(primary),
      checkColor: const WidgetStatePropertyAll(PosTokens.colorTextOnPrimary),
    ),
    radioTheme: RadioThemeData(fillColor: whenSelected(primary)),
    switchTheme: SwitchThemeData(
      thumbColor: whenSelected(primary),
      trackColor: whenSelected(posTint(primary, 0.5)),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: PosTokens.componentPageBackground,
      selectedColor: posTint(primary),
      disabledColor: PosTokens.colorBackgroundSubtle,
      checkmarkColor: primary,
      side: const BorderSide(color: PosTokens.colorLineBorder),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PosTokens.componentChipRadius),
      ),
      labelStyle: style(14, FontWeight.w500, PosTokens.colorTextPrimary),
      secondaryLabelStyle: style(14, FontWeight.w600, primary),
      elevation: 0,
      pressElevation: 0,
    ),
    sliderTheme: SliderThemeData(
      activeTrackColor: primary,
      thumbColor: primary,
      inactiveTrackColor: posTint(primary, 0.24),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: primary),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: primary,
      selectionColor: posTint(primary, 0.3),
      selectionHandleColor: primary,
    ),
    listTileTheme: ListTileThemeData(
      iconColor: primary,
      selectedColor: primary,
      titleTextStyle: style(14, FontWeight.w600, PosTokens.colorTextPrimary),
      subtitleTextStyle: bodySmall,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: PosTokens.componentPageBackground,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PosTokens.componentCardRadius),
      ),
      titleTextStyle: style(16, FontWeight.w600, PosTokens.colorTextPrimary),
      contentTextStyle: style(14, FontWeight.w500, PosTokens.colorTextBody),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: PosTokens.componentPageBackground,
      elevation: 0,
      modalElevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(PosTokens.componentCardRadius),
        ),
      ),
    ),
    drawerTheme: const DrawerThemeData(
      backgroundColor: PosTokens.componentPageBackground,
      elevation: 0,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: PosTokens.colorTextBody,
      contentTextStyle: style(
        14,
        FontWeight.w500,
        PosTokens.colorTextOnPrimary,
      ),
      elevation: 0,
    ),
    // FESS's bottom bar: white, the active item in the brand colour, the
    // rest readable grey, and no highlight pill.
    bottomNavigationBarTheme: BottomNavigationBarThemeData(
      backgroundColor: PosTokens.componentBottomNavBackground,
      elevation: 0,
      type: BottomNavigationBarType.fixed,
      selectedItemColor: primary,
      unselectedItemColor: PosTokens.componentBottomNavInactiveItem,
      showUnselectedLabels: true,
      selectedLabelStyle: style(
        PosTokens.componentBottomNavLabelSize,
        FontWeight.w600,
        primary,
      ),
      unselectedLabelStyle: style(
        PosTokens.componentBottomNavLabelSize,
        PosTokens.componentBottomNavLabelWeight,
        PosTokens.componentBottomNavInactiveItem,
      ),
    ),
    navigationBarTheme: const NavigationBarThemeData(
      backgroundColor: PosTokens.componentBottomNavBackground,
      indicatorColor: Colors.transparent,
      elevation: 0,
    ),
  );
}
