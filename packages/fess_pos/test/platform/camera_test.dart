import 'dart:typed_data';

import 'package:camera_platform_interface/camera_platform_interface.dart';
import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/test_host.dart';

const _back = CameraDescription(
  name: '0',
  lensDirection: CameraLensDirection.back,
  sensorOrientation: 90,
);

/// Stands in for camera_android / camera_avfoundation.
class _FakeCameraPlatform extends CameraPlatform {
  final List<String> calls = [];
  MediaSettings? settings;

  @override
  Future<List<CameraDescription>> availableCameras() async => const [_back];

  @override
  Future<int> createCameraWithSettings(
    CameraDescription cameraDescription,
    MediaSettings mediaSettings,
  ) async {
    calls.add('create ${cameraDescription.name}');
    settings = mediaSettings;
    return 7;
  }

  @override
  Stream<CameraInitializedEvent> onCameraInitialized(int cameraId) =>
      Stream.value(
        const CameraInitializedEvent(
          7,
          1920,
          1080,
          ExposureMode.auto,
          false,
          FocusMode.auto,
          false,
        ),
      );

  @override
  Future<void> initializeCamera(
    int cameraId, {
    ImageFormatGroup imageFormatGroup = ImageFormatGroup.unknown,
  }) async => calls.add('initialize $cameraId');

  @override
  Future<XFile> takePicture(int cameraId) async {
    calls.add('take $cameraId');
    return XFile.fromData(
      Uint8List.fromList([0xFF, 0xD8, 0xFF]),
      mimeType: 'image/jpeg',
    );
  }

  @override
  Widget buildPreview(int cameraId) => Text('preview $cameraId');

  @override
  Future<void> dispose(int cameraId) async => calls.add('dispose $cameraId');
}

void main() {
  late _FakeCameraPlatform fake;
  setUp(() => CameraPlatform.instance = fake = _FakeCameraPlatform());

  test('PosCamera maps the platform description', () {
    final camera = PosCamera.fromDescription(_back);
    expect(camera.id, '0');
    expect(camera.lens, PosLens.back);
    expect(camera.sensorOrientation, 90);
    expect(
      PosCamera.fromDescription(
        const CameraDescription(
          name: '1',
          lensDirection: CameraLensDirection.front,
          sensorOrientation: 270,
        ),
      ).lens,
      PosLens.front,
    );
  });

  test('a session opens without audio, captures, and closes', () async {
    const service = PluginCameraService();
    final cameras = await service.cameras();
    expect(cameras.single.id, '0');

    final session = await service.open(cameras.single);
    expect(fake.settings!.enableAudio, isFalse);
    expect(fake.settings!.resolutionPreset, ResolutionPreset.veryHigh);

    final capture = await session.capture();
    expect(capture.bytes, [0xFF, 0xD8, 0xFF]);
    expect(capture.mimeType, 'image/jpeg');
    expect(capture.cameraId, '0');
    expect(capture.lens, PosLens.back);

    await session.close();
    expect(fake.calls, ['create 0', 'initialize 7', 'take 7', 'dispose 7']);
  });

  test('an unknown camera is CAMERA_UNAVAILABLE', () async {
    await expectLater(
      const PluginCameraService().open(
        const PosCamera(id: '9', lens: PosLens.back, sensorOrientation: 0),
      ),
      throwsPosCode(PosErrorCodes.cameraUnavailable),
    );
    expect(fake.calls, isEmpty);
  });

  test('a test capture carries its bytes and has no temp file', () async {
    final capture = CameraCaptureResult.forTesting(
      bytes: Uint8List.fromList([0xFF, 0xD8, 0xFF]),
    );
    expect(capture.mimeType, 'image/jpeg');
    await capture.releaseSource(); // no-op without a source file
  });
}
