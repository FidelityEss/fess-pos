import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/data/remote/api_exception.dart';
import 'package:http/http.dart' as http;

/// One answer from the storage.
typedef _Answer = ({int status, String text, Map<String, String> headers});

/// Uploads evidence bytes to the target an upload grant names (docs/12 §6):
/// resumably (TUS) where the grant offers it (T4-13), else one PUT to the
/// signed upload URL for the server-derived path. Storage never overwrites
/// an object, so a repeat after a lost answer is refused as a duplicate,
/// which means the bytes are already there.
class EvidenceUploader {
  EvidenceUploader({
    required String publishableKey,
    http.Client? client,
    this.timeout = const Duration(minutes: 2),
  }) : _publishableKey = publishableKey,
       _client = client ?? http.Client();

  /// The storage refused the upload because the object exists.
  static const String alreadyStored = 'EVIDENCE_ALREADY_STORED';

  /// Any other failed upload. Always retryable: the next try asks for a
  /// fresh grant, and nothing on the phone is changed.
  static const String uploadFailed = 'EVIDENCE_UPLOAD_FAILED';

  /// The storage refused the resumable upload itself, not the network or a
  /// fault of its own: one PUT is tried instead.
  static const String resumableRefused = 'EVIDENCE_RESUMABLE_REFUSED';

  /// The resumable upload an earlier try created is gone; the next try
  /// creates another.
  static const String resumableGone = 'EVIDENCE_RESUMABLE_GONE';

  /// Supabase Storage takes resumable uploads 6 MB at a time.
  static const int chunkBytes = 6 * 1024 * 1024;

  final String _publishableKey;
  final http.Client _client;
  final Duration timeout;

  Future<void> put(
    Uri signedUrl,
    Uint8List bytes, {
    required String contentType,
  }) async {
    final answer = await _send(
      http.Request('PUT', signedUrl)
        ..headers.addAll({
          'apikey': _publishableKey,
          'content-type': contentType,
          'x-upsert': 'false',
        })
        ..bodyBytes = bytes,
    );
    if (answer.status >= 200 && answer.status < 300) return;
    throw _failure(answer);
  }

  /// A resumable upload (TUS 1.0; docs/12 §6 step 3) to the grant's
  /// [endpoint], with its [headers] (the grant's signature). It is created
  /// once, then the bytes go from where the storage has them, so an
  /// interrupted upload carries on, even after the app was closed.
  /// [resumeAt] is the upload an earlier try created; [onCreated] keeps a
  /// new one's address before any byte goes.
  Future<void> resumable(
    Uri endpoint, {
    required Map<String, String> headers,
    required String bucket,
    required String path,
    required Uint8List bytes,
    required String contentType,
    Uri? resumeAt,
    Future<void> Function(Uri upload)? onCreated,
  }) async {
    final base = {
      'apikey': _publishableKey,
      'tus-resumable': '1.0.0',
      ...headers,
    };
    var upload = resumeAt;
    var offset = upload == null ? 0 : await _offset(upload, base);
    if (offset == null) upload = null;
    if (upload == null) {
      String b64(String s) => base64Encode(utf8.encode(s));
      final created = await _send(
        http.Request('POST', endpoint)
          ..headers.addAll({
            ...base,
            'upload-length': '${bytes.length}',
            'upload-metadata': [
              'bucketName ${b64(bucket)}',
              'objectName ${b64(path)}',
              'contentType ${b64(contentType)}',
            ].join(','),
            'x-upsert': 'false',
          }),
      );
      final location = created.headers['location'];
      if (created.status != 201 || location == null) {
        throw _failure(
          created,
          code: created.status >= 500 ? uploadFailed : resumableRefused,
        );
      }
      upload = endpoint.resolve(location);
      await onCreated?.call(upload);
      offset = 0;
    }
    var from = offset ?? 0;
    while (from < bytes.length) {
      final to = math.min(from + chunkBytes, bytes.length);
      final sent = await _send(
        http.Request('PATCH', upload)
          ..headers.addAll({
            ...base,
            'upload-offset': '$from',
            'content-type': 'application/offset+octet-stream',
          })
          ..bodyBytes = bytes.sublist(from, to),
      );
      if (sent.status == 409) {
        // The storage has a different offset: carry on from its own.
        from = await _offset(upload, base) ?? (throw _failure(sent));
        continue;
      }
      if (sent.status == 404 || sent.status == 410) {
        throw _failure(sent, code: resumableGone);
      }
      if (sent.status < 200 || sent.status >= 300) throw _failure(sent);
      from = int.tryParse(sent.headers['upload-offset'] ?? '') ?? to;
    }
  }

  /// How much of [upload] the storage has; null when it's gone.
  Future<int?> _offset(Uri upload, Map<String, String> headers) async {
    final head = await _send(
      http.Request('HEAD', upload)..headers.addAll(headers),
    );
    if (head.status != 200 && head.status != 204) return null;
    return int.tryParse(head.headers['upload-offset'] ?? '') ?? 0;
  }

  PosApiException _failure(_Answer answer, {String? code}) {
    final duplicate =
        answer.status == 409 ||
        RegExp(
          'duplicate|already exists',
          caseSensitive: false,
        ).hasMatch(answer.text);
    final failed = code ?? (duplicate ? alreadyStored : uploadFailed);
    return PosApiException(
      failed,
      'the storage answered HTTP ${answer.status}',
      kind: PosErrorKind.network,
      retryable: failed == uploadFailed || failed == resumableGone,
      endpoint: 'storage',
      status: answer.status,
    );
  }

  Future<_Answer> _send(http.BaseRequest request) async {
    try {
      final response = await _client.send(request).timeout(timeout);
      final text = await response.stream.bytesToString().timeout(timeout);
      return (
        status: response.statusCode,
        text: text,
        headers: response.headers,
      );
    } on TimeoutException catch (e) {
      throw PosApiException(
        PosErrorCodes.requestTimeout,
        'the upload took longer than ${timeout.inSeconds} s',
        kind: PosErrorKind.network,
        retryable: true,
        endpoint: 'storage',
        cause: e,
      );
    } on Exception catch (e) {
      throw PosApiException(
        PosErrorCodes.networkUnavailable,
        'the storage could not be reached',
        kind: PosErrorKind.network,
        retryable: true,
        endpoint: 'storage',
        cause: e,
      );
    }
  }

  void close() => _client.close();
}
