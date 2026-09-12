'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, ShieldAlert, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { keyForPath } from '@/components/config/config-meta';
import { humanLabel } from '@/components/structured-view';
import { useIsAdvanced } from '@/lib/preferences';
import { DateTime } from '@/components/date-time';
import { EmptyState } from '@/components/empty-state';
import { JsonView } from '@/components/json-view';
import { UserName } from '@/components/ops/ops-shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { adminApi } from '@/lib/api';
import { humanize, shortId } from '@/lib/format';
import { useBankLookup } from '@/lib/hooks';
import { useStaff } from '@/lib/staff';
import type { ApprovalSubjectType } from '@/lib/types';
import { audienceLabel, changelogCounts, defKeys, fetchApprovalPayload, fetchPendingApprovals, type PendingApproval } from './definitions-data';

type Decision = 'approved' | 'rejected' | 'withdrawn';

const SUBJECT_LABEL: Record<ApprovalSubjectType, string> = {
  definition_publish: 'Publish definition',
  definition_activation: 'Activate version',
  remote_config: 'Remote config',
  block_in_progress: 'Block in-progress work',
};

/** Pending four-eyes requests (D-31). Shared by /definitions and /config (filter with `subjectTypes`). */
export function usePendingApprovals() {
  return useQuery({ queryKey: defKeys.approvals, queryFn: fetchPendingApprovals, refetchInterval: 60_000 });
}

/** "form/site_inspection" in Advanced view; "Form: Site inspection" in Basic view. */
function DefinitionName({ kind, keyName, suffix }: { kind: string | null | undefined; keyName: string | null | undefined; suffix?: string }) {
  const advanced = useIsAdvanced();
  if (advanced) {
    return (
      <div className="font-mono text-xs">
        {kind}/{keyName}
        {suffix}
      </div>
    );
  }
  return (
    <div className="text-sm font-medium">
      {humanLabel(kind ?? '')}: {humanLabel(keyName ?? '')}
      {suffix}
    </div>
  );
}

function Summary({ a }: { a: PendingApproval }) {
  const bankLookup = useBankLookup();
  const advanced = useIsAdvanced();
  if (a.subject_type === 'definition_publish') {
    const c = changelogCounts(a.changelog);
    return (
      <div className="space-y-0.5">
        <DefinitionName kind={a.kind} keyName={a.key} />
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span className="text-emerald-700">+{c.added}</span>
          <span className="text-red-700">−{c.removed}</span>
          <span className="text-amber-700">~{c.changed}</span>
          {a.breaking ? <Badge tone="warning">Breaking</Badge> : null}
        </div>
        {a.changelog?.note || a.note ? <p className="text-xs italic text-muted-foreground">“{a.changelog?.note ?? a.note}”</p> : null}
      </div>
    );
  }
  if (a.subject_type === 'definition_activation') {
    return (
      <div className="space-y-0.5">
        <DefinitionName kind={a.kind} keyName={a.key} suffix={` v${a.version ?? '?'}`} />
        <div className="text-xs text-muted-foreground">{audienceLabel(a.audience)}</div>
        {a.reason ? <p className="text-xs italic text-muted-foreground">“{a.reason}”</p> : null}
      </div>
    );
  }
  if (a.subject_type === 'remote_config') {
    const subject =
      a.layer === 'bank' ? (bankLookup(a.subject_id)?.code ?? shortId(a.subject_id)) : a.layer === 'agent' ? <UserName id={a.subject_id} /> : a.subject_id ? shortId(a.subject_id) : null;
    return (
      <div className="space-y-0.5">
        <div className="text-xs">
          <span className="font-medium">{humanize(a.layer)} layer</span>
          {subject ? <span className="text-muted-foreground"> · {subject}</span> : null}
          {a.base_version ? <span className="text-muted-foreground"> · replaces v{a.base_version}</span> : null}
        </div>
        {a.changed_integrity_keys && a.changed_integrity_keys.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {a.changed_integrity_keys.map((k) => (
              <Badge key={k} tone="warning" className={advanced ? 'font-mono' : undefined}>
                <ShieldAlert /> {advanced ? k : (keyForPath(k)?.label ?? humanLabel(k))}
              </Badge>
            ))}
          </div>
        ) : null}
        {a.reason ? <p className="text-xs italic text-muted-foreground">“{a.reason}”</p> : null}
      </div>
    );
  }
  return <span className="text-xs text-muted-foreground">{a.note ?? a.reason ?? '—'}</span>;
}

function DecideDialog({
  approval,
  decision,
  onOpenChange,
}: {
  approval: PendingApproval | null;
  decision: Decision;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [showPayload, setShowPayload] = useState(false);
  const payload = useQuery({
    queryKey: ['approvals', 'payload', approval?.id ?? ''],
    queryFn: () => fetchApprovalPayload(approval?.id ?? ''),
    enabled: showPayload && !!approval,
  });
  const open = approval !== null;
  const noteRequired = decision === 'rejected';

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setNote('');
      setError(null);
      setShowPayload(false);
    }
    onOpenChange(next);
  }

  async function submit() {
    if (!approval || (noteRequired && !note.trim())) return;
    setPending(true);
    setError(null);
    try {
      const res = await adminApi.approvals.decide(approval.id, { decision, note: note.trim() || undefined });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: defKeys.approvals }),
        queryClient.invalidateQueries({ queryKey: defKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['config'] }),
      ]);
      const executed = res.executed as { version?: { version?: number } } | undefined;
      toast.success(
        decision === 'approved'
          ? executed?.version?.version
            ? `Approved — version ${executed.version.version} is now recorded`
            : 'Approved and applied'
          : decision === 'rejected'
            ? 'Request rejected'
            : 'Request withdrawn',
      );
      setNote('');
      setShowPayload(false);
      onOpenChange(false);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }

  const title = decision === 'approved' ? 'Approve request' : decision === 'rejected' ? 'Reject request' : 'Withdraw request';
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {decision === 'approved'
              ? 'Approving applies the frozen request exactly as submitted, recorded with you as the approver.'
              : decision === 'rejected'
                ? 'The request is closed without being applied. Tell the requester why.'
                : 'Your request is closed without being applied.'}
          </DialogDescription>
        </DialogHeader>
        {approval ? (
          <div className="space-y-3 rounded-md border bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-sm">
              <Badge tone="accent">{SUBJECT_LABEL[approval.subject_type]}</Badge>
              <span className="text-xs text-muted-foreground">
                by <UserName id={approval.requested_by} /> · <DateTime value={approval.at} mode="relative" />
              </span>
            </div>
            <Summary a={approval} />
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowPayload((v) => !v)}>
              <Eye /> {showPayload ? 'Hide full request' : 'View full request'}
            </Button>
            {showPayload ? (
              payload.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : payload.error ? (
                <ApiErrorAlert error={payload.error} />
              ) : (
                <JsonView value={payload.data?.payload ?? null} defaultExpandDepth={1} maxHeight={280} className="bg-white" />
              )
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="approval-note">
            Note {noteRequired ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(optional)</span>}
          </Label>
          <Textarea id="approval-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Recorded with the decision." />
        </div>
        <ApiErrorAlert error={error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={decision === 'approved' ? 'default' : 'destructive'}
            onClick={submit}
            loading={pending}
            disabled={noteRequired && !note.trim()}
          >
            {decision === 'approved' ? 'Approve' : decision === 'rejected' ? 'Reject' : 'Withdraw'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pending approvals table with Approve / Reject / Withdraw, respecting four-eyes rules (UX only; the API enforces). */
export function ApprovalsPanel({ subjectTypes, emptyText = 'No requests are waiting for approval.' }: { subjectTypes?: ApprovalSubjectType[]; emptyText?: string }) {
  const staff = useStaff();
  const bankLookup = useBankLookup();
  const query = usePendingApprovals();
  const [target, setTarget] = useState<{ approval: PendingApproval; decision: Decision } | null>(null);

  const rows = (query.data ?? []).filter((a) => !subjectTypes || subjectTypes.includes(a.subject_type));

  function whyCannotDecide(a: PendingApproval): string | null {
    if (!staff.hasPermission('approve_definitions')) return 'You need the approve_definitions permission to decide requests.';
    if (a.requested_by === staff.me.id) return 'Four-eyes: you cannot decide your own request.';
    if (a.bank_id ? !staff.canAccessBank(a.bank_id) : !staff.isGlobalAdmin) {
      return a.bank_id ? 'This request is for a bank outside your scope.' : 'Global requests need an all-bank admin.';
    }
    return null;
  }

  if (query.error) return <ApiErrorAlert error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isPending) return <Skeleton className="h-32 w-full" />;

  return (
    <>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={Check} title="Nothing to approve" description={emptyText} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => {
                const blocked = whyCannotDecide(a);
                const own = a.requested_by === staff.me.id;
                return (
                  <TableRow key={a.id}>
                    <TableCell className="align-top">
                      <Badge tone="accent">{SUBJECT_LABEL[a.subject_type]}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md align-top">
                      <Summary a={a} />
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      {a.bank_id ? (bankLookup(a.bank_id)?.code ?? shortId(a.bank_id)) : <span className="text-muted-foreground">Global</span>}
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      <UserName id={a.requested_by} />
                      <div className="text-muted-foreground">
                        <DateTime value={a.at} mode="relative" />
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap justify-end gap-1">
                        {own ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => setTarget({ approval: a, decision: 'withdrawn' })}>
                            <Undo2 /> Withdraw
                          </Button>
                        ) : null}
                        {blocked ? (
                          <SimpleTooltip content={blocked}>
                            <span tabIndex={0} className="inline-flex gap-1">
                              <Button type="button" size="sm" disabled>
                                <Check /> Approve
                              </Button>
                              <Button type="button" size="sm" variant="outline" disabled>
                                <X /> Reject
                              </Button>
                            </span>
                          </SimpleTooltip>
                        ) : (
                          <>
                            <Button type="button" size="sm" onClick={() => setTarget({ approval: a, decision: 'approved' })}>
                              <Check /> Approve
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setTarget({ approval: a, decision: 'rejected' })}>
                              <X /> Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      <DecideDialog approval={target?.approval ?? null} decision={target?.decision ?? 'approved'} onOpenChange={(o) => (!o ? setTarget(null) : undefined)} />
    </>
  );
}
