'use client';

// /jobs — list, board and map of jobs with server-side filters (dashboard status, internal status, bank, agent,
// scheduled range, flags, search) and sort. Loads at most JOB_LIST_LIMIT rows.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronDown, FileUp, LayoutGrid, List, Map as MapIcon, Plus, RefreshCw, Search, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { BankSelect } from '@/components/bank-select';
import { DataTable } from '@/components/data-table';
import { DateTime, useNow } from '@/components/date-time';
import { EmptyState } from '@/components/empty-state';
import { MapView, type MapMarker } from '@/components/map/map-view';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { employeeName, formatDuration, fullName, humanize } from '@/lib/format';
import { isUuid, useAgents } from '@/lib/hooks';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { DASHBOARD_GROUPS, type DashboardKey, dashboardStatus, isDashboardKey, JOB_STATUS_LABEL, statusesForDashboardKey } from '@/lib/status';
import { fetchRows, pos } from '@/lib/supabase';
import { JOB_STATUSES, type JobStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FlagBadges } from './job-bits';
import {
  addDays,
  FILTER_FLAGS,
  flagInfo,
  formatWindow,
  JOB_LIST_LIMIT,
  JOB_LIST_SELECT,
  type JobListRow,
  jobPoint,
  sastDayStartIso,
  TONE_HEX,
} from './job-data';

type ViewMode = 'list' | 'board' | 'map';
const VIEWS: { key: ViewMode; label: string; icon: typeof List }[] = [
  { key: 'list', label: 'List', icon: List },
  { key: 'board', label: 'Board', icon: LayoutGrid },
  { key: 'map', label: 'Map', icon: MapIcon },
];

const SORTS = {
  created_desc: { label: 'Newest first', column: 'created_at', ascending: false },
  created_asc: { label: 'Oldest first', column: 'created_at', ascending: true },
  scheduled_asc: { label: 'Visit time (soonest first)', column: 'scheduled_start', ascending: true },
  scheduled_desc: { label: 'Visit time (latest first)', column: 'scheduled_start', ascending: false },
  changed_desc: { label: 'Recently changed status', column: 'status_changed_at', ascending: false },
  reference_desc: { label: 'Reference (newest number first)', column: 'reference', ascending: false },
  merchant_asc: { label: 'Merchant (A to Z)', column: 'merchant_name', ascending: true },
} as const;
type SortKey = keyof typeof SORTS;
const isSortKey = (v: string | null): v is SortKey => v !== null && v in SORTS;

const UNASSIGNED = 'unassigned';
const ALL = '__all__';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Booked jobs whose visit hasn't started: "past their visit time" once the booked window has ended (`?overdue=1`, Home's to-do list). */
export const OVERDUE_STATUSES: readonly JobStatus[] = ['scheduled', 'assigned', 'accepted'];

interface JobFilters {
  dash: DashboardKey | null;
  statuses: JobStatus[];
  bankId: string | null;
  /** pos_users id, 'unassigned', or null (any). */
  agent: string | null;
  from: string;
  to: string;
  flags: string[];
  search: string;
  sort: SortKey;
  /** Only jobs past their booked visit time (the visit hasn't started). */
  overdue: boolean;
}

interface ParamSource {
  get(name: string): string | null;
}

function readState(sp: ParamSource): { filters: JobFilters; view: ViewMode } {
  const dash = sp.get('dash');
  const statuses = (sp.get('status') ?? '').split(',').filter((s): s is JobStatus => (JOB_STATUSES as readonly string[]).includes(s));
  const bank = sp.get('bank');
  const agent = sp.get('agent');
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const known = FILTER_FLAGS.map((f) => f.flag);
  const view = sp.get('view');
  return {
    filters: {
      dash: isDashboardKey(dash) ? dash : null,
      statuses,
      bankId: isUuid(bank) ? bank : null,
      agent: agent === UNASSIGNED || isUuid(agent) ? agent : null,
      from: DAY_RE.test(from) ? from : '',
      to: DAY_RE.test(to) ? to : '',
      flags: (sp.get('flags') ?? '').split(',').filter((f) => known.includes(f)),
      search: sp.get('q') ?? '',
      sort: isSortKey(sp.get('sort')) ? (sp.get('sort') as SortKey) : 'created_desc',
      overdue: sp.get('overdue') === '1',
    },
    view: view === 'board' || view === 'map' ? view : 'list',
  };
}

function writeState(f: JobFilters, view: ViewMode): string {
  const p = new URLSearchParams();
  if (f.dash) p.set('dash', f.dash);
  if (f.statuses.length) p.set('status', f.statuses.join(','));
  if (f.bankId) p.set('bank', f.bankId);
  if (f.agent) p.set('agent', f.agent);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.flags.length) p.set('flags', f.flags.join(','));
  if (f.search) p.set('q', f.search);
  if (f.sort !== 'created_desc') p.set('sort', f.sort);
  if (f.overdue) p.set('overdue', '1');
  if (view !== 'list') p.set('view', view);
  return p.toString();
}

function effectiveStatuses(f: JobFilters): readonly JobStatus[] | null {
  const group = f.dash ? statusesForDashboardKey(f.dash) : null;
  let out: readonly JobStatus[] | null = f.statuses.length ? (group ? f.statuses.filter((s) => group.includes(s)) : f.statuses) : group;
  if (f.overdue) out = (out ?? OVERDUE_STATUSES).filter((s) => OVERDUE_STATUSES.includes(s));
  return out;
}

/** PostgREST or() value: strip characters that would break the filter grammar. */
function searchTerm(q: string): string {
  return q.replace(/[,()*%\\"]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchJobs(f: JobFilters): Promise<JobListRow[]> {
  const statuses = effectiveStatuses(f);
  if (statuses && statuses.length === 0) return [];
  const inspectionFlags = f.flags.filter((fl) => FILTER_FLAGS.find((x) => x.flag === fl)?.on === 'inspection');
  const jobFlags = f.flags.filter((fl) => FILTER_FLAGS.find((x) => x.flag === fl)?.on === 'job');
  // Inspection flags filter through an inner-joined embed so the job list stays one server-side query.
  const select = inspectionFlags.length ? `${JOB_LIST_SELECT},insp:inspections!inner(id)` : JOB_LIST_SELECT;
  let q = pos().from('jobs').select(select);
  if (statuses) q = q.in('status', [...statuses]);
  if (f.bankId) q = q.eq('bank_id', f.bankId);
  if (f.agent === UNASSIGNED) q = q.is('assigned_to', null);
  else if (isUuid(f.agent)) q = q.eq('assigned_to', f.agent);
  if (f.from) q = q.gte('scheduled_start', sastDayStartIso(f.from));
  if (f.to) q = q.lt('scheduled_start', sastDayStartIso(addDays(f.to, 1)));
  if (f.overdue) q = q.lt('scheduled_end', new Date().toISOString());
  if (jobFlags.length) q = q.contains('flags', jobFlags);
  if (inspectionFlags.length) q = q.contains('insp.flags', inspectionFlags);
  const term = searchTerm(f.search);
  if (term) {
    q = q.or(['reference', 'merchant_name', 'trading_name', 'external_ref'].map((c) => `${c}.ilike.*${term}*`).join(','));
  }
  const sort = SORTS[f.sort];
  q = q.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order('id').limit(JOB_LIST_LIMIT);
  return fetchRows<JobListRow>(q);
}

function ageOf(r: JobListRow, now: number): number {
  const end = r.closed_at ? new Date(r.closed_at).getTime() : now;
  return end - new Date(r.created_at).getTime();
}

// ── Filter controls ───────────────────────────────────────────────────────────────────────────
function MultiCheckDropdown<T extends string>({
  label,
  options,
  selected,
  onChange,
  renderLabel,
  heading,
}: {
  label: string;
  options: readonly T[];
  selected: T[];
  onChange: (next: T[]) => void;
  renderLabel: (v: T) => string;
  heading?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn('font-normal', selected.length && 'border-primary/50 bg-primary/5')}>
          {label}
          {selected.length ? <Badge tone="solid" className="py-0">{selected.length}</Badge> : null}
          <ChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        {heading ? <DropdownMenuLabel>{heading}</DropdownMenuLabel> : null}
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o}
            checked={selected.includes(o)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(v) => onChange(v ? [...selected, o] : selected.filter((s) => s !== o))}
          >
            {renderLabel(o)}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length ? (
          <>
            <DropdownMenuSeparator />
            <button type="button" className="w-full rounded-sm px-2 py-2 text-left text-sm text-muted-foreground hover:bg-accent" onClick={() => onChange([])}>
              Clear
            </button>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentFilter({ bankId, value, onChange }: { bankId: string | null; value: string | null; onChange: (v: string | null) => void }) {
  const { data, isLoading } = useAgents(bankId);
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)} disabled={isLoading}>
      <SelectTrigger className="w-52" aria-label="Agent">
        <SelectValue placeholder="Any agent" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Any agent</SelectItem>
        <SelectItem value={UNASSIGNED}>No agent yet</SelectItem>
        <SelectSeparator />
        {(data ?? []).map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {employeeName(a)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Board & map ───────────────────────────────────────────────────────────────────────────────
function JobCard({ row }: { row: JobListRow }) {
  return (
    <Link href={`/jobs/${row.id}`} className="block rounded-md border bg-card p-3 text-sm transition hover:border-primary/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="whitespace-nowrap font-mono font-medium">{row.reference}</span>
        <StatusBadge status={row.status} />
      </div>
      <div className="mt-1 break-words text-base font-medium">{row.merchant_name}</div>
      <div className="mt-0.5 text-muted-foreground">
        {row.bank?.code ?? '—'} · {row.agent ? fullName(row.agent) : 'No agent yet'}
      </div>
      {row.scheduled_start ? <div className="mt-0.5 text-muted-foreground">{formatWindow(row.scheduled_start, row.scheduled_end)}</div> : null}
      <FlagBadges flags={row.flags} className="mt-1.5" max={2} />
    </Link>
  );
}

function JobBoard({ rows }: { rows: JobListRow[] }) {
  const archived = rows.filter((r) => r.status === 'closed').length;
  return (
    <div className="space-y-2">
      <div className="grid auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
        {DASHBOARD_GROUPS.map((g) => {
          const items = rows.filter((r) => g.statuses.includes(r.status));
          return (
            <div key={g.key} className="flex min-h-40 flex-col rounded-lg border bg-card">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                <span className="flex items-center gap-2 text-base font-medium">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: TONE_HEX[g.tone] }} />
                  {g.label}
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">{items.length}</span>
              </div>
              <div className="max-h-[70vh] flex-1 space-y-2 overflow-y-auto p-2">
                {items.map((r) => (
                  <JobCard key={r.id} row={r} />
                ))}
                {items.length === 0 ? <p className="px-1 py-4 text-center text-sm text-muted-foreground">No jobs</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      {archived ? <p className="text-sm text-muted-foreground">{archived} archived job{archived === 1 ? ' isn’t' : 's aren’t'} shown on the board.</p> : null}
    </div>
  );
}

function JobMap({ rows }: { rows: JobListRow[] }) {
  const router = useRouter();
  const open = useCallback((id: string) => router.push(`/jobs/${id}`), [router]);
  const markers = useMemo<MapMarker[]>(
    () =>
      rows.flatMap((r) => {
        const p = jobPoint(r);
        if (!p) return [];
        const d = dashboardStatus(r.status);
        return [{ id: r.id, lat: p.lat, lng: p.lng, color: TONE_HEX[d.tone], label: `${r.reference} · ${r.merchant_name} · ${d.displayLabel}`, onClick: () => open(r.id) }];
      }),
    [rows, open],
  );
  const missing = rows.length - markers.length;
  return (
    <div className="space-y-2">
      <MapView markers={markers} height={560} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {DASHBOARD_GROUPS.map((g) => (
          <span key={g.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: TONE_HEX[g.tone] }} />
            {g.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: TONE_HEX.muted }} />
          Archived
        </span>
        {missing > 0 ? <span className="ml-auto">{missing} job{missing === 1 ? ' has' : 's have'} no map pin, so {missing === 1 ? 'it isn’t' : 'they aren’t'} on the map.</span> : null}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────────────────────
export function JobsListView() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const spString = searchParams.toString();
  const now = useNow(60_000);

  const [state, setState] = useState(() => readState(searchParams));
  const [searchInput, setSearchInput] = useState(state.filters.search);
  const written = useRef(spString);
  const { filters, view } = state;

  // Navigation to /jobs?… from elsewhere (e.g. a dashboard card or the sidebar) resets the filters.
  useEffect(() => {
    if (spString === written.current) return;
    written.current = spString;
    const next = readState(new URLSearchParams(spString));
    setState(next);
    setSearchInput(next.filters.search);
  }, [spString]);

  // Keep the URL shareable.
  useEffect(() => {
    const qs = writeState(filters, view);
    if (qs === written.current) return;
    written.current = qs;
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, view, pathname, router]);

  // Debounced server-side search.
  useEffect(() => {
    const t = setTimeout(() => setState((s) => (s.filters.search === searchInput.trim() ? s : { ...s, filters: { ...s.filters, search: searchInput.trim() } })), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const setFilter = useCallback(<K extends keyof JobFilters>(key: K, value: JobFilters[K]) => {
    setState((s) => ({ ...s, filters: { ...s.filters, [key]: value } }));
  }, []);

  const query = useQuery({
    queryKey: ['jobs', 'list', filters],
    queryFn: () => fetchJobs(filters),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const hitLimit = rows.length >= JOB_LIST_LIMIT;

  const statusOptions = filters.dash ? statusesForDashboardKey(filters.dash) : JOB_STATUSES;
  const activeFilterCount =
    (filters.dash ? 1 : 0) +
    (filters.statuses.length ? 1 : 0) +
    (filters.bankId ? 1 : 0) +
    (filters.agent ? 1 : 0) +
    (filters.from || filters.to ? 1 : 0) +
    (filters.flags.length ? 1 : 0) +
    (filters.search ? 1 : 0) +
    (filters.overdue ? 1 : 0);

  const columns = useMemo<ColumnDef<JobListRow>[]>(
    () => [
      {
        accessorKey: 'reference',
        header: 'Reference',
        cell: ({ row }) => (
          <Link href={`/jobs/${row.original.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-mono text-sm font-medium text-primary hover:underline">
            {row.original.reference}
          </Link>
        ),
      },
      {
        id: 'merchant',
        accessorFn: (r) => r.merchant_name,
        header: 'Merchant',
        cell: ({ row }) => (
          <div className="min-w-48 max-w-80">
            <div className="break-words font-medium">{row.original.merchant_name}</div>
            {row.original.trading_name || row.original.external_ref ? (
              <div className="break-words text-sm text-muted-foreground">
                {[row.original.trading_name ? `trading as ${row.original.trading_name}` : null, row.original.external_ref ? `bank’s ref ${row.original.external_ref}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'bank',
        accessorFn: (r) => r.bank?.code ?? '',
        header: 'Bank',
        cell: ({ row }) => <span className="whitespace-nowrap" title={row.original.bank?.name}>{row.original.bank?.code ?? '—'}</span>,
      },
      {
        id: 'status',
        accessorFn: (r) => r.status,
        header: 'Status',
        cell: ({ row }) => {
          const d = dashboardStatus(row.original.status);
          return (
            <div className="flex min-w-40 flex-col items-start gap-1">
              <StatusBadge status={row.original.status} />
              {advanced ? <span className="text-sm text-muted-foreground">{d.displayLabel}</span> : null}
              <FlagBadges flags={row.original.flags} max={advanced ? undefined : 1} />
            </div>
          );
        },
      },
      {
        id: 'agent',
        accessorFn: (r) => (r.agent ? fullName(r.agent) : ''),
        header: 'Agent',
        cell: ({ row }) =>
          row.original.agent ? (
            <span className="whitespace-nowrap">{advanced ? employeeName(row.original.agent) : fullName(row.original.agent)}</span>
          ) : (
            <span className="text-muted-foreground">No agent yet</span>
          ),
      },
      {
        id: 'scheduled',
        accessorFn: (r) => r.scheduled_start ?? '',
        header: 'Visit time',
        cell: ({ row }) => <span className="whitespace-nowrap">{formatWindow(row.original.scheduled_start, row.original.scheduled_end)}</span>,
      },
      { accessorKey: 'location_type', header: 'Type of place', meta: { advanced: true }, cell: ({ row }) => <span className="whitespace-nowrap">{humanize(row.original.location_type)}</span> },
      { accessorKey: 'created_at', header: 'Created', meta: { advanced: true }, cell: ({ row }) => <DateTime value={row.original.created_at} /> },
      {
        id: 'age',
        accessorFn: (r) => ageOf(r, now),
        header: 'Open for',
        cell: ({ row }) => <span className="tabular-nums" title={row.original.closed_at ? 'From when it was created to when it was archived' : 'Since it was created'}>{formatDuration(ageOf(row.original, now))}</span>,
      },
    ],
    [now, advanced],
  );

  return (
    <>
      <PageHeader
        title="Jobs"
        description={
          filters.overdue
            ? 'Jobs whose booked visit time has passed, but the visit hasn’t started. Check with the agent, or change the time.'
            : undefined
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
              {query.isFetching ? null : <RefreshCw />} Refresh
            </Button>
            {staff.isAdmin ? (
              <>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/jobs/import">
                    <FileUp /> Import a spreadsheet
                  </Link>
                </Button>
                <Button size="sm" asChild>
                  <Link href="/jobs/new">
                    <Plus /> New job
                  </Link>
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by reference, merchant or the bank’s reference"
              className="pl-9"
              aria-label="Search jobs"
            />
          </div>
          <Select
            value={filters.dash ?? ALL}
            onValueChange={(v) => {
              const dash = isDashboardKey(v) ? v : null;
              setState((s) => ({
                ...s,
                filters: {
                  ...s.filters,
                  dash,
                  statuses: dash ? s.filters.statuses.filter((st) => statusesForDashboardKey(dash).includes(st)) : s.filters.statuses,
                },
              }));
            }}
          >
            <SelectTrigger className="w-52" aria-label="Report group" title="The six groups banks use to report on jobs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All report groups</SelectItem>
              <SelectSeparator />
              {DASHBOARD_GROUPS.map((g) => (
                <SelectItem key={g.key} value={g.key}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <MultiCheckDropdown
            label="Status"
            heading={advanced ? 'Internal status' : 'Detailed status'}
            options={statusOptions}
            selected={filters.statuses}
            onChange={(v) => setFilter('statuses', v)}
            renderLabel={(s) => JOB_STATUS_LABEL[s]}
          />
          <BankSelect value={filters.bankId} onChange={(v) => setFilter('bankId', v)} allowAll includeInactive className="w-52" />
          <AgentFilter bankId={filters.bankId} value={filters.agent} onChange={(v) => setFilter('agent', v)} />
          <MultiCheckDropdown
            label={advanced ? 'Flags' : 'Warnings'}
            heading="Has all of these"
            options={FILTER_FLAGS.map((f) => f.flag)}
            selected={filters.flags}
            onChange={(v) => setFilter('flags', v)}
            renderLabel={(f) => `${advanced ? flagInfo(f).label : flagInfo(f).plain}${FILTER_FLAGS.find((x) => x.flag === f)?.on === 'inspection' ? ' (any visit)' : ''}`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Visit from
            <Input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} className="w-44" aria-label="Visit from" />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            to
            <Input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} className="w-44" aria-label="Visit to" />
          </label>
          <label className={cn('flex h-10 items-center gap-2 rounded-md border px-3 text-sm', filters.overdue ? 'border-primary/50 bg-primary/5' : 'border-input')}>
            <input type="checkbox" className="accent-primary" checked={filters.overdue} onChange={(e) => setFilter('overdue', e.target.checked)} />
            Past their visit time
          </label>
          <Select value={filters.sort} onValueChange={(v) => setFilter('sort', isSortKey(v) ? v : 'created_desc')}>
            <SelectTrigger className="w-64" aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORTS) as SortKey[]).map((k) => (
                <SelectItem key={k} value={k}>
                  Sort: {SORTS[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeFilterCount > 0 ? (
            <Button
              variant="ghost"
              onClick={() => {
                setSearchInput('');
                setState((s) => ({ ...s, filters: { ...readState(new URLSearchParams()).filters, sort: s.filters.sort } }));
              }}
            >
              <X /> Clear filters
            </Button>
          ) : null}
          <div className="ml-auto inline-flex rounded-md border bg-card p-0.5" role="tablist" aria-label="View">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                onClick={() => setState((s) => ({ ...s, view: key }))}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded px-3.5 text-sm text-muted-foreground transition hover:text-foreground',
                  view === key && 'bg-accent font-medium text-primary-hover',
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {query.isPending ? 'Loading…' : `${rows.length} job${rows.length === 1 ? '' : 's'}`}
          {hitLimit ? `. Only the first ${JOB_LIST_LIMIT} are shown, in the order you chose. Narrow the filters to see the rest.` : ''}
        </p>
      </div>

      {view === 'list' ? (
        <DataTable
          columns={columns}
          data={query.data}
          isLoading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          enableSearch={false}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/jobs/${r.id}`)}
          emptyTitle={activeFilterCount ? 'No jobs match these filters' : 'No jobs yet'}
          emptyDescription={activeFilterCount ? 'Try clearing some filters.' : staff.isAdmin ? 'Create a job with “New job”, or import a spreadsheet of jobs.' : 'Jobs show here once your administrators create them.'}
        />
      ) : query.error ? (
        <ApiErrorAlert error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title={activeFilterCount ? 'No jobs match these filters' : 'No jobs yet'} description={activeFilterCount ? 'Try clearing some filters.' : undefined} />
      ) : view === 'board' ? (
        <JobBoard rows={rows} />
      ) : (
        <JobMap rows={rows} />
      )}
    </>
  );
}
