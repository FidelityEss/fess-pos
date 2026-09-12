'use client';

// Small helpers shared by the definitions, config and operations screens (local to these folders).
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { employeeName, formatDuration, fullName, shortId } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import { fetchRows, pos } from '@/lib/supabase';
import type { PosRole } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';

export const HOUR_MS = 3600_000;

/** The subset of pos_users the screens need to name people. */
export interface UserLite {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  role: PosRole;
  bank_ids: string[] | null;
  active: boolean;
}

/** Every pos_users row visible under RLS (small table), for naming actors/agents. */
export function usePosUsers() {
  return useQuery({
    queryKey: ['ops', 'pos_users_lite'],
    queryFn: () =>
      fetchRows<UserLite>(
        pos().from('pos_users').select('id,employee_number,first_name,last_name,role,bank_ids,active').order('last_name').order('first_name'),
      ),
    staleTime: 5 * 60_000,
  });
}

/** Lookup id → user (undefined while loading or unknown). */
export function useUserLookup(): (id: string | null | undefined) => UserLite | undefined {
  const { data } = usePosUsers();
  const byId = useMemo(() => new Map((data ?? []).map((u) => [u.id, u])), [data]);
  return useCallback((id) => (id ? byId.get(id) : undefined), [byId]);
}

/** "Thandi Mokoena (E1234)", a short id when unknown, or a dash. */
export function UserName({ id, fallback = '—', className }: { id: string | null | undefined; fallback?: string; className?: string }) {
  const lookup = useUserLookup();
  const advanced = useIsAdvanced();
  if (!id) return <span className={cn('text-muted-foreground', className)}>{fallback}</span>;
  const u = lookup(id);
  return (
    <span className={className} title={advanced ? id : undefined}>
      {u ? (advanced ? employeeName(u) : fullName(u)) : advanced ? <code className="text-xs">{shortId(id)}</code> : 'Unknown person'}
    </span>
  );
}

/** A number from a numeric-ish value (PostgREST bigint/numeric may arrive as strings). */
export function toCount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** JSON pointer ("/geofence/sample_seconds") or dotted path → dotted path ("geofence.sample_seconds"). */
export function toDottedPath(path: string | undefined | null): string {
  if (!path) return '';
  return path.replace(/^\/+/, '').replace(/\//g, '.');
}

/** Value at a dotted path in a JSON object (undefined when missing). */
export function getPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const part of path.split('.')) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Structural equality for JSON values (object key order ignored). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

/** Short one-line rendering of an arbitrary JSON value for table cells. */
export function compactJson(value: unknown, max = 80): string {
  if (value === null || value === undefined) return '—';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** `{code, message}`-ish error → "CODE: message" (else compact JSON). */
export function describeError(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (typeof error === 'string') return error;
  if (isPlainObject(error)) {
    const code = typeof error.code === 'string' ? error.code : null;
    const message = typeof error.message === 'string' ? error.message : null;
    if (code || message) return [code, message].filter(Boolean).join(': ');
  }
  return compactJson(error, 200);
}

/** Age with warning/alert colouring (thresholds in ms). */
export function AgeBadge({ ms, warnMs, alertMs, suffix = '' }: { ms: number | null; warnMs: number; alertMs: number; suffix?: string }) {
  if (ms === null) return <span className="text-muted-foreground">—</span>;
  const tone = ms > alertMs ? 'danger' : ms > warnMs ? 'warning' : 'neutral';
  return (
    <Badge tone={tone} title={ms > alertMs ? 'Above the alert threshold' : ms > warnMs ? 'Above the warning threshold' : undefined}>
      {formatDuration(ms)}
      {suffix}
    </Badge>
  );
}

const ALL = '__all__';

/** Compact filter select with an "All" option mapping to null. */
export function FilterSelect({
  value,
  onChange,
  options,
  allLabel = 'All',
  placeholder,
  className,
  id,
  'aria-label': ariaLabel,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  options: readonly { value: string; label: ReactNode }[];
  allLabel?: string;
  placeholder?: string;
  className?: string;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger id={id} className={cn('h-9 w-44', className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        <SelectSeparator />
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Small uppercase section heading (matches the dashboard). */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

/** Label/value rows for detail panels. */
export function DetailList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 text-sm', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
