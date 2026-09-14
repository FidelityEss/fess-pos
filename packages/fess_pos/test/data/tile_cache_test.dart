@TestOn('vm')
library;

import 'dart:io';
import 'dart:typed_data';

import 'package:drift/native.dart';
import 'package:fess_pos/src/core/config/remote_config.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/local/tile_cache.dart';
import 'package:fess_pos/src/data/remote/tile_fetcher.dart';
import 'package:fess_pos/src/data/sync/sections.dart';
import 'package:fess_pos/src/domain/maps/map_tiles.dart';
import 'package:fess_pos/src/platform/connectivity.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const String _template = 'https://tiles.test/{z}/{x}/{y}.png?key={api_key}';
const GeoPoint _braam = GeoPoint(-26.1929, 28.0305);
const NetworkState _wifi = NetworkState(connected: true, unmetered: true);
const NetworkState _mobile = NetworkState.unknown;

Map<String, Object?> _maps({
  String? template = _template,
  String? key = 'pk-1',
  List<int> zoom = const [16, 17],
  int capMb = 150,
  bool wifiOnly = false,
}) => {
  'maps': {
    'tile_url': template,
    'api_key': key,
    'prefetch_zoom': zoom,
    'wifi_only_prefetch': wifiOnly,
  },
  'storage': {'tile_cache_mb': capMb},
};

void main() {
  late PosDatabase db;
  late Directory dir;
  late List<Uri> requests;
  late Map<String, Object?> values;
  var tileBytes = 3;

  CachedTileSource source() => CachedTileSource(
    db: db,
    fetcher: TileFetcher(
      client: MockClient((req) async {
        requests.add(req.url);
        return http.Response.bytes(Uint8List(tileBytes), 200);
      }),
    ),
    moduleDirectory: () async => dir.path,
    config: () async => RemoteConfig(values),
  );

  Future<void> putJob(
    String id, {
    String status = 'assigned',
    bool mine = true,
    Object? location = const {'lat': -26.1929, 'lng': 28.0305},
  }) => JobsSection(db).apply({
    'jobs': {
      'items': [
        {
          'id': id,
          'reference': 'POS-$id',
          'status': status,
          'assigned_to_me': mine,
          'updated_at': '2026-09-14T08:00:00Z',
          'location': location,
        },
      ],
    },
  });

  setUp(() {
    db = PosDatabase(NativeDatabase.memory());
    dir = Directory.systemTemp.createTempSync('fess_pos_tiles_');
    requests = [];
    values = _maps();
    tileBytes = 3;
  });

  tearDown(() async {
    await db.close();
    dir.deleteSync(recursive: true);
  });

  test('settings follow remote config', () async {
    final s = await source().settings();
    expect((s.available, s.minZoom, s.maxZoom), (true, 16, 17));
    values = _maps(template: null);
    expect((await source().settings()).available, isFalse);
    values = _maps(key: null);
    expect(
      (await source().settings()).available,
      isFalse,
      reason: 'the template needs a key',
    );
  });

  test('a tile is fetched once, then read from the phone', () async {
    final tiles = source();
    const key = TileKey(17, 1, 2);
    expect(await tiles.tile(key), hasLength(3));
    expect(await tiles.tile(key), hasLength(3));
    expect(requests, hasLength(1));
    expect(
      requests.single.toString(),
      'https://tiles.test/17/1/2.png?key=pk-1',
    );
    expect(File('${dir.path}/tiles/17/1/2').existsSync(), isTrue);
  });

  test('a new provider fetches its own tiles', () async {
    const key = TileKey(17, 1, 2);
    await source().tile(key);
    values = _maps(template: 'https://other.test/{z}/{x}/{y}?key={api_key}');
    await source().tile(key);
    expect(requests.map((u) => u.host), ['tiles.test', 'other.test']);
  });

  test('no provider: no tiles and no requests', () async {
    values = _maps(template: null);
    expect(await source().tile(const TileKey(17, 1, 2)), isNull);
    expect(requests, isEmpty);
  });

  test('past the cap the least recently used tiles go', () async {
    values = _maps(capMb: 1);
    tileBytes = 400 * 1024;
    final tiles = source();
    await tiles.tile(const TileKey(17, 1, 1));
    await tiles.tile(const TileKey(17, 1, 2));
    await tiles.tile(const TileKey(17, 1, 1)); // used again: now the newest
    await tiles.tile(const TileKey(17, 1, 3)); // 1.2 MB: one must go
    final kept = (await db.select(db.tileCacheIndex).get())
        .map((r) => r.key)
        .toSet();
    expect(kept, {'17/1/1', '17/1/3'});
    expect(File('${dir.path}/tiles/17/1/2').existsSync(), isFalse);
  });

  test(
    'prefetch keeps the tiles around each job the agent may visit',
    () async {
      await putJob('j1');
      await putJob('j2', status: 'closed');
      await putJob('j3', mine: false);
      await putJob('j4', location: null);
      final tiles = source();
      expect(await tiles.prefetchAssigned(_wifi), 18, reason: '2 zooms × 9');
      expect(
        await tiles.prefetchAssigned(_wifi),
        0,
        reason: 'the job is done for this provider and zooms',
      );
      requests.clear();
      expect(await tiles.tile(tileAt(_braam, 17)), isNotNull);
      expect(requests, isEmpty, reason: 'the map works offline');
    },
  );

  test('prefetch waits for a network it may use', () async {
    await putJob('j1');
    expect(await source().prefetchAssigned(NetworkState.offline), 0);
    values = _maps(wifiOnly: true);
    expect(await source().prefetchAssigned(_mobile), 0);
    expect(requests, isEmpty);
    expect(await source().prefetchAssigned(_wifi), 18);
  });
}
