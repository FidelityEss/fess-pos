import 'package:flutter/painting.dart';
import 'package:meta/meta.dart';

/// Brand overrides a host may pass. The module ships the FESS look
/// (docs/14); these are the only knobs (remote config `theme.*`, D-45).
@immutable
class PosTheme {
  const PosTheme({this.primaryColor, this.fontFamily});

  /// Replaces the primary brand colour.
  final Color? primaryColor;

  /// Replaces the font family. The family must be available to the app.
  final String? fontFamily;
}
