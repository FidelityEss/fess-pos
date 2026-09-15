'use client';

// Custody tab (docs/12 §10): custody_events for an inspection, its evidence and its envelopes, ordered by server
// time — plus a one-line chain per evidence item, e.g. "Photo external_photos-2 captured … · uploaded … · verified …".
import { useMemo, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { EmptyState } from '@/components/empty-state';
import { JsonView } from '@/components/json-view';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatTime, humanize, shortId } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import type { CustodyEvent, CustodySubject, Evidence } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';
import { SectionCard } from './job-bits';
import { type InspectionRow, type JobDetailRow, useCustodyEvents } from './job-data';

const ALL = '__all__';

/** Label "Photo external_photos-2" per evidence id (index within its field, by capture time). With field labels
 * (Basic view) it reads "External photographs 2". */
function evidenceLabels(evidence: Evidence[], fieldLabels?: Record<string, string>): Map<string, string> {
  const byField = new Map<string, Evidence[]>();
  for (const e of evidence) {
    const k = `${e.inspection_id}:${e.field_key ?? e.category ?? e.type}`;
    byField.set(k, [...(byField.get(k) ?? []), e]);
  }
  const out = new Map<string, string>();
  for (const items of byField.values()) {
    items
      .sort((a, b) => (a.captured_at_device ?? a.created_at).localeCompare(b.captured_at_device ?? b.created_at))
      .forEach((e, i) => {
        const field = e.field_key ?? e.category ?? e.type;
        const friendly = fieldLabels ? (fieldLabels[field] ?? humanize(field)) : null;
        out.set(e.id, friendly ? `${friendly} ${i + 1}` : `${humanize(e.type)} ${field}-${i + 1}`);
      });
  }
  return out;
}

// `label` is the PDF-report wording (Advanced); `plain` is the Basic-view wording.
const CHAIN_STEPS: { event: string; label: string; plain: string }[] = [
  { event: 'uploaded', label: 'uploaded', plain: 'received' },
  { event: 'verified', label: 'verified', plain: 'passed the security check' },
  { event: 'quarantined', label: 'quarantined', plain: 'failed the security check' },
  { event: 'replicated', label: 'replicated', plain: 'backed up' },
  { event: 'reviewed', label: 'reviewed', plain: 'reviewed' },
  { event: 'exported', label: 'exported', plain: 'exported' },
];

function EvidenceChain({ e, label, events, advanced }: { e: Evidence; label: string; events: CustodyEvent[]; advanced: boolean }) {
  const mine = events.filter((ev) => ev.subject_id === e.id);
  const captured = mine.find((ev) => ev.event === 'captured')?.at_device ?? e.captured_at_device;
  const seconds = (at: string) => `${formatTime(at)}:${new Date(at).getUTCSeconds().toString().padStart(2, '0')}`;
  const parts: string[] = [captured ? (advanced ? `captured ${seconds(captured)} (device)` : `taken ${seconds(captured)}`) : advanced ? 'capture time unknown' : 'time taken unknown'];
  for (const step of CHAIN_STEPS) {
    const ev = mine.find((x) => x.event === step.event);
    const at = ev?.at_server ?? (step.event === 'uploaded' ? e.uploaded_at : step.event === 'verified' ? e.verified_at : null);
    if (at) parts.push(`${advanced ? step.label : step.plain} ${formatDateTime(at, { seconds: true })}`);
  }
  const pendingNote = e.upload_state === 'pending' ? (advanced ? 'awaiting upload from the device' : 'still on the agent’s phone') : null;
  return (
    <li className="text-sm">
      <span className="font-medium">{label}</span> <span className="text-muted-foreground">{parts.join(' · ')}</span>
      {pendingNote ? <span className="text-amber-700"> · {pendingNote}</span> : null}
      {e.upload_state === 'quarantined' ? <Badge tone="danger" className="ml-1">{advanced ? 'quarantined' : 'failed check'}</Badge> : null}
    </li>
  );
}

export function CustodyTimeline({
  job,
  inspections,
  evidence,
  fieldLabels,
}: {
  job: JobDetailRow;
  inspections: InspectionRow[];
  evidence: Evidence[];
  /** Field key → label from the pinned form definitions (plain item names in Basic view). */
  fieldLabels?: Record<string, string>;
}) {
  const advanced = useIsAdvanced();
  const sorted = useMemo(() => [...inspections].sort((a, b) => b.attempt - a.attempt), [inspections]);
  const [selected, setSelected] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<string>(ALL);
  const insp = sorted.find((i) => i.id === selected) ?? sorted[0] ?? null;
  const inspEvidence = useMemo(() => (insp ? evidence.filter((e) => e.inspection_id === insp.id) : []), [evidence, insp]);
  const labels = useMemo(() => evidenceLabels(evidence, advanced ? undefined : fieldLabels), [evidence, advanced, fieldLabels]);

  const envelopeRoles = useMemo(() => {
    const m = new Map<string, string>();
    if (insp?.started_envelope_id) m.set(insp.started_envelope_id, 'visit started');
    if (insp?.submission_envelope_id) m.set(insp.submission_envelope_id, 'visit sent in');
    for (const e of inspEvidence) if (e.envelope_id) m.set(e.envelope_id, `details of ${labels.get(e.id) ?? 'a photo'}`);
    return m;
  }, [insp, inspEvidence, labels]);

  const subjects = useMemo(
    () => [job.id, ...(insp ? [insp.id] : []), ...inspEvidence.map((e) => e.id), ...envelopeRoles.keys()],
    [job.id, insp, inspEvidence, envelopeRoles],
  );
  const custody = useCustodyEvents(job.id, subjects);
  const events = useMemo(() => custody.data ?? [], [custody.data]);
  const filtered = subjectFilter === ALL ? events : events.filter((e) => e.subject_type === subjectFilter);

  const subjectLabel = (ev: CustodyEvent): string => {
    switch (ev.subject_type) {
      case 'inspection':
        return `Visit ${sorted.find((i) => i.id === ev.subject_id)?.attempt ?? '?'}`;
      case 'evidence':
        return labels.get(ev.subject_id) ?? `Evidence ${shortId(ev.subject_id)}`;
      case 'envelope':
        return `Envelope ${shortId(ev.subject_id)}${envelopeRoles.get(ev.subject_id) ? ` (${envelopeRoles.get(ev.subject_id)})` : ''}`;
      case 'job':
        return 'Job';
      default:
        return humanize(ev.subject_type);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {sorted.length > 1 ? (
          <Select value={insp?.id ?? ''} onValueChange={setSelected}>
            <SelectTrigger className="w-48" aria-label="Visit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sorted.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  Visit {i.attempt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {advanced ? (
          <>
            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger className="w-48" aria-label="Subject">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All subjects</SelectItem>
                {(['inspection', 'evidence', 'envelope', 'job'] as CustodySubject[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {humanize(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">Device events carry the device clock; server events the server clock (SAST).</span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">When each photo and file was taken, received and checked. Advanced view also shows the full record of every step.</span>
        )}
      </div>

      {inspEvidence.length ? (
        <SectionCard title={advanced ? 'Evidence chain of custody' : 'Photos and files'} description={advanced ? 'One line per item — the same wording appears on the PDF report.' : 'One line per photo or file.'}>
          <ul className="space-y-2">
            {inspEvidence.map((e) => (
              <EvidenceChain key={e.id} e={e} label={labels.get(e.id) ?? evidenceLabelFallback(e)} events={events} advanced={advanced} />
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <ApiErrorAlert error={custody.error} onRetry={() => void custody.refetch()} />
      {!advanced ? (
        inspEvidence.length === 0 ? (
          <EmptyState title="No photos or files yet" description={insp ? 'They show here as the agent’s phone sends them.' : 'No visit has started yet.'} />
        ) : null
      ) : custody.isPending && subjects.length ? (
        <Skeleton className="h-48 w-full" />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing recorded yet" description={insp ? 'Steps show here as the phone and our systems handle this visit.' : 'No visit has started yet.'} />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Server time</TableHead>
                <TableHead>Device time</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((ev) => (
                <TableRow key={ev.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(ev.at_server, { seconds: true })}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {ev.at_device ? formatDateTime(ev.at_device, { seconds: true }) : '—'}
                    {ev.monotonic_ms !== null ? <div className="text-xs text-muted-foreground">+{ev.monotonic_ms} ms mono</div> : null}
                  </TableCell>
                  <TableCell>
                    <Badge tone={ev.source === 'device' ? 'info' : 'neutral'}>{ev.source}</Badge>
                  </TableCell>
                  <TableCell>{subjectLabel(ev)}</TableCell>
                  <TableCell className="text-sm font-medium">{humanize(ev.event)}</TableCell>
                  <TableCell className="max-w-80 text-sm">
                    {isPlainObject(ev.detail) && Object.keys(ev.detail).length ? (
                      <details>
                        <summary className="cursor-pointer text-primary">{Object.keys(ev.detail).length} fields</summary>
                        <JsonView value={ev.detail} defaultExpandDepth={1} maxHeight={200} className="mt-1" />
                      </details>
                    ) : ev.request_id ? (
                      <span className="font-mono text-xs text-muted-foreground">req {shortId(ev.request_id)}</span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function evidenceLabelFallback(e: Evidence): string {
  return `${humanize(e.type)} ${e.field_key ?? e.category ?? ''}`.trim();
}
