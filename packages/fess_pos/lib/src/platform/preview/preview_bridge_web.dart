// The web side of the preview bridge (T3-08): the window's `message` events
// from the page that embeds the module's web build, and `postMessage` back.
import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';

import 'package:fess_pos/src/platform/preview/preview_bridge_api.dart';

export 'package:fess_pos/src/platform/preview/preview_bridge_api.dart';

@JS('window')
external _Window get _window;

extension type _Window._(JSObject _) implements JSObject {
  external void addEventListener(String type, JSFunction listener);
  external void removeEventListener(String type, JSFunction listener);
  external _Window get parent;
  external _Location get location;
  external void postMessage(JSAny? message, String targetOrigin);
}

extension type _Location._(JSObject _) implements JSObject {
  external String get origin;
}

extension type _MessageEvent._(JSObject _) implements JSObject {
  external JSAny? get data;
  external String get origin;
}

/// Hears the embedding page from [allowedOrigins] only (the page's own
/// origin when none are given), and answers only to them.
PreviewBridge createPreviewBridge(List<String> allowedOrigins) =>
    _WebPreviewBridge(
      allowedOrigins.isEmpty
          ? {_window.location.origin}
          : allowedOrigins.toSet(),
    );

class _WebPreviewBridge implements PreviewBridge {
  _WebPreviewBridge(this._allowed) {
    _window.addEventListener('message', _listener);
  }

  final Set<String> _allowed;
  final StreamController<Map<String, Object?>> _messages =
      StreamController.broadcast();
  late final JSFunction _listener = _onMessage.toJS;

  @override
  Stream<Map<String, Object?>> get messages => _messages.stream;

  void _onMessage(_MessageEvent event) {
    if (!_allowed.contains(event.origin)) return;
    var data = event.data.dartify();
    if (data is String) {
      try {
        data = jsonDecode(data);
      } on FormatException {
        return;
      }
    }
    final message = jsonLike(data);
    if (message is Map<String, Object?>) _messages.add(message);
  }

  @override
  void send(Map<String, Object?> message) {
    final payload = message.jsify();
    for (final origin in _allowed) {
      _window.parent.postMessage(payload, origin);
    }
  }

  @override
  void close() {
    _window.removeEventListener('message', _listener);
    unawaited(_messages.close());
  }
}
