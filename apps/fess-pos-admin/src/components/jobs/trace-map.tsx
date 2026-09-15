'use client';

// Trace map tab: breadcrumbs (location_traces) for one inspection as a polyline, event markers (check-in, enter,
// exit, pause, resume), merchant pin and fence circle, plus a distance-to-merchant summary and histogram.
import { useMemo, useState } from 'react';
import { DateTime } from '@/components/date-time';
import { EmptyState } from '@/components/empty-state';
import { MapView, type MapCircle, type MapLine, type MapMarker } from '@/components/map/map-view';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatDuration, humanize } from '@/lib/format';
import { haversineM, parsePoint } from '@/lib/geo';
import type { LatLng, TraceEvent } from '@/lib/types';
import { KeyValues, SectionCard } from './job-bits';
import { type InspectionRow, type JobDetailRow, jobPoint, objOf, toNumber, useInspectionTraces } from './job-data';

/** What each point on the trail means, in words. */
const EVENT_LABEL: Record<TraceEvent, string> = {
  fix: 'Location point',
  checkin: 'Checked in',
  enter: 'Entered the site area',
  exit: 'Left the site area',
  pause: 'Paused the visit',
  resume: 'Carried on',
};

const EVENT_COLOR: Record<TraceEvent, string> = {
  fix: '#2799ff', // FESS info blue (location)
  checkin: '#7c3aed',
  enter: '#059669',
  exit: '#ea580c',
  pause: '#d97706',
  resume: '#0d9488',
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

function Histogram({ distances, radiusM }: { distances: number[]; radiusM: number | null }) {
  if (!distances.length) return null;
  const maxD = Math.max(...distances, radiusM ?? 0);
  const bin = Math.max(5, Math.ceil(maxD / 12 / 5) * 5);
  const bins = Array.from({ length: Math.floor(maxD / bin) + 1 }, (_, i) => ({ from: i * bin, n: 0 }));
  for (const d of distances) {
    const b = bins[Math.min(bins.length - 1, Math.floor(d / bin))];
    if (b) b.n++;
  }
  const peak = Math.max(...bins.map((b) => b.n), 1);
  return (
    <div>
      <div className="flex h-24 items-end gap-0.5">
        {bins.map((b) => (
          <div
            key={b.from}
            className={radiusM !== null && b.from >= radiusM ? 'flex-1 rounded-t bg-orange-400' : 'flex-1 rounded-t bg-sky-500'}
            style={{ height: `${Math.max(2, (b.n / peak) * 100)}%` }}
            title={`${b.from}–${b.from + bin} m: ${b.n} point${b.n === 1 ? '' : 's'}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-sm text-muted-foreground">
        <span>0 m</span>
        {radiusM !== null ? <span>site area {radiusM} m (orange = outside it)</span> : null}
        <span>{bins.length * bin} m</span>
      </div>
    </div>
  );
}

export function TraceMapPanel({ job, inspections, fallbackRadius }: { job: JobDetailRow; inspections: InspectionRow[]; fallbackRadius: number | null }) {
  const latest = [...inspections].sort((a, b) => b.attempt - a.attempt)[0];
  const [selected, setSelected] = useState<string | null>(null);
  const insp = inspections.find((i) => i.id === selected) ?? latest ?? null;
  const traces = useInspectionTraces(job.id, insp?.id ?? null);

  const gr = insp?.geofence_result ?? null;
  const merchant: LatLng | null = jobPoint(job) ?? parsePoint(objOf(gr, 'job_location'));
  const radiusM = toNumber(objOf(gr, 'profile_params')?.radius_m) ?? fallbackRadius;

  const points = useMemo(
    () =>
      (traces.data ?? []).flatMap((t) => {
        const p = parsePoint(t.location);
        if (!p) return [];
        return [{ t, p, acc: toNumber(t.accuracy_m), d: merchant ? haversineM(merchant, p) : null }];
      }),
    [traces.data, merchant],
  );

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    if (merchant) out.push({ id: 'merchant', lat: merchant.lat, lng: merchant.lng, color: '#dc2626', label: 'Merchant pin' });
    for (const { t, p, acc, d } of points) {
      if (t.event === 'fix') continue;
      out.push({
        id: t.id,
        lat: p.lat,
        lng: p.lng,
        color: EVENT_COLOR[t.event],
        label: `${EVENT_LABEL[t.event] ?? humanize(t.event)} · ${formatDateTime(t.ts_device, { seconds: true })}${d !== null ? ` · ${Math.round(d)} m` : ''}${acc !== null ? ` ± ${Math.round(acc)} m` : ''}`,
      });
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (first && first.t.event === 'fix') out.push({ id: 'first', lat: first.p.lat, lng: first.p.lng, color: '#0f172a', label: `First point · ${formatDateTime(first.t.ts_device)}` });
    if (last && last !== first && last.t.event === 'fix') out.push({ id: 'last', lat: last.p.lat, lng: last.p.lng, color: '#64748b', label: `Last point · ${formatDateTime(last.t.ts_device)}` });
    const startFix = parsePoint(objOf(gr, 'fix'));
    if (startFix) out.push({ id: 'start-fix', lat: startFix.lat, lng: startFix.lng, color: '#7c3aed', label: 'Location check at the start of the visit' });
    return out;
  }, [points, merchant, gr]);

  const lines = useMemo<MapLine[]>(() => (points.length > 1 ? [{ id: 'trail', coords: points.map(({ p }) => [p.lat, p.lng] as [number, number]), color: '#2799ff', width: 3 }] : []), [points]);
  const circles: MapCircle[] = merchant && radiusM ? [{ id: 'fence', lat: merchant.lat, lng: merchant.lng, radiusM, color: '#dc2626' }] : [];

  const stats = useMemo(() => {
    const ds = points.map((x) => x.d).filter((d): d is number => d !== null);
    const accs = points.map((x) => x.acc).filter((a): a is number => a !== null);
    const inside = points.filter((x) => x.t.inside_fence === true).length;
    const mocked = points.filter((x) => x.t.is_mocked === true).length;
    const first = points[0]?.t.ts_device;
    const last = points[points.length - 1]?.t.ts_device;
    return {
      ds,
      inside,
      mocked,
      worstAcc: accs.length ? Math.max(...accs) : null,
      min: ds.length ? Math.min(...ds) : null,
      max: ds.length ? Math.max(...ds) : null,
      median: median(ds),
      span: first && last ? new Date(last).getTime() - new Date(first).getTime() : null,
    };
  }, [points]);

  if (!insp) return <EmptyState title="No visit yet" description="The agent’s location trail shows here once a visit has started and the phone has sent it." />;
  const events = points.filter((x) => x.t.event !== 'fix');

  return (
    <div className="space-y-4">
      {inspections.length > 1 ? (
        <div className="w-56">
          <Select value={insp.id} onValueChange={setSelected}>
            <SelectTrigger aria-label="Visit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...inspections].sort((a, b) => b.attempt - a.attempt).map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  Visit {i.attempt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <ApiErrorAlert error={traces.error} onRetry={() => void traces.refetch()} />
      {traces.isPending ? (
        <Skeleton className="h-[480px] w-full" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
          <div className="space-y-2">
            <MapView markers={markers} circles={circles} lines={lines} height={480} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-red-600" />Merchant pin and site area</span>
              {(Object.keys(EVENT_COLOR) as TraceEvent[]).filter((e) => e !== 'fix').map((e) => (
                <span key={e} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: EVENT_COLOR[e] }} />
                  {EVENT_LABEL[e]}
                </span>
              ))}
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#2799ff]" />Trail</span>
            </div>
          </div>
          <div className="space-y-4">
            <SectionCard title="Distance to merchant">
              {points.length === 0 ? (
                <p className="text-sm text-muted-foreground">No location points have arrived for this visit.</p>
              ) : (
                <div className="space-y-3">
                  <KeyValues
                    className="sm:grid-cols-2 lg:grid-cols-2"
                    items={[
                      ['Location points', String(points.length)],
                      ['Inside the site area', `${stats.inside} (${Math.round((stats.inside / points.length) * 100)}%)`],
                      ['Closest', stats.min !== null ? `${Math.round(stats.min)} m` : null],
                      ['Typical', stats.median !== null ? `${Math.round(stats.median)} m` : null],
                      ['Furthest', stats.max !== null ? `${Math.round(stats.max)} m` : null],
                      ['Least accurate', stats.worstAcc !== null ? `± ${Math.round(stats.worstAcc)} m` : null],
                      ['Time covered', stats.span !== null ? formatDuration(stats.span) : null],
                      ['Fake locations', stats.mocked ? <Badge key="m" tone="danger">{stats.mocked}</Badge> : '0'],
                    ]}
                  />
                  <Histogram distances={stats.ds} radiusM={radiusM} />
                  {!merchant ? <p className="text-sm text-amber-700">The job has no map pin, so we can’t work out distances.</p> : null}
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      )}
      {events.length ? (
        <SectionCard title="What happened where">
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time (phone)</TableHead>
                  <TableHead>What happened</TableHead>
                  <TableHead>Distance</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead>Inside the site area</TableHead>
                  <TableHead>Fake location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map(({ t, acc, d }) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <DateTime value={t.ts_device} seconds />
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: EVENT_COLOR[t.event] }} />
                        {EVENT_LABEL[t.event] ?? humanize(t.event)}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">{d !== null ? `${Math.round(d)} m` : '—'}</TableCell>
                    <TableCell className="tabular-nums">{acc !== null ? `± ${Math.round(acc)} m` : '—'}</TableCell>
                    <TableCell>{t.inside_fence === null ? '—' : t.inside_fence ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{t.is_mocked ? <Badge tone="danger">Fake</Badge> : 'No'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
