/// Bundled default copy for the module shell.
///
/// Copy is configuration (docs/04, non-negotiable 3): these are only the
/// offline first-run defaults for the shell's own states. Content definitions
/// from the server replace them (T3-05), keyed the same way.
abstract final class BundledCopy {
  static const Map<String, String> en = {
    'shell.title': 'POS verification',
    'shell.back': 'Back',
    'shell.placeholder': 'Your verification jobs will appear here.',
    'shell.unavailable': 'POS verification is not available right now.',
    'shell.not_initialized': 'POS verification is not set up in this app.',
  };

  /// The copy for [key]; the key itself when it's unknown, so a missing
  /// string is visible rather than blank.
  static String text(String key) => en[key] ?? key;
}
