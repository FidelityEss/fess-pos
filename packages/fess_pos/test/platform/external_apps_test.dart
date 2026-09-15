import 'package:fess_pos/src/platform/external_apps.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test("Android: the agent's own maps app first, Google Maps after", () {
    final uris = directionsUris(
      -26.19,
      28.03,
      platform: TargetPlatform.android,
      web: false,
      label: 'Braam Coffee Co.',
    );
    expect(
      uris.first.toString(),
      'geo:-26.19,28.03?q=-26.19,28.03(Braam%20Coffee%20Co.)',
    );
    expect(uris.last.host, 'www.google.com');
    expect(uris.last.queryParameters['destination'], '-26.19,28.03');
    expect(
      directionsUris(
        1,
        2,
        platform: TargetPlatform.android,
        web: false,
      ).first.toString(),
      'geo:1.0,2.0?q=1.0,2.0',
    );
  });

  test('iOS: Apple Maps, then Google Maps', () {
    final uris = directionsUris(
      -26.19,
      28.03,
      platform: TargetPlatform.iOS,
      web: false,
    );
    expect(uris.first.host, 'maps.apple.com');
    expect(uris.first.queryParameters['daddr'], '-26.19,28.03');
    expect(uris, hasLength(2));
  });

  test('contacts: a number keeps its digits and a leading +; an address '
      'must be one (T3-05)', () {
    expect(
      contactUri(ContactChannel.call, '+27 (82) 000-1111').toString(),
      'tel:+27820001111',
    );
    expect(
      contactUri(ContactChannel.sms, '082 000 1111').toString(),
      'sms:0820001111',
    );
    expect(
      contactUri(ContactChannel.email, ' t@example.com ').toString(),
      'mailto:t@example.com',
    );
    expect(contactUri(ContactChannel.call, 'n/a'), isNull);
    expect(contactUri(ContactChannel.email, 'not an address'), isNull);
  });

  test('the web: Google Maps only', () {
    final uris = directionsUris(
      -26.19,
      28.03,
      platform: TargetPlatform.android,
      web: true,
    );
    expect(uris.single.host, 'www.google.com');
  });
}
