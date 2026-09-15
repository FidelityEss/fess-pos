import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:flutter/widgets.dart';

/// What a chip, a notice or a status icon means (docs/14 §3, D-97). Colour
/// is kept for meaning: green for done, gold for the brand accent (work in
/// hand), amber and red for problems, blue for information.
enum PosTone { neutral, info, accent, success, warning, danger }

/// A tone's colours: a light tint of the status colour behind dark text of
/// the same family. Every pair reads at 4.5:1 or better (WCAG AA), unlike
/// white text on gold (≈2.4:1).
@immutable
class PosToneColors {
  const PosToneColors({required this.background, required this.foreground});

  final Color background;

  /// Text and icons on [background].
  final Color foreground;
}

/// [color] as a tint over white, as the chips use it.
Color posTint(
  Color color, [
  double opacity = PosTokens.componentChipTintOpacity,
]) => Color.alphaBlend(
  color.withValues(alpha: opacity),
  PosTokens.colorBackgroundPage,
);

/// The colours of [tone], from the design tokens.
PosToneColors posToneColors(PosTone tone) => switch (tone) {
  PosTone.success => PosToneColors(
    background: posTint(PosTokens.colorStatusSuccessText),
    foreground: PosTokens.colorStatusSuccessText,
  ),
  PosTone.accent => PosToneColors(
    background: posTint(PosTokens.colorBrandGold),
    foreground: PosTokens.colorBrandGoldTextStrong,
  ),
  PosTone.info => PosToneColors(
    background: posTint(PosTokens.colorStatusInfo),
    foreground: PosTokens.colorStatusInfoText,
  ),
  PosTone.warning => PosToneColors(
    background: posTint(PosTokens.colorStatusWarning),
    foreground: PosTokens.colorStatusWarningText,
  ),
  PosTone.danger => PosToneColors(
    background: posTint(PosTokens.colorStatusError),
    foreground: PosTokens.colorStatusErrorText,
  ),
  PosTone.neutral => const PosToneColors(
    background: PosTokens.colorBackgroundSubtle,
    foreground: PosTokens.colorTextBody,
  ),
};

/// The tone a definition names (`tone`: `info`, `success`, `warning`,
/// `danger` or `error`); anything else is [fallback].
PosTone posTone(Object? name, {PosTone fallback = PosTone.neutral}) =>
    switch (name) {
      'info' => PosTone.info,
      'success' => PosTone.success,
      'warning' => PosTone.warning,
      'danger' || 'error' => PosTone.danger,
      _ => fallback,
    };
