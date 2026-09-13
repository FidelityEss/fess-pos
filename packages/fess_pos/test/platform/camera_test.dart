import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('PosCamera maps the plugin description', () {
    final camera = PosCamera.fromDescription(
      const CameraDescription(
        name: '0',
        lensDirection: CameraLensDirection.back,
        sensorOrientation: 90,
      ),
    );
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

  test('a test capture carries its bytes and has no temp file', () async {
    final capture = CameraCaptureResult.forTesting(
      bytes: Uint8List.fromList([0xFF, 0xD8, 0xFF]),
    );
    expect(capture.mimeType, 'image/jpeg');
    expect(capture.bytes, hasLength(3));
    await capture.releaseSource(); // no-op without a source file
  });
}
