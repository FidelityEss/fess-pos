'use client';

// Readable rendering of any JSON-shaped value: humanised labels, units from key suffixes (radius_m → "75 m"), Yes/No for
// booleans, dates, short ids with copy, arrays as chips / tables / numbered groups, nested objects as sections.
// Basic users never need to read JSON; the raw view stays available in Advanced mode (JsonView).
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { DateTime } from '@/components/date-time';
import { cn, isPlainObject } from '@/lib/utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{40,128}$/i;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

const WORDS: Record<string, string> = {
  id: 'ID', ids: 'IDs', url: 'URL', api: 'API', mcc: 'MCC', gps: 'GPS', sha256: 'SHA-256', ttl: 'TTL', qr: 'QR', pos: 'POS',
  jpeg: 'JPEG', dsn: 'DSN', sms: 'SMS', otp: 'OTP', csv: 'CSV', pdf: 'PDF', uuid: 'UUID', jwks: 'JWKS', sast: 'SAST', ok: 'OK',
};

const UNITS: readonly [RegExp, string][] = [
  [/_ms$/, ' ms'], [/_s$/, ' s'], [/_seconds$/, ' s'], [/_m$/, ' m'], [/_minutes$/, ' min'], [/_h$/, ' h'], [/_hours$/, ' h'],
  [/_days$/, ' days'], [/_mb$/, ' MB'], [/_pct$/, '%'], [/_px$/, ' px'],
];

function splitUnit(key: string): { base: string; unit: string } {
  for (const [re, unit] of UNITS) if (re.test(key)) return { base: key.replace(re, ''), unit };
  return { base: key, unit: '' };
}

/** "geofence_radius_m" → "Geofence radius"; "maxAccuracy" → "Max accuracy". */
export function humanLabel(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_\s.-]+/).filter(Boolean);
  return words
    .map((w, i) => WORDS[w.toLowerCase()] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ');
}

function Scalar({ value, unit = '' }: { value: unknown; unit?: string }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">—</span>;
  if (typeof value === 'boolean') {
    return (
      <span className={cn('inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', value ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700')}>
        {value ? 'Yes' : 'No'}
      </span>
    );
  }
  if (typeof value === 'number') return <span className="tabular-nums">{`${value.toLocaleString('en-ZA')}${unit}`}</span>;
  if (typeof value === 'string') {
    if (UUID.test(value) || HASH.test(value)) {
      return (
        <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground" title={value}>
          {value.slice(0, 8)}…
          <CopyButton value={value} title="Copy full value" />
        </span>
      );
    }
    if (ISO_DATETIME.test(value) && !Number.isNaN(Date.parse(value))) return <DateTime value={value} />;
    return <span className="whitespace-pre-wrap break-words">{`${value}${unit}`}</span>;
  }
  return <span>{String(value)}</span>;
}

function isScalar(v: unknown): boolean {
  return v === null || typeof v !== 'object';
}

/** Uniform list of flat objects → a small table (≤ 6 columns). */
function tableColumns(items: unknown[]): string[] | null {
  if (items.length === 0 || !items.every(isPlainObject)) return null;
  const cols = [...new Set(items.flatMap((o) => Object.keys(o as Record<string, unknown>)))];
  if (cols.length === 0 || cols.length > 6) return null;
  const flat = items.every((o) => Object.values(o as Record<string, unknown>).every((v) => isScalar(v) || (Array.isArray(v) && v.every(isScalar))));
  return flat ? cols : null;
}

function ArrayValue({ items, depth, expandDepth }: { items: unknown[]; depth: number; expandDepth: number }) {
  if (items.length === 0) return <span className="text-muted-foreground">None</span>;
  if (items.every(isScalar)) {
    return (
      <span className="flex flex-wrap gap-1">
        {items.map((v, i) => (
          <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-sm">
            <Scalar value={v} />
          </span>
        ))}
      </span>
    );
  }
  const cols = tableColumns(items);
  if (cols) {
    return (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left">
            <tr>
              {cols.map((c) => {
                const { base, unit } = splitUnit(c);
                return (
                  <th key={c} className="px-2 py-1.5 font-medium text-muted-foreground">
                    {humanLabel(base)}
                    {unit ? <span className="font-normal">{` (${unit.trim()})`}</span> : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {items.map((row, i) => (
              <tr key={i} className="border-t">
                {cols.map((c) => {
                  const v = (row as Record<string, unknown>)[c];
                  return (
                    <td key={c} className="px-2 py-1.5 align-top">
                      {Array.isArray(v) ? v.map(String).join(', ') || '—' : <Scalar value={v} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <ol className="space-y-2">
      {items.map((v, i) => (
        <li key={i} className="rounded-md border bg-card p-2.5">
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">#{i + 1}</p>
          <Node value={v} depth={depth + 1} expandDepth={expandDepth} />
        </li>
      ))}
    </ol>
  );
}

function Section({ label, children, defaultOpen }: { label: string; children: ReactNode; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="col-span-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 py-0.5 text-sm font-semibold hover:text-primary" aria-expanded={open}>
        {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        {label}
      </button>
      {open ? <div className="mt-1 border-l-2 border-muted pl-3">{children}</div> : null}
    </div>
  );
}

function Node({ value, depth, expandDepth }: { value: unknown; depth: number; expandDepth: number }): ReactNode {
  if (Array.isArray(value)) return <ArrayValue items={value} depth={depth} expandDepth={expandDepth} />;
  if (!isPlainObject(value)) return <Scalar value={value} />;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-muted-foreground">Nothing set</span>;
  return (
    <dl className="grid grid-cols-[minmax(7rem,max-content)_1fr] items-baseline gap-x-4 gap-y-1.5 text-sm">
      {entries.map(([key, v]) => {
        const { base, unit } = splitUnit(key);
        if (isPlainObject(v) || (Array.isArray(v) && !v.every(isScalar) && tableColumns(v) === null)) {
          return (
            <Section key={key} label={humanLabel(key)} defaultOpen={depth < expandDepth}>
              <Node value={v} depth={depth + 1} expandDepth={expandDepth} />
            </Section>
          );
        }
        return (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{humanLabel(base)}</dt>
            <dd className="min-w-0">{Array.isArray(v) ? <ArrayValue items={v} depth={depth} expandDepth={expandDepth} /> : <Scalar value={v} unit={unit} />}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Human-readable view of a JSON value (no braces, no quotes). */
export function StructuredView({ value, expandDepth = 2, className }: { value: unknown; expandDepth?: number; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <Node value={value} depth={0} expandDepth={expandDepth} />
    </div>
  );
}
