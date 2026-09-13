@TestOn('vm')
library;

import 'dart:io';

import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/platform/background_work.dart';
import 'package:fess_pos/src/platform/device_info.dart';
import 'package:fess_pos/src/platform/integrity.dart';
import 'package:fess_pos/src/platform/io/files.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';
import '../support/test_host.dart';

void main() {
  tearDown(ModuleRuntime.reset);

  test('the real adapters are created without touching a platform channel', () {
    expect(PlatformServices.forCurrentPlatform, returnsNormally);
    expect(ModuleDependencies.production, returnsNormally);
  });

  test('the runtime exposes its platform services to widgets', () async {
    final platform = fakePlatform();
    final runtime = await startTestRuntime(platform: platform);
    expect(runtime.container.read(platformServicesProvider), same(platform));
  });

  test(
    'integrity and background work say plainly they are unavailable',
    () async {
      final snapshot = await const UnavailableIntegritySignals().snapshot();
      expect(snapshot.available, isFalse);
      expect(snapshot.rooted, isNull, reason: 'unknown, never "clean"');
      expect(snapshot.toJson()['source'], 'not_implemented');
      expect(const UnavailableBackgroundWork().supported, isFalse);
    },
  );

  test('the device description has the API field names', () {
    const d = DeviceDescription(
      clientType: 'native',
      os: 'android',
      osVersion: '14',
      model: 'SM-A146P',
      manufacturer: 'samsung',
      isPhysicalDevice: true,
      hostAppId: 'com.fidelity.fess',
      hostAppVersion: '3.1.0',
      hostAppBuild: '310',
    );
    expect(d.toJson(), {
      'client_type': 'native',
      'os': 'android',
      'os_version': '14',
      'model': 'SM-A146P',
      'manufacturer': 'samsung',
      'is_physical_device': true,
      'host_app_id': 'com.fidelity.fess',
      'host_app_version': '3.1.0',
      'host_app_build': '310',
    });
  });

  test('file helpers (native)', () async {
    final dir = Directory.systemTemp.createTempSync('fess_pos_files_');
    addTearDown(() => dir.deleteSync(recursive: true));
    final nested = '${dir.path}/a/b';
    await ensureDirectory(nested);
    expect(Directory(nested).existsSync(), isTrue);
    final file = File('$nested/x.bin')..writeAsBytesSync([1]);
    expect(await fileExists(file.path), isTrue);
    await deleteFileIfExists(file.path);
    expect(await fileExists(file.path), isFalse);
    await deleteFileIfExists(file.path); // idempotent
  });
}
