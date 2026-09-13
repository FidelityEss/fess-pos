import 'package:camera/camera.dart';
import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/platform/io/files.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

enum PosLens { back, front, external }

@immutable
class PosCamera {
  const PosCamera({
    required this.id,
    required this.lens,
    required this.sensorOrientation,
  });

  factory PosCamera.fromDescription(CameraDescription d) => PosCamera(
    id: d.name,
    lens: switch (d.lensDirection) {
      CameraLensDirection.back => PosLens.back,
      CameraLensDirection.front => PosLens.front,
      CameraLensDirection.external => PosLens.external,
    },
    sensorOrientation: d.sensorOrientation,
  );

  final String id;
  final PosLens lens;
  final int sensorOrientation;
}

/// Capture resolution. The image pipeline caps the long edge afterwards
/// (`photos.max_long_edge_px`, T4-02).
enum PosCameraResolution { high, veryHigh, max }

/// A photo straight from the device camera.
///
/// It has no public constructor: only a [CameraSession] makes one. Evidence
/// can therefore only come from the camera, never from a file or the
/// gallery (docs/07 §6), and the evidence pipeline's only intake type is
/// this class (docs/DEVELOPMENT-GUIDELINES.md §2).
final class CameraCaptureResult {
  CameraCaptureResult._({
    required this.bytes,
    required this.mimeType,
    required this.cameraId,
    required this.lens,
    required this.capturedAt,
    required String? sourcePath,
  }) : _sourcePath = sourcePath;

  @visibleForTesting
  factory CameraCaptureResult.forTesting({
    required Uint8List bytes,
    String mimeType = 'image/jpeg',
    String cameraId = 'test',
    PosLens lens = PosLens.back,
    DateTime? capturedAt,
  }) => CameraCaptureResult._(
    bytes: bytes,
    mimeType: mimeType,
    cameraId: cameraId,
    lens: lens,
    capturedAt: capturedAt ?? DateTime.now(),
    sourcePath: null,
  );

  final Uint8List bytes;
  final String mimeType;
  final String cameraId;
  final PosLens lens;

  /// Device wall time when the shutter fired.
  final DateTime capturedAt;

  final String? _sourcePath;

  /// Deletes the camera plugin's temporary plaintext file. The evidence
  /// store calls this only once its encrypted copy is durable (docs/12 §3):
  /// until then the temporary file is a second copy, not litter.
  Future<void> releaseSource() async {
    final path = _sourcePath;
    if (path != null) await deleteFileIfExists(path);
  }
}

abstract interface class CameraService {
  Future<List<PosCamera>> cameras();

  Future<CameraSession> open(
    PosCamera camera, {
    PosCameraResolution resolution = PosCameraResolution.veryHigh,
  });
}

/// An open camera. The capture screen (T4-01) shows [preview] and calls
/// [capture]; [close] releases the camera.
abstract interface class CameraSession {
  Widget preview();

  Future<CameraCaptureResult> capture();

  Future<void> close();
}

/// The camera plugin (CameraX, AVFoundation, getUserMedia on the web).
/// Audio is off: no microphone permission is needed (findings/03 §7).
class PluginCameraService implements CameraService {
  const PluginCameraService();

  @override
  Future<List<PosCamera>> cameras() async {
    try {
      return (await availableCameras()).map(PosCamera.fromDescription).toList();
    } on CameraException catch (e) {
      throw _failed(e);
    }
  }

  @override
  Future<CameraSession> open(
    PosCamera camera, {
    PosCameraResolution resolution = PosCameraResolution.veryHigh,
  }) async {
    final CameraDescription description;
    try {
      final all = await availableCameras();
      final match = all.where((c) => c.name == camera.id);
      if (match.isEmpty) {
        throw const PosException(
          PosErrorCodes.cameraUnavailable,
          'the requested camera is not available',
          kind: PosErrorKind.platform,
          retryable: false,
        );
      }
      description = match.first;
    } on CameraException catch (e) {
      throw _failed(e);
    }
    final controller = CameraController(
      description,
      switch (resolution) {
        PosCameraResolution.high => ResolutionPreset.high,
        PosCameraResolution.veryHigh => ResolutionPreset.veryHigh,
        PosCameraResolution.max => ResolutionPreset.max,
      },
      enableAudio: false,
    );
    try {
      await controller.initialize();
    } on CameraException catch (e) {
      await controller.dispose();
      throw _failed(e);
    }
    return _PluginCameraSession(controller, camera);
  }
}

class _PluginCameraSession implements CameraSession {
  _PluginCameraSession(this._controller, this._camera);

  final CameraController _controller;
  final PosCamera _camera;

  @override
  Widget preview() => CameraPreview(_controller);

  @override
  Future<CameraCaptureResult> capture() async {
    try {
      final file = await _controller.takePicture();
      final capturedAt = DateTime.now();
      final bytes = await file.readAsBytes();
      return CameraCaptureResult._(
        bytes: bytes,
        mimeType: file.mimeType ?? 'image/jpeg',
        cameraId: _camera.id,
        lens: _camera.lens,
        capturedAt: capturedAt,
        sourcePath: kIsWeb ? null : file.path,
      );
    } on CameraException catch (e) {
      throw _failed(e);
    }
  }

  @override
  Future<void> close() => _controller.dispose();
}

PosException _failed(CameraException e) => PosException(
  PosErrorCodes.cameraFailed,
  'camera error ${e.code}',
  kind: PosErrorKind.platform,
  retryable: true,
  cause: e,
);
