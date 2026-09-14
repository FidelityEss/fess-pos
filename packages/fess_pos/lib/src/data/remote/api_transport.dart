import 'dart:async';
import 'dart:convert';

import 'package:fess_pos/src/contract/bootstrap.dart';
import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/data/remote/api_exception.dart';
import 'package:http/http.dart' as http;
import 'package:meta/meta.dart';
import 'package:uuid/uuid.dart';

/// A successful POS API answer: HTTP 2xx with a JSON object.
@immutable
class ApiResponse {
  const ApiResponse({
    required this.status,
    required this.body,
    required this.requestId,
  });

  final int status;
  final Map<String, Object?> body;

  /// The request id the server logged this call under.
  final String requestId;
}

/// The POS API over plain HTTPS (docs/03 §4, §7): one request, one answer,
/// no retries. Retry policy belongs to the callers (docs/12 §4).
///
/// Every request carries the publishable key (`apikey`) and a request id
/// (`x-pos-request-id`), which the server propagates to its logs and rows.
/// Agent calls add the POS access token. Nothing here logs a token or a
/// body.
class ApiTransport {
  ApiTransport({
    required PosBootstrap bootstrap,
    http.Client? client,
    this.timeout = const Duration(seconds: 30),
    String Function()? newRequestId,
  }) : _base = bootstrap.apiBaseUrl,
       _publishableKey = bootstrap.publishableKey,
       _client = client ?? http.Client(),
       _newRequestId = newRequestId ?? _uuid.v7;

  static const Uuid _uuid = Uuid();
  static const String requestIdHeader = 'x-pos-request-id';

  final Uri _base;
  final String _publishableKey;
  final http.Client _client;
  final String Function() _newRequestId;

  /// The longest a call may take, answer included.
  final Duration timeout;

  /// `<apiBaseUrl>/v1<path>`.
  Uri uriFor(String path) {
    final basePath = _base.path.endsWith('/')
        ? _base.path.substring(0, _base.path.length - 1)
        : _base.path;
    return _base.replace(path: '$basePath/v${PosVersions.api}$path');
  }

  Future<ApiResponse> post(
    String path,
    Object body, {
    String? accessToken,
    String? requestId,
  }) => _send(
    'POST',
    path,
    body: body,
    accessToken: accessToken,
    requestId: requestId,
  );

  Future<ApiResponse> get(String path, {String? accessToken}) =>
      _send('GET', path, accessToken: accessToken);

  /// Closes the HTTP client. Only when the module shuts down.
  void close() => _client.close();

  Future<ApiResponse> _send(
    String method,
    String path, {
    Object? body,
    String? accessToken,
    String? requestId,
  }) async {
    final rid = requestId ?? _newRequestId();
    final request = http.Request(method, uriFor(path))
      ..headers.addAll({
        'apikey': _publishableKey,
        'accept': 'application/json',
        requestIdHeader: rid,
        'x-client-info': 'fess_pos/${PosVersions.module}',
        if (accessToken != null) 'authorization': 'Bearer $accessToken',
        if (body != null) 'content-type': 'application/json',
      });
    if (body != null) request.body = jsonEncode(body);

    final int status;
    final Map<String, String> headers;
    final String text;
    try {
      (status, headers, text) = await _exchange(request).timeout(timeout);
    } on TimeoutException catch (e) {
      throw PosApiException(
        PosErrorCodes.requestTimeout,
        'no answer from the POS API within ${timeout.inSeconds} s',
        kind: PosErrorKind.network,
        retryable: true,
        endpoint: path,
        requestId: rid,
        cause: e,
      );
    } on Exception catch (e) {
      // http.ClientException, TLS failures: nothing reached the API.
      throw PosApiException(
        PosErrorCodes.networkUnavailable,
        'the POS API could not be reached',
        kind: PosErrorKind.network,
        retryable: true,
        endpoint: path,
        requestId: rid,
        cause: e,
      );
    }

    final answeredId = headers[requestIdHeader] ?? rid;
    Object? json;
    if (text.isNotEmpty) {
      try {
        json = jsonDecode(text);
      } on FormatException {
        json = null;
      }
    }
    if (status >= 200 && status < 300) {
      if (json is Map<String, Object?>) {
        return ApiResponse(status: status, body: json, requestId: answeredId);
      }
      // Often a captive portal answering 200 with a web page.
      throw PosApiException(
        PosErrorCodes.responseMalformed,
        'HTTP $status without a JSON object',
        kind: PosErrorKind.network,
        retryable: true,
        endpoint: path,
        status: status,
        requestId: answeredId,
      );
    }
    throw PosApiException.fromResponse(
      json,
      status: status,
      endpoint: path,
      requestId: answeredId,
      retryAfter: parseRetryAfter(headers['retry-after']),
    );
  }

  Future<(int, Map<String, String>, String)> _exchange(
    http.Request request,
  ) async {
    final response = await _client.send(request);
    final text = await response.stream.bytesToString();
    return (response.statusCode, response.headers, text);
  }
}
