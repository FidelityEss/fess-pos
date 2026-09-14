import 'dart:ui' as ui;

import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:fess_pos/src/domain/maps/map_tiles.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

T? _data<T>(AsyncValue<T> value) => switch (value) {
  AsyncData(:final value) => value,
  _ => null,
};

/// A job's location on its page (`map_preview`, `11` §7.2; B2.5): a small
/// map that opens the full one, and directions in the phone's maps app.
class JobMapPreview extends ConsumerWidget {
  const JobMapPreview({
    required this.location,
    this.height = 180,
    this.label,
    super.key,
  });

  final GeoPoint? location;
  final double height;

  /// What the maps app calls the place, e.g. the merchant's name.
  final String? label;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final copy = ref.watch(copyProvider);
    final at = location;
    if (at == null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(copy('map.no_location')),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: height,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(PosTokens.radiusCard),
              child: Stack(
                children: [
                  Positioned.fill(
                    child: JobMap(location: at, interactive: false),
                  ),
                  Positioned.fill(
                    child: Material(
                      type: MaterialType.transparency,
                      child: InkWell(
                        key: const ValueKey('map-preview'),
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) =>
                                JobMapPage(location: at, label: label),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: DirectionsButton(location: at, label: label),
          ),
        ],
      ),
    );
  }
}

/// A job's location on a full page, with directions.
class JobMapPage extends ConsumerWidget {
  const JobMapPage({required this.location, this.label, super.key});

  final GeoPoint location;
  final String? label;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final copy = ref.watch(copyProvider);
    return Scaffold(
      appBar: PosHeader(
        title: label ?? copy('map.title'),
        onBack: () => Navigator.of(context).pop(),
      ),
      body: JobMap(location: location),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: DirectionsButton(location: location, label: label),
        ),
      ),
    );
  }
}

/// Hands over to the phone's maps app for directions (B2.5).
class DirectionsButton extends ConsumerWidget {
  const DirectionsButton({required this.location, this.label, super.key});

  final GeoPoint location;
  final String? label;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final copy = ref.watch(copyProvider);
    return FilledButton.tonalIcon(
      key: const ValueKey('map-directions'),
      icon: const Icon(Icons.directions),
      label: Text(copy('map.directions')),
      onPressed: () async {
        final apps = ref.read(platformServicesProvider).externalApps;
        final opened = await apps.openDirections(
          location.lat,
          location.lng,
          label: label,
        );
        if (!opened && context.mounted) {
          ScaffoldMessenger.maybeOf(context)?.showSnackBar(
            SnackBar(content: Text(copy('map.directions_failed'))),
          );
        }
      },
    );
  }
}

/// The map around [location], with its pin. Tiles come from the phone's
/// cache or the configured provider; without a provider the pin and a note
/// show instead (directions still work).
class JobMap extends ConsumerWidget {
  const JobMap({required this.location, this.interactive = true, super.key});

  final GeoPoint location;
  final bool interactive;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final copy = ref.watch(copyProvider);
    final source = _data(ref.watch(tileSourceProvider));
    final settings = _data(ref.watch(mapSettingsProvider));
    final scheme = Theme.of(context).colorScheme;
    if (source == null || settings == null || !settings.available) {
      return ColoredBox(
        key: const ValueKey('map-unavailable'),
        color: scheme.surfaceContainerHighest,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.location_on, size: 40, color: scheme.primary),
                const SizedBox(height: 8),
                Text(copy('map.not_configured'), textAlign: TextAlign.center),
              ],
            ),
          ),
        ),
      );
    }
    final point = LatLng(location.lat, location.lng);
    return FlutterMap(
      key: const ValueKey('job-map'),
      options: MapOptions(
        initialCenter: point,
        initialZoom: settings.maxZoom.toDouble(),
        minZoom: 3,
        maxZoom: 19,
        interactionOptions: InteractionOptions(
          flags: interactive
              ? InteractiveFlag.all & ~InteractiveFlag.rotate
              : InteractiveFlag.none,
        ),
      ),
      children: [
        TileLayer(
          tileProvider: _SourceTiles(source),
          tileDisplay: const TileDisplay.instantaneous(),
        ),
        MarkerLayer(
          markers: [
            Marker(
              point: point,
              width: 40,
              height: 40,
              alignment: Alignment.topCenter,
              child: Icon(Icons.location_on, size: 40, color: scheme.error),
            ),
          ],
        ),
        SimpleAttributionWidget(source: Text(copy('map.attribution'))),
      ],
    );
  }
}

/// Tiles for `flutter_map` from a [TileSource].
class _SourceTiles extends TileProvider {
  _SourceTiles(this.source);

  final TileSource source;

  @override
  ImageProvider getImage(TileCoordinates coordinates, TileLayer options) =>
      _TileImage(source, TileKey(coordinates.z, coordinates.x, coordinates.y));
}

/// One tile's image. A tile that can't be had (offline and not kept) fails
/// to load, and the map leaves that square blank.
@immutable
class _TileImage extends ImageProvider<_TileImage> {
  const _TileImage(this.source, this.tile);

  final TileSource source;
  final TileKey tile;

  @override
  Future<_TileImage> obtainKey(ImageConfiguration configuration) =>
      SynchronousFuture(this);

  @override
  ImageStreamCompleter loadImage(_TileImage key, ImageDecoderCallback decode) =>
      OneFrameImageStreamCompleter(_load(decode));

  Future<ImageInfo> _load(ImageDecoderCallback decode) async {
    final bytes = await source.tile(tile);
    if (bytes == null) throw StateError('map tile ${tile.path} unavailable');
    final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);
    final codec = await decode(buffer);
    final frame = await codec.getNextFrame();
    return ImageInfo(image: frame.image);
  }

  @override
  bool operator ==(Object other) =>
      other is _TileImage &&
      identical(other.source, source) &&
      other.tile == tile;

  @override
  int get hashCode => Object.hash(identityHashCode(source), tile);
}
