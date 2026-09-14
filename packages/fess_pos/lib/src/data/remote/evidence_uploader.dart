import 'dart:async';
import 'dart:typed_data';

import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/data/remote/api_exception.dart';
import 'package:http/http.dart' as http;

/// Uploads evidence bytes to the target an upload grant names (docs/12 §6):
/// one PUT to the signed upload URL for the server-derived path. Storage
/// never overwrites an object, so a repeat after a lost answer is refused
/// as a duplicate, which means the bytes are already there.
///
/// Resumable uploads for large files and slow links come with T4-13.
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

  final String _publishableKey;
  final http.Client _client;
  final Duration timeout;

  Future<void> put(
    Uri signedUrl,
    Uint8List bytes, {
    required String contentType,
  }) async {
    final request = http.Request('PUT', signedUrl)
      ..headers.addAll({
        'apikey': _publishableKey,
        'content-type': contentType,
        'x-upsert': 'false',
      })
      ..bodyBytes = bytes;
    final int status;
    final String text;
    try {
      final response = await _client.send(request).timeout(timeout);
      status = response.statusCode;
      text = await response.stream.bytesToString().timeout(timeout);
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
    if (status >= 200 && status < 300) return;
    final duplicate =
        status == 409 ||
        RegExp('duplicate|already exists', caseSensitive: false).hasMatch(text);
    throw PosApiException(
      duplicate ? alreadyStored : uploadFailed,
      'the storage answered HTTP $status',
      kind: PosErrorKind.network,
      retryable: !duplicate,
      endpoint: 'storage',
      status: status,
    );
  }

  void close() => _client.close();
}
