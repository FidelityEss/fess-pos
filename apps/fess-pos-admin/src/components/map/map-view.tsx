'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { MapViewProps } from './map-types';

export type { MapCircle, MapLine, MapMarker, MapViewProps } from './map-types';

// MapLibre touches `window`, so it is only loaded in the browser.
const MapViewInner = dynamic(() => import('./map-view-inner'), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

/** MapLibre GL map (client-only) with markers, circles, lines, fit-to-content and click-to-place. */
export function MapView(props: MapViewProps) {
  return (
    <div className={cn('relative overflow-hidden rounded-md border bg-slate-100', props.className)} style={{ height: props.height ?? 360 }}>
      <MapViewInner {...props} />
    </div>
  );
}
