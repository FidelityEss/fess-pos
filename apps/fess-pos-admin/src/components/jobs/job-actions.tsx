'use client';

// Job actions (docs/06 §1a, §2): availability by status + permission, the header action bar, and the dialogs
// (contact attempt, confirm / reschedule, unschedule, not secured, allocate / reassign with agent load, revoke,
// cancel, close). Every write goes through /v1/admin/jobs/*; 409s refetch the job and show the server's message.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Pencil } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FormField, FormGrid } from '@/components/form-field';
import { ReasonCodeSelect } from '@/components/reason-code-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { employeeName, fromDateTimeLocalValue, TIME_ZONE, toDateTimeLocalValue } from '@/lib/format';
import { CONTACT_CHANNEL_LABEL, CONTACT_OUTCOME_LABEL } from '@/lib/labels';
import { useAgents } from '@/lib/hooks';
import { useMutationWithToast } from '@/lib/mutations';
import type { ContactAttemptBody, ReasonCodeActionBody, ScheduleBody } from '@/lib/schemas';
import type { StaffContextValue } from '@/lib/staff';
import { callRpc } from '@/lib/supabase';
import { type AgentLoadRow, CONTACT_CHANNELS, CONTACT_OUTCOMES, type ContactChannel, type ContactOutcome, type Job, type ReasonCategory, type ReasonCode } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';
import { ActionDialog } from './job-bits';
import {
  addDays,
  ATTEMPT_LOGGABLE,
  type AttemptRow,
  CANCELLABLE,
  CLOSABLE,
  formatWindow,
  invalidateJob,
  isConflictError,
  type JobDetailRow,
  RESCHEDULABLE,
  sastDay,
} from './job-data';

export type JobDialogKind = 'attempt' | 'schedule' | 'unschedule' | 'not_secured' | 'allocate' | 'reassign' | 'revoke' | 'cancel' | 'close';

export interface JobAction {
  kind: JobDialogKind;
  label: string;
  enabled: boolean;
  reason?: string;
  destructive?: boolean;
  primary?: boolean;
}

export interface AgentConflict {
  job_id: string;
  reference: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
}

/** Actions available for a job given its status and the staff member's role / permissions. */
export function jobActions(job: Pick<Job, 'status'>, staff: Pick<StaffContextValue, 'isAdmin' | 'hasPermission'>, attemptsCount: number): JobAction[] {
  if (!staff.isAdmin) return [];
  const canSchedule = staff.hasPermission('schedule_jobs');
  const st = job.status;
  const out: JobAction[] = [];
  if (canSchedule && st === 'pending') {
    out.push({
      kind: 'schedule',
      label: 'Confirm the visit time',
      enabled: attemptsCount > 0,
      reason: attemptsCount > 0 ? undefined : 'First log at least one call or message to the merchant. It’s the proof behind the booking.',
      primary: true,
    });
  }
  if (st === 'scheduled') out.push({ kind: 'allocate', label: 'Assign an agent', enabled: true, primary: true });
  if (st === 'assigned' || st === 'accepted') out.push({ kind: 'reassign', label: 'Change the agent', enabled: true, primary: true });
  if (CLOSABLE.includes(st)) out.push({ kind: 'close', label: 'Archive the job', enabled: true, primary: true });
  if (canSchedule && ATTEMPT_LOGGABLE.includes(st)) out.push({ kind: 'attempt', label: 'Log a call or message', enabled: true });
  if (canSchedule && RESCHEDULABLE.includes(st)) out.push({ kind: 'schedule', label: 'Change the visit time', enabled: true });
  if (canSchedule && st === 'scheduled') out.push({ kind: 'unschedule', label: 'Cancel the booking', enabled: true });
  if (canSchedule && st === 'pending') out.push({ kind: 'not_secured', label: 'Couldn’t book a visit', enabled: true, destructive: true });
  if (st === 'assigned' || st === 'accepted') out.push({ kind: 'revoke', label: 'Take the job off the agent', enabled: true, destructive: true });
  if (CANCELLABLE.includes(st)) out.push({ kind: 'cancel', label: 'Cancel job', enabled: true, destructive: true });
  return out;
}

/** Header buttons: Edit and a "More actions" menu. The next step's own button is in the job summary, so pass the other actions. */
export function JobActionBar({ actions, onOpen, editHref }: { actions: JobAction[]; onOpen: (k: JobDialogKind) => void; editHref: string | null }) {
  const rest = actions;
  return (
    <>
      {editHref ? (
        <Button variant="outline" size="sm" asChild>
          <Link href={editHref}>
            <Pencil /> Edit
          </Link>
        </Button>
      ) : null}
      {rest.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              More actions <ChevronDown className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {rest.map((a) => (
              <DropdownMenuItem key={`${a.kind}-${a.label}`} disabled={!a.enabled} destructive={a.destructive} onSelect={() => onOpen(a.kind)}>
                <div>
                  <div>{a.label}</div>
                  {!a.enabled && a.reason ? <div className="text-sm text-muted-foreground">{a.reason}</div> : null}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}

/** Inline buttons for a subset of actions (used inside tabs). */
export function ActionButtons({ actions, kinds, onOpen }: { actions: JobAction[]; kinds: JobDialogKind[]; onOpen: (k: JobDialogKind) => void }) {
  const list = actions.filter((a) => kinds.includes(a.kind));
  if (!list.length) return null;
  return (
    <>
      {list.map((a) => (
        <Button
          key={`${a.kind}-${a.label}`}
          size="sm"
          variant={a.primary ? 'default' : 'outline'}
          className={cn(a.destructive && 'text-destructive hover:text-destructive')}
          onClick={() => onOpen(a.kind)}
          disabled={!a.enabled}
          title={a.reason}
        >
          {a.label}
        </Button>
      ))}
    </>
  );
}

// ── Mutation helper ───────────────────────────────────────────────────────────────────────────
function useJobMutation<TVars, TData>(jobId: string, fn: (v: TVars) => Promise<TData>, successMessage: string | ((d: TData) => string | null), onDone: (d: TData) => void) {
  const queryClient = useQueryClient();
  return useMutationWithToast<TData, TVars>({
    mutationFn: fn,
    successMessage,
    toastErrors: false,
    onSuccess: async (d) => {
      await invalidateJob(queryClient, jobId);
      onDone(d);
    },
    onError: (e) => {
      // Someone else changed the job (409): refresh so the page shows the real state; the dialog shows the message.
      if (isConflictError(e)) void invalidateJob(queryClient, jobId);
    },
  });
}

const opt = (v: string): string | undefined => (v.trim() ? v.trim() : undefined);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function addMinutesLocal(local: string, minutes: number): string {
  const iso = fromDateTimeLocalValue(local);
  return iso ? toDateTimeLocalValue(new Date(Date.parse(iso) + minutes * 60_000).toISOString()) : '';
}

// ── Dialogs ───────────────────────────────────────────────────────────────────────────────────
function ContactAttemptDialog({ job, onClose }: { job: JobDetailRow; onClose: () => void }) {
  const [channel, setChannel] = useState<ContactChannel>('phone');
  const [outcome, setOutcome] = useState<ContactOutcome>('no_answer');
  const [at, setAt] = useState(() => toDateTimeLocalValue(new Date().toISOString()));
  const [pStart, setPStart] = useState('');
  const [pEnd, setPEnd] = useState('');
  const [contactName, setContactName] = useState(job.contact?.name ?? '');
  const [note, setNote] = useState('');
  const m = useJobMutation(job.id, (b: ContactAttemptBody) => adminApi.jobs.contactAttempt(job.id, b), 'Call or message logged', onClose);
  const startIso = fromDateTimeLocalValue(pStart);
  const endIso = fromDateTimeLocalValue(pEnd);
  const windowError = startIso && endIso && Date.parse(endIso) <= Date.parse(startIso) ? 'The end must be after the start' : null;
  const atIso = fromDateTimeLocalValue(at);
  const future = atIso ? Date.parse(atIso) > Date.now() + 5 * 60_000 : false;

  return (
    <ActionDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title="Log a call or message"
      description="Note every try to reach the merchant. These notes are the proof behind a booking, or behind “couldn’t book a visit”. Times are South African time."
      submitLabel="Log it"
      size="md"
      pending={m.isPending}
      error={m.error}
      canSubmit={!!atIso && !windowError && !future}
      onSubmit={() =>
        m.mutate({ attempted_at: atIso, channel, outcome, proposed_start: startIso, proposed_end: endIso, contact_name: opt(contactName), note: opt(note) })
      }
    >
      <FormGrid>
        <FormField label="How" htmlFor="att-channel" required>
          <Select value={channel} onValueChange={(v) => setChannel(v as ContactChannel)}>
            <SelectTrigger id="att-channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>
                  {CONTACT_CHANNEL_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="What happened" htmlFor="att-outcome" required>
          <Select value={outcome} onValueChange={(v) => setOutcome(v as ContactOutcome)}>
            <SelectTrigger id="att-outcome">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_OUTCOMES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CONTACT_OUTCOME_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="When" htmlFor="att-at" required error={future ? 'This can’t be in the future' : null}>
          <Input id="att-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </FormField>
        <FormField label="Spoke to" htmlFor="att-contact">
          <Input id="att-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </FormField>
        <FormField label="Time they suggested: from" htmlFor="att-ps" hint="If the merchant suggested a time">
          <Input
            id="att-ps"
            type="datetime-local"
            value={pStart}
            onChange={(e) => {
              setPStart(e.target.value);
              if (!pEnd && e.target.value) setPEnd(addMinutesLocal(e.target.value, 60));
            }}
          />
        </FormField>
        <FormField label="Time they suggested: to" htmlFor="att-pe" error={windowError}>
          <Input id="att-pe" type="datetime-local" value={pEnd} onChange={(e) => setPEnd(e.target.value)} />
        </FormField>
      </FormGrid>
      <FormField label="Note" htmlFor="att-note">
        <Textarea id="att-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}

function ScheduleDialog({ job, attempts, onClose }: { job: JobDetailRow; attempts: AttemptRow[]; onClose: () => void }) {
  const reschedule = job.status !== 'pending';
  const proposal = attempts.find((a) => a.proposed_start);
  const onsite = job.onsite_contact;
  const [start, setStart] = useState(() => toDateTimeLocalValue(job.scheduled_start ?? proposal?.proposed_start));
  const [end, setEnd] = useState(() => toDateTimeLocalValue(job.scheduled_end ?? proposal?.proposed_end));
  const [name, setName] = useState(onsite?.name ?? job.contact?.name ?? '');
  const [phone, setPhone] = useState(onsite?.phone ?? job.contact?.phone ?? '');
  const [email, setEmail] = useState(onsite?.email ?? job.contact?.email ?? '');
  const [role, setRole] = useState(onsite?.role ?? '');
  const [note, setNote] = useState('');
  const m = useJobMutation(
    job.id,
    (b: ScheduleBody) => adminApi.jobs.schedule(job.id, b),
    reschedule ? 'Visit time changed' : 'Visit time confirmed. Next: assign an agent.',
    onClose,
  );
  const startIso = fromDateTimeLocalValue(start);
  const endIso = fromDateTimeLocalValue(end);
  const windowError = startIso && endIso && Date.parse(endIso) <= Date.parse(startIso) ? 'The end must be after the start' : null;
  const emailError = email.trim() && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address' : null;
  const canSubmit = !!startIso && !!endIso && !windowError && !!name.trim() && !emailError;

  return (
    <ActionDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={reschedule ? 'Change the visit time' : 'Confirm the visit time'}
      description={
        reschedule
          ? `Change the visit time agreed with the merchant. Times are South African time.${job.assigned_to ? ' The agent gets the new time, and can only start the visit in the new window.' : ''}`
          : 'Record the visit time agreed with the merchant, and who will meet the agent. Next, you can assign an agent. Times are South African time.'
      }
      submitLabel={reschedule ? 'Change the time' : 'Confirm the visit time'}
      size="md"
      pending={m.isPending}
      error={m.error}
      canSubmit={canSubmit}
      onSubmit={() =>
        m.mutate({
          scheduled_start: startIso ?? '',
          scheduled_end: endIso ?? '',
          onsite_contact: { name: name.trim(), phone: opt(phone), email: opt(email), role: opt(role) },
          note: opt(note),
        })
      }
    >
      {reschedule && job.scheduled_start ? <p className="text-sm text-muted-foreground">Booked now: {formatWindow(job.scheduled_start, job.scheduled_end)}</p> : null}
      <FormGrid>
        <FormField label="Visit starts" htmlFor="sch-start" required>
          <Input
            id="sch-start"
            type="datetime-local"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (!end && e.target.value) setEnd(addMinutesLocal(e.target.value, 60));
            }}
          />
        </FormField>
        <FormField label="Visit ends" htmlFor="sch-end" required error={windowError}>
          <Input id="sch-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </FormField>
        <FormField label="Who will meet the agent" htmlFor="sch-name" required>
          <Input id="sch-name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Their role" htmlFor="sch-role" hint="For example: owner, store manager">
          <Input id="sch-role" value={role} onChange={(e) => setRole(e.target.value)} />
        </FormField>
        <FormField label="Phone" htmlFor="sch-phone">
          <Input id="sch-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </FormField>
        <FormField label="Email" htmlFor="sch-email" error={emailError}>
          <Input id="sch-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
      </FormGrid>
      <FormField label="Note" htmlFor="sch-note">
        <Textarea id="sch-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}

function ReasonDialog<T>({
  job,
  category,
  title,
  description,
  submitLabel,
  destructive,
  run,
  successMessage,
  onClose,
  noteLabel = 'Note',
  children,
}: {
  job: JobDetailRow;
  category: ReasonCategory;
  title: string;
  description: ReactNode;
  submitLabel: string;
  destructive?: boolean;
  run: (b: ReasonCodeActionBody) => Promise<T>;
  successMessage: string | ((d: T) => string | null);
  onClose: () => void;
  noteLabel?: string;
  children?: ReactNode;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [reason, setReason] = useState<ReasonCode | null>(null);
  const [note, setNote] = useState('');
  const m = useJobMutation(job.id, run, successMessage, onClose);
  const noteRequired = reason?.requires_note ?? false;
  return (
    <ActionDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={title}
      description={description}
      submitLabel={submitLabel}
      destructive={destructive}
      pending={m.isPending}
      error={m.error}
      canSubmit={!!code && (!noteRequired || !!note.trim())}
      onSubmit={() => code && m.mutate({ reason_code: code, note: opt(note) })}
    >
      {children}
      <FormField label="Reason" htmlFor={`reason-${category}`} required>
        <ReasonCodeSelect
          id={`reason-${category}`}
          category={category}
          bankId={job.bank_id}
          value={code}
          onChange={(c, r) => {
            setCode(c);
            setReason(r);
          }}
        />
      </FormField>
      <FormField label={noteLabel} htmlFor={`note-${category}`} required={noteRequired}>
        <Textarea id={`note-${category}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}

const dayHeadFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: '2-digit', month: 'short' });

/** Agents eligible for the bank with their assigned-job counts per day around the job's scheduled day. */
function AgentLoadPicker({
  bankId,
  day,
  value,
  onChange,
  excludeId,
}: {
  bankId: string;
  day: string;
  value: string | null;
  onChange: (id: string) => void;
  excludeId: string | null;
}) {
  const agents = useAgents(bankId);
  const from = addDays(day, -3);
  const to = addDays(day, 3);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(from, i)), [from]);
  const load = useQuery({
    queryKey: ['agent-load', from, to],
    queryFn: () => callRpc<AgentLoadRow[]>('admin_agent_load', { p_from: from, p_to: to, p_bank_id: null }),
  });
  const [q, setQ] = useState('');
  const byAgent = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of load.data ?? []) {
      const d = m.get(r.user_id) ?? new Map<string, number>();
      d.set(String(r.day).slice(0, 10), (d.get(String(r.day).slice(0, 10)) ?? 0) + r.jobs);
      m.set(r.user_id, d);
    }
    return m;
  }, [load.data]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (agents.data ?? [])
      .filter((a) => a.id !== excludeId)
      .filter((a) => !t || employeeName(a).toLowerCase().includes(t))
      .map((a) => ({ a, onDay: byAgent.get(a.id)?.get(day) ?? 0, week: [...(byAgent.get(a.id)?.values() ?? [])].reduce((s, n) => s + n, 0) }))
      .sort((x, y) => x.onDay - y.onDay || x.week - y.week || employeeName(x.a).localeCompare(employeeName(y.a)));
  }, [agents.data, byAgent, day, excludeId, q]);

  if (agents.isPending) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents" className="max-w-56" aria-label="Search agents" />
        <span className="text-sm text-muted-foreground">How many jobs each agent already has each day (all the banks you can see). The quietest on the visit day are first.</span>
      </div>
      <div className="max-h-72 overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b bg-card text-sm text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Agent</th>
              {days.map((d) => (
                <th key={d} className={cn('px-1.5 py-1.5 text-center font-medium', d === day && 'bg-primary/15 text-primary-hover')}>
                  {dayHeadFmt.format(new Date(`${d}T12:00:00+02:00`))}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right font-medium">Week</th>
            </tr>
          </thead>
          <tbody>
            {list.map(({ a, week }) => (
              <tr
                key={a.id}
                onClick={() => onChange(a.id)}
                className={cn('cursor-pointer border-t border-divider hover:bg-accent/50', value === a.id && 'bg-primary/10 hover:bg-primary/10')}
              >
                <td className="px-2 py-1.5">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="radio" name="agent" checked={value === a.id} onChange={() => onChange(a.id)} className="accent-primary" />
                    {employeeName(a)}
                  </label>
                </td>
                {days.map((d) => {
                  const n = byAgent.get(a.id)?.get(d) ?? 0;
                  return (
                    <td key={d} className={cn('px-1.5 py-1.5 text-center tabular-nums', d === day && 'bg-primary/10 font-medium', n === 0 && 'text-muted-foreground', n >= 4 && 'text-amber-700')}>
                      {load.isPending ? '·' : n}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right tabular-nums">{load.isPending ? '·' : week}</td>
              </tr>
            ))}
            {list.length === 0 ? (
              <tr>
                <td colSpan={days.length + 2} className="px-2 py-4 text-center text-sm text-muted-foreground">
                  No active agents work for this bank. Add one under People.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {load.error ? <p className="text-sm text-destructive">We couldn’t load how busy each agent is. You can still choose an agent.</p> : null}
    </div>
  );
}

function parseConflicts(data: unknown): AgentConflict[] {
  if (!isPlainObject(data) || !Array.isArray(data.agent_conflicts)) return [];
  return data.agent_conflicts.flatMap((c) =>
    isPlainObject(c) && typeof c.job_id === 'string'
      ? [{
          job_id: c.job_id,
          reference: typeof c.reference === 'string' ? c.reference : c.job_id,
          scheduled_start: typeof c.scheduled_start === 'string' ? c.scheduled_start : null,
          scheduled_end: typeof c.scheduled_end === 'string' ? c.scheduled_end : null,
        }]
      : [],
  );
}

function AllocateDialog({
  job,
  mode,
  onClose,
  onConflicts,
}: {
  job: JobDetailRow;
  mode: 'allocate' | 'reassign';
  onClose: () => void;
  onConflicts: (c: AgentConflict[]) => void;
}) {
  const [agentId, setAgentId] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [reason, setReason] = useState<ReasonCode | null>(null);
  const [note, setNote] = useState('');
  const m = useJobMutation(
    job.id,
    (v: { agentId: string }) =>
      mode === 'allocate'
        ? adminApi.jobs.allocate(job.id, { agent_id: v.agentId, note: opt(note) })
        : adminApi.jobs.reassign(job.id, { agent_id: v.agentId, reason_code: code ?? '', note: opt(note) }),
    mode === 'allocate' ? 'Agent assigned. The job shows in their app the next time it syncs.' : 'Agent changed. The job moves to the new agent’s app the next time it syncs.',
    (d) => {
      const conflicts = parseConflicts(d);
      onConflicts(conflicts);
      if (conflicts.length) toast.warning(`This agent already has ${conflicts.length} other job${conflicts.length === 1 ? '' : 's'} at that time`, { description: conflicts.map((c) => c.reference).join(', ') });
      onClose();
    },
  );
  const noteRequired = mode === 'reassign' && (reason?.requires_note ?? false);
  const canSubmit = !!agentId && (mode === 'allocate' || !!code) && (!noteRequired || !!note.trim());
  return (
    <ActionDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={mode === 'allocate' ? 'Assign an agent' : 'Change the agent'}
      description={
        <>
          Visit time: <strong>{formatWindow(job.scheduled_start, job.scheduled_end)}</strong>.{' '}
          {mode === 'reassign'
            ? `${job.agent ? employeeName(job.agent) : 'The current agent'} will no longer have the job.`
            : 'Only active agents who work for this bank are listed.'}
        </>
      }
      submitLabel={mode === 'allocate' ? 'Assign' : 'Change the agent'}
      size="xl"
      pending={m.isPending}
      error={m.error}
      canSubmit={canSubmit}
      onSubmit={() => agentId && m.mutate({ agentId })}
    >
      <AgentLoadPicker bankId={job.bank_id} day={sastDay(job.scheduled_start)} value={agentId} onChange={setAgentId} excludeId={mode === 'reassign' ? job.assigned_to : null} />
      <FormGrid>
        {mode === 'reassign' ? (
          <FormField label="Reason" htmlFor="reassign-reason" required>
            <ReasonCodeSelect
              id="reassign-reason"
              category="reassign"
              bankId={job.bank_id}
              value={code}
              onChange={(c, r) => {
                setCode(c);
                setReason(r);
              }}
            />
          </FormField>
        ) : null}
        <FormField label="Note" htmlFor="alloc-note" required={noteRequired} className={mode === 'allocate' ? 'sm:col-span-2' : undefined}>
          <Textarea id="alloc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </FormGrid>
    </ActionDialog>
  );
}

function CloseDialog({ job, onClose }: { job: JobDetailRow; onClose: () => void }) {
  const [note, setNote] = useState('');
  const m = useJobMutation(job.id, () => adminApi.jobs.close(job.id, { note: opt(note) }), 'Job archived', onClose);
  return (
    <ActionDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title="Archive this job?"
      description="Archiving puts a finished job away for good. Nothing more can happen to it afterwards."
      submitLabel="Archive"
      pending={m.isPending}
      error={m.error}
      onSubmit={() => m.mutate(undefined)}
    >
      <FormField label="Note" htmlFor="close-note">
        <Textarea id="close-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}

/** Renders the open dialog (fresh state each time it opens). */
export function JobDialogs({
  job,
  dialog,
  onClose,
  attempts,
  onConflicts,
}: {
  job: JobDetailRow;
  dialog: JobDialogKind | null;
  onClose: () => void;
  attempts: AttemptRow[];
  onConflicts: (c: AgentConflict[]) => void;
}) {
  switch (dialog) {
    case 'attempt':
      return <ContactAttemptDialog job={job} onClose={onClose} />;
    case 'schedule':
      return <ScheduleDialog job={job} attempts={attempts} onClose={onClose} />;
    case 'unschedule':
      return (
        <ReasonDialog
          job={job}
          category="unschedule"
          title="Cancel the booking?"
          description="Use this when the agreed visit time falls through. The job goes back to “To be booked” so someone can agree a new time."
          submitLabel="Cancel the booking"
          run={(b) => adminApi.jobs.unschedule(job.id, b)}
          successMessage="Booking cancelled. The job needs a new visit time."
          onClose={onClose}
        />
      );
    case 'not_secured':
      return (
        <ReasonDialog
          job={job}
          category="appointment_not_secured"
          title="Couldn’t book a visit"
          description="Close the job without sending an agent, because no visit time could be agreed with the merchant. Whether the bank is billed depends on the reason and the bank’s billing settings."
          submitLabel="Record it"
          destructive
          run={(b) => adminApi.jobs.notSecured(job.id, b)}
          successMessage={(d) => `Recorded as “couldn’t book a visit”. Under the bank’s billing settings, ${d.billable ? 'the bank is billed for it' : 'the bank isn’t billed for it'}.`}
          onClose={onClose}
        >
          {attempts.length === 0 ? <p className="text-sm text-amber-700">No calls or messages are logged yet. Log them first: they’re the proof behind any charge.</p> : null}
        </ReasonDialog>
      );
    case 'revoke':
      return (
        <ReasonDialog
          job={job}
          category="reassign"
          title="Take the job off the agent?"
          description={`${job.agent ? employeeName(job.agent) : 'The agent'} will no longer have the job. It goes back to “Booked, no agent yet” so you can assign someone else.`}
          submitLabel="Take it off them"
          destructive
          run={(b) => adminApi.jobs.revoke(job.id, b)}
          successMessage="Job taken off the agent. Assign someone else when you’re ready."
          onClose={onClose}
        />
      );
    case 'cancel':
      return (
        <ReasonDialog
          job={job}
          category="cancel"
          title="Cancel this job?"
          description={
            <>
              The job stops here, and the agent can no longer start the visit.
              {job.assigned_to ? ' The job is taken off the agent’s app.' : ''}
              {['in_progress', 'paused'].includes(job.status)
                ? ' The agent is on the visit right now: anything they still send in is received and kept, marked as sent after the cancellation.'
                : ''}
            </>
          }
          submitLabel="Cancel job"
          destructive
          run={(b) => adminApi.jobs.cancel(job.id, b)}
          successMessage="Job cancelled"
          onClose={onClose}
        />
      );
    case 'allocate':
    case 'reassign':
      return <AllocateDialog job={job} mode={dialog} onClose={onClose} onConflicts={onConflicts} />;
    case 'close':
      return <CloseDialog job={job} onClose={onClose} />;
    default:
      return null;
  }
}

/** Warning banner for allocate/reassign overlaps (B1.7 — shown, not blocking). */
export function ConflictsBanner({ conflicts, onDismiss }: { conflicts: AgentConflict[]; onDismiss: () => void }) {
  if (!conflicts.length) return null;
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-start justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
      <div>
        <p className="font-medium">This agent already has {conflicts.length} other job{conflicts.length === 1 ? '' : 's'} at the same time</p>
        <ul className="mt-1 space-y-0.5">
          {conflicts.map((c) => (
            <li key={c.job_id}>
              <Link href={`/jobs/${c.job_id}`} className="font-mono underline">
                {c.reference}
              </Link>{' '}
              · {formatWindow(c.scheduled_start, c.scheduled_end)}
            </li>
          ))}
        </ul>
      </div>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
      <Badge tone="warning" className="sr-only">
        warning
      </Badge>
    </div>
  );
}
