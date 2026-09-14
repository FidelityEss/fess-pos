import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

/// Hands the agent over to other apps on the phone (B2.5: "launch external
/// navigation"). The host already ships `url_launcher`, so this adds no
/// native code to it.
// An interface, not a typedef: platform adapters are swapped as objects.
// ignore: one_member_abstracts
abstract interface class ExternalApps {
  /// Opens the phone's maps app with directions to [lat], [lng]; false when
  /// no app could take it.
  Future<bool> openDirections(double lat, double lng, {String? label});
}

class LauncherExternalApps implements ExternalApps {
  const LauncherExternalApps();

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
