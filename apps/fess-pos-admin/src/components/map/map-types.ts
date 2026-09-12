import type { LatLng } from '@/lib/types';

/** A pin. `onClick` fires when the pin is clicked; `label` shows as tooltip and popup. */
export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  /** CSS colour (default: primary blue). */
  color?: string;
  label?: string;
  onClick?: () => void;
}

/** A circle (e.g. a geofence) drawn as a 64-step polygon. */
export interface MapCircle {
  id?: string;
  lat: number;
  lng: number;
  radiusM: number;
  color: string;
}

/** A polyline; coords are [lat, lng] pairs (e.g. a breadcrumb trail). */
export interface MapLine {
  id?: string;
  coords: [number, number][];
  color: string;
  width?: number;
}

export interface MapViewProps {
  markers?: MapMarker[];
  circles?: MapCircle[];
  lines?: MapLine[];
  /** Enables pin placement: called with the clicked position (cursor becomes a crosshair). */
  onMapClick?: (lat: number, lng: number) => void;
  /** Fit the view to all markers/circles/lines when they change (default true). */
  fitToContent?: boolean;
  /** Container height (default 360). */
  height?: number | string;
  /** Initial centre when there is no content (default Johannesburg). */
  center?: LatLng;
  /** Initial zoom when there is no content (default 5). */
  zoom?: number;
  className?: string;
}
