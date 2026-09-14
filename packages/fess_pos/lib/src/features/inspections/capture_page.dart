import 'dart:async';

import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The camera (docs/07 §4 step 1): a live preview and a shutter. It returns
/// the capture and stores nothing; the inspection stores it. Tuning for
/// budget phones, and the Android preview's rotation, are T4-01.
class CapturePage extends ConsumerStatefulWidget {
  const CapturePage({required this.title, super.key});

  final String title;

  @override
  ConsumerState<CapturePage> createState() => _CapturePageState();
}

class _CapturePageState extends ConsumerState<CapturePage> {
  CameraSession? _session;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    unawaited(_open());
  }

  @override
  void dispose() {
    final session = _session;
    _session = null;
    if (session != null) unawaited(session.close());
    super.dispose();
  }

  Future<void> _open() async {
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
      if (!mounted) {
        await session.close();
        return;
      }
      setState(() => _session = session);
    } on Object catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _shoot(CameraSession session) async {
    setState(() => _busy = true);
    try {
      final capture = await session.capture();
      if (mounted) Navigator.of(context).pop(capture);
    } on PosException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(copyProvider);
    final session = _session;
    final Widget body;
    if (_error != null) {
      body = Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text(
            copy('inspection.camera_unavailable'),
            textAlign: TextAlign.center,
          ),
        ),
      );
    } else if (session == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      body = Stack(
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
                child: const Icon(Icons.camera_alt),
              ),
            ),
          ),
        ],
      );
    }
    return Scaffold(
      appBar: PosHeader(
        title: widget.title,
        onBack: () => Navigator.of(context).pop(),
      ),
      body: body,
    );
  }
}
