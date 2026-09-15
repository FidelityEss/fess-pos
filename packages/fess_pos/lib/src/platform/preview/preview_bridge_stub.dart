import 'package:fess_pos/src/platform/preview/preview_bridge_api.dart';

export 'package:fess_pos/src/platform/preview/preview_bridge_api.dart';

/// Off the web nothing embeds the module, so the bridge hears nothing.
PreviewBridge createPreviewBridge(List<String> allowedOrigins) =>
    const _SilentBridge();

class _SilentBridge implements PreviewBridge {
  const _SilentBridge();

  @override
  Stream<Map<String, Object?>> get messages => const Stream.empty();

  @override
  void send(Map<String, Object?> message) {}

  @override
  void close() {}
}
