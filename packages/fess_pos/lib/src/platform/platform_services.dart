import 'package:fess_pos/src/platform/background_work.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:fess_pos/src/platform/connectivity.dart';
import 'package:fess_pos/src/platform/device_info.dart';
import 'package:fess_pos/src/platform/integrity.dart';
import 'package:fess_pos/src/platform/location.dart';
import 'package:fess_pos/src/platform/module_storage.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:meta/meta.dart';

/// Every platform service the module uses, behind interfaces (docs/03 §2,
/// docs/13 §8). Nothing above `platform/` talks to a plugin directly, so
/// the web build and tests swap implementations here and nowhere else.
@immutable
class PlatformServices {
  const PlatformServices({
    required this.secureStore,
    required this.connectivity,
    required this.location,
    required this.camera,
    required this.deviceInfo,
    required this.storage,
    required this.integrity,
    required this.backgroundWork,
  });

  /// The real adapters. Creating them touches no platform channel; that
  /// happens on first use.
  factory PlatformServices.forCurrentPlatform() => PlatformServices(
    secureStore: FlutterSecureStore(),
    connectivity: PluginConnectivityMonitor(),
    location: const GeolocatorLocationProvider(),
    camera: const PluginCameraService(),
    deviceInfo: PluginDeviceInfoProvider(),
    storage: const AppSupportModuleStorage(),
    integrity: const UnavailableIntegritySignals(),
    backgroundWork: const UnavailableBackgroundWork(),
  );

  final SecureStore secureStore;
  final ConnectivityMonitor connectivity;
  final LocationProvider location;
  final CameraService camera;
  final DeviceInfoProvider deviceInfo;
  final ModuleStorage storage;
  final IntegritySignalsProvider integrity;
  final BackgroundWorkScheduler backgroundWork;
}
