import 'dart:async';

import 'package:camera_platform_interface/camera_platform_interface.dart';
import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/platform/io/files.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show DeviceOrientation;
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
final class CameraCaptureResult implements CapturedPhoto {
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

  @override
  final Uint8List bytes;
  @override
  final String mimeType;
  final String cameraId;
  final PosLens lens;

  /// Device wall time when the shutter fired.
  @override
  final DateTime capturedAt;

  final String? _sourcePath;

  /// Deletes the camera plugin's temporary plaintext file. The evidence
  /// store calls this only once its encrypted copy is durable (docs/12 §3):
  /// until then the temporary file is a second copy, not litter.
  @override
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
  /// The live preview, the right way up and in proportion.
  Widget preview();

  Future<CameraCaptureResult> capture();

  Future<void> close();
}

/// The camera through its platform interface: Camera2 on Android
/// (camera_android), AVFoundation on iOS, getUserMedia on the web. The
/// module doesn't use the app-facing `camera` package, whose Android default
/// (CameraX) can need a higher minSdk than the host has (D-54). Audio is
/// off: no microphone is needed (findings/03 §7).
class PluginCameraService implements CameraService {
  const PluginCameraService();

  CameraPlatform get _platform => CameraPlatform.instance;

  @override
  Future<List<PosCamera>> cameras() async {
    try {
      return (await _platform.availableCameras())
          .map(PosCamera.fromDescription)
          .toList();
    } on CameraException catch (e) {
      throw _failed(e);
    }
  }

  @override
  Future<CameraSession> open(
    PosCamera camera, {
    PosCameraResolution resolution = PosCameraResolution.veryHigh,
  }) async {
    final int id;
    try {
      final match = (await _platform.availableCameras()).where(
        (c) => c.name == camera.id,
      );
      if (match.isEmpty) {
        throw const PosException(
          PosErrorCodes.cameraUnavailable,
          'the requested camera is not available',
          kind: PosErrorKind.platform,
          retryable: false,
        );
      }
      id = await _platform.createCameraWithSettings(
        match.first,
        MediaSettings(
          resolutionPreset: switch (resolution) {
            PosCameraResolution.high => ResolutionPreset.high,
            PosCameraResolution.veryHigh => ResolutionPreset.veryHigh,
            PosCameraResolution.max => ResolutionPreset.max,
          },
        ),
      );
    } on CameraException catch (e) {
      throw _failed(e);
    }
    final CameraInitializedEvent ready;
    try {
      // Listen before initialising: the event can arrive before the call
      // returns.
      final initialized = _platform.onCameraInitialized(id).first;
      await _platform.initializeCamera(id);
      ready = await initialized;
    } on CameraException catch (e) {
      await _platform.dispose(id);
      throw _failed(e);
    }
    return _PluginCameraSession(
      _platform,
      id,
      camera,
      ready.previewHeight > 0 ? ready.previewWidth / ready.previewHeight : 0,
    );
  }
}

class _PluginCameraSession implements CameraSession {
  _PluginCameraSession(this._platform, this._id, this._camera, this._ratio);

  final CameraPlatform _platform;
  final int _id;
  final PosCamera _camera;

  /// The preview's width over its height, as the sensor delivers it.
  final double _ratio;

  @override
  Widget preview() => _Preview(_platform, _id, _ratio);

  @override
  Future<CameraCaptureResult> capture() async {
    try {
      final file = await _platform.takePicture(_id);
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
  Future<void> close() => _platform.dispose(_id);
}

/// The codes the camera plugins use when the user hasn't allowed the
/// camera: Camera2 on Android, AVFoundation on iOS, the browser on the web.
const Set<String> _permissionCodes = {
  'CameraAccessDenied',
  'CameraAccessDeniedWithoutPrompt',
  'CameraAccessRestricted',
  'cameraPermission',
};

PosException _failed(CameraException e) => _permissionCodes.contains(e.code)
    ? PosException(
        PosErrorCodes.cameraPermissionDenied,
        'camera access is not allowed (${e.code})',
        kind: PosErrorKind.platform,
        retryable: false,
        cause: e,
      )
    : PosException(
        PosErrorCodes.cameraFailed,
        'camera error ${e.code}',
        kind: PosErrorKind.platform,
        retryable: true,
        cause: e,
      );

/// The live preview, the right way up. On Android the plugin's texture
/// isn't turned with the phone, so it is turned here as the phone turns,
/// as the `camera` package does; elsewhere the platform does it. The box
/// keeps the sensor's proportions, so nothing is stretched.
class _Preview extends StatefulWidget {
  const _Preview(this.platform, this.id, this.ratio);

  final CameraPlatform platform;
  final int id;
  final double ratio;

  @override
  State<_Preview> createState() => _PreviewState();
}

class _PreviewState extends State<_Preview> {
  DeviceOrientation _orientation = DeviceOrientation.portraitUp;
  StreamSubscription<DeviceOrientationChangedEvent>? _turns;

  @override
  void initState() {
    super.initState();
    _turns = widget.platform.onDeviceOrientationChanged().listen(
      (e) => setState(() => _orientation = e.orientation),
    );
  }

  @override
  void dispose() {
    unawaited(_turns?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final texture = widget.platform.buildPreview(widget.id);
    if (widget.ratio <= 0) return texture;
    final landscape =
        _orientation == DeviceOrientation.landscapeLeft ||
        _orientation == DeviceOrientation.landscapeRight;
    final turned = !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
    return AspectRatio(
      aspectRatio: landscape ? widget.ratio : 1 / widget.ratio,
      child: turned
          ? RotatedBox(
              quarterTurns: switch (_orientation) {
                DeviceOrientation.portraitUp => 0,
                DeviceOrientation.landscapeRight => 1,
                DeviceOrientation.portraitDown => 2,
                DeviceOrientation.landscapeLeft => 3,
              },
              child: texture,
            )
          : texture,
    );
  }
}
