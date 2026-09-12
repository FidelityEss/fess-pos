// Geography helpers: EWKB point parsing (PostgREST geography columns), distances, circle polygons.
import type { LatLng } from './types';
import { isPlainObject } from './utils';

const WKB_SRID_FLAG = 0x20000000;
const WKB_Z_FLAG = 0x80000000;
const WKB_M_FLAG = 0x40000000;

/**
 * Parse an EWKB/WKB hex point (e.g. `0101000020E6100000…`) into {lat, lng}. Handles little/big endian and
 * with/without the SRID flag (0x20000000); ignores Z/M. Returns null for null, empty points or non-points.
 */
export function parseEwkbPoint(hex: string | null | undefined): LatLng | null {
  if (!hex || typeof hex !== 'string') return null;
  const clean = hex.trim();
  if (clean.length < 42 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  const view = new DataView(bytes.buffer);
  const littleEndian = view.getUint8(0) === 1;
  const rawType = view.getUint32(1, littleEndian);
  const hasSrid = (rawType & WKB_SRID_FLAG) !== 0;
  // EWKB flags, or ISO WKB type codes (1001 = PointZ, 2001 = PointM, 3001 = PointZM).
  const baseType = (rawType & ~(WKB_SRID_FLAG | WKB_Z_FLAG | WKB_M_FLAG)) >>> 0;
  if (baseType % 1000 !== 1) return null;
  const offset = 5 + (hasSrid ? 4 : 0);
  if (bytes.length < offset + 16) return null;
  const x = view.getFloat64(offset, littleEndian);
  const y = view.getFloat64(offset + 8, littleEndian);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { lat: y, lng: x };
}

/** Parse any point representation seen in the app: EWKB hex, GeoJSON Point, or {lat,lng}. */
export function parsePoint(value: unknown): LatLng | null {
  if (typeof value === 'string') return parseEwkbPoint(value);
  if (!isPlainObject(value)) return null;
  if (typeof value.lat === 'number' && typeof value.lng === 'number') return { lat: value.lat, lng: value.lng };
  if (value.type === 'Point' && Array.isArray(value.coordinates)) {
    const [lng, lat] = value.coordinates as unknown[];
    if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  }
  return null;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres between two points. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Approximate a circle as a closed polygon ring in GeoJSON order: `[lng, lat][]` with steps+1 points
 * (first point repeated at the end).
 */
export function circlePolygon(center: LatLng, radiusM: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  const angular = radiusM / EARTH_RADIUS_M;
  const lat1 = toRad(center.lat);
  const lng1 = toRad(center.lng);
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * (i % steps)) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lng2 =
      lng1 +
      Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([((toDeg(lng2) + 540) % 360) - 180, toDeg(lat2)]);
  }
  return ring;
}

/** Format a point as "lat, lng" with 6 decimals. */
export function formatLatLng(p: LatLng | null | undefined): string {
  return p ? `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}` : '—';
}

/** Johannesburg — default map centre when there is nothing to show. */
export const DEFAULT_MAP_CENTER: LatLng = { lat: -26.2041, lng: 28.0473 };
