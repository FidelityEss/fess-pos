// Pure formatting helpers for the phone preview (T3-23): bindings, dates, addresses and values as the phone shows them.
import { isPlainObject } from '@/lib/utils';

const LOCALE = 'en-ZA';

/** Read a dotted path (`job.address.city`, `items.0.name`) from a value; undefined when absent. */
export function readPathValue(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(seg);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
      continue;
    }
    if (typeof cur !== 'object') return undefined;
    cur = Object.prototype.hasOwnProperty.call(cur, seg) ? (cur as Record<string, unknown>)[seg] : undefined;
  }
  return cur;
}

function parseDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatTime(value: string): string {
  const d = parseDate(value);
  return d ? d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false }) : value;
}

export function formatDate(value: string): string {
  const d = parseDate(value);
  return d ? d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : value;
}

/** "Today", "Tomorrow", "Yesterday" or a short date. */
export function dayLabel(value: string): string {
  const d = parseDate(value);
  if (!d) return value;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatDateTime(value: string): string {
  const d = parseDate(value);
  return d ? `${dayLabel(value)} ${formatTime(value)}` : value;
}

/** A visit window `{start, end}` → "Today · 10:00–12:00". */
export function formatWindow(value: unknown): string {
  if (!isPlainObject(value)) return typeof value === 'string' ? formatDateTime(value) : '—';
  const start = typeof value.start === 'string' ? value.start : null;
  const end = typeof value.end === 'string' ? value.end : null;
  if (!start) return '—';
  return end ? `${dayLabel(start)} · ${formatTime(start)}–${formatTime(end)}` : formatDateTime(start);
}

/** Address lines as the phone prints them. */
export function addressLines(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!isPlainObject(value)) return [];
  const s = (k: string) => (typeof value[k] === 'string' && value[k] ? (value[k] as string) : null);
  const lines = [s('line1'), s('line2'), s('suburb'), [s('city'), s('postal_code')].filter(Boolean).join(' ') || null, s('province')];
  return lines.filter((l): l is string => Boolean(l));
}

export function humanise(value: string): string {
  const s = value.replace(/[_.]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** First letter upper-case, trailing full stop (engine messages are lower-case fragments). */
export function sentence(message: string): string {
  const s = message.trim();
  if (!s) return s;
  const cap = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

const currency = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'ZAR' });

/** A bound or answered value as display text. */
export function formatValue(value: unknown, format?: string | null): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (format === 'currency') return currency.format(value);
    if (format === 'percentage') return `${value}%`;
    return value.toLocaleString(LOCALE);
  }
  if (typeof value === 'string') {
    if (format === 'date') return formatDate(value);
    if (format === 'datetime') return formatDateTime(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => formatValue(v)).join(', ');
  if (isPlainObject(value)) {
    if ('line1' in value || 'city' in value) return addressLines(value).join(', ');
    if ('start' in value && 'end' in value) return formatWindow(value);
    if ('minor' in value && typeof value.minor === 'number') return currency.format(value.minor / 100);
    if ('value' in value && 'unit' in value) return `${String(value.value)} ${String(value.unit)}`;
    if ('name' in value && typeof value.name === 'string') return value.name;
    return Object.entries(value)
      .map(([k, v]) => `${humanise(k)}: ${formatValue(v)}`)
      .join(' · ');
  }
  return String(value);
}

/**
 * Fill `{{placeholders}}` from sample values; placeholders without a sample stay visible as ‹name› so the admin sees
 * where the phone will insert something.
 */
export function fillPlaceholders(template: string, values: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{\{\s*([a-z_][a-z0-9_.]*)\s*\}\}/gi, (_m, path: string) => {
    const v = readPathValue(values, path);
    return v === undefined || v === null || typeof v === 'object' ? `‹${path}›` : String(v);
  });
}
