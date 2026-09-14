// Release-build self-check (T1-42). `flutter drive` can't run release builds
// on Android, so this entry point opens the module's local store, lists the
// cameras and reads the device and storage adapters inside a real release
// (R8-shrunk) build, printing one line per check for logcat:
//
//   flutter build apk --release --target lib/self_check.dart
//   adb install -r build/app/outputs/flutter-apk/app-release.apk
//   adb shell am start -n com.fidelityess.fess_pos_example/.MainActivity
//   adb logcat -d -s flutter | grep POS_SELF_CHECK
//
// ignore_for_file: implementation_imports, avoid_print

import 'package:fess_pos/src/data/local/local_store.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:flutter/widgets.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SizedBox.shrink());
  final platform = PlatformServices.forCurrentPlatform();

  Future<void> check(String name, Future<String> Function() run) async {
    try {
      print('POS_SELF_CHECK $name ok ${await run()}');
    } on Object catch (e) {
      print('POS_SELF_CHECK $name FAILED $e');
    }
  }

  await check('store', () async {
    final db = await openLocalStore(platform);
    final cipher = await db.customSelect('PRAGMA cipher_version').getSingle();
    await db.close();
    return 'cipher=${cipher.data.values.first}';
  });
  await check('camera', () async {
    final cameras = await const PluginCameraService().cameras();
    return 'count=${cameras.length}';
  });
  await check('device', () async {
    final d = await platform.deviceInfo.describe();
    return '${d.os} ${d.osVersion} host=${d.hostAppId}';
  });
  await check(
    'storage',
    () async => '${await platform.storage.moduleDirectory()}',
  );
  print('POS_SELF_CHECK done');
}
