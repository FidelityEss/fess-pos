import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/domain/preview/preview_request.dart';

/// Drafts for "Preview on a phone" links (docs/04 §10, T3-12), fetched from
/// the POS API with the signed-in user's session.
class ApiPreviewDrafts implements PreviewDrafts {
  const ApiPreviewDrafts(this._client);

  final PosApiClient _client;

  /// Null when the server doesn't know the token or it has expired; any
  /// other failure (no network, no session) is thrown for the page to say.
  @override
  Future<PreviewRequest?> fetch(String token) async {
    try {
      return PreviewRequest.fromJson(await _client.previewDraft(token));
    } on PosException catch (e) {
      if (e.code == 'NOT_FOUND') return null;
      rethrow;
    }
  }
}
