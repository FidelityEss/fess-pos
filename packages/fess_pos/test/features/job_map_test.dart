import 'dart:convert';
import 'dart:typed_data';

import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/maps/map_tiles.dart';
import 'package:fess_pos/src/features/maps/job_map.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';

/// A 1×1 transparent PNG.
final Uint8List _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAj'
  'CB0C8AAAAASUVORK5CYII=',
);

class _Tiles implements TileSource {
  _Tiles(this._settings);

  final MapSettings _settings;
  final List<TileKey> requested = [];

  @override
  Future<MapSettings> settings() async => _settings;

  @override
  Future<Uint8List?> tile(TileKey key) async {
    requested.add(key);
    return _png;
  }
}

const GeoPoint _braam = GeoPoint(-26.1929, 28.0305);
const MapSettings _configured = MapSettings(available: true, minZoom: 16);

String _copy(String key) => BundledCopy.text(key);

Widget _host(
  Widget child, {
  required _Tiles tiles,
  FakeExternalApps? apps,
}) => ProviderScope(
  overrides: [
    activeDefinitionProvider.overrideWith((ref, key) => Stream.value(null)),
    tileSourceProvider.overrideWith((ref) async => tiles),
    mapSettingsProvider.overrideWith((ref) => tiles.settings()),
    platformServicesProvider.overrideWithValue(
      fakePlatform(externalApps: apps),
    ),
  ],
  child: MaterialApp(
    home: Scaffold(body: SingleChildScrollView(child: child)),
  ),
);

const JobMapPreview _preview = JobMapPreview(
  location: _braam,
  label: 'Braam Coffee Co.',
);

void main() {
  testWidgets('without a provider: the pin, a note, and working directions', (
    tester,
  ) async {
    final apps = FakeExternalApps();
    await tester.pumpWidget(
      _host(_preview, tiles: _Tiles(MapSettings.none), apps: apps),
    );
    await tester.pumpAndSettle();
    expect(find.text(_copy('map.not_configured')), findsOneWidget);
    expect(find.byType(FlutterMap), findsNothing);
    await tester.tap(find.byKey(const ValueKey('map-directions')));
    await tester.pump();
    expect(apps.directions.single, (
      lat: -26.1929,
      lng: 28.0305,
      label: 'Braam Coffee Co.',
    ));
  });

  testWidgets('a job without a location says so', (tester) async {
    await tester.pumpWidget(
      _host(
        const JobMapPreview(location: null),
        tiles: _Tiles(_configured),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(_copy('map.no_location')), findsOneWidget);
    expect(find.byKey(const ValueKey('map-directions')), findsNothing);
  });

  testWidgets('with a provider the map draws tiles at the kept zoom', (
    tester,
  ) async {
    final tiles = _Tiles(_configured);
    await tester.pumpWidget(_host(_preview, tiles: tiles));
    await tester.pump();
    await tester.pump();
    expect(find.byType(FlutterMap), findsOneWidget);
    expect(find.text(_copy('map.attribution')), findsOneWidget);
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 100)),
    );
    await tester.pump();
    expect(tiles.requested, isNotEmpty);
    expect(tiles.requested.map((t) => t.z).toSet(), {17});
  });

  testWidgets('the preview opens the full map, with directions there too', (
    tester,
  ) async {
    await tester.pumpWidget(_host(_preview, tiles: _Tiles(MapSettings.none)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('map-preview')));
    await tester.pumpAndSettle();
    expect(find.byType(JobMapPage), findsOneWidget);
    expect(find.text('Braam Coffee Co.'), findsOneWidget);
    expect(find.byKey(const ValueKey('map-directions')), findsOneWidget);
  });

  testWidgets('no maps app to hand over to: the agent is told', (
    tester,
  ) async {
    final apps = FakeExternalApps()..opens = false;
    await tester.pumpWidget(
      _host(_preview, tiles: _Tiles(MapSettings.none), apps: apps),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('map-directions')));
    await tester.pump();
    await tester.pump();
    expect(find.text(_copy('map.directions_failed')), findsOneWidget);
  });
}
