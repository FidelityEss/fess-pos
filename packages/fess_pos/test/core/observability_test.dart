// `SentryEvent.extra` is deprecated but still sent, so scrubbing it is tested.
// ignore_for_file: deprecated_member_use

import 'package:fess_pos/src/core/observability/pos_observability.dart';
import 'package:fess_pos/src/core/observability/scrub.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sentry/sentry.dart';

void main() {
  test('no DSN: reporting is off and capturing is a no-op', () async {
    final o = PosObservability.create(
      dsn: null,
      sampleRate: 1,
      environment: 'qa',
    );
    expect(o.enabled, isFalse);
    await o.captureException(StateError('x'));
    await o.close();
  });

  test('a DSN builds the module its own hub, not the global one', () async {
    final o = PosObservability.create(
      dsn: 'https://public@sentry.example.invalid/1',
      sampleRate: 1,
      environment: 'qa',
    );
    expect(o.enabled, isTrue);
    expect(Sentry.isEnabled, isFalse);
    await o.close();
  });

  group('scrubEvent', () {
    test('keeps only the opaque user id and drops the request', () {
      final event = SentryEvent(
        user: SentryUser(
          id: 'user-1',
          email: 'agent@example.com',
          ipAddress: '10.0.0.1',
          name: 'Nomsa',
        ),
        request: SentryRequest(url: 'https://x.example/v1/ingest'),
      );
      final out = scrubEvent(event, Hint())!;
      expect(out.user!.id, 'user-1');
      expect(out.user!.email, isNull);
      expect(out.user!.ipAddress, isNull);
      expect(out.user!.name, isNull);
      expect(out.request, isNull);
    });

    test('scrubs sensitive keys in extras, tags and breadcrumbs', () {
      final event = SentryEvent(
        extra: {
          'access_token': 'abc',
          'count': 3,
          'job': {'id': 'j1', 'lat': -26.2, 'merchant_name': 'Joe'},
        },
        tags: {'session_id': 's1', 'screen': 'home'},
        breadcrumbs: [
          Breadcrumb(message: 'sync', data: {'payload_hash': 'h', 'items': 2}),
        ],
      );
      final out = scrubEvent(event, Hint())!;
      expect(out.extra!['access_token'], '[scrubbed]');
      expect(out.extra!['count'], 3);
      final job = out.extra!['job'] as Map<String, dynamic>;
      expect(job['id'], 'j1');
      expect(job['lat'], '[scrubbed]');
      expect(job['merchant_name'], '[scrubbed]');
      expect(out.tags!['session_id'], '[scrubbed]');
      expect(out.tags!['screen'], 'home');
      expect(out.breadcrumbs!.single.data!['payload_hash'], '[scrubbed]');
      expect(out.breadcrumbs!.single.data!['items'], 2);
    });

    test('an event with no user stays without one', () {
      expect(scrubEvent(SentryEvent(), Hint())!.user, isNull);
    });
  });

  test('scrubBreadcrumb scrubs data and passes null through', () {
    expect(scrubBreadcrumb(null, Hint()), isNull);
    final b = scrubBreadcrumb(
      Breadcrumb(data: {'email': 'a@b.c', 'n': 1}),
      Hint(),
    )!;
    expect(b.data, {'email': '[scrubbed]', 'n': 1});
  });
}
