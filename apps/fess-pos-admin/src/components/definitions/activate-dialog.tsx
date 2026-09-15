'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { Details } from '@/components/details';
import { apiFieldErrors, type FieldErrors, FormField, zodFieldErrors } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { adminApi, isApprovalRequired } from '@/lib/api';
import { employeeName, formatDateTime, fromDateTimeLocalValue } from '@/lib/format';
import { useAgents, useBankLookup } from '@/lib/hooks';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import { activationSchema } from '@/lib/schemas';
import { ACTIVATION_INCOMPATIBLE_POLICIES, type ActivationIncompatiblePolicy, type DefinitionFamily } from '@/lib/types';
import { defKeys, liveForLabel, POLICY_LABEL, type VersionLite } from './definitions-data';

export interface ActivatePreset {
  versionId?: string;
  reason?: string;
}

type AudienceType = 'all' | 'agents' | 'percent' | 'attribute';

/** Checkbox list of active agents eligible for the family's bank (all agents for a global family). */
function AgentMultiSelect({ bankId, value, onChange, invalid }: { bankId: string | null; value: string[]; onChange: (ids: string[]) => void; invalid?: boolean }) {
  const { data, isLoading, error } = useAgents(bankId);
  const [q, setQ] = useState('');
  const list = (data ?? []).filter((a) => !q.trim() || employeeName(a).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className={`rounded-md border ${invalid ? 'border-destructive' : ''}`}>
      <div className="border-b p-1.5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents…" className="h-8" aria-label="Search agents" />
      </div>
      <div className="max-h-44 overflow-y-auto p-1">
        {isLoading ? <p className="px-2 py-1 text-sm text-muted-foreground">Loading agents…</p> : null}
        {error ? <p className="px-2 py-1 text-sm text-destructive">Couldn’t load the agents. Close this and try again.</p> : null}
        {data && list.length === 0 ? <p className="px-2 py-1 text-sm text-muted-foreground">No agents match your search.</p> : null}
        {list.map((a) => (
          <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
            <Checkbox
              checked={value.includes(a.id)}
              onCheckedChange={(c) => onChange(c === true ? [...value, a.id] : value.filter((x) => x !== a.id))}
            />
            {employeeName(a)}
          </label>
        ))}
      </div>
      <p className="border-t px-2 py-1 text-xs text-muted-foreground">{value.length} chosen</p>
    </div>
  );
}

/** Make a version live for some or all agents (POST /definitions/families/:id/activations): 201 live | 202 needs a second approval. */
export function ActivateDialog({
  open,
  onOpenChange,
  family,
  versions,
  preset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  family: DefinitionFamily;
  versions: VersionLite[];
  preset?: ActivatePreset;
}) {
  const advanced = useIsAdvanced();
  const bankLookup = useBankLookup();
  const bankName = family.scope === 'global' ? null : (bankLookup(family.bank_id)?.name ?? null);
  const [versionId, setVersionId] = useState<string>(preset?.versionId ?? versions[0]?.id ?? '');
  const [audType, setAudType] = useState<AudienceType>('all');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [percent, setPercent] = useState('10');
  const [attrKey, setAttrKey] = useState('');
  const [attrValues, setAttrValues] = useState('');
  const [policy, setPolicy] = useState<ActivationIncompatiblePolicy>('fallback_version');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState(preset?.reason ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});

  const activate = useMutationWithToast({
    mutationFn: (body: Parameters<typeof adminApi.definitions.activate>[1]) => adminApi.definitions.activate(family.id, body),
    toastErrors: false,
    invalidate: [defKeys.all, defKeys.approvals],
    onSuccess: (res) => {
      const v = versions.find((x) => x.id === versionId);
      if (isApprovalRequired(res.data)) {
        toast.success('Sent for a second approval', { description: 'Another admin must approve this before it goes live.' });
      } else {
        const act = res.data.activation;
        toast.success(`Version ${v?.version ?? '?'} is now ${liveForLabel(act.audience, bankName).replace(/^L/, 'l')}.`, {
          description: `From ${formatDateTime(act.effective_from)}. Phones pick it up the next time they sync.`,
        });
      }
      onOpenChange(false);
    },
    onError: (e) => setErrors(apiFieldErrors(e)),
  });

  function submit() {
    const audience =
      audType === 'all'
        ? { type: 'all' as const }
        : audType === 'agents'
          ? { type: 'agents' as const, user_ids: agentIds }
          : audType === 'percent'
            ? { type: 'percent' as const, percent: Number(percent) }
            : {
                type: 'attribute' as const,
                key: attrKey.trim(),
                values: attrValues
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              };
    const effectiveFrom = fromDateTimeLocalValue(from);
    const effectiveTo = fromDateTimeLocalValue(to);
    const parsed = activationSchema.safeParse({
      version_id: versionId,
      audience,
      policy: { incompatible: policy },
      ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
      ...(effectiveTo ? { effective_to: effectiveTo } : {}),
      reason,
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    if (effectiveTo && !effectiveFrom && Date.parse(effectiveTo) <= Date.now()) {
      setErrors({ effective_to: 'Choose a time in the future.' });
      return;
    }
    setErrors({});
    activate.mutate(parsed.data);
  }

  const audienceError = errors['audience.user_ids'] ?? errors['audience.percent'] ?? errors['audience.key'] ?? errors['audience.values'] ?? errors.audience;

  return (
    <Dialog open={open} onOpenChange={(o) => (activate.isPending ? undefined : onOpenChange(o))}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Make “{family.title}” live</DialogTitle>
          <DialogDescription>
            Choose a version and who gets it. Phones pick it up the next time they sync. Visits already under way keep the version they started with.
            {advanced ? (
              <span className="mt-1 block font-mono text-xs">
                {family.kind}/{family.key}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
          <FormField label="Version" htmlFor="act-version" required error={errors.version_id}>
            <Select value={versionId} onValueChange={setVersionId}>
              <SelectTrigger id="act-version">
                <SelectValue placeholder="Choose a version" />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    Version {v.version} · published {formatDateTime(v.published_at)}
                    {v.breaking ? ' · changes earlier answers' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Who gets it" htmlFor="act-audience" required error={audienceError}>
            <Select value={audType} onValueChange={(v) => setAudType(v as AudienceType)}>
              <SelectTrigger id="act-audience">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{bankName ? `All agents at ${bankName}` : 'All agents'}</SelectItem>
                <SelectItem value="agents">Only the agents I choose</SelectItem>
                <SelectItem value="percent">A share of agents, to try it out first</SelectItem>
                <SelectItem value="attribute">Agents with a certain detail, such as their region</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {audType === 'agents' ? <AgentMultiSelect bankId={family.bank_id} value={agentIds} onChange={setAgentIds} invalid={!!errors['audience.user_ids']} /> : null}
          {audType === 'percent' ? (
            <FormField label="Share of agents (%)" htmlFor="act-percent" hint="From 1 to 100. The same agents stay in the group as you raise it.">
              <Input id="act-percent" type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} className="w-32" />
            </FormField>
          ) : null}
          {audType === 'attribute' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Detail" htmlFor="act-attr-key" hint="The name of the detail, such as region">
                <Input id="act-attr-key" value={attrKey} onChange={(e) => setAttrKey(e.target.value)} className="font-mono" />
              </FormField>
              <FormField label="Values" htmlFor="act-attr-values" hint="Separate with commas, such as GP, WC">
                <Input id="act-attr-values" value={attrValues} onChange={(e) => setAttrValues(e.target.value)} />
              </FormField>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Start (SAST)" htmlFor="act-from" error={errors.effective_from} hint="Leave empty to start straight away">
              <Input id="act-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </FormField>
            <FormField label="End (SAST)" htmlFor="act-to" error={errors.effective_to} hint="Leave empty for no end date">
              <Input id="act-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Why are you making this change?" htmlFor="act-reason" required error={errors.reason}>
            <Textarea id="act-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Saved in the activity history" />
          </FormField>

          <Details summary="More options" defaultOpen={!!errors['policy.incompatible']}>
            <FormField label="If a phone’s app is too old for this version" htmlFor="act-policy" error={errors['policy.incompatible']}>
              <Select value={policy} onValueChange={(v) => setPolicy(v as ActivationIncompatiblePolicy)}>
                <SelectTrigger id="act-policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVATION_INCOMPATIBLE_POLICIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {POLICY_LABEL[p] ?? p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </Details>
          <ApiErrorAlert error={activate.error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={activate.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} loading={activate.isPending} disabled={!versionId}>
            Make live
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
