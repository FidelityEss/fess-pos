// On a device or emulator (T1-42, D-54): the module's camera goes through
// the platform interface, and on Android that is camera_android (Camera2),
// registered even though nothing depends on the app-facing `camera`.
//
// ignore_for_file: implementation_imports

import 'dart:io';

import 'package:camera_platform_interface/camera_platform_interface.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the camera implementation is registered and sees a camera', (
    tester,
  ) async {
    final cameras = await const PluginCameraService().cameras();
    if (Platform.isAndroid) {
      expect(CameraPlatform.instance.runtimeType.toString(), 'AndroidCamera');
      expect(cameras, isNotEmpty); // the emulator has virtual cameras
    }
    // The iOS simulator has no camera: listing must still work, and be empty
    // rather than fail.
  });
}
