import 'dart:math' as math;
import 'dart:typed_data';

import 'package:meta/meta.dart';

/// A place on the map (WGS84), e.g. a job's `location`.
@immutable
class GeoPoint {
  const GeoPoint(this.lat, this.lng);

  /// From `{lat, lng}` (`common.schema.json#/$defs/point`); null when
  /// missing or out of range.
  static GeoPoint? tryParse(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final lat = json['lat'];
    final lng = json['lng'];
    if (lat is! num || lng is! num) return null;
    if (lat.abs() > 90 || lng.abs() > 180) return null;
    return GeoPoint(lat.toDouble(), lng.toDouble());
  }

  final double lat;
  final double lng;

  @override
  bool operator ==(Object other) =>
      other is GeoPoint && other.lat == lat && other.lng == lng;

  @override
  int get hashCode => Object.hash(lat, lng);

  @override
  String toString() => 'GeoPoint($lat, $lng)';
}

/// One map tile in the Web Mercator ("slippy map") scheme providers use.
@immutable
class TileKey {
  const TileKey(this.z, this.x, this.y);

  final int z;
  final int x;
  final int y;

  /// `z/x/y`, the cache's key and the tile's file path.
  String get path => '$z/$x/$y';

  @override
  bool operator ==(Object other) =>
      other is TileKey && other.z == z && other.x == x && other.y == y;

  @override
  int get hashCode => Object.hash(z, x, y);

  @override
  String toString() => 'TileKey($path)';
}

/// The tile holding [p] at zoom [z].
TileKey tileAt(GeoPoint p, int z) {
  final n = 1 << z;
  final x = ((p.lng + 180) / 360 * n).floor().clamp(0, n - 1);
  // Web Mercator stops short of the poles; clamp so tan() stays finite.
  final lat = p.lat.clamp(-85.05112878, 85.05112878) * math.pi / 180;
  final y =
      ((1 - math.log(math.tan(lat) + 1 / math.cos(lat)) / math.pi) / 2 * n)
          .floor()
          .clamp(0, n - 1);
  return TileKey(z, x, y);
}

/// What is prefetched for a job (D-62): at each zoom from [minZoom] to
/// [maxZoom], the tile holding its location and the eight around it, so
/// the agent can see the approach from any side while offline.
List<TileKey> prefetchTiles(GeoPoint p, int minZoom, int maxZoom) {
  final lo = math.min(minZoom, maxZoom);
  final hi = math.max(minZoom, maxZoom);
  final out = <TileKey>[];
  for (var z = lo; z <= hi; z++) {
    final n = 1 << z;
    final centre = tileAt(p, z);
    for (var dy = -1; dy <= 1; dy++) {
      final y = centre.y + dy;
      if (y < 0 || y >= n) continue;
      for (var dx = -1; dx <= 1; dx++) {
        // Longitude wraps around the date line.
        final x = (centre.x + dx) % n;
        final key = TileKey(z, x, y);
        if (!out.contains(key)) out.add(key);
      }
    }
  }
  return out;
}

/// How the map is set up now (remote config `maps.*`).
@immutable
class MapSettings {
  const MapSettings({
    required this.available,
    this.minZoom = 14,
    this.maxZoom = 17,
  });

  static const MapSettings none = MapSettings(available: false);

  /// A tile provider is configured. Without one, the location shows without
  /// a map, and directions still work.
  final bool available;

  /// The zoom levels prefetched per job (`maps.prefetch_zoom`); the map
  /// opens at [maxZoom], the closest one kept offline.
  final int minZoom;
  final int maxZoom;
}

/// Map tiles for the module (B2.5): from the phone's cache first, else from
/// the provider in remote config (`maps.tile_url`, `maps.api_key`).
abstract interface class TileSource {
  Future<MapSettings> settings();

  /// The tile's image bytes, or null when it can't be had now (offline
  /// and not cached, or no provider).
  Future<Uint8List?> tile(TileKey key);
}
