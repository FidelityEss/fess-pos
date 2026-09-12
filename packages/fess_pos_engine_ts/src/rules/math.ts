/**
 * Numeric helpers with semantics both engines implement identically (IEEE-754 doubles).
 */
import { RuleError } from "../errors.ts";
import type { JsonValue } from "../json.ts";
import { isPlainObject } from "../json.ts";

/**
 * Round half away from zero to `decimals` places:
 * r = floor(|x| · 10^d + 0.5) / 10^d, then the sign of x is restored. -0 becomes 0.
 */
export function roundHalfAway(x: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.floor(Math.abs(x) * f + 0.5) / f;
  const out = x < 0 ? -r : r;
  return out === 0 ? 0 : out;
}

export function finite(n: number, op: string): number {
  if (!Number.isFinite(n)) throw new RuleError("RULE_NUMERIC_OVERFLOW", `${op}: result is not a finite number`);
  return n === 0 ? 0 : n;
}

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** Mean Earth radius (IUGG), metres. */
export const EARTH_RADIUS_M = 6371008.8;

/** Point from `{lat, lng}` (extra keys ignored). Null stays null; anything else is an error. */
export function toPoint(v: JsonValue, op: string): GeoPoint | null {
  if (v === null) return null;
  if (!isPlainObject(v)) throw new RuleError("RULE_INVALID_POINT", `${op}: expected {lat, lng}`);
  const lat = v["lat"];
  const lng = v["lng"];
  if (typeof lat !== "number" || typeof lng !== "number" || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new RuleError("RULE_INVALID_POINT", `${op}: lat must be −90…90 and lng −180…180`);
  }
  return { lat, lng };
}

/**
 * Haversine great-circle distance in metres, rounded half away from zero to 3 decimals:
 *   φ = lat·π/180, Δφ, Δλ in radians,
 *   h = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2),
 *   d = R · 2 · atan2(√h, √(1−h)).
 */
export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return roundHalfAway(EARTH_RADIUS_M * c, 3);
}
