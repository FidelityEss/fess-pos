'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { type GeoJSONSource, LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { env } from '@/lib/env';
import { circlePolygon, DEFAULT_MAP_CENTER } from '@/lib/geo';
import type { MapViewProps } from './map-types';

const DEFAULT_COLOR = '#006b55'; // FESS primary (schema/design/tokens.json)
type Ring = [number, number][];

function circleCollection(circles: NonNullable<MapViewProps['circles']>) {
  return {
    type: 'FeatureCollection' as const,
    features: circles.map((c) => ({
      type: 'Feature' as const,
      properties: { color: c.color },
      geometry: { type: 'Polygon' as const, coordinates: [circlePolygon({ lat: c.lat, lng: c.lng }, c.radiusM)] as Ring[] },
    })),
  };
}

function lineCollection(lines: NonNullable<MapViewProps['lines']>) {
  return {
    type: 'FeatureCollection' as const,
    features: lines
      .filter((l) => l.coords.length > 1)
      .map((l) => ({
        type: 'Feature' as const,
        properties: { color: l.color, width: l.width ?? 3 },
        geometry: { type: 'LineString' as const, coordinates: l.coords.map(([lat, lng]) => [lng, lat]) as Ring },
      })),
  };
}

/** The actual MapLibre map; import via <MapView> (dynamic, ssr:false). */
export default function MapViewInner({
  markers = [],
  circles = [],
  lines = [],
  onMapClick,
  fitToContent = true,
  center = DEFAULT_MAP_CENTER,
  zoom = 5,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerObjects = useRef<Marker[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Latest props for handlers/effects that are keyed on content signatures rather than array identity.
  const latest = useRef({ markers, circles, lines, onMapClick });
  latest.current = { markers, circles, lines, onMapClick };
  const initial = useRef({ center, zoom });

  const markerSig = useMemo(() => JSON.stringify(markers.map((m) => [m.id, m.lat, m.lng, m.color, m.label])), [markers]);
  const shapeSig = useMemo(
    () => JSON.stringify([circles.map((c) => [c.lat, c.lng, c.radiusM, c.color]), lines.map((l) => [l.coords, l.color, l.width])]),
    [circles, lines],
  );

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new MapLibreMap({
      container,
      style: env.mapStyleUrl,
      center: [initial.current.center.lng, initial.current.center.lat],
      zoom: initial.current.zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('fp-circles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'fp-circles-fill', type: 'fill', source: 'fp-circles', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'fp-circles-line', type: 'line', source: 'fp-circles', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 } });
      map.addSource('fp-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'fp-lines',
        type: 'line',
        source: 'fp-lines',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] },
      });
      setLoaded(true);
    });
    map.on('click', (e) => {
      const target = e.originalEvent.target;
      if (target instanceof Element && target.closest('.maplibregl-marker')) return;
      latest.current.onMapClick?.(e.lngLat.lat, e.lngLat.lng);
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    mapRef.current = map;
    return () => {
      ro.disconnect();
      markerObjects.current.forEach((m) => m.remove());
      markerObjects.current = [];
      map.remove();
      mapRef.current = null;
      setLoaded(false);
    };
  }, []);

  // Crosshair cursor when placing pins.
  const placing = !!onMapClick;
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = placing ? 'crosshair' : '';
  }, [placing, loaded]);

  // Markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerObjects.current.forEach((m) => m.remove());
    markerObjects.current = latest.current.markers.map((m) => {
      const marker = new Marker({ color: m.color ?? DEFAULT_COLOR }).setLngLat([m.lng, m.lat]);
      const el = marker.getElement();
      if (m.label) {
        el.title = m.label;
        marker.setPopup(new Popup({ offset: 28, closeButton: false }).setText(m.label));
      }
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => latest.current.markers.find((x) => x.id === m.id)?.onClick?.());
      return marker.addTo(map);
    });
  }, [markerSig]);

  // Circles and lines.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    map.getSource<GeoJSONSource>('fp-circles')?.setData(circleCollection(latest.current.circles));
    map.getSource<GeoJSONSource>('fp-lines')?.setData(lineCollection(latest.current.lines));
  }, [shapeSig, loaded]);

  // Fit to content.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitToContent) return;
    const bounds = new LngLatBounds();
    let points = 0;
    const { markers: ms, circles: cs, lines: ls } = latest.current;
    for (const m of ms) {
      bounds.extend([m.lng, m.lat]);
      points++;
    }
    for (const c of cs) {
      for (const [lng, lat] of circlePolygon({ lat: c.lat, lng: c.lng }, c.radiusM, 16)) bounds.extend([lng, lat]);
      points += 2;
    }
    for (const l of ls) {
      for (const [lat, lng] of l.coords) {
        bounds.extend([lng, lat]);
        points++;
      }
    }
    if (points === 0) return;
    const only = ms[0];
    if (points === 1 && only) map.jumpTo({ center: [only.lng, only.lat], zoom: 15 });
    else map.fitBounds(bounds, { padding: 40, maxZoom: 17, duration: 0 });
  }, [markerSig, shapeSig, fitToContent]);

  // Inline position: maplibre-gl.css sets .maplibregl-map { position: relative }, which would otherwise win and collapse
  // the container to 0 px high.
  return <div ref={containerRef} className="absolute inset-0" style={{ position: "absolute", inset: 0 }} />;
}
