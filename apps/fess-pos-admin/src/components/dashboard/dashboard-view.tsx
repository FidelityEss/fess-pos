'use client';

// Home (docs/17 §4.5, T3-36): a to-do list first — visits to review, alerts, jobs past their visit time, jobs without an
// agent, jobs to book, changes waiting for approval and unpublished set-up — each opening the screen that deals with it.
// Then the six job report groups, and (Advanced) the behind-the-scenes figures and queues.
// Data: pos.admin_dashboard(), three small counts over PostgREST, and GET /queues (Advanced).
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  Bell,
  BellRing,
  CalendarClock,
  CalendarPlus,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  FileCode,
  FileWarning,
  Inbox,
  type LucideIcon,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { useNow } from '@/components/date-time';
import { fetchPendingApprovals } from '@/components/definitions/definitions-data';
import { OVERDUE_STATUSES } from '@/components/jobs/jobs-list-view';
import { PageHeader } from '@/components/page-header';
import { useCanAccessPath } from '@/components/shell/nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi } from '@/lib/api';
import { ageMs, formatDuration, formatNumber, formatTime, humanize } from '@/lib/format';
import { queryKeys } from '@/lib/hooks';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { DASHBOARD_GROUPS, type DashboardGroup, dashboardStatus, JOB_STATUS_LABEL, type StatusTone } from '@/lib/status';
import { callRpc, fetchCount, fetchRows, pos } from '@/lib/supabase';
import type { DashboardSummary, JobStatus, QueueDepths } from '@/lib/types';
import { cn } from '@/lib/utils';

const TONE_DOT: Record<StatusTone, string> = {
  neutral: 'bg-slate-400',
  info: 'bg-sky-500',
  accent: 'bg-primary',
  progress: 'bg-violet-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  muted: 'bg-slate-300',
};

const DAY_MS = 24 * 3600_000;

/** Approval kinds decided on the Inspection set-up screen; the rest (settings) on App settings. */
const SETUP_APPROVALS = ['definition_publish', 'definition_activation'];

function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-semibold">{children}</h2>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ── To-do list ────────────────────────────────────────────────────────────────────────────────
interface Todo {
  key: string;
  icon: LucideIcon;
  count: number;
  title: string;
  description: string;
  href: string;
  tone?: 'danger' | 'warning';
}

/** One flat row, FESS-style: green line icon, bold title, grey description, chevron, hairline divider. */
function TodoRow({ todo }: { todo: Todo }) {
  const Icon = todo.icon;
  return (
    <li>
      <Link href={todo.href} className="group flex items-center gap-4 px-1 py-4 transition-colors hover:bg-accent/40">
        <Icon className={cn('size-7 shrink-0 stroke-[1.5]', todo.tone === 'danger' ? 'text-red-600' : 'text-primary')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {todo.title}
            {todo.tone ? <Badge tone={todo.tone}>{todo.tone === 'danger' ? 'Urgent' : 'Check'}</Badge> : null}
          </span>
          <span className="block text-sm text-muted-foreground">{todo.description}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
      </Link>
    </li>
  );
}

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

// ── Report groups ─────────────────────────────────────────────────────────────────────────────
function breakdownLabel(status: JobStatus): string {
  return JOB_STATUS_LABEL[status];
}

/** One of the six report groups banks use (docs/06 §1); links to /jobs?dash=<key>. */
function StatusCard({ group, counts, loading }: { group: DashboardGroup; counts: Partial<Record<JobStatus, number>>; loading: boolean }) {
  const total = group.statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  return (
    <Link href={`/jobs?dash=${group.key}`} className="group block rounded-lg border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="flex items-center gap-2 text-base font-medium text-foreground">
        <span className={cn('size-2.5 rounded-full', TONE_DOT[group.tone])} aria-hidden />
        {group.label}
      </div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{loading ? <Skeleton className="h-9 w-14" /> : formatNumber(total)}</div>
      <p className="text-sm text-muted-foreground">{group.hint}</p>
      <ul className="mt-2 space-y-1 border-t border-divider pt-2 text-sm text-muted-foreground">
        {group.statuses.map((s) => (
          <li key={s} className="flex justify-between gap-2 leading-snug" title={dashboardStatus(s).displayLabel}>
            <span>{breakdownLabel(s)}</span>
            <span className="tabular-nums">{loading ? '–' : formatNumber(counts[s] ?? 0)}</span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

/** Behind-the-scenes figure (Advanced); links when `href` is set and accessible. */
function OpsTile({
  icon: Icon,
  title,
  value,
  href,
  tone = 'default',
  loading,
  children,
}: {
  icon: LucideIcon;
  title: string;
  value: number | undefined;
  href?: string;
  tone?: 'default' | 'warning' | 'danger';
  loading: boolean;
  children?: ReactNode;
}) {
  const className = cn(
    'block rounded-lg border bg-card p-4',
    tone === 'danger' && 'border-red-200',
    tone === 'warning' && 'border-amber-200',
    href && 'transition-colors hover:border-primary/40',
  );
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-medium">{title}</span>
        <Icon className={cn('size-5', tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-primary')} />
      </div>
      <div className={cn('mt-1 text-3xl font-semibold tabular-nums', tone === 'danger' && 'text-red-700')}>
        {loading ? <Skeleton className="h-9 w-14" /> : formatNumber(value ?? 0)}
      </div>
      {children && !loading ? <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">{children}</div> : null}
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function toCount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Pair each queue with its `<name>_dlq` dead-letter queue. */
function queueRows(q: QueueDepths): { name: string; depth: number | null; dlq: number | null }[] {
  const names = new Set<string>();
  for (const k of Object.keys(q)) names.add(k.endsWith('_dlq') ? k.slice(0, -4) : k);
  return [...names].sort().map((name) => ({ name, depth: toCount(q[name]), dlq: toCount(q[`${name}_dlq`]) }));
}

function QueueDepthsCard({ query }: { query: UseQueryResult<QueueDepths, Error> }) {
  if (query.error) return <ApiErrorAlert error={query.error} title="We couldn’t load the background work" onRetry={() => void query.refetch()} />;
  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  const rows = queueRows(query.data);
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Background work</TableHead>
            <TableHead className="text-right">Waiting</TableHead>
            <TableHead className="text-right">Failed after several tries</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                Nothing reported
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell>
                  <span className="font-medium">{humanize(r.name)}</span> <code className="ml-1 text-xs text-muted-foreground">{r.name}</code>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.depth === null ? '—' : formatNumber(r.depth)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.dlq === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : r.dlq > 0 ? (
                    <Badge tone="danger">{formatNumber(r.dlq)}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Home: the to-do list, the six report groups, and (Advanced) the behind-the-scenes figures. */
export function DashboardView() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const canAccessPath = useCanAccessPath();
  const now = useNow();
  const summary = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => callRpc<DashboardSummary>('admin_dashboard'),
    refetchInterval: 60_000,
  });
  const overdue = useQuery({
    queryKey: ['dashboard', 'overdue'],
    queryFn: () =>
      fetchCount(
        pos()
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .in('status', [...OVERDUE_STATUSES])
          .lt('scheduled_end', new Date().toISOString()),
      ),
    refetchInterval: 60_000,
    enabled: staff.isAdmin,
  });
  const approvals = useQuery({
    queryKey: ['dashboard', 'approvals'],
    queryFn: fetchPendingApprovals,
    refetchInterval: 60_000,
    enabled: staff.isAdmin,
  });
  // A draft stays after publishing, so only drafts changed after the piece's latest published version count as unpublished.
  const drafts = useQuery({
    queryKey: ['dashboard', 'drafts'],
    queryFn: async () => {
      const [ds, vs] = await Promise.all([
        fetchRows<{ family_id: string; updated_at: string }>(pos().from('definition_drafts').select('family_id,updated_at')),
        fetchRows<{ family_id: string; published_at: string | null }>(pos().from('definition_versions').select('family_id,published_at')),
      ]);
      const latest = new Map<string, number>();
      for (const v of vs) latest.set(v.family_id, Math.max(latest.get(v.family_id) ?? 0, v.published_at ? Date.parse(v.published_at) : 0));
      return ds.filter((d) => Date.parse(d.updated_at) > (latest.get(d.family_id) ?? 0) + 2000).length;
    },
    refetchInterval: 5 * 60_000,
    enabled: staff.isAdmin,
  });
  const queues = useQuery({
    queryKey: queryKeys.queues,
    queryFn: () => adminApi.queues(),
    refetchInterval: 60_000,
    enabled: staff.isAdmin && advanced,
  });

  const s = summary.data;
  const loading = summary.isPending && !summary.error;
  const counts = s?.jobs_by_status ?? {};
  const linkIf = (href: string) => (canAccessPath(href) ? href : undefined);
  const critical = s?.open_alerts_critical ?? 0;
  const otherAlerts = Math.max(0, (s?.open_alerts ?? 0) - critical);
  const oldestAge = ageMs(s?.custody?.oldest_pending_at, now);
  const phones = s?.custody?.devices_with_backlog ?? 0;
  const setupApprovals = (approvals.data ?? []).filter((a) => SETUP_APPROVALS.includes(a.subject_type)).length;
  const settingsApprovals = (approvals.data ?? []).length - setupApprovals;
  const refreshing = summary.isFetching || queues.isFetching || overdue.isFetching;

  const todos: Todo[] = [];
  const add = (t: Todo) => {
    if (t.count > 0 && canAccessPath(t.href.split('?')[0] ?? t.href)) todos.push(t);
  };
  if (staff.isAdmin) {
    add({ key: 'alerts-urgent', icon: BellRing, count: critical, tone: 'danger', title: plural(critical, 'urgent alert', 'urgent alerts'), description: 'Problems the system noticed that need someone now.', href: '/alerts' });
    add({ key: 'review', icon: ClipboardCheck, count: s?.awaiting_review ?? 0, title: plural(s?.awaiting_review ?? 0, 'visit to review', 'visits to review'), description: 'Finished visits waiting for someone to check the answers and photos.', href: '/review' });
    add({
      key: 'overdue',
      icon: CalendarClock,
      count: overdue.data ?? 0,
      tone: 'warning',
      title: plural(overdue.data ?? 0, 'job past its visit time', 'jobs past their visit time'),
      description: 'The booked time has passed and the visit hasn’t started. Check with the agent, or change the time.',
      href: '/jobs?overdue=1',
    });
    add({ key: 'no-agent', icon: UserPlus, count: counts.scheduled ?? 0, title: plural(counts.scheduled ?? 0, 'booked job without an agent', 'booked jobs without an agent'), description: 'A visit time is agreed. Assign an agent to each.', href: '/jobs?status=scheduled' });
    if (staff.hasPermission('schedule_jobs')) {
      add({ key: 'to-book', icon: CalendarPlus, count: counts.pending ?? 0, title: plural(counts.pending ?? 0, 'job to book', 'jobs to book'), description: 'Nobody has agreed a visit time with the merchant yet.', href: '/jobs?status=pending' });
    }
    add({ key: 'alerts', icon: Bell, count: otherAlerts, title: plural(otherAlerts, 'alert', 'alerts'), description: 'Problems the system noticed. Mark each one as dealt with once it’s sorted.', href: '/alerts' });
    if (oldestAge !== null && oldestAge > DAY_MS) {
      add({
        key: 'on-phones',
        icon: Smartphone,
        count: s?.custody?.pending_items ?? 0,
        tone: 'warning',
        title: `Photos and answers waiting on ${plural(phones, 'phone', 'phones')} for ${formatDuration(oldestAge)}`,
        description: 'They haven’t reached us yet. The agent may need to open the app somewhere with signal.',
        href: '/custody',
      });
    }
    add({
      key: 'approvals-setup',
      icon: ShieldCheck,
      count: setupApprovals,
      title: plural(setupApprovals, 'set-up change waiting for approval', 'set-up changes waiting for approval'),
      description: 'A second person must approve these before they take effect. You can’t approve your own.',
      href: '/definitions',
    });
    add({
      key: 'approvals-settings',
      icon: ShieldCheck,
      count: settingsApprovals,
      title: plural(settingsApprovals, 'settings change waiting for approval', 'settings changes waiting for approval'),
      description: 'A second person must approve these before they take effect. You can’t approve your own.',
      href: '/config',
    });
    add({
      key: 'drafts',
      icon: FileCode,
      count: drafts.data ?? 0,
      title: plural(drafts.data ?? 0, 'set-up draft with changes not published', 'set-up drafts with changes not published'),
      description: 'Changes to the inspection set-up saved as drafts. Agents don’t see them until they’re published and made live.',
      href: '/definitions',
    });
  }
  const todoLoading = staff.isAdmin && loading;

  return (
    <>
      <PageHeader
        title="Home"
        description={
          staff.isAdmin
            ? `Hello ${staff.me.first_name}. This is what needs your attention ${staff.me.bank_ids === null ? 'across all banks' : 'for your banks'}. Each item opens the screen that deals with it.`
            : `Hello ${staff.me.first_name}. This is how your bank’s jobs are going. Each group opens the jobs in it.`
        }
        actions={
          <>
            {summary.dataUpdatedAt ? <span className="text-sm text-muted-foreground">Updated {formatTime(summary.dataUpdatedAt)}</span> : null}
            <Button
              variant="outline"
              size="sm"
              loading={refreshing}
              onClick={() => {
                void summary.refetch();
                if (staff.isAdmin) {
                  void overdue.refetch();
                  void approvals.refetch();
                  void drafts.refetch();
                }
                if (staff.isAdmin && advanced) void queues.refetch();
              }}
            >
              {refreshing ? null : <RefreshCw />} Refresh
            </Button>
          </>
        }
      />

      {summary.error ? (
        <ApiErrorAlert error={summary.error} title="We couldn’t load the summary" onRetry={() => void summary.refetch()} className="mb-5" />
      ) : null}

      {staff.isAdmin ? (
        <section className="mb-8" aria-labelledby="todo-title">
          <SectionTitle>
            <span id="todo-title">To do</span>
          </SectionTitle>
          {todoLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : todos.length ? (
            <ul className="divide-y divide-divider border-y border-divider">
              {todos.map((t) => (
                <TodoRow key={t.key} todo={t} />
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-3 border-y border-divider px-1 py-5 text-base">
              <CircleCheck className="size-7 shrink-0 stroke-[1.5] text-primary" aria-hidden />
              <span>
                <span className="block font-semibold">Nothing needs your attention right now</span>
                <span className="block text-sm text-muted-foreground">New work shows here as it comes in. To start something new, create a job under Jobs.</span>
              </span>
            </div>
          )}
        </section>
      ) : null}

      <section className="mb-8">
        <SectionTitle hint="The six groups banks use to report on jobs. Each opens the jobs in it.">Jobs by status</SectionTitle>
        {/* Breakpoints don't grow with the text size, so at Large / Extra large the six cards use three columns. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 [[data-text-size=large]_&]:xl:grid-cols-3 [[data-text-size=xlarge]_&]:xl:grid-cols-3">
          {DASHBOARD_GROUPS.map((g) => (
            <StatusCard key={g.key} group={g} counts={counts} loading={loading} />
          ))}
        </div>
        {(counts.closed ?? 0) > 0 ? <p className="mt-2 text-sm text-muted-foreground">Archived: {formatNumber(counts.closed)}</p> : null}
      </section>

      {staff.isAdmin && advanced ? (
        <>
          <section className="mb-8">
            <SectionTitle hint="How data from the phones is flowing. Technical, shown in Advanced view.">Behind the scenes</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [[data-text-size=large]_&]:xl:grid-cols-2 [[data-text-size=xlarge]_&]:xl:grid-cols-2">
              <OpsTile
                icon={Smartphone}
                title="Still on agents’ phones"
                value={s?.custody?.pending_items}
                href={linkIf('/custody')}
                loading={loading}
                tone={oldestAge !== null && oldestAge > DAY_MS ? 'warning' : 'default'}
              >
                <p>From {plural(phones, 'phone', 'phones')}</p>
                <p>Oldest: {oldestAge === null ? '—' : `${formatDuration(oldestAge)} ago`}</p>
              </OpsTile>
              <OpsTile
                icon={FileWarning}
                title="Visits with photos missing"
                value={s?.incomplete_manifests}
                href={linkIf('/custody')}
                loading={loading}
                tone={(s?.incomplete_manifests ?? 0) > 0 ? 'warning' : 'default'}
              >
                <p>Sent in, but not every photo has arrived</p>
              </OpsTile>
              <OpsTile
                icon={Inbox}
                title="Incoming data to sort out"
                value={s?.envelopes_needing_attention}
                href={linkIf('/envelopes')}
                loading={loading}
                tone={(s?.envelopes_needing_attention ?? 0) > 0 ? 'warning' : 'default'}
              >
                <p>Data from phones that couldn’t be saved as it was</p>
              </OpsTile>
              <OpsTile icon={Bell} title="Open alerts" value={s?.open_alerts} href={linkIf('/alerts')} loading={loading} tone={critical > 0 ? 'danger' : 'default'}>
                {critical > 0 ? <p>{formatNumber(critical)} urgent</p> : <p>None urgent</p>}
              </OpsTile>
            </div>
          </section>
          <section>
            <SectionTitle hint="Work the server does in the background. “Failed after several tries” should always be 0.">Background work</SectionTitle>
            <QueueDepthsCard query={queues} />
          </section>
        </>
      ) : null}
    </>
  );
}
