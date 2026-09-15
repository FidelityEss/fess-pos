import 'dart:async';
import 'dart:convert';

import 'package:fess_pos/src/data/remote/api_transport.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/remote/session_vault.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'test_host.dart';

typedef ApiAnswer = FutureOr<http.Response> Function(http.Request request);

/// A scripted POS API. Answers are queued per path and used in order; the
/// last one repeats. Unknown paths get a 404 error body.
class FakePosApi {
  FakePosApi() {
    client = MockClient(_handle);
  }

  late final MockClient client;
  final List<http.Request> requests = [];
  final Map<String, List<ApiAnswer>> _answers = {};

  void on(String path, ApiAnswer answer) => (_answers[path] ??= []).add(answer);

  void reset(String path) => _answers.remove(path);

  List<http.Request> calls(String path) => [
    for (final r in requests)
      if (pathOf(r) == path) r,
  ];

  /// `/sync/pull` from `…/functions/v1/api/v1/sync/pull`.
  static String pathOf(http.BaseRequest r) => r.url.path.split('/v1').last;

  Future<http.Response> _handle(http.Request r) async {
    requests.add(r);
    final answers = _answers[pathOf(r)];
    if (answers == null || answers.isEmpty) {
      return jsonResponse(404, apiError('NOT_FOUND'));
    }
    final next = answers.length > 1 ? answers.removeAt(0) : answers.first;
    return next(r);
  }
}

Map<String, Object?> bodyOf(http.Request r) =>
    jsonDecode(r.body) as Map<String, Object?>;

http.Response jsonResponse(
  int status,
  Object body, {
  Map<String, String> headers = const {},
}) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json', ...headers},
);

Map<String, Object?> apiError(String code, {bool retryable = false}) => {
  'error': {'code': code, 'message': 'test $code', 'retryable': retryable},
  'request_id': 'req-test',
};

const String refreshToken1 = 'refresh-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const String refreshToken2 = 'refresh-2-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const String testDeviceId = '11111111-2222-4333-8444-555555555555';

/// An exchange or refresh answer
/// (`schema/api/auth-exchange-response.schema.json`).
Map<String, Object?> sessionAnswer({
  required DateTime serverTime,
  String sessionId = '4f2a1b3c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
  String userId = 'u-1',
  String employeeNumber = 'E0001',
  String scope = 'full',
  String accessToken = 'access-1',
  String refreshToken = refreshToken1,
  Duration accessTtl = const Duration(minutes: 15),
  Duration refreshTtl = const Duration(days: 30),
}) => {
  'access_token': accessToken,
  'access_expires_at': serverTime.add(accessTtl).toUtc().toIso8601String(),
  'refresh_token': refreshToken,
  'refresh_expires_at': serverTime.add(refreshTtl).toUtc().toIso8601String(),
  'session_id': sessionId,
  'scope': scope,
  'user': {
    'id': userId,
    'employee_number': employeeNumber,
    'first_name': 'Test',
    'last_name': 'Agent',
    'role': 'pos_agent',
    'active': true,
  },
  'server_time': serverTime.toUtc().toIso8601String(),
  'profile_mismatch': null,
};

/// A clock tests move by hand.
class TestClock {
  TestClock([DateTime? start]) : now = start ?? DateTime.utc(2026, 9, 14, 8);

  DateTime now;

  DateTime call() => now;

  void advance(Duration d) => now = now.add(d);
}

/// A client on [api], with an in-memory secure store unless given one.
PosApiClient testApiClient(
  FakePosApi api, {
  required TestClock clock,
  SecureStore? store,
}) {
  var n = 0;
  return PosApiClient(
    transport: ApiTransport(
      bootstrap: testBootstrap,
      client: api.client,
      newRequestId: () => 'req-${++n}-test',
    ),
    vault: SessionVault(
      store ?? MemorySecureStore(),
      newDeviceId: () => testDeviceId,
    ),
    clock: clock.call,
  );
}
