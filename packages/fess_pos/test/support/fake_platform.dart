import 'dart:async';

import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/platform/background_work.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:fess_pos/src/platform/connectivity.dart';
import 'package:fess_pos/src/platform/device_info.dart';
import 'package:fess_pos/src/platform/external_apps.dart';
import 'package:fess_pos/src/platform/integrity.dart';
import 'package:fess_pos/src/platform/location.dart';
import 'package:fess_pos/src/platform/module_storage.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:fess_pos/src/platform/secure_store.dart';

class FakeConnectivity implements ConnectivityMonitor {
  NetworkState state = const NetworkState(connected: true, unmetered: true);
  final StreamController<NetworkState> controller =
      StreamController.broadcast();

  @override
  Future<NetworkState> current() async => state;

  @override
  Stream<NetworkState> get changes => controller.stream;
}

class FakeLocation implements LocationProvider {
  LocationAccess accessState = LocationAccess.whileInUse;
  LocationFix? fix;

  @override
  Future<LocationAccess> access() async => accessState;

  @override
  Future<LocationAccess> requestAccess() async => accessState;

  /// What [precise] answers.
  bool? preciseState = true;

  @override
  Future<bool?> precise() async => preciseState;

  @override
  Future<LocationFix> currentFix({Duration? timeLimit}) async =>
      fix ??
      (throw const PosException(
        'NO_FIX',
        'no fix in this test',
        kind: PosErrorKind.platform,
        retryable: true,
      ));

  /// The fixes a test sends.
  final StreamController<LocationFix> updates = StreamController.broadcast();

  @override
  Stream<LocationFix> fixes({required Duration interval}) => updates.stream;
}

class FakeCamera implements CameraService {
  @override
  Future<List<PosCamera>> cameras() async => const [];

  @override
  Future<CameraSession> open(
    PosCamera camera, {
    PosCameraResolution resolution = PosCameraResolution.veryHigh,
  }) => Future.error(
    const PosException(
      PosErrorCodes.cameraUnavailable,
      'no camera in tests',
      kind: PosErrorKind.platform,
      retryable: false,
    ),
  );
}

class FakeDeviceInfo implements DeviceInfoProvider {
  @override
  Future<DeviceDescription> describe() async => const DeviceDescription(
    clientType: 'native',
    os: 'android',
    osVersion: '14',
    model: 'test-device',
  );
}

class FakeModuleStorage implements ModuleStorage {
  FakeModuleStorage([this.directory]);

  final String? directory;

  @override
  Future<String?> moduleDirectory() async => directory;
}

/// Records the directions asked for; [opens] says whether an app took them.
class FakeExternalApps implements ExternalApps {
  bool opens = true;
  final List<({double lat, double lng, String? label})> directions = [];

  @override
  Future<bool> openDirections(double lat, double lng, {String? label}) async {
    directions.add((lat: lat, lng: lng, label: label));
    return opens;
  }

  int settingsOpened = 0;

  @override
  Future<bool> openAppSettings() async {
    settingsOpened++;
    return true;
  }
}

PlatformServices fakePlatform({
  SecureStore? secureStore,
  ModuleStorage? storage,
  ExternalApps? externalApps,
}) => PlatformServices(
  secureStore: secureStore ?? MemorySecureStore(),
  connectivity: FakeConnectivity(),
  location: FakeLocation(),
  camera: FakeCamera(),
  deviceInfo: FakeDeviceInfo(),
  storage: storage ?? FakeModuleStorage(),
  integrity: const UnavailableIntegritySignals(),
  backgroundWork: const UnavailableBackgroundWork(),
  externalApps: externalApps ?? FakeExternalApps(),
);
