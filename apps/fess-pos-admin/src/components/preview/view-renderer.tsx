'use client';

// View renderer for the phone preview (T3-23): every view component of the catalogue (docs/11 §7.2) — job and record
// display, home components and cards — bound to the sample context (`job.*`, `agent.*`, `inspection.*`, `stats.*`).
// Drawn as the module draws them (docs/14 §2, D-97; renderer/view_renderer.dart): flat labelled values, chips side by
// side, lists as flat rows with a store icon, the home stats as one strip between hairlines, and a bordered box only
// for the agent card, the card for a visit and notices.
import { BadgeCheck, ChevronRight, ImageIcon, Mail, MessageSquare, Phone, QrCode, ShieldCheck, Store } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { FESS } from '@/lib/brand';
import type { ViewItemDef } from '@/lib/engine';
import { JOB_STATUS_LABEL } from '@/lib/status';
import type { JobStatus } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';
import { lenientParse } from './lenient-parse';
import { PhoneCard, PhoneChip, type PhoneChipTone } from './phone-frame';
import { BUTTON_BASE, BUTTON_LOOK, BUTTON_STYLE, PAGE_BLEED, PAGE_X, RING_OFFSET, typeStyle } from './phone-style';
import { Avatar, Callout, Markdown, MockMap, PhoneActionButton, PreviewNotice, QrPlaceholder, toTone, UnknownElement } from './phone-widgets';
import { contentText, type PreviewTarget, ruleBool, templateText, usePreviewEnv } from './preview-context';
import { addressLines, fillPlaceholders, formatDate, formatTime, formatValue, formatWindow, humanise, readPathValue } from './preview-format';

type Data = Record<string, unknown>;
type ChipTone = PhoneChipTone;

/** A job's status as a tone, as the module colours it: done green, work in hand gold, a hold-up amber, an end red. */
const STATUS_TONE: Partial<Record<string, ChipTone>> = {
  approved: 'success',
  closed: 'success',
  submitted: 'success',
  returned: 'warning',
  paused: 'warning',
  appointment_not_secured: 'warning',
  rejected: 'danger',
  cancelled: 'danger',
  unable_to_complete: 'danger',
  assigned: 'accent',
  accepted: 'accent',
  in_progress: 'accent',
  under_review: 'accent',
};

export function statusChip(status: unknown): { label: string; tone: ChipTone } {
  const s = typeof status === 'string' ? status : '';
  const label = JOB_STATUS_LABEL[s as JobStatus] ?? (s ? humanise(s) : '—');
  return { label, tone: STATUS_TONE[s] ?? 'neutral' };
}

function chipTone(tone: unknown): ChipTone {
  return tone === 'error' ? 'danger' : toTone(tone, 'neutral');
}

const ROW_TYPES = new Set(['field_value', 'address_block', 'contact', 'schedule_window']);
/** Chips next to each other share a line. */
const CHIP_TYPES = new Set(['status_chip', 'badge']);

const ROW_DESCRIPTION = { fontSize: FESS.listRow.description.size, fontWeight: FESS.listRow.description.weight, color: FESS.listRow.description.color };
const CHEVRON = { width: FESS.listRow.chevronSize, height: FESS.listRow.chevronSize, color: FESS.listRow.chevron };

/** A value under its label, on a page: a small grey label over the value. */
function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div>
      {label ? (
        <div className="text-[color:var(--ph-body)]" style={typeStyle('caption')}>
          {label}
        </div>
      ) : null}
      <div className="mt-0.5 leading-snug text-[color:var(--ph-body)]" style={typeStyle('body')}>
        {children}
      </div>
    </div>
  );
}

/** A labelled value inside a list row: one grey line, the value in semibold. */
function RowLine({ label, value }: { label?: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-1.5 leading-snug" style={ROW_DESCRIPTION}>
      {label ? <span>{label}</span> : null}
      <span className={label ? 'font-semibold' : undefined}>{value}</span>
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

/** The agent card (`agent_card`) or the card for this visit (`job_card`): a bordered white box, centred, no shadow. */
function AgentCard({ item, data, scope }: { item: ViewItemDef; data: Data; scope: 'agent' | 'job' }) {
  const env = usePreviewEnv();
  const agent = isPlainObject(data.agent) ? data.agent : {};
  const job = isPlainObject(data.job) ? data.job : {};
  const until = new Date();
  until.setDate(until.getDate() + (scope === 'job' ? 0 : 30));
  const first = String(agent.first_name ?? '');
  const last = String(agent.last_name ?? '');
  const name = `${first} ${last}`.trim() || 'Agent name';
  return (
    <PhoneCard className="flex flex-col items-center p-5 text-center">
      {item.show_photo !== false ? (
        <div className="mb-3">
          <Avatar firstName={first} lastName={last} size={80} />
        </div>
      ) : null}
      <div className="leading-tight text-[color:var(--ph-text)]" style={typeStyle('titleLarge')}>
        {name}
      </div>
      <div className="mt-1 leading-snug text-[color:var(--ph-body)]" style={typeStyle('body')}>
        Employee {String(agent.employee_number ?? '—')}
        <br />
        Fidelity POS agent
      </div>
      {item.show_status !== false ? (
        <div className="mt-3">
          <PhoneChip tone="success">
            <ShieldCheck className="size-3.5" />
            {scope === 'job' ? 'Authorised for this visit' : contentText(env.strings, 'verify.valid_heading')}
          </PhoneChip>
        </div>
      ) : null}
      {scope === 'job' ? (
        <div className="mt-4 leading-snug">
          <div className="text-[color:var(--ph-text)]" style={typeStyle('body')}>
            {contentText(env.strings, 'verify.job_heading')}
          </div>
          <div className="text-[color:var(--ph-body)]" style={typeStyle('body')}>
            {String(job.merchant_name ?? '')}
          </div>
        </div>
      ) : null}
      {item.show_qr !== false ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          <QrPlaceholder size={160} seed={`${String(agent.id ?? '')}${scope === 'job' ? String(job.id ?? '') : ''}`} />
          <span className="text-[color:var(--ph-body)]" style={typeStyle('caption')}>
            {contentText(env.strings, 'verify.valid_until')} {scope === 'job' ? `${formatDate(until.toISOString())} 23:59` : formatDate(until.toISOString())} · code from the server
          </span>
        </div>
      ) : null}
    </PhoneCard>
  );
}

/** How the visit's evidence is getting on: a chip in its tone (received green, still going up amber). */
function EvidenceStatus({ value, label }: { value: unknown; label?: string }) {
  const env = usePreviewEnv();
  const r = isPlainObject(value) ? value : null;
  if (!r) return <PreviewNotice>No confirmation yet. It appears after the visit is sent in.</PreviewNotice>;
  const pending = typeof r.photos_pending === 'number' ? r.photos_pending : 0;
  const state = r.state === 'saved' ? 'saved' : pending > 0 ? 'uploading' : 'received';
  const text = fillPlaceholders(contentText(env.strings, `receipt.${state}`), {
    time: typeof r.received_at === 'string' ? formatTime(r.received_at) : '',
    verified: r.photos_verified,
    expected: r.photos_expected,
    remaining: pending,
    count: r.pending_items,
  });
  return (
    <Row label={label}>
      <PhoneChip tone={state === 'received' ? 'success' : 'warning'}>{text}</PhoneChip>
    </Row>
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
  // Edge to edge: the rows span the page and line their text up themselves.
  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)]', PAGE_BLEED)}>
      {item.title ? (
        <div className={cn('pb-2 pt-2 leading-tight text-[color:var(--ph-text)]', PAGE_X)} style={typeStyle('title')}>
          {templateText(item.title, data)}
        </div>
      ) : null}
      {jobs.length === 0 ? (
        <div className={cn('py-6 text-center text-[color:var(--ph-body)]', PAGE_X)} style={typeStyle('body')}>
          {contentText(env.strings, item.empty_content) || 'Nothing here yet.'}
        </div>
      ) : (
        // FESS's lists open with a hairline above the first row.
        <div className="border-t border-[color:var(--ph-divider)]">
          {jobs.map((job) => (
            <Tappable key={job.id} target={item.on_tap}>
              <JobListCard viewKey={item.item_view} data={{ ...data, job }} />
            </Tappable>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One record through an item view (job_card and friends), as a flat list row (component.listRow): a green store icon in
 * a 70 px column, the item view, a grey chevron and a hairline inset from the left; at least 80 px high.
 */
export function JobListCard({ viewKey, data }: { viewKey: string | undefined; data: Data }) {
  const env = usePreviewEnv();
  const doc = viewKey ? env.bundle.views?.[viewKey] : undefined;
  const parsed = doc ? lenientParse('view', doc).definition : null;
  const items = parsed && Array.isArray(parsed.items) ? (parsed.items as ViewItemDef[]) : null;
  const row = FESS.listRow;
  return (
    <div className="flex items-stretch bg-[color:var(--ph-page)]">
      <span className="flex shrink-0 items-center justify-center text-[var(--pp)]" style={{ width: row.iconColumn }}>
        <Store style={{ width: row.iconSize, height: row.iconSize }} strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 items-center border-b" style={{ minHeight: row.height, borderColor: row.divider }}>
        <div className="min-w-0 flex-1" style={{ paddingTop: row.paddingY, paddingBottom: row.paddingY }}>
          {items ? (
            <ViewItems items={items} data={data} compact />
          ) : (
            <>
              <div className="leading-snug" style={{ fontSize: row.title.size, fontWeight: row.title.weight, color: row.title.color }}>
                {String(readPathValue(data, 'job.merchant_name') ?? '')}
              </div>
              <div className="mt-1 leading-snug" style={ROW_DESCRIPTION}>
                The screen layout “{viewKey ?? '—'}” can’t be shown in this preview
              </div>
            </>
          )}
        </div>
        <ChevronRight className="mx-4 shrink-0" style={CHEVRON} />
      </div>
    </div>
  );
}

function renderItem(item: ViewItemDef, data: Data, compact: boolean, strings: Readonly<Record<string, string>>): ReactNode {
  const bound = item.bind ? readPathValue(data, item.bind) : undefined;
  const label = item.label ? templateText(item.label, data) : undefined;
  switch (item.type) {
    case 'title': {
      const text = item.bind ? formatValue(bound) : templateText(item.text, data);
      return compact ? (
        <div className="pb-0.5 leading-snug" style={{ fontSize: FESS.listRow.title.size, fontWeight: FESS.listRow.title.weight, color: FESS.listRow.title.color }}>
          {text}
        </div>
      ) : (
        <div className="leading-tight text-[color:var(--ph-text)]" style={typeStyle('title')}>
          {text}
        </div>
      );
    }
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
      return compact ? <RowLine label={label} value={formatValue(bound, item.format)} /> : <Row label={label}>{formatValue(bound, item.format)}</Row>;
    case 'schedule_window':
      return compact ? <RowLine label={label} value={formatWindow(bound)} /> : <Row label={label ?? 'Visit window'}>{formatWindow(bound)}</Row>;
    case 'address_block': {
      const lines = addressLines(bound);
      return compact ? (
        <RowLine label={label} value={lines.join(', ') || '—'} />
      ) : (
        <Row label={label ?? 'Address'}>{lines.length ? lines.map((l) => <div key={l}>{l}</div>) : '—'}</Row>
      );
    }
    case 'contact': {
      const c = isPlainObject(bound) ? bound : {};
      const actions = item.actions ?? ['call'];
      const lines = [c.role, c.phone, c.email].filter((v): v is string => typeof v === 'string' && v !== '');
      return (
        <Row label={label ?? 'Contact'}>
          <div>{String(c.name ?? '—')}</div>
          {lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
          {/* The module's contact buttons: gold-outlined, an icon and the action's name. */}
          <div className="mt-2 flex flex-wrap gap-2">
            {actions.map((a) => {
              const Icon = a === 'sms' ? MessageSquare : a === 'email' ? Mail : Phone;
              return (
                <span key={a} className={cn(BUTTON_BASE, BUTTON_LOOK.outline)} style={BUTTON_STYLE}>
                  <Icon />
                  {strings[`contact.${a}`] ?? humanise(a)}
                </span>
              );
            })}
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
          <div className="flex h-32 items-center justify-center rounded-[var(--ph-inner-r)] bg-[color:var(--ph-subtle)] text-[color:var(--ph-muted)]">
            <ImageIcon className="size-8" />
          </div>
          {item.caption ? (
            <figcaption className="mt-1 text-[color:var(--ph-body)]" style={typeStyle('caption')}>
              {templateText(item.caption, data)}
            </figcaption>
          ) : null}
        </figure>
      );
    case 'divider':
      return compact ? <div className="h-1" /> : <hr className={cn('my-2 border-[color:var(--ph-divider)]', PAGE_BLEED)} />;
    case 'evidence_status':
      return <EvidenceStatus value={bound} label={label} />;
    case 'greeting':
      return (
        <div className="leading-tight text-[color:var(--ph-text)]" style={typeStyle('titleLarge')}>
          {templateText(item.text, data)}
        </div>
      );
    case 'section_title':
      return (
        <div className="pt-2 leading-tight text-[color:var(--ph-text)]" style={typeStyle('title')}>
          {templateText(item.text, data)}
        </div>
      );
    case 'announcement':
      return <Callout tone={toTone(item.tone, 'info')}>{templateText(item.text, data)}</Callout>;
    case 'sync_status':
      // The module's sync line: small grey text, centred.
      return (
        <div className="text-center text-[color:var(--ph-body)]" style={typeStyle('caption')}>
          {contentText(strings, 'sync.synced')}
        </div>
      );
    default:
      return undefined;
  }
}

/** One stat: the number (green where it opens something) over its label. */
function StatTile({ tile, data, first = false }: { tile: ViewItemDef; data: Data; first?: boolean }) {
  const env = usePreviewEnv();
  let value: unknown;
  if (tile.source === 'local') {
    const today = typeof data.today === 'string' ? data.today : null;
    value = env.jobs.filter((job) => ruleBool(tile.filter, { ...data, job }, true, today)).length;
  } else value = tile.stat ? readPathValue(data, tile.stat) : undefined;
  const stat = FESS.stat;
  return (
    <Tappable target={tile.on_tap} className="h-full">
      <div className={cn('flex h-full flex-col px-3 py-3.5', first && 'pl-[var(--ph-x)]')}>
        <div className="leading-none" style={{ fontSize: stat.number.size, fontWeight: stat.number.weight, color: tile.on_tap ? 'var(--pp)' : stat.number.color }}>
          {typeof value === 'number' ? value : '—'}
        </div>
        <div className="mt-1 leading-tight" style={{ fontSize: stat.label.size, fontWeight: stat.label.weight, color: stat.label.color }}>
          {templateText(tile.label, data)}
        </div>
      </div>
    </Tappable>
  );
}

/**
 * The home stats as one flat strip between hairlines (component.stat), edge to edge. The module fits four in a line on a
 * real phone; this phone is narrower, so four go two by two (hairlines between the cells either way).
 */
function StatStrip({ tiles, data }: { tiles: readonly ViewItemDef[]; data: Data }) {
  if (tiles.length === 0) return null;
  const perRow = tiles.length <= 3 ? tiles.length : tiles.length === 4 ? 2 : 3;
  const rest = tiles.length % perRow;
  return (
    <div
      className={cn('grid gap-px border-y border-[color:var(--ph-divider)] bg-[color:var(--ph-divider)]', PAGE_BLEED)}
      style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}
    >
      {tiles.map((t, j) => (
        <div
          key={j}
          className="bg-[color:var(--ph-page)]"
          // The last cell of a short last line takes the rest of it, so no empty slot shows.
          style={rest && j === tiles.length - 1 ? { gridColumn: `span ${perRow - rest + 1}` } : undefined}
        >
          <StatTile tile={t} data={data} first={j % perRow === 0} />
        </div>
      ))}
    </div>
  );
}

/** A list of view items. `compact` is the look inside a list row (item views). */
export function ViewItems({ items, data, compact = false }: { items: readonly ViewItemDef[]; data: Data; compact?: boolean }) {
  const env = usePreviewEnv();
  const today = typeof data.today === 'string' ? data.today : null;
  const blocks: ReactNode[] = [];
  let rows: ReactNode[] = [];
  let chips: ReactNode[] = [];
  const flushRows = () => {
    if (rows.length) {
      blocks.push(
        <div key={`rows-${blocks.length}`} className="grid gap-3">
          {rows}
        </div>,
      );
      rows = [];
    }
  };
  const flushChips = () => {
    if (chips.length) {
      blocks.push(
        <div key={`chips-${blocks.length}`} className="flex flex-wrap gap-2">
          {chips}
        </div>,
      );
      chips = [];
    }
  };
  items.forEach((item, i) => {
    if (!ruleBool(item.visible, data, true, today)) return;
    const anchor = item.id;
    const highlighted = anchor !== undefined && env.focus === anchor;
    const wrap = (node: ReactNode) => (
      <div key={`${item.type}-${i}`} data-preview-anchor={anchor} className={cn('scroll-mt-4 rounded-[var(--ph-inner-r)]', highlighted && cn('ring-2 ring-[var(--pp)] ring-offset-2', RING_OFFSET))}>
        {node}
      </div>
    );
    if (!compact && ROW_TYPES.has(item.type) && !highlighted) {
      flushChips();
      rows.push(<Fragment key={`${item.type}-${i}`}>{renderItem(item, data, false, env.strings)}</Fragment>);
      return;
    }
    if (CHIP_TYPES.has(item.type) && !highlighted) {
      flushRows();
      chips.push(<Fragment key={`${item.type}-${i}`}>{renderItem(item, data, compact, env.strings)}</Fragment>);
      return;
    }
    flushRows();
    flushChips();
    let node: ReactNode;
    if (item.type === 'stat_row') {
      node = <StatStrip tiles={(item.tiles ?? []).filter((t) => ruleBool(t.visible, data, true, today))} data={data} />;
    } else if (item.type === 'stat_tile') {
      node = (
        <div className="-mx-3">
          <StatTile tile={item} data={data} />
        </div>
      );
    } else if (item.type === 'job_list') node = <JobList item={item} data={data} />;
    else if (item.type === 'agent_card') node = <AgentCard item={item} data={data} scope="agent" />;
    else if (item.type === 'job_card') node = <AgentCard item={item} data={data} scope="job" />;
    else if (item.type === 'agent_card_summary') {
      const agent = isPlainObject(data.agent) ? data.agent : {};
      const first = String(agent.first_name ?? '');
      const last = String(agent.last_name ?? '');
      node = (
        <Tappable target={item.on_tap}>
          <PhoneCard className="flex items-center gap-3 py-4 pl-4 pr-2">
            <Avatar firstName={first} lastName={last} />
            <div className="min-w-0 flex-1">
              <div className="leading-tight" style={{ fontSize: FESS.type.title.size, fontWeight: FESS.listRow.title.weight, color: FESS.listRow.title.color }}>
                {first} {last}
              </div>
              <div className="mt-1.5">
                <PhoneChip tone="success">
                  <BadgeCheck className="size-3.5" /> Authorised · show my card
                </PhoneChip>
              </div>
            </div>
            <QrCode className="size-6 shrink-0 text-[var(--pp)]" />
            <ChevronRight className="shrink-0" style={CHEVRON} />
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
    if (node !== null) blocks.push(wrap(node));
  });
  flushRows();
  flushChips();
  return <div className={cn('grid min-w-0 grid-cols-[minmax(0,1fr)]', compact ? 'gap-1' : 'gap-3')}>{blocks}</div>;
}

/** Render a view definition document (lenient: valid items only, with a notice for the rest). */
export function ViewDocument({ view, data, compact }: { view: unknown; data: Data; compact?: boolean }) {
  const parsed = lenientParse('view', view);
  const items = parsed.definition && Array.isArray(parsed.definition.items) ? (parsed.definition.items as ViewItemDef[]) : [];
  if (items.length === 0) return <PreviewNotice>This screen layout is empty so far.</PreviewNotice>;
  return <ViewItems items={items} data={data} compact={compact} />;
}

/** A view from the bundle by family key. */
export function ViewByKey({ viewKey, data }: { viewKey: string | undefined; data?: Data }) {
  const env = usePreviewEnv();
  const doc = viewKey ? env.bundle.views?.[viewKey] : undefined;
  if (!doc) {
    return <PreviewNotice>The screen layout “{viewKey ?? '—'}” can’t be shown in this preview.</PreviewNotice>;
  }
  return <ViewDocument view={doc} data={data ?? env.data} />;
}
