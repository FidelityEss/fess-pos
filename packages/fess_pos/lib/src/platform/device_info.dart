import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// The device and host app, for the capability report and
/// `POST /v1/device` (docs/03 §4, D-50). Nothing here identifies a person.
@immutable
class DeviceDescription {
  const DeviceDescription({
    required this.clientType,
    required this.os,
    required this.osVersion,
    required this.model,
    this.manufacturer,
    this.isPhysicalDevice,
    this.hostAppId,
    this.hostAppVersion,
    this.hostAppBuild,
  });

  /// `native` or `web`, as every record carries it (docs/13 §8).
  final String clientType;

  /// `android`, `ios`, `web`, …
  final String os;
  final String osVersion;
  final String model;
  final String? manufacturer;
  final bool? isPhysicalDevice;
  final String? hostAppId;
  final String? hostAppVersion;
  final String? hostAppBuild;

  Map<String, Object?> toJson() => {
    'client_type': clientType,
    'os': os,
    'os_version': osVersion,
    'model': model,
    'manufacturer': manufacturer,
    'is_physical_device': isPhysicalDevice,
    'host_app_id': hostAppId,
    'host_app_version': hostAppVersion,
    'host_app_build': hostAppBuild,
  };
}

// An interface, not a typedef: platform adapters are swapped as objects.
// ignore: one_member_abstracts
abstract interface class DeviceInfoProvider {
  Future<DeviceDescription> describe();
}

/// device_info_plus and package_info_plus, on every platform.
class PluginDeviceInfoProvider implements DeviceInfoProvider {
  PluginDeviceInfoProvider({DeviceInfoPlugin? plugin})
    : _plugin = plugin ?? DeviceInfoPlugin();

  final DeviceInfoPlugin _plugin;

  @override
  Future<DeviceDescription> describe() async {
    PackageInfo? app;
    try {
      app = await PackageInfo.fromPlatform();
    } on Object {
      app = null; // host app details are nice to have, never required
    }
    if (kIsWeb) {
      final web = await _plugin.webBrowserInfo;
      return DeviceDescription(
        clientType: 'web',
        os: 'web',
        osVersion: web.platform ?? 'unknown',
        model: web.browserName.name,
        hostAppId: app?.packageName,
        hostAppVersion: app?.version,
        hostAppBuild: app?.buildNumber,
      );
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        final a = await _plugin.androidInfo;
        return DeviceDescription(
          clientType: 'native',
          os: 'android',
          osVersion: a.version.release,
          model: a.model,
          manufacturer: a.manufacturer,
          isPhysicalDevice: a.isPhysicalDevice,
          hostAppId: app?.packageName,
          hostAppVersion: app?.version,
          hostAppBuild: app?.buildNumber,
        );
      case TargetPlatform.iOS:
        final i = await _plugin.iosInfo;
        return DeviceDescription(
          clientType: 'native',
          os: 'ios',
          osVersion: i.systemVersion,
          model: i.utsname.machine,
          manufacturer: 'Apple',
          isPhysicalDevice: i.isPhysicalDevice,
          hostAppId: app?.packageName,
          hostAppVersion: app?.version,
          hostAppBuild: app?.buildNumber,
        );
      case TargetPlatform.fuchsia ||
          TargetPlatform.linux ||
          TargetPlatform.macOS ||
          TargetPlatform.windows:
        return DeviceDescription(
          clientType: 'native',
          os: defaultTargetPlatform.name,
          osVersion: 'unknown',
          model: 'unknown',
          hostAppId: app?.packageName,
          hostAppVersion: app?.version,
          hostAppBuild: app?.buildNumber,
        );
    }
  }
}
