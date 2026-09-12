'use client';

// View renderer for the phone preview (T3-23): every view component of the catalogue (docs/11 §7.2) — job and record
// display, home components and cards — bound to the sample context (`job.*`, `agent.*`, `inspection.*`, `stats.*`).
import { BadgeCheck, CalendarClock, ChevronRight, CircleCheck, CloudUpload, ImageIcon, Mail, MessageSquare, Navigation, Phone } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import type { ViewItemDef } from '@/lib/engine';
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from '@/lib/status';
import type { JobStatus } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';
import { lenientParse } from './lenient-parse';
import { PhoneCard, PhoneChip } from './phone-frame';
import { Callout, Markdown, MockMap, PhoneActionButton, PhotoPlaceholder, PreviewNotice, QrPlaceholder, toTone, UnknownElement } from './phone-widgets';
import { contentText, type PreviewTarget, ruleBool, templateText, usePreviewEnv } from './preview-context';
import { addressLines, fillPlaceholders, formatDate, formatTime, formatValue, formatWindow, humanise, readPathValue } from './preview-format';

type Data = Record<string, unknown>;
type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export function statusChip(status: unknown): { label: string; tone: ChipTone } {
  const s = typeof status === 'string' ? status : '';
  const label = JOB_STATUS_LABEL[s as JobStatus] ?? (s ? humanise(s) : '—');
  const t = JOB_STATUS_TONE[s as JobStatus];
  const tone: ChipTone = t === 'success' ? 'success' : t === 'warning' ? 'warning' : t === 'danger' ? 'danger' : t === 'info' || t === 'accent' || t === 'progress' ? 'primary' : 'neutral';
  return { label, tone };
}

function chipTone(tone: unknown): ChipTone {
  const t = toTone(tone, 'neutral');
  return t === 'info' ? 'primary' : t;
}

const ROW_TYPES = new Set(['field_value', 'address_block', 'contact', 'schedule_window']);

function Row({ label, children, icon }: { label?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      {icon ? <span className="mt-0.5 text-slate-500">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        {label ? <div className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{label}</div> : null}
        <div className="text-[15px] leading-snug text-slate-900">{children}</div>
      </div>
    </div>
  );
}

function Tappable({ target, children, className }: { target: PreviewTarget | undefined; children: ReactNode; className?: string }) {
  const env = usePreviewEnv();
  if (!target) return <div className={className}>{children}</div>;
  return (
    <button type="button" onClick={() => env.navigate?.(target)} className={cn('block w-full text-left', env.navigate ? 'cursor-pointer' : 'cursor-default', className)}>
      {children}
    </button>
  );
}

function AgentCard({ item, data, scope }: { item: ViewItemDef; data: Data; scope: 'agent' | 'job' }) {
  const env = usePreviewEnv();
  const agent = isPlainObject(data.agent) ? data.agent : {};
  const job = isPlainObject(data.job) ? data.job : {};
  const until = new Date();
  until.setDate(until.getDate() + (scope === 'job' ? 0 : 30));
  const name = `${String(agent.first_name ?? '')} ${String(agent.last_name ?? '')}`.trim() || 'Agent name';
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between bg-[var(--pp)] px-4 py-2 text-[13px] font-semibold text-white">
        <span>Fidelity POS agent</span>
        <BadgeCheck className="size-4" />
      </div>
      <div className="flex gap-3 p-4">
        {item.show_photo !== false ? <PhotoPlaceholder size={72} label="Agent photo" /> : null}
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold leading-tight">{name}</div>
          <div className="text-[13px] text-slate-600">Employee {String(agent.employee_number ?? '—')}</div>
          {scope === 'job' ? <div className="mt-1 text-[14px] text-slate-800">{contentText(env.strings, 'verify.job_heading')}: {String(job.merchant_name ?? '')}</div> : null}
          {item.show_status !== false ? (
            <div className="mt-2">
              <PhoneChip tone="success">{scope === 'job' ? 'Authorised for this visit' : contentText(env.strings, 'verify.valid_heading')}</PhoneChip>
            </div>
          ) : null}
        </div>
      </div>
      {item.show_qr !== false ? (
        <div className="flex flex-col items-center gap-1 border-t border-slate-100 px-4 py-3">
          <QrPlaceholder seed={`${String(agent.id ?? '')}${scope === 'job' ? String(job.id ?? '') : ''}`} />
          <span className="text-[12px] text-slate-500">
            {contentText(env.strings, 'verify.valid_until')} {scope === 'job' ? `${formatDate(until.toISOString())} 23:59` : formatDate(until.toISOString())} · code from the server
          </span>
        </div>
      ) : null}
    </div>
  );
}

function EvidenceStatus({ value }: { value: unknown }) {
  const env = usePreviewEnv();
  const r = isPlainObject(value) ? value : null;
  if (!r) return <PreviewNotice>No receipt yet — it appears after the inspection is sent.</PreviewNotice>;
  const pending = typeof r.photos_pending === 'number' ? r.photos_pending : 0;
  const state = r.state === 'saved' ? 'saved' : pending > 0 ? 'uploading' : 'received';
  const text = fillPlaceholders(contentText(env.strings, `receipt.${state}`), {
    time: typeof r.received_at === 'string' ? formatTime(r.received_at) : '',
    verified: r.photos_verified,
    expected: r.photos_expected,
    remaining: pending,
    count: r.pending_items,
  });
  const Icon = state === 'received' ? CircleCheck : CloudUpload;
  return (
    <div className={cn('flex items-start gap-2 rounded-xl border px-3 py-3 text-[15px]', state === 'received' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-sky-200 bg-sky-50 text-sky-900')}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function JobList({ item, data }: { item: ViewItemDef; data: Data }) {
  const env = usePreviewEnv();
  const today = typeof data.today === 'string' ? data.today : null;
  let jobs = env.jobs.filter((job) => ruleBool(item.filter, { ...data, job }, true, today));
  if (item.sort) {
    const sort = item.sort;
    const key = (job: unknown) => {
      const v = readPathValue({ job }, sort) ?? readPathValue({ job }, sort.replace(/_start$/, '.start'));
      return typeof v === 'string' || typeof v === 'number' ? v : '';
    };
    jobs = [...jobs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (item.sort_direction === 'desc' ? -1 : 1));
  }
  if (item.limit) jobs = jobs.slice(0, item.limit);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      {item.title ? <div className="text-[16px] font-semibold">{templateText(item.title, data)}</div> : null}
      {jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-[14px] text-slate-500">{contentText(env.strings, item.empty_content) || 'Nothing here yet.'}</div>
      ) : (
        jobs.map((job) => (
          <Tappable key={job.id} target={item.on_tap} className="rounded-xl">
            <JobListCard viewKey={item.item_view} data={{ ...data, job }} />
          </Tappable>
        ))
      )}
    </div>
  );
}

/** One record through an item view (job_card and friends), as a card. */
export function JobListCard({ viewKey, data }: { viewKey: string | undefined; data: Data }) {
  const env = usePreviewEnv();
  const doc = viewKey ? env.bundle.views?.[viewKey] : undefined;
  const parsed = doc ? lenientParse('view', doc).definition : null;
  const items = parsed && Array.isArray(parsed.items) ? (parsed.items as ViewItemDef[]) : null;
  return (
    <PhoneCard className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        {items ? (
          <ViewItems items={items} data={data} compact />
        ) : (
          <>
            <div className="text-[15px] font-semibold">{String(readPathValue(data, 'job.merchant_name') ?? '')}</div>
            <div className="text-[12px] text-slate-500">Item view “{viewKey ?? '—'}” is not loaded in this preview</div>
          </>
        )}
      </div>
      <ChevronRight className="size-5 shrink-0 text-slate-400" />
    </PhoneCard>
  );
}

function renderItem(item: ViewItemDef, data: Data, compact: boolean, strings: Readonly<Record<string, string>>): ReactNode {
  const bound = item.bind ? readPathValue(data, item.bind) : undefined;
  const label = item.label ? templateText(item.label, data) : undefined;
  switch (item.type) {
    case 'title':
      return <div className={cn('font-semibold leading-tight text-slate-900', compact ? 'text-[16px]' : 'text-[20px]')}>{item.bind ? formatValue(bound) : templateText(item.text, data)}</div>;
    case 'status_chip': {
      const c = statusChip(bound);
      return (
        <div>
          <PhoneChip tone={c.tone}>{c.label}</PhoneChip>
        </div>
      );
    }
    case 'badge':
      return (
        <div>
          <PhoneChip tone={chipTone(item.tone)}>{templateText(item.text, data)}</PhoneChip>
        </div>
      );
    case 'field_value':
      return compact ? (
        <div className="text-[13px] text-slate-600">
          {label ? `${label}: ` : ''}
          {formatValue(bound, item.format)}
        </div>
      ) : (
        <Row label={label}>{formatValue(bound, item.format)}</Row>
      );
    case 'schedule_window':
      return compact ? (
        <div className="flex items-center gap-1 text-[13px] text-slate-600">
          <CalendarClock className="size-3.5" /> {formatWindow(bound)}
        </div>
      ) : (
        <Row label={label ?? 'Visit window'} icon={<CalendarClock className="size-4" />}>
          {formatWindow(bound)}
        </Row>
      );
    case 'address_block': {
      const lines = addressLines(bound);
      return compact ? (
        <div className="truncate text-[13px] text-slate-600">{lines.join(', ') || '—'}</div>
      ) : (
        <Row label={label ?? 'Address'} icon={<Navigation className="size-4" />}>
          {lines.length ? lines.map((l) => <div key={l}>{l}</div>) : '—'}
        </Row>
      );
    }
    case 'contact': {
      const c = isPlainObject(bound) ? bound : {};
      const actions = item.actions ?? ['call'];
      return (
        <Row label={label ?? 'Contact'} icon={<Phone className="size-4" />}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div>{String(c.name ?? '—')}</div>
              <div className="text-[13px] text-slate-600">{String(c.phone ?? c.email ?? '')}</div>
            </div>
            <div className="flex gap-1.5">
              {actions.map((a) => {
                const Icon = a === 'sms' ? MessageSquare : a === 'email' ? Mail : Phone;
                return (
                  <span key={a} className="flex size-9 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--pp)_12%,white)] text-[var(--pp)]" title={humanise(a)}>
                    <Icon className="size-4" />
                  </span>
                );
              })}
            </div>
          </div>
        </Row>
      );
    }
    case 'map_preview':
      return <MockMap height={item.height ?? 160} />;
    case 'markdown': {
      const text = templateText(item.text, data);
      return text.trim() ? <Markdown text={text} /> : null;
    }
    case 'image':
      return (
        <figure>
          <div className="flex h-32 items-center justify-center rounded-lg bg-slate-200 text-slate-500">
            <ImageIcon className="size-8" />
          </div>
          {item.caption ? <figcaption className="mt-1 text-[13px] text-slate-600">{templateText(item.caption, data)}</figcaption> : null}
        </figure>
      );
    case 'divider':
      return <hr className="border-slate-200" />;
    case 'evidence_status':
      return <EvidenceStatus value={bound} />;
    case 'greeting':
      return <div className="text-[22px] font-semibold leading-tight text-slate-900">{templateText(item.text, data)}</div>;
    case 'section_title':
      return <div className="pt-1 text-[16px] font-semibold text-slate-900">{templateText(item.text, data)}</div>;
    case 'announcement':
      return <Callout tone={toTone(item.tone, 'info')}>{templateText(item.text, data)}</Callout>;
    case 'sync_status':
      return (
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[13px] font-medium text-emerald-800">
            <CircleCheck className="size-4" /> {contentText(strings, 'sync.synced')}
          </span>
        </div>
      );
    default:
      return undefined;
  }
}

function StatTile({ tile, data }: { tile: ViewItemDef; data: Data }) {
  const env = usePreviewEnv();
  let value: unknown;
  if (tile.source === 'local') {
    const today = typeof data.today === 'string' ? data.today : null;
    value = env.jobs.filter((job) => ruleBool(tile.filter, { ...data, job }, true, today)).length;
  } else value = tile.stat ? readPathValue(data, tile.stat) : undefined;
  return (
    <Tappable target={tile.on_tap} className="h-full">
      <div className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <div className="text-[24px] font-semibold leading-none text-[var(--pp)]">{typeof value === 'number' ? value : '—'}</div>
        <div className="mt-1 text-[13px] leading-tight text-slate-600">{templateText(tile.label, data)}</div>
      </div>
    </Tappable>
  );
}

/** A list of view items. `compact` is the look inside a list card (item views). */
export function ViewItems({ items, data, compact = false }: { items: readonly ViewItemDef[]; data: Data; compact?: boolean }) {
  const env = usePreviewEnv();
  const today = typeof data.today === 'string' ? data.today : null;
  const blocks: ReactNode[] = [];
  let rows: ReactNode[] = [];
  const flush = () => {
    if (rows.length) {
      blocks.push(
        <div key={`rows-${blocks.length}`} className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {rows}
        </div>,
      );
      rows = [];
    }
  };
  items.forEach((item, i) => {
    if (!ruleBool(item.visible, data, true, today)) return;
    const anchor = item.id;
    const highlighted = anchor !== undefined && env.focus === anchor;
    const wrap = (node: ReactNode) => (
      <div key={`${item.type}-${i}`} data-preview-anchor={anchor} className={cn('scroll-mt-4 rounded-xl', highlighted && 'ring-2 ring-[var(--pp)] ring-offset-2 ring-offset-[#f4f5f7]')}>
        {node}
      </div>
    );
    if (!compact && ROW_TYPES.has(item.type) && !highlighted) {
      rows.push(<Fragment key={`${item.type}-${i}`}>{renderItem(item, data, false, env.strings)}</Fragment>);
      return;
    }
    flush();
    let node: ReactNode;
    if (item.type === 'stat_row') {
      node = (
        <div className="grid grid-cols-2 gap-2">
          {(item.tiles ?? []).filter((t) => ruleBool(t.visible, data, true, today)).map((t, j) => (
            <StatTile key={j} tile={t} data={data} />
          ))}
        </div>
      );
    } else if (item.type === 'stat_tile') node = <StatTile tile={item} data={data} />;
    else if (item.type === 'job_list') node = <JobList item={item} data={data} />;
    else if (item.type === 'agent_card') node = <AgentCard item={item} data={data} scope="agent" />;
    else if (item.type === 'job_card') node = <AgentCard item={item} data={data} scope="job" />;
    else if (item.type === 'agent_card_summary') {
      const agent = isPlainObject(data.agent) ? data.agent : {};
      node = (
        <Tappable target={item.on_tap}>
          <PhoneCard className="flex items-center gap-3">
            <PhotoPlaceholder size={40} label="Agent photo" />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">
                {String(agent.first_name ?? '')} {String(agent.last_name ?? '')}
              </div>
              <div className="flex items-center gap-1 text-[13px] text-emerald-700">
                <BadgeCheck className="size-3.5" /> Authorised · show my card
              </div>
            </div>
            <ChevronRight className="size-5 text-slate-400" />
          </PhoneCard>
        </Tappable>
      );
    } else if (item.type === 'action_button') {
      node = (
        <PhoneActionButton variant={item.style === 'secondary' ? 'outline' : 'primary'} onClick={() => item.target && env.navigate?.(item.target)}>
          {templateText(item.label, data)}
        </PhoneActionButton>
      );
    } else {
      const rendered = renderItem(item, data, compact, env.strings);
      node = rendered === undefined ? <UnknownElement type={item.type} /> : rendered;
    }
    if (node !== null) blocks.push(wrap(highlighted && ROW_TYPES.has(item.type) ? <div className="rounded-xl border border-slate-200 bg-white">{node}</div> : node));
  });
  flush();
  return <div className={cn('grid min-w-0 grid-cols-[minmax(0,1fr)]', compact ? 'gap-1' : 'gap-3')}>{blocks}</div>;
}

/** Render a view definition document (lenient: valid items only, with a notice for the rest). */
export function ViewDocument({ view, data, compact }: { view: unknown; data: Data; compact?: boolean }) {
  const parsed = lenientParse('view', view);
  const items = parsed.definition && Array.isArray(parsed.definition.items) ? (parsed.definition.items as ViewItemDef[]) : [];
  if (items.length === 0) return <PreviewNotice>This view has no items to show yet.</PreviewNotice>;
  return <ViewItems items={items} data={data} compact={compact} />;
}

/** A view from the bundle by family key. */
export function ViewByKey({ viewKey, data }: { viewKey: string | undefined; data?: Data }) {
  const env = usePreviewEnv();
  const doc = viewKey ? env.bundle.views?.[viewKey] : undefined;
  if (!doc) {
    return <PreviewNotice>View “{viewKey ?? '—'}” is not loaded in this preview.</PreviewNotice>;
  }
  return <ViewDocument view={doc} data={data ?? env.data} />;
}
