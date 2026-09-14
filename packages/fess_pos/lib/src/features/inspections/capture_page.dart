import 'dart:async';

import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Kept in the module's secure store once the agent has read why POS needs
/// the camera, so the explanation shows only before the first prompt.
const String cameraExplainedKey = 'camera_explained.v1';

enum _Stage { explain, opening, open, denied, failed }

/// The camera (docs/07 §4 step 1, T4-01): a live preview and a shutter. It
/// returns the capture and stores nothing; the inspection stores it.
///
/// The first time, it says why POS needs the camera before the phone asks
/// (D-55). A refused permission shows how to turn it on. The camera is let
/// go when the app leaves the screen and taken again when it comes back.
class CapturePage extends ConsumerStatefulWidget {
  const CapturePage({required this.title, super.key});

  final String title;

  @override
  ConsumerState<CapturePage> createState() => _CapturePageState();
}

class _CapturePageState extends ConsumerState<CapturePage>
    with WidgetsBindingObserver {
  CameraSession? _session;
  _Stage _stage = _Stage.opening;
  bool _busy = false;

  /// The camera was let go because the app left the screen.
  bool _released = false;

  /// The agent went to the phone's settings to allow the camera.
  bool _toSettings = false;

  /// Only the newest attempt to open the camera counts.
  int _attempt = 0;

  SecureStore get _store => ref.read(platformServicesProvider).secureStore;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_start());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _close();
    super.dispose();
  }

  Future<void> _start() async {
    String? explained;
    try {
      explained = await _store.read(cameraExplainedKey);
    } on Object {
      explained = null;
    }
    if (!mounted) return;
    if (explained == '1') {
      await _open();
    } else {
      setState(() => _stage = _Stage.explain);
    }
  }

  Future<void> _continue() async {
    try {
      await _store.write(cameraExplainedKey, '1');
    } on Object {
      // Explained again next time; nothing else depends on it.
    }
    await _open();
  }

  void _close() {
    final session = _session;
    _session = null;
    if (session != null) unawaited(session.close());
  }

  Future<void> _open() async {
    final attempt = ++_attempt;
    _close();
    if (mounted) setState(() => _stage = _Stage.opening);
    try {
      final camera = ref.read(platformServicesProvider).camera;
      final cameras = await camera.cameras();
      final pick =
          cameras.where((c) => c.lens == PosLens.back).firstOrNull ??
          cameras.firstOrNull;
      if (pick == null) {
        throw const PosException(
          PosErrorCodes.cameraUnavailable,
          'this device has no camera',
          kind: PosErrorKind.platform,
          retryable: false,
        );
      }
      final session = await camera.open(pick);
      if (!mounted || attempt != _attempt) {
        await session.close();
        return;
      }
      setState(() {
        _session = session;
        _stage = _Stage.open;
      });
    } on Object catch (e) {
      if (!mounted || attempt != _attempt) return;
      setState(
        () => _stage =
            e is PosException && e.code == PosErrorCodes.cameraPermissionDenied
            ? _Stage.denied
            : _Stage.failed,
      );
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        if (_released || _toSettings) {
          _released = false;
          _toSettings = false;
          unawaited(_open());
        }
      case AppLifecycleState.hidden ||
          AppLifecycleState.paused ||
          AppLifecycleState.detached:
        if (_session != null) {
          _released = true;
          _close();
          setState(() => _stage = _Stage.opening);
        }
      case AppLifecycleState.inactive:
      // The phone's permission prompt makes the app inactive: carry on.
    }
  }

  Future<void> _openSettings() async {
    _toSettings = true;
    await ref.read(platformServicesProvider).externalApps.openAppSettings();
  }

  Future<void> _shoot(CameraSession session) async {
    setState(() => _busy = true);
    try {
      final capture = await session.capture();
      if (mounted) Navigator.of(context).pop(capture);
    } on PosException {
      if (mounted) setState(() => _stage = _Stage.failed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _message({
    required String text,
    required List<Widget> actions,
    Widget? above,
  }) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ?above,
          Text(text, textAlign: TextAlign.center),
          const SizedBox(height: 24),
          ...actions,
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(copyProvider);
    final session = _session;
    final body = switch (_stage) {
      _Stage.explain => _message(
        above: Column(
          children: [
            const Icon(Icons.photo_camera_outlined, size: 64),
            const SizedBox(height: 16),
            Text(
              copy('camera.explain.title'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
          ],
        ),
        text: copy('camera.explain.body'),
        actions: [
          FilledButton(
            key: const ValueKey('camera-explain-continue'),
            onPressed: _continue,
            child: Text(copy('camera.explain.continue')),
          ),
        ],
      ),
      _Stage.denied => _message(
        text: copy('camera.denied'),
        actions: [
          FilledButton(
            key: const ValueKey('camera-open-settings'),
            onPressed: _openSettings,
            child: Text(copy('camera.open_settings')),
          ),
          TextButton(
            key: const ValueKey('camera-try-again'),
            onPressed: _open,
            child: Text(copy('camera.try_again')),
          ),
        ],
      ),
      _Stage.failed => _message(
        text: copy('inspection.camera_unavailable'),
        actions: [
          TextButton(
            key: const ValueKey('camera-try-again'),
            onPressed: _open,
            child: Text(copy('camera.try_again')),
          ),
        ],
      ),
      _Stage.open when session != null => Stack(
        fit: StackFit.expand,
        children: [
          ColoredBox(
            color: Colors.black,
            child: Center(child: session.preview()),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 32,
            child: Center(
              child: FloatingActionButton.large(
                key: const ValueKey('capture-shutter'),
                onPressed: _busy ? null : () => _shoot(session),
                // Taking a photo can take a moment on a budget phone.
                child: _busy
                    ? const SizedBox.square(
                        dimension: 32,
                        child: CircularProgressIndicator(strokeWidth: 3),
                      )
                    : const Icon(Icons.camera_alt),
              ),
            ),
          ),
        ],
      ),
      _ => const Center(child: CircularProgressIndicator()),
    };
    return Scaffold(
      appBar: PosHeader(
        title: widget.title,
        onBack: () => Navigator.of(context).pop(),
      ),
      body: body,
    );
  }
}
