// Token values are passed even where they equal Flutter's defaults, so that
// a change to tokens.json always reaches the widgets.
// ignore_for_file: avoid_redundant_argument_values

import 'package:fess_pos/src/core/theme/pos_tones.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:flutter/material.dart';

/// The FESS building blocks every module page shares (docs/14 §1–2, D-97):
/// white and flat, no shadows; hairlines and light borders separate things.

/// A list row's title: bold, as FESS's menu rows.
TextStyle posRowTitleStyle(BuildContext context) =>
    Theme.of(context).textTheme.bodyMedium!.copyWith(
      fontSize: PosTokens.componentListRowTitleSize,
      fontWeight: PosTokens.componentListRowTitleWeight,
      color: PosTokens.componentListRowTitleColor,
    );

/// A list row's description: small and grey.
TextStyle posRowDescriptionStyle(BuildContext context) =>
    Theme.of(context).textTheme.bodyMedium!.copyWith(
      fontSize: PosTokens.componentListRowDescriptionSize,
      fontWeight: PosTokens.componentListRowDescriptionWeight,
      color: PosTokens.componentListRowDescriptionColor,
    );

/// A flat row, as FESS's menu rows (`ModernMenuItem`): an optional line
/// icon in the brand colour in a 70 px column, a bold [title] and a grey
/// [description] (or any [child]), a grey chevron when it opens something,
/// and a hairline divider inset from the left. At least 80 px high.
class PosListRow extends StatelessWidget {
  const PosListRow({
    this.icon,
    this.iconColor,
    this.title,
    this.description,
    this.child,
    this.onTap,
    this.chevron,
    this.divider = true,
    this.gutter = PosTokens.componentPagePaddingX,
    super.key,
  });

  final IconData? icon;

  /// The icon's colour; the brand colour by default.
  final Color? iconColor;
  final String? title;
  final String? description;

  /// What the row shows instead of [title] and [description].
  final Widget? child;
  final VoidCallback? onTap;

  /// Whether the chevron shows; by default when the row opens something.
  final bool? chevron;
  final bool divider;

  /// The inset where there is no icon: the page's side padding.
  final double gutter;

  @override
  Widget build(BuildContext context) {
    final t = title;
    final d = description;
    final content =
        child ??
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (t != null) Text(t, style: posRowTitleStyle(context)),
            if (d != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(d, style: posRowDescriptionStyle(context)),
              ),
          ],
        );
    final i = icon;
    return Material(
      color: PosTokens.componentPageBackground,
      child: InkWell(
        onTap: onTap,
        child: Row(
          children: [
            if (i != null)
              SizedBox(
                width: PosTokens.componentListRowIconColumn,
                child: Icon(
                  i,
                  size: PosTokens.componentListRowIconSize,
                  color: iconColor ?? Theme.of(context).colorScheme.primary,
                ),
              )
            else
              SizedBox(width: gutter),
            Expanded(
              child: DecoratedBox(
                decoration: divider
                    ? const BoxDecoration(
                        border: Border(
                          bottom: BorderSide(
                            color: PosTokens.componentListRowDivider,
                          ),
                        ),
                      )
                    : const BoxDecoration(),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minHeight: PosTokens.componentListRowHeight,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            vertical: PosTokens.componentListRowPaddingY,
                          ),
                          child: content,
                        ),
                      ),
                      if (chevron ?? onTap != null)
                        const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 16),
                          child: Icon(
                            Icons.chevron_right_rounded,
                            size: PosTokens.componentListRowChevronSize,
                            color: PosTokens.componentListRowChevron,
                          ),
                        )
                      else
                        SizedBox(width: gutter),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A status chip: a pill tinted in its [tone]'s colour with dark text of
/// the same family, readable at any size (docs/14 §3).
class PosChip extends StatelessWidget {
  const PosChip({
    required this.text,
    this.tone = PosTone.neutral,
    this.icon,
    super.key,
  });

  final String text;
  final PosTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final colors = posToneColors(tone);
    final i = icon;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(PosTokens.componentChipRadius),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: PosTokens.componentChipPaddingX,
          vertical: PosTokens.componentChipPaddingY,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (i != null) ...[
              Icon(i, size: 14, color: colors.foreground),
              const SizedBox(width: 6),
            ],
            Flexible(
              child: Text(
                text,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  fontSize: PosTokens.componentChipTextSize,
                  fontWeight: PosTokens.componentChipTextWeight,
                  color: colors.foreground,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A box, where one is truly needed (the agent card, a notice with a
/// button): white with a light border and no shadow, as FESS's Settings.
class PosBox extends StatelessWidget {
  const PosBox({
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.margin = EdgeInsets.zero,
    this.onTap,
    super.key,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry margin;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Padding(
    padding: margin,
    child: Material(
      color: PosTokens.componentCardBackground,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PosTokens.componentCardRadius),
        side: const BorderSide(
          color: PosTokens.componentCardBorder,
          width: PosTokens.componentCardBorderWidth,
        ),
      ),
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    ),
  );
}

/// The buttons at the foot of a page: on white under a hairline, lined up
/// with the page's side padding, clear of the phone's home indicator.
class PosActionBar extends StatelessWidget {
  const PosActionBar({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      color: PosTokens.componentPageBackground,
      border: Border(top: BorderSide(color: PosTokens.colorLineDivider)),
    ),
    child: SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          PosTokens.componentPagePaddingX,
          12,
          PosTokens.componentPagePaddingX,
          16,
        ),
        child: child,
      ),
    ),
  );
}

/// A destructive button's style: FESS's red with white text (≈5.3:1).
ButtonStyle posDangerButtonStyle() => FilledButton.styleFrom(
  backgroundColor: PosTokens.componentButtonDangerBackground,
  foregroundColor: PosTokens.componentButtonDangerText,
);
