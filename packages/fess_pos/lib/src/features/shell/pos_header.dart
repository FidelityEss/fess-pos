import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:flutter/material.dart';

/// The FESS page header (docs/14 §1): a 60 px bar in the brand colour with
/// a 30 px round white back button and a white semibold title.
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

  @override
  Widget build(BuildContext context) {
    final back = onBack;
    return AppBar(
      automaticallyImplyLeading: false,
      leadingWidth: back == null
          ? null
          : PosTokens.componentHeaderPaddingX + _hitSize,
      titleSpacing: back == null ? PosTokens.componentHeaderPaddingX : 8,
      leading: back == null
          ? null
          : Padding(
              padding: const EdgeInsetsDirectional.only(
                start:
                    PosTokens.componentHeaderPaddingX -
                    (_hitSize - PosTokens.componentHeaderBackSize) / 2,
              ),
              child: _RoundBackButton(onPressed: back),
            ),
      title: Text(title),
      actions: [
        if (onMenu case final VoidCallback open)
          IconButton(
            key: const ValueKey('pos-menu'),
            onPressed: open,
            tooltip: menuTooltip,
            icon: const Icon(Icons.menu),
          ),
      ],
    );
  }

  /// Keeps the tap target near 44 px while the button looks 30 px.
  static const double _hitSize = 44;
}

class _RoundBackButton extends StatelessWidget {
  const _RoundBackButton({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => IconButton(
    onPressed: onPressed,
    tooltip: BundledCopy.text('shell.back'),
    padding: EdgeInsets.zero,
    constraints: const BoxConstraints.tightFor(
      width: PosHeader._hitSize,
      height: PosHeader._hitSize,
    ),
    icon: Container(
      width: PosTokens.componentHeaderBackSize,
      height: PosTokens.componentHeaderBackSize,
      decoration: const BoxDecoration(
        color: PosTokens.componentHeaderBackColor,
        shape: BoxShape.circle,
      ),
      child: Icon(
        Icons.arrow_back_ios_new,
        size: PosTokens.componentHeaderBackIconSize,
        color: Theme.of(context).colorScheme.primary,
      ),
    ),
  );
}
