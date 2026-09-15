import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/data/remote/api_preview_drafts.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_pos_api.dart';

/// "Preview on a phone" drafts over the POS API (T3-12, docs/04 §10).
void main() {
  const token = 'tok_0123456789abcdefghij';
  const path = '/preview/$token';
  late FakePosApi api;
  late PosApiClient client;

  setUp(() async {
    api = FakePosApi();
    final clock = TestClock();
    client = testApiClient(api, clock: clock);
    api.on(
      '/auth/exchange',
      (_) => jsonResponse(200, sessionAnswer(serverTime: clock.now)),
    );
    await client.exchange({
      'issuer': 'pos_dev',
      'token': 'host-token',
      'device': {'device_id': testDeviceId},
    }, issuer: 'pos_dev');
  });

  test('fetches the draft by its token with the agent session', () async {
    api.on(
      path,
      (_) => jsonResponse(200, {
        'kind': 'form',
        'definition': {
          'kind': 'form',
          'family': 'site_safety',
          'sections': <Object?>[],
        },
        'bundle': {'strings': <String, Object?>{}},
        'context': {'today': '2026-09-15'},
        'expires_at': '2026-09-15T10:30:00Z',
      }),
    );
    final request = await ApiPreviewDrafts(client).fetch(token);
    expect(request?.kind, 'form');
    expect(request?.family, 'site_safety');
    expect(request?.context['today'], '2026-09-15');
    final call = api.calls(path).single;
    expect(call.method, 'GET');
    expect(call.headers['authorization'], 'Bearer access-1');
  });

  test('an unknown or expired token is no preview', () async {
    api.on(path, (_) => jsonResponse(404, apiError('NOT_FOUND')));
    expect(await ApiPreviewDrafts(client).fetch(token), isNull);
  });

  test('an answer that is not a preview request is no preview', () async {
    api.on(path, (_) => jsonResponse(200, {'kind': 'nonsense'}));
    expect(await ApiPreviewDrafts(client).fetch(token), isNull);
  });

  test('a failure to reach the server is thrown for the page to say', () {
    api.on(
      path,
      (_) => jsonResponse(503, apiError('UNAVAILABLE', retryable: true)),
    );
    expect(
      ApiPreviewDrafts(client).fetch(token),
      throwsA(isA<PosException>()),
    );
  });
}
