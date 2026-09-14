import 'dart:convert';
import 'dart:math' as math;

import 'package:drift/drift.dart';
import 'package:fess_pos/src/core/config/remote_config.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/remote/tile_fetcher.dart';
import 'package:fess_pos/src/domain/maps/map_tiles.dart';
import 'package:fess_pos/src/platform/connectivity.dart';
import 'package:fess_pos/src/platform/io/files.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show sha256Hex;
import 'package:path/path.dart' as p;

const PosLogger _log = PosLogger('maps');

/// Statuses of a job the agent may still go to, whose map is worth having
/// offline.
const Set<String> _goingThere = {
  'assigned',
  'accepted',
  'in_progress',
  'paused',
  'returned',
};

/// Deleted a batch at a time when the cache is over its cap.
const int _evictBatch = 200;

class _Setup {
  const _Setup(
    this.settings, {
    this.template,
    this.apiKey,
    this.source = '',
    this.capBytes = 0,
    this.wifiOnly = false,
  });

  final MapSettings settings;
  final String? template;
  final String? apiKey;

  /// Which provider tiles come from: a hash of the template.
  final String source;
  final int capBytes;
  final bool wifiOnly;
}

/// Map tiles through the phone's cache (docs/08 §2 and §4; D-62): a tile is
/// read from the cache when it's there, else fetched from the provider in
/// remote config and kept. The cache is a folder of tile files with an
/// index in the local store; the least recently used go first once it
/// passes `storage.tile_cache_mb`. On the web there is no folder: tiles are
/// fetched each time.
///
/// After each sync the tiles around every job the agent may still go to
/// are prefetched ([prefetchAssigned]), so the map works on site without
/// signal.
class CachedTileSource implements TileSource {
  CachedTileSource({
    required PosDatabase db,
    required TileFetcher fetcher,
    required Future<String?> Function() moduleDirectory,
    required Future<RemoteConfig> Function() config,
    DateTime Function() clock = DateTime.now,
  }) : _db = db,
       _fetcher = fetcher,
       _moduleDirectory = moduleDirectory,
       _config = config,
       _clock = clock;

  final PosDatabase _db;
  final TileFetcher _fetcher;
  final Future<String?> Function() _moduleDirectory;
  final Future<RemoteConfig> Function() _config;
  final DateTime Function() _clock;

  @override
  Future<MapSettings> settings() async => (await _setup()).settings;

  @override
  Future<Uint8List?> tile(TileKey key) async {
    final s = await _setup();
    final template = s.template;
    if (!s.settings.available || template == null) return null;
    final dir = await _tileDirectory();
    if (dir != null) {
      final cached = await _cached(dir, key, s.source);
      if (cached != null) return cached;
    }
    final url = TileFetcher.urlFor(template, key, apiKey: s.apiKey);
    final bytes = url == null ? null : await _fetcher.fetch(url);
    if (bytes != null && dir != null) await _store(dir, key, s, bytes);
    return bytes;
  }

  /// Fetches the tiles around each job the agent may still go to (see
  /// [prefetchTiles]) that the cache lacks. Nothing happens offline, on
  /// mobile data when `maps.wifi_only_prefetch` is set, without a provider,
  /// or on the web. A job is done once all its tiles are kept for the
  /// current provider and zooms. Returns the number fetched.
  Future<int> prefetchAssigned(NetworkState network) async {
    final s = await _setup();
    final template = s.template;
    final dir = await _tileDirectory();
    if (!s.settings.available || template == null || dir == null) return 0;
    if (!network.connected || (s.wifiOnly && !network.unmetered)) return 0;
    final jobs =
        await (_db.select(_db.jobs)..where(
              (j) => j.assignedToMe.equals(true) & j.status.isIn(_goingThere),
            ))
            .get();
    var fetched = 0;
    for (final job in jobs) {
      final point = GeoPoint.tryParse(_location(job.body));
      if (point == null) continue;
      final settings = s.settings;
      final done =
          '${s.source}:${settings.minZoom}-${settings.maxZoom}:'
          '${point.lat},${point.lng}';
      final doneKey = 'tiles.job.${job.id}';
      if (await _state(doneKey) == done) continue;
      var complete = true;
      for (final key in prefetchTiles(
        point,
        settings.minZoom,
        settings.maxZoom,
      )) {
        if (await _has(key, s.source)) continue;
        final url = TileFetcher.urlFor(template, key, apiKey: s.apiKey);
        final bytes = url == null ? null : await _fetcher.fetch(url);
        if (bytes == null) {
          complete = false;
          continue;
        }
        await _store(dir, key, s, bytes);
        fetched++;
      }
      if (complete) await _setState(doneKey, done);
    }
    if (fetched > 0) _log.info('kept $fetched map tiles for offline use');
    return fetched;
  }

  Future<_Setup> _setup() async {
    final c = await _config();
    final template = c.text('maps.tile_url');
    final apiKey = c.text('maps.api_key');
    final zoom = c.value('maps.prefetch_zoom');
    final (a, b) =
        zoom is List<Object?> &&
            zoom.length == 2 &&
            zoom[0] is int &&
            zoom[1] is int
        ? (zoom[0]! as int, zoom[1]! as int)
        : (14, 17);
    final available =
        template != null &&
        TileFetcher.urlFor(template, const TileKey(0, 0, 0), apiKey: apiKey) !=
            null;
    return _Setup(
      MapSettings(
        available: available,
        minZoom: math.min(a, b),
        maxZoom: math.max(a, b),
      ),
      template: template,
      apiKey: apiKey,
      source: template == null ? '' : sha256Hex(template).substring(0, 16),
      capBytes: c.integer('storage.tile_cache_mb') * 1024 * 1024,
      wifiOnly: c.flag('maps.wifi_only_prefetch'),
    );
  }

  Future<String?> _tileDirectory() async {
    final dir = await _moduleDirectory();
    return dir == null ? null : p.join(dir, 'tiles');
  }

  static String _file(String dir, String key) =>
      p.joinAll([dir, ...key.split('/')]);

  Future<TileRow?> _row(String key) => (_db.select(
    _db.tileCacheIndex,
  )..where((t) => t.key.equals(key))).getSingleOrNull();

  Future<bool> _has(TileKey key, String source) async =>
      (await _row(key.path))?.source == source;

  Future<Uint8List?> _cached(String dir, TileKey key, String source) async {
    final row = await _row(key.path);
    if (row == null || row.source != source) return null;
    final bytes = await readBytes(_file(dir, key.path));
    if (bytes == null) {
      // The file went (e.g. the OS cleared space): forget it.
      await (_db.delete(
        _db.tileCacheIndex,
      )..where((t) => t.key.equals(key.path))).go();
      return null;
    }
    await (_db.update(
      _db.tileCacheIndex,
    )..where((t) => t.key.equals(key.path))).write(
      TileCacheIndexCompanion(
        lastUsedMs: Value(_clock().millisecondsSinceEpoch),
      ),
    );
    return bytes;
  }

  Future<void> _store(
    String dir,
    TileKey key,
    _Setup s,
    Uint8List bytes,
  ) async {
    try {
      final now = _clock().millisecondsSinceEpoch;
      await writeBytes(_file(dir, key.path), bytes);
      await _db
          .into(_db.tileCacheIndex)
          .insertOnConflictUpdate(
            TileCacheIndexCompanion.insert(
              key: key.path,
              source: s.source,
              bytes: bytes.length,
              fetchedAtMs: now,
              lastUsedMs: now,
            ),
          );
      await _evict(dir, s.capBytes);
    } on Object catch (e, st) {
      _log.warning('a map tile could not be kept', error: e, stackTrace: st);
    }
  }

  /// Deletes the least recently used tiles until the cache fits [cap].
  Future<void> _evict(String dir, int cap) async {
    final total = _db.tileCacheIndex.bytes.sum();
    var over =
        (await (_db.selectOnly(
              _db.tileCacheIndex,
            )..addColumns([total])).map((r) => r.read(total)).getSingle() ??
            0) -
        cap;
    while (over > 0) {
      final oldest =
          await (_db.select(_db.tileCacheIndex)
                ..orderBy([(t) => OrderingTerm.asc(t.lastUsedMs)])
                ..limit(_evictBatch))
              .get();
      if (oldest.isEmpty) return;
      for (final row in oldest) {
        if (over <= 0) break;
        await deleteFileIfExists(_file(dir, row.key));
        await (_db.delete(
          _db.tileCacheIndex,
        )..where((t) => t.key.equals(row.key))).go();
        over -= row.bytes;
      }
    }
  }

  Future<String?> _state(String key) async => (await (_db.select(
    _db.syncState,
  )..where((s) => s.key.equals(key))).getSingleOrNull())?.value;

  Future<void> _setState(String key, String value) => _db
      .into(_db.syncState)
      .insertOnConflictUpdate(
        SyncStateCompanion.insert(
          key: key,
          value: value,
          updatedAt: isoWithOffset(_clock()),
        ),
      );

  static Object? _location(String body) {
    try {
      final job = jsonDecode(body);
      return job is Map<String, Object?> ? job['location'] : null;
    } on FormatException {
      return null;
    }
  }
}
