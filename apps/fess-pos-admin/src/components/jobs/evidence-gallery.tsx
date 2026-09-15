'use client';

// Evidence: lazily-fetched signed URLs (≤ 15 min, refreshed before expiry), thumbnails, lightbox and the gallery tab.
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, FileText, ImageOff } from 'lucide-react';
import { type ReactNode, type RefCallback, useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { DateTime } from '@/components/date-time';
import { ToneBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/api';
import { formatBytes, humanize, shortId } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import { formatLatLng, parsePoint } from '@/lib/geo';
import { UPLOAD_STATE_TONE } from '@/lib/status';
import type { Evidence } from '@/lib/types';
import { cn } from '@/lib/utils';
import { type InspectionRow, toNumber } from './job-data';
import { KeyValues } from './job-bits';

/** Signed URL for an evidence item; refetched shortly before it expires while mounted. */
export function useEvidenceUrl(evidenceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['evidence-url', evidenceId],
    queryFn: () => adminApi.evidence.url(evidenceId),
    enabled,
    staleTime: (q) => {
      const d = q.state.data;
      return d ? Math.max(30, d.expires_in_s - 60) * 1000 : 0;
    },
    refetchInterval: (q) => {
      const d = q.state.data;
      return d ? Math.max(30, d.expires_in_s - 60) * 1000 : false;
    },
    gcTime: 10 * 60_000,
    retry: 1,
  });
}

/** Becomes true once the element has scrolled into view (and stays true). */
function useInView<T extends Element>(): [RefCallback<T>, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!node || inView) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setInView(true);
    }, { rootMargin: '200px' });
    io.observe(node);
    return () => io.disconnect();
  }, [node, inView]);
  return [setNode, inView];
}

/** Plain labels for the upload state badge on thumbnails. */
const UPLOAD_STATE_LABEL: Record<Evidence['upload_state'], string> = { pending: 'Not received', uploaded: 'Checking', verified: 'Checked', quarantined: 'Failed' };

function isImage(e: Pick<Evidence, 'mime' | 'type'> | undefined): boolean {
  if (!e) return true;
  if (e.mime) return e.mime.startsWith('image/');
  return ['photo', 'signature', 'override_photo', 'unable_photo'].includes(e.type);
}

/** "Photo · External photos 2" style label. */
export function evidenceLabel(e: Evidence, index?: number): string {
  const what = e.field_key ?? e.category ?? e.type;
  return `${humanize(e.type)} · ${humanize(what)}${index !== undefined ? ` ${index + 1}` : ''}`;
}

/** Lazily loaded thumbnail; click to open. `evidence` may be unknown (id only) while rows load. */
export function EvidenceThumb({
  evidenceId,
  evidence,
  onOpen,
  className,
}: {
  evidenceId: string;
  evidence?: Evidence;
  onOpen?: () => void;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLButtonElement>();
  const image = isImage(evidence);
  const url = useEvidenceUrl(evidenceId, inView && image);
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);
  const state = evidence?.upload_state;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      title={evidence ? evidenceLabel(evidence) : evidenceId}
      className={cn('group relative size-24 shrink-0 overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      {!image ? (
        <span className="flex size-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
          <FileText className="size-5" />
          {evidence?.mime ?? humanize(evidence?.type)}
        </span>
      ) : url.data && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URL; next/image can't optimise it
        <img
          src={url.data.url}
          alt={evidence ? evidenceLabel(evidence) : 'Photo'}
          className="size-full object-cover transition group-hover:scale-105"
          loading="lazy"
          onError={() => {
            if (!retried) {
              setRetried(true);
              void url.refetch();
            } else setFailed(true);
          }}
        />
      ) : url.isError || failed ? (
        <span className="flex size-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
          <ImageOff className="size-5" />
          {state === 'pending' ? 'Not received yet' : 'Can’t show'}
        </span>
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}
      {state && state !== 'verified' ? (
        <span className="absolute left-1 top-1">
          <ToneBadge value={state} tones={UPLOAD_STATE_TONE} labels={UPLOAD_STATE_LABEL} className="px-1.5 py-0 text-xs" />
        </span>
      ) : null}
    </button>
  );
}

function HashRow({ e }: { e: Evidence }) {
  const match = e.sha256_server ? e.sha256_server === e.sha256_client : null;
  return (
    <div className="space-y-1">
      <div className="font-mono text-xs" title={e.sha256_client}>
        client {shortId(e.sha256_client, 12, 6)}
      </div>
      <div className="font-mono text-xs" title={e.sha256_server ?? ''}>
        server {e.sha256_server ? shortId(e.sha256_server, 12, 6) : '—'}
      </div>
      {match === true ? <Badge tone="success">Hashes match</Badge> : match === false ? <Badge tone="danger">Hash mismatch</Badge> : <Badge tone="neutral">Not verified yet</Badge>}
    </div>
  );
}

/** Metadata block for one evidence item (Basic: plain summary; Advanced: every technical detail). */
export function EvidenceMeta({ e }: { e: Evidence }) {
  const advanced = useIsAdvanced();
  const point = parsePoint(e.location);
  const acc = toNumber(e.accuracy_m);
  if (!advanced) {
    const checked = e.sha256_server ? e.sha256_server === e.sha256_client : null;
    return (
      <KeyValues
        className="sm:grid-cols-1 lg:grid-cols-1"
        items={[
          ['What', humanize(e.type)],
          ['Taken', <DateTime key="c" value={e.captured_at_device} />],
          ['Where', point ? `${formatLatLng(point)}${acc !== null ? ` (± ${Math.round(acc)} m)` : ''}` : 'Not recorded'],
          ...(e.is_mocked ? ([['Location', <Badge key="m" tone="danger">Fake GPS location</Badge>]] as [ReactNode, ReactNode][]) : []),
          [
            'Security check',
            e.upload_state === 'quarantined' || checked === false ? (
              <Badge key="t" tone="danger">Failed: the file may have been changed</Badge>
            ) : checked === true ? (
              <Badge key="t" tone="success">Passed</Badge>
            ) : e.upload_state === 'pending' ? (
              'Still on the agent’s phone'
            ) : (
              'Not checked yet'
            ),
          ],
          ...(e.quarantined_reason ? ([['Why it failed', <span key="q" className="text-red-700">{e.quarantined_reason}</span>]] as [ReactNode, ReactNode][]) : []),
          ...(!e.in_manifest ? ([['Note', <Badge key="u" tone="warning">Not in the list the phone sent</Badge>]] as [ReactNode, ReactNode][]) : []),
        ]}
      />
    );
  }
  return (
    <KeyValues
      className="sm:grid-cols-1 lg:grid-cols-1"
      items={[
        ['Type', `${humanize(e.type)}${e.mime ? ` (${e.mime})` : ''}`],
        ['Field / category', [e.field_key, e.category].filter(Boolean).join(' / ') || '—'],
        ['Captured (device)', <DateTime key="c" value={e.captured_at_device} seconds />],
        ['GNSS time', <DateTime key="g" value={e.gnss_time} seconds />],
        ['Location', point ? `${formatLatLng(point)}${acc !== null ? ` ± ${Math.round(acc)} m` : ''}` : '—'],
        ['Mocked location', e.is_mocked === null ? '—' : e.is_mocked ? <Badge key="m" tone="danger">Mocked</Badge> : 'No'],
        ['In manifest', e.in_manifest ? 'Yes' : <Badge key="u" tone="warning">Not in manifest</Badge>],
        ['Upload', <span key="up" className="inline-flex flex-wrap items-center gap-1"><ToneBadge value={e.upload_state} tones={UPLOAD_STATE_TONE} /> <DateTime value={e.uploaded_at} /></span>],
        ['Verified', <DateTime key="v" value={e.verified_at} seconds />],
        ['Replica', humanize(e.replica_state)],
        ['Size', `${formatBytes(e.bytes)}${e.width && e.height ? ` · ${e.width}×${e.height}` : ''}`],
        ['Hashes (SHA-256)', <HashRow key="h" e={e} />],
        ...(e.quarantined_reason ? ([['Quarantined', <span key="q" className="text-red-700">{e.quarantined_reason}</span>]] as [ReactNode, ReactNode][]) : []),
        ['Evidence id', <span key="id" className="font-mono text-xs">{e.id}</span>],
      ]}
    />
  );
}

function LightboxBody({ e }: { e: Evidence }) {
  const image = isImage(e);
  const url = useEvidenceUrl(e.id, true);
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_17rem]">
      <div className="flex min-h-72 items-center justify-center overflow-hidden rounded-md border bg-slate-900">
        {url.isPending ? (
          <Skeleton className="h-72 w-full rounded-none" />
        ) : url.data ? (
          image ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URL
            <img src={url.data.url} alt={evidenceLabel(e)} className="max-h-[70vh] w-auto object-contain" onError={() => void url.refetch()} />
          ) : (
            <a href={url.data.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-white underline">
              <ExternalLink className="size-4" /> Open file
            </a>
          )
        ) : (
          <span className="flex items-center gap-2 p-6 text-sm text-slate-300">
            <ImageOff className="size-5" /> {e.upload_state === 'pending' ? 'The phone hasn’t sent this file yet.' : 'We couldn’t open this file. Try again in a moment.'}
          </span>
        )}
      </div>
      <div className="space-y-3">
        {url.data ? (
          <a href={url.data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <ExternalLink className="size-4" /> Open the full-size file
          </a>
        ) : null}
        <EvidenceMeta e={e} />
      </div>
    </div>
  );
}

/** Controlled lightbox over a list of evidence items. */
export function EvidenceLightbox({
  items,
  index,
  onIndexChange,
}: {
  items: Evidence[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
}) {
  const current = index !== null ? items[index] : undefined;
  const go = useCallback(
    (delta: number) => {
      if (index === null || items.length === 0) return;
      onIndexChange((index + delta + items.length) % items.length);
    },
    [index, items.length, onIndexChange],
  );
  return (
    <Dialog open={current !== undefined} onOpenChange={(o) => (o ? undefined : onIndexChange(null))}>
      <DialogContent
        size="xl"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(1);
          if (e.key === 'ArrowLeft') go(-1);
        }}
      >
        {current ? (
          <>
            <DialogHeader>
              <DialogTitle>{evidenceLabel(current)}</DialogTitle>
              <DialogDescription>
                {index !== null ? `${index + 1} of ${items.length}. ` : null}Use the arrow keys to move between them.
              </DialogDescription>
            </DialogHeader>
            <LightboxBody e={current} />
            {items.length > 1 ? (
              <div className="flex justify-between">
                <Button type="button" variant="outline" size="sm" onClick={() => go(-1)}>
                  <ChevronLeft /> Previous
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => go(1)}>
                  Next <ChevronRight />
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <DialogTitle className="sr-only">Photo</DialogTitle>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Hook: `open(items, index)` + the lightbox element to render. */
export function useLightbox(): { open: (items: Evidence[], index: number) => void; element: ReactNode } {
  const [items, setItems] = useState<Evidence[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const open = useCallback((next: Evidence[], i: number) => {
    setItems(next);
    setIndex(i);
  }, []);
  return { open, element: <EvidenceLightbox items={items} index={index} onIndexChange={setIndex} /> };
}

const ALL = '__all__';

/** Evidence tab: thumbnails grouped by attempt and field, with metadata and a lightbox. */
export function EvidenceGallery({
  evidence,
  inspections,
  fieldLabels,
  isLoading,
}: {
  evidence: Evidence[] | undefined;
  inspections: InspectionRow[];
  fieldLabels: Record<string, string>;
  isLoading: boolean;
}) {
  const advanced = useIsAdvanced();
  const [attemptFilter, setAttemptFilter] = useState<string>(ALL);
  const lightbox = useLightbox();
  const rows = useMemo(() => evidence ?? [], [evidence]);
  const groups = useMemo(() => {
    const byInspection = new Map<string, Evidence[]>();
    for (const e of rows) {
      if (attemptFilter !== ALL && e.inspection_id !== attemptFilter) continue;
      byInspection.set(e.inspection_id, [...(byInspection.get(e.inspection_id) ?? []), e]);
    }
    return [...byInspection.entries()]
      .map(([inspectionId, items]) => {
        const insp = inspections.find((i) => i.id === inspectionId);
        const byField = new Map<string, Evidence[]>();
        for (const e of items) {
          const k = e.field_key ?? e.category ?? e.type;
          byField.set(k, [...(byField.get(k) ?? []), e]);
        }
        return { inspectionId, attempt: insp?.attempt ?? null, items, fields: [...byField.entries()] };
      })
      .sort((a, b) => (b.attempt ?? 0) - (a.attempt ?? 0));
  }, [rows, inspections, attemptFilter]);

  const counts = useMemo(() => {
    const c = { total: rows.length, verified: 0, pending: 0, uploaded: 0, quarantined: 0 };
    for (const e of rows) c[e.upload_state]++;
    return c;
  }, [rows]);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (rows.length === 0) {
    return <EmptyState title="No photos yet" description="Photos, signatures and documents show here as the agent’s phone sends them." />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{counts.total} items</span>
        <Badge tone="success">{counts.verified} {advanced ? 'verified' : 'checked'}</Badge>
        {counts.uploaded ? <Badge tone="info">{counts.uploaded} {advanced ? 'uploaded, verifying' : 'being checked'}</Badge> : null}
        {counts.pending ? <Badge tone="neutral">{counts.pending} {advanced ? 'awaiting upload' : 'still on the phone'}</Badge> : null}
        {counts.quarantined ? <Badge tone="danger">{counts.quarantined} {advanced ? 'quarantined' : 'failed a security check'}</Badge> : null}
        {inspections.length > 1 ? (
          <div className="ml-auto w-48">
            <Select value={attemptFilter} onValueChange={setAttemptFilter}>
              <SelectTrigger aria-label="Visit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All visits</SelectItem>
                {inspections.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    Visit {i.attempt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {groups.map((g) => (
        <section key={g.inspectionId} className="space-y-3">
          <h3 className="text-base font-semibold">
            {g.attempt !== null ? `Visit ${g.attempt}` : advanced ? `Visit ${shortId(g.inspectionId)}` : 'Visit'}{' '}
            <span className="font-normal text-muted-foreground">· {g.items.length} items</span>
          </h3>
          {g.fields.map(([field, items]) => (
            <div key={field} className="rounded-lg border bg-card p-3">
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <span className="text-base font-medium">{fieldLabels[field] ?? humanize(field)}</span>
                {advanced ? <code className="text-xs text-muted-foreground">{field}</code> : null}
              </div>
              <div className="flex flex-wrap gap-3">
                {items.map((e, i) => (
                  <div key={e.id} className="w-28 space-y-1">
                    <EvidenceThumb evidenceId={e.id} evidence={e} onOpen={() => lightbox.open(items, i)} className="size-28" />
                    <div className="text-sm leading-tight text-muted-foreground">
                      <DateTime value={e.captured_at_device} mode="time" />
                      {e.is_mocked ? <Badge tone="danger" className="ml-1 px-1 py-0 text-xs">{advanced ? 'mock' : 'fake GPS'}</Badge> : null}
                      {!e.in_manifest ? <Badge tone="warning" className="ml-1 px-1 py-0 text-xs">not expected</Badge> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
      {lightbox.element}
    </div>
  );
}
