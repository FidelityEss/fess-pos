import 'dart:async';

import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:fess_pos/src/platform/location.dart';
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
///
/// Over the preview it shows the field's [guidance] and, in a guided
/// sequence, which photo this is ([progress], T4-04). With
/// [requireLocation] (`require_gps`), the shutter waits for a location fix.
class CapturePage extends ConsumerStatefulWidget {
  const CapturePage({
    required this.title,
    this.guidance,
    this.progress,
    this.requireLocation = false,
    super.key,
  });

  final String title;
  final String? guidance;
  final String? progress;
  final bool requireLocation;

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

  /// The agent went to the phone's settings to allow the camera or the
  /// location.
  bool _toSettings = false;

  /// Only the newest attempt to open the camera counts.
  int _attempt = 0;

  /// Whether the location is known, where the photo needs it.
  late bool _located = !widget.requireLocation;
  LocationAccess? _locationAccess;
  bool _locating = false;

  SecureStore get _store => ref.read(platformServicesProvider).secureStore;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_start());
    unawaited(_locate());
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

  /// Waits for a fix, where the photo needs one; reads access, never asks
  /// on its own.
  Future<void> _locate() async {
    if (_located || _locating) return;
    _locating = true;
    try {
      final location = ref.read(platformServicesProvider).location;
      final access = await location.access();
      if (!mounted) return;
      setState(() => _locationAccess = access);
      while (mounted && access.granted && !_located) {
        try {
          await location.currentFix(timeLimit: const Duration(seconds: 15));
          if (mounted) setState(() => _located = true);
        } on Object {
          await Future<void>.delayed(const Duration(seconds: 2));
        }
      }
    } finally {
      _locating = false;
    }
  }

  Future<void> _allowLocation() async {
    final services = ref.read(platformServicesProvider);
    final access = await services.location.requestAccess();
    if (!mounted) return;
    setState(() => _locationAccess = access);
    if (access == LocationAccess.deniedForever) {
      _toSettings = true;
      await services.externalApps.openAppSettings();
    } else {
      unawaited(_locate());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        if (_released || (_toSettings && _stage == _Stage.denied)) {
          unawaited(_open());
        }
        if (_toSettings || _released) unawaited(_locate());
        _released = false;
        _toSettings = false;
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

  /// What shows over the preview: which photo, the guidance, and the
  /// location, where it's needed.
  Widget? _overlay(String Function(String key) copy) {
    final access = _locationAccess;
    final location = !widget.requireLocation || _located
        ? null
        : switch (access) {
            null || LocationAccess.always || LocationAccess.whileInUse => Text(
              copy('camera.location_wait'),
              key: const ValueKey('camera-location-wait'),
              style: const TextStyle(color: Colors.white),
            ),
            LocationAccess.serviceDisabled => Text(
              copy('camera.location_off'),
              style: const TextStyle(color: Colors.white),
            ),
            _ => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  copy('camera.location_needed'),
                  style: const TextStyle(color: Colors.white),
                ),
                TextButton(
                  key: const ValueKey('camera-location-allow'),
                  onPressed: _allowLocation,
                  child: Text(copy('camera.location_allow')),
                ),
              ],
            ),
          };
    final guidance = widget.guidance;
    final progress = widget.progress;
    if (location == null && guidance == null && progress == null) return null;
    return DecoratedBox(
      decoration: const BoxDecoration(color: Colors.black54),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (progress != null)
              Text(
                progress,
                key: const ValueKey('camera-progress'),
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                ),
              ),
            if (guidance != null)
              Text(
                guidance,
                key: const ValueKey('camera-guidance'),
                style: const TextStyle(color: Colors.white),
              ),
            ?location,
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(copyProvider);
    final session = _session;
    final overlay = _overlay(copy);
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
          if (overlay != null)
            Positioned(left: 0, right: 0, top: 0, child: overlay),
          Positioned(
            left: 0,
            right: 0,
            bottom: 32,
            child: Center(
              child: FloatingActionButton.large(
                key: const ValueKey('capture-shutter'),
                onPressed: _busy || !_located ? null : () => _shoot(session),
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
