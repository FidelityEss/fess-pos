// Token values are passed even where they equal Flutter's defaults, so that
// a change to tokens.json always reaches the header.
// ignore_for_file: avoid_redundant_argument_values

import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:flutter/material.dart';

/// The FESS page header (docs/14 §1, `custom_app_bar_widget`): a 60 px bar
/// in the brand colour with a 30 px round back button, outlined (a white
/// ring and a white arrow), and a centred white semibold title.
class PosHeader extends StatelessWidget implements PreferredSizeWidget {
  const PosHeader({
    required this.title,
    this.onBack,
    this.onMenu,
    this.menuTooltip,
    super.key,
  });

  final String title;
  final VoidCallback? onBack;

  /// Opens the navigation drawer (`navigation.style: drawer`), from a
  /// menu button at the end of the bar.
  final VoidCallback? onMenu;
  final String? menuTooltip;

  @override
  Size get preferredSize =>
      const Size.fromHeight(PosTokens.componentHeaderHeight);

  /// Keeps the tap target near 44 px while the button looks 30 px.
  static const double _hitSize = 44;

  /// The back button's column: the bar's side padding and the button. The
  /// same width is kept free at the other end, so the title is centred on
  /// the bar however long it is.
  static const double _side = PosTokens.componentHeaderPaddingX + _hitSize;

  @override
  Widget build(BuildContext context) {
    final back = onBack;
    final menu = onMenu;
    final bare = back == null && menu == null;
    return AppBar(
      automaticallyImplyLeading: false,
      centerTitle: PosTokens.componentHeaderTitleAlign == 'center',
      leadingWidth: bare ? null : _side,
      titleSpacing: bare ? PosTokens.componentHeaderPaddingX : 0,
      leading: back == null
          ? (menu == null ? null : const SizedBox.shrink())
          : Padding(
              padding: const EdgeInsetsDirectional.only(
                start:
                    PosTokens.componentHeaderPaddingX -
                    (_hitSize - PosTokens.componentHeaderBackSize) / 2,
              ),
              child: Align(
                alignment: AlignmentDirectional.centerStart,
                child: _RoundBackButton(onPressed: back),
              ),
            ),
      title: Text(
        title,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        textAlign: TextAlign.center,
      ),
      actions: [
        if (menu != null)
          Padding(
            padding: const EdgeInsetsDirectional.only(
              end: PosTokens.componentHeaderPaddingX - 12,
            ),
            child: IconButton(
              key: const ValueKey('pos-menu'),
              onPressed: menu,
              tooltip: menuTooltip,
              icon: const Icon(Icons.menu),
            ),
          )
        else if (back != null)
          const SizedBox(width: _side),
      ],
    );
  }
}

class _RoundBackButton extends StatelessWidget {
  const _RoundBackButton({required this.onPressed});

  final VoidCallback onPressed;

  /// FESS draws a 12 px FontAwesome arrow; a Material icon's glyph fills
  /// about three quarters of its box, so it takes 4/3 the size to match.
  static const double _arrowSize =
      PosTokens.componentHeaderBackIconSize * 4 / 3;

  @override
  Widget build(BuildContext context) {
    const color = PosTokens.componentHeaderBackColor;
    const outlined = PosTokens.componentHeaderBackStyle == 'outline';
    return IconButton(
      onPressed: onPressed,
      tooltip: BundledCopy.text('shell.back'),
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints.tightFor(
        width: PosHeader._hitSize,
        height: PosHeader._hitSize,
      ),
      icon: Container(
        key: const ValueKey('pos-back-ring'),
        width: PosTokens.componentHeaderBackSize,
        height: PosTokens.componentHeaderBackSize,
        alignment: Alignment.center,
        decoration: outlined
            ? BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: color,
                  width: PosTokens.componentHeaderBackBorderWidth,
                ),
              )
            : const BoxDecoration(color: color, shape: BoxShape.circle),
        child: Icon(
          Icons.arrow_back,
          size: _arrowSize,
          color: outlined ? color : Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}
