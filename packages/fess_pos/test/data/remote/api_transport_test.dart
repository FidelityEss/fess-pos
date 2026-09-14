@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/data/remote/api_exception.dart';
import 'package:fess_pos/src/data/remote/api_transport.dart';
import 'package:fess_pos/src/data/remote/retry_policy.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../../support/fake_pos_api.dart';
import '../../support/test_host.dart';

ApiTransport _transport(
  MockClient client, {
  Duration timeout = const Duration(seconds: 30),
  String? base,
}) => ApiTransport(
  bootstrap: base == null
      ? testBootstrap
      : PosBootstrap(
          apiBaseUrl: Uri.parse(base),
          publishableKey: testBootstrap.publishableKey,
          environment: PosEnvironment.qa,
        ),
  client: client,
  timeout: timeout,
);

Matcher _apiError(
  String code, {
  required bool retryable,
  int? status,
  Duration? retryAfter,
}) => throwsA(
  isA<PosApiException>()
      .having((e) => e.code, 'code', code)
      .having((e) => e.retryable, 'retryable', retryable)
      .having((e) => e.status, 'status', status)
      .having((e) => e.retryAfter, 'retryAfter', retryAfter),
);

Object? _fixture(String name) =>
    (jsonDecode(
          File('../../schema/fixtures/api/$name.json').readAsStringSync(),
        )
        as Map<String, Object?>)['value'];

void main() {
  test('paths go under <apiBaseUrl>/v1, with or without a slash', () {
    for (final base in [
      'https://x.supabase.co/functions/v1/api',
      'https://x.supabase.co/functions/v1/api/',
    ]) {
      final t = _transport(
        MockClient((_) async => http.Response('', 200)),
        base: base,
      );
      expect(
        t.uriFor('/sync/pull').toString(),
        'https://x.supabase.co/functions/v1/api/v1/sync/pull',
      );
    }
  });

  test('a request carries the key, a request id, the token and JSON', () async {
    late http.Request seen;
    final t = _transport(
      MockClient((r) async {
        seen = r;
        return jsonResponse(200, {'ok': true});
      }),
    );
    final response = await t.post('/ingest', {
      'envelopes': <Object>[],
    }, accessToken: 'tok');
    expect(seen.method, 'POST');
    expect(seen.headers['apikey'], testBootstrap.publishableKey);
    expect(seen.headers['authorization'], 'Bearer tok');
    expect(seen.headers['content-type'], startsWith('application/json'));
    expect(seen.headers['x-client-info'], 'fess_pos/${PosVersions.module}');
    expect(jsonDecode(seen.body), {'envelopes': <Object>[]});
    // A UUIDv7, inside the server's accepted request-id pattern.
    expect(
      seen.headers['x-pos-request-id'],
      matches(
        RegExp(
          '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-'
          r'[0-9a-f]{12}$',
        ),
      ),
    );
    expect(response.requestId, seen.headers['x-pos-request-id']);
    expect(response.body, {'ok': true});
  });

  test('without a token there is no authorization header', () async {
    late http.Request seen;
    final t = _transport(
      MockClient((r) async {
        seen = r;
        return jsonResponse(200, {'status': 'ok'});
      }),
    );
    await t.get('/health');
    expect(seen.method, 'GET');
    expect(seen.headers.containsKey('authorization'), isFalse);
  });

  test("the server's request id is the one kept", () async {
    final t = _transport(
      MockClient(
        (_) async => jsonResponse(
          200,
          <String, Object?>{},
          headers: {'x-pos-request-id': 'srv-req-1'},
        ),
      ),
    );
    expect((await t.get('/health')).requestId, 'srv-req-1');
  });

  test('an API error keeps its code, retryability, status and wait', () async {
    final t = _transport(
      MockClient(
        (_) async => jsonResponse(
          429,
          _fixture('valid/error')!,
          headers: {'retry-after': '30'},
        ),
      ),
    );
    await expectLater(
      t.post('/ingest', <String, Object?>{}),
      _apiError(
        'RATE_LIMITED',
        retryable: true,
        status: 429,
        retryAfter: const Duration(seconds: 30),
      ),
    );
  });

  test('a refusal the API marks final is parked, not retried', () async {
    final t = _transport(
      MockClient(
        (_) async => jsonResponse(400, apiError('INVALID_ENVELOPE')),
      ),
    );
    try {
      await t.post('/ingest', <String, Object?>{});
      fail('expected an error');
    } on PosApiException catch (e) {
      expect(e.retryable, isFalse);
      expect(classifyFailure(e), FailureAction.park);
    }
  });

  test('a page that is not from the API counts as no answer', () async {
    for (final status in [200, 302, 404, 502]) {
      final t = _transport(
        MockClient(
          (_) async => http.Response('<html>Wi-Fi login</html>', status),
        ),
      );
      await expectLater(
        t.post('/ingest', <String, Object?>{}),
        _apiError(
          status == 200
              ? PosErrorCodes.responseMalformed
              : PosErrorCodes.apiErrorMalformed,
          retryable: true,
          status: status,
        ),
        reason: 'HTTP $status',
      );
    }
  });

  test('no connection', () async {
    final t = _transport(
      MockClient((_) async => throw http.ClientException('Failed host lookup')),
    );
    await expectLater(
      t.post('/ingest', <String, Object?>{}),
      _apiError(PosErrorCodes.networkUnavailable, retryable: true),
    );
  });

  test('no answer in time', () async {
    final t = _transport(
      MockClient((_) async {
        await Future<void>.delayed(const Duration(milliseconds: 200));
        return jsonResponse(200, <String, Object?>{});
      }),
      timeout: const Duration(milliseconds: 20),
    );
    await expectLater(
      t.post('/ingest', <String, Object?>{}),
      _apiError(PosErrorCodes.requestTimeout, retryable: true),
    );
  });
}
