import 'package:fess_pos/src/domain/maps/map_tiles.dart';
import 'package:flutter_test/flutter_test.dart';

const GeoPoint _braam = GeoPoint(-26.1929, 28.0305);

void main() {
  test('the tile holding a place', () {
    expect(
      tileAt(const GeoPoint(51.5074, -0.1278), 10),
      const TileKey(10, 511, 340),
    );
    expect(tileAt(const GeoPoint(0, 0), 0), const TileKey(0, 0, 0));
  });

  test('a job keeps its tile and the eight around it at each zoom', () {
    final tiles = prefetchTiles(_braam, 14, 17);
    expect(tiles, hasLength(36));
    for (var z = 14; z <= 17; z++) {
      expect(tiles.where((t) => t.z == z), hasLength(9), reason: 'zoom $z');
    }
    expect(tiles, contains(tileAt(_braam, 17)));
    expect(prefetchTiles(_braam, 17, 14), hasLength(36), reason: 'any order');
  });

  test('across the date line, and near the pole', () {
    final dateLine = prefetchTiles(const GeoPoint(0, 179.999), 2, 2);
    expect(dateLine, hasLength(9));
    expect(dateLine.map((t) => t.x).toSet(), {2, 3, 0});
    // At zoom 1 there are only 2×2 tiles: no row above the top one, and
    // the columns wrap onto each other.
    expect(prefetchTiles(const GeoPoint(85, 0), 1, 1), hasLength(4));
  });

  test('a location reads only when it is one', () {
    expect(
      GeoPoint.tryParse({'lat': -26.1929, 'lng': 28}),
      const GeoPoint(-26.1929, 28),
    );
    expect(GeoPoint.tryParse({'lat': 91, 'lng': 0}), isNull);
    expect(GeoPoint.tryParse({'lat': '1', 'lng': 2}), isNull);
    expect(GeoPoint.tryParse(null), isNull);
  });
}
