'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { employeeName } from '@/lib/format';
import { useAgents } from '@/lib/hooks';
import type { PosUser } from '@/lib/types';

/** Picker of active pos_agent users allowed for `bankId` (bank_ids null or containing it). Value = pos_users.id. */
export function AgentSelect({
  bankId,
  value,
  onChange,
  excludeIds,
  placeholder = 'Choose an agent',
  disabled,
  id,
  invalid,
}: {
  bankId?: string | null;
  value: string | null | undefined;
  onChange: (agentId: string | null, agent: PosUser | null) => void;
  /** e.g. the currently assigned agent when reassigning. */
  excludeIds?: string[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
}) {
  const { data, isLoading, error } = useAgents(bankId);
  const agents = (data ?? []).filter((a) => !excludeIds?.includes(a.id));
  return (
    <Select
      value={value ?? ''}
      onValueChange={(v) => onChange(v || null, agents.find((a) => a.id === v) ?? null)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger id={id} aria-invalid={invalid || undefined}>
        <SelectValue placeholder={isLoading ? 'Loading agents…' : error ? 'Couldn’t load the agents' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {agents.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {employeeName(a)}
          </SelectItem>
        ))}
        {data && agents.length === 0 ? <div className="px-2 py-1.5 text-sm text-muted-foreground">No active agents work for this bank</div> : null}
      </SelectContent>
    </Select>
  );
}
