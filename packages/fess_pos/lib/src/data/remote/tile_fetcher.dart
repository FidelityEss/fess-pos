import 'dart:async';
import 'dart:typed_data';

import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/domain/maps/map_tiles.dart';
import 'package:http/http.dart' as http;

/// Fetches map tiles from the provider in remote config (`maps.tile_url`,
/// `maps.api_key`; D-14 keeps the provider open). Not the POS API: no
/// session and no request id, only the provider's publishable key.
class TileFetcher {
  TileFetcher({
    http.Client? client,
    this.timeout = const Duration(seconds: 15),
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final Duration timeout;

  /// [template] with the tile's `{z}`, `{x}` and `{y}`, and `{api_key}`
  /// (or `{key}`) from [apiKey]. Null when the template needs a key and
  /// there is none, or isn't a web address.
  static Uri? urlFor(String template, TileKey tile, {String? apiKey}) {
    final needsKey =
        template.contains('{api_key}') || template.contains('{key}');
    if (needsKey && (apiKey == null || apiKey.isEmpty)) return null;
    final key = Uri.encodeComponent(apiKey ?? '');
    final url = template
        .replaceAll('{z}', '${tile.z}')
        .replaceAll('{x}', '${tile.x}')
        .replaceAll('{y}', '${tile.y}')
        .replaceAll('{api_key}', key)
        .replaceAll('{key}', key);
    final uri = Uri.tryParse(url);
    return uri != null && (uri.scheme == 'https' || uri.scheme == 'http')
        ? uri
        : null;
  }

  /// The tile's bytes, or null for anything but a non-empty 200.
  Future<Uint8List?> fetch(Uri url) async {
    try {
      final res = await _client
          .get(url, headers: {'user-agent': 'fess-pos/${PosVersions.module}'})
          .timeout(timeout);
      return res.statusCode == 200 && res.bodyBytes.isNotEmpty
          ? res.bodyBytes
          : null;
    } on Object {
      return null;
    }
  }

  void close() => _client.close();
}
