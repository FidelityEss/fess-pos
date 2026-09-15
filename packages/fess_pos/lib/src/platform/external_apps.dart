import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';

/// Hands the agent over to other apps on the phone (B2.5: "launch external
/// navigation"), and to the phone's settings. The host already ships
/// `url_launcher` and `geolocator`, so this adds no native code to it.
abstract interface class ExternalApps {
  /// Opens the phone's maps app with directions to [lat], [lng]; false when
  /// no app could take it.
  Future<bool> openDirections(double lat, double lng, {String? label});

  /// Opens the host app's page in the phone's settings, where a permission
  /// the agent refused can be turned on; false where there's none (web).
  Future<bool> openAppSettings();

  /// Starts a call, a text message or an email to [address] in the phone's
  /// own app; false when none could take it.
  Future<bool> openContact(ContactChannel channel, String address);
}

/// How a `contact` is reached.
enum ContactChannel { call, sms, email }

class LauncherExternalApps implements ExternalApps {
  const LauncherExternalApps();

  @override
  Future<bool> openAppSettings() async {
    if (kIsWeb) return false;
    try {
      return await Geolocator.openAppSettings();
    } on Object {
      return false;
    }
  }

  @override
  Future<bool> openContact(ContactChannel channel, String address) async {
    final uri = contactUri(channel, address);
    if (uri == null) return false;
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } on Object {
      return false;
    }
  }

  @override
  Future<bool> openDirections(double lat, double lng, {String? label}) async {
    final uris = directionsUris(
      lat,
      lng,
      label: label,
      platform: defaultTargetPlatform,
      web: kIsWeb,
    );
    for (final uri in uris) {
      try {
        if (await launchUrl(uri, mode: LaunchMode.externalApplication)) {
          return true;
        }
      } on Object {
        // No app for this one; try the next.
      }
    }
    return false;
  }
}

/// Where directions go, best first: on Android the `geo:` intent, so the
/// agent's own maps app opens (Google Maps, Waze, Petal Maps on Huawei);
/// Apple Maps on iOS; Google Maps on the web, which is also the fallback
/// everywhere.
@visibleForTesting
List<Uri> directionsUris(
  double lat,
  double lng, {
  required TargetPlatform platform,
  required bool web,
  String? label,
}) {
  final at = '$lat,$lng';
  final google = Uri.https('www.google.com', '/maps/dir/', {
    'api': '1',
    'destination': at,
  });
  if (web) return [google];
  return switch (platform) {
    TargetPlatform.android => [
      Uri.parse(
        label == null || label.trim().isEmpty
            ? 'geo:$at?q=$at'
            : 'geo:$at?q=$at(${Uri.encodeComponent(label.trim())})',
      ),
      google,
    ],
    TargetPlatform.iOS => [
      Uri.https('maps.apple.com', '/', {'daddr': at}),
      google,
    ],
    _ => [google],
  };
}

/// The address that starts [channel] to [address], or null when [address]
/// can't be one. A number keeps its digits and a leading `+`.
@visibleForTesting
Uri? contactUri(ContactChannel channel, String address) {
  final a = address.trim();
  if (channel == ContactChannel.email) {
    final valid = RegExp(r'^[^@\s]+@[^@\s]+$').hasMatch(a);
    return valid ? Uri(scheme: 'mailto', path: a) : null;
  }
  final digits = a.replaceAll(RegExp(r'\D'), '');
  if (digits.length < 3) return null;
  final number = a.startsWith('+') ? '+$digits' : digits;
  return Uri(
    scheme: channel == ContactChannel.call ? 'tel' : 'sms',
    path: number,
  );
}
