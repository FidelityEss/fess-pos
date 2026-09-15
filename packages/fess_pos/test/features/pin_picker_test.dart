import 'dart:convert';
import 'dart:typed_data';

import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/maps/map_tiles.dart';
import 'package:fess_pos/src/features/maps/job_map.dart';
import 'package:fess_pos/src/platform/location.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:flutter/material.dart';
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

  @override
  Future<MapSettings> settings() async => _settings;

  @override
  Future<Uint8List?> tile(TileKey key) async => _png;
}

const GeoPoint _start = GeoPoint(-26.2041, 28.0473);
const MapSettings _configured = MapSettings(available: true, minZoom: 16);

typedef _Pin = ({GeoPoint point, String source});

Future<List<_Pin?>> _open(
  WidgetTester tester, {
  GeoPoint? initial,
  MapSettings settings = _configured,
  LocationFix? fix,
}) async {
  final result = <_Pin?>[];
  final tiles = _Tiles(settings);
  final base = fakePlatform();
  final location = FakeLocation()..fix = fix;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        activeDefinitionProvider.overrideWith((ref, key) => Stream.value(null)),
        tileSourceProvider.overrideWith((ref) async => tiles),
        mapSettingsProvider.overrideWith((ref) => tiles.settings()),
        platformServicesProvider.overrideWithValue(
          PlatformServices(
            secureStore: base.secureStore,
            connectivity: base.connectivity,
            location: location,
            camera: base.camera,
            deviceInfo: base.deviceInfo,
            storage: base.storage,
            integrity: base.integrity,
            backgroundWork: base.backgroundWork,
            externalApps: base.externalApps,
          ),
        ),
      ],
      child: MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async => result.add(
                await Navigator.of(context).push<_Pin>(
                  MaterialPageRoute(
                    builder: (_) =>
                        PinPickerPage(initial: initial, title: 'Entrance'),
                  ),
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return result;
}

Future<void> _use(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('pin-use')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the spot under the pin is used as it is (T4-11)', (
    tester,
  ) async {
    final result = await _open(tester, initial: _start);
    expect(find.byKey(const ValueKey('pin-map')), findsOneWidget);
    await _use(tester);
    final pin = result.single!;
    expect(pin.source, 'map_pin');
    expect(pin.point.lat, closeTo(_start.lat, 1e-6));
    expect(pin.point.lng, closeTo(_start.lng, 1e-6));
  });

  testWidgets('moving the map moves the pin', (tester) async {
    final result = await _open(tester, initial: _start);
    await tester.drag(
      find.byKey(const ValueKey('pin-map')),
      const Offset(0, 200),
    );
    await tester.pumpAndSettle();
    await _use(tester);
    final pin = result.single!;
    expect(pin.source, 'map_pin');
    expect(
      pin.point.lat,
      greaterThan(_start.lat),
      reason: 'dragging the map down brings the north under the pin',
    );
  });

  testWidgets('without tiles, the current location gives the pin', (
    tester,
  ) async {
    final result = await _open(
      tester,
      settings: MapSettings.none,
      fix: LocationFix(
        latitude: -26.19,
        longitude: 28.03,
        accuracyM: 8,
        fixTime: DateTime.utc(2026, 9, 14, 10),
      ),
    );
    // No start: it looks for the current location at once.
    expect(find.byKey(const ValueKey('pin-no-map')), findsOneWidget);
    await _use(tester);
    final pin = result.single!;
    expect(
      (pin.point.lat, pin.point.lng, pin.source),
      (
        -26.19,
        28.03,
        'current_location',
      ),
    );
  });
}
