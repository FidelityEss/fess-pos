'use client';

import { useQuery } from '@tanstack/react-query';
import { Power, Search } from 'lucide-react';
import { useState } from 'react';
import { AgentSelect } from '@/components/agent-select';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { BankSelect } from '@/components/bank-select';
import { CopyButton } from '@/components/copy-button';
import { FormField } from '@/components/form-field';
import { JsonView } from '@/components/json-view';
import { getPath } from '@/components/ops/ops-shared';
import { humanLabel } from '@/components/structured-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/api';
import { formatDateTime, shortId } from '@/lib/format';
import { isUuid } from '@/lib/hooks';
import { useIsAdvanced } from '@/lib/preferences';
import type { ConfigResolvedQuery } from '@/lib/schemas';
import { fetchRows, pos } from '@/lib/supabase';
import type { Device } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';
import { KILL_SWITCH_KEYS, MIN_VERSION_KEYS } from './config-keys';

export type DeviceLite = Pick<Device, 'id' | 'device_id' | 'user_id' | 'platform' | 'model' | 'last_seen_at' | 'revoked_at'>;

/** Devices visible under RLS (most recently seen first). */
export function useDevices(userId?: string | null) {
  return useQuery({
    queryKey: ['config', 'devices', userId ?? null],
    queryFn: () => {
      const q = pos().from('devices').select('id,device_id,user_id,platform,model,last_seen_at,revoked_at');
      return fetchRows<DeviceLite>((userId ? q.eq('user_id', userId) : q).order('last_seen_at', { ascending: false }).limit(500));
    },
    staleTime: 60_000,
  });
}

const NONE = '__none__';

/** Device picker: known devices (optionally for one user) or a pasted module device id. Value = devices.device_id. */
export function DevicePicker({
  value,
  onChange,
  userId,
  userLabel,
  id,
}: {
  value: string;
  onChange: (deviceId: string) => void;
  userId?: string | null;
  userLabel?: (userId: string) => string;
  id?: string;
}) {
  const devices = useDevices(userId);
  const known = (devices.data ?? []).some((d) => d.device_id === value);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Select value={known ? value : NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)} disabled={devices.isPending}>
        <SelectTrigger id={id} aria-label="Known phones">
          <SelectValue placeholder={devices.isPending ? 'Loading phones…' : 'Pick a phone'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None (type the phone ID instead)</SelectItem>
          {(devices.data ?? []).map((d) => (
            <SelectItem key={d.id} value={d.device_id}>
              {userLabel ? `${userLabel(d.user_id)} · ` : ''}
              {d.model ?? d.platform ?? 'phone'} · {shortId(d.device_id)}
              {d.revoked_at ? ' (no longer allowed)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="Phone ID" className="font-mono text-xs" aria-label="Phone ID" />
    </div>
  );
}

/** "Resolved config for a user": all layers merged as a device of that user would receive them. */
export function ResolvedConfigPanel() {
  const [agentId, setAgentId] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [bankId, setBankId] = useState<string | null>(null);
  const [params, setParams] = useState<ConfigResolvedQuery | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const effectiveUser = userId.trim() || agentId || '';
  const resolved = useQuery({
    queryKey: ['config', 'resolved', params],
    queryFn: () => adminApi.config.resolved(params ?? {}),
    enabled: params !== null,
  });

  function run() {
    if (effectiveUser && !isUuid(effectiveUser)) return setFormError('That person ID isn’t valid. Pick an agent, or paste their full ID.');
    if (deviceId && !isUuid(deviceId)) return setFormError('That phone ID isn’t valid. Pick a phone, or paste its full ID.');
    if (!effectiveUser) return setFormError('Choose an agent, or paste a person’s ID.');
    setFormError(null);
    setParams({ user_id: effectiveUser, ...(deviceId ? { device_id: deviceId } : {}), ...(bankId ? { bank_id: bankId } : {}) });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">What one agent’s phone receives</CardTitle>
        <CardDescription>
          The default settings, then the settings for everyone, their bank, the agent and their phone, combined exactly as the phone gets them when it
          syncs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Agent" htmlFor="res-agent">
            <AgentSelect id="res-agent" value={agentId} onChange={(id) => setAgentId(id)} />
          </FormField>
          <FormField label="…or paste a person’s ID" htmlFor="res-user">
            <Input id="res-user" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Person ID" className="font-mono text-xs" />
          </FormField>
        </div>
        <FormField label="Phone (optional)" htmlFor="res-device">
          <DevicePicker id="res-device" value={deviceId} onChange={setDeviceId} userId={isUuid(effectiveUser) ? effectiveUser : null} />
        </FormField>
        <FormField label="Bank (optional)" htmlFor="res-bank" hint="For agents who work for more than one bank.">
          <BankSelect id="res-bank" value={bankId} onChange={setBankId} allowAll allLabel="Not specified" />
        </FormField>
        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        <Button type="button" onClick={run} loading={resolved.isFetching}>
          {resolved.isFetching ? null : <Search />} Show the settings
        </Button>
        {resolved.error ? <ApiErrorAlert error={resolved.error} /> : null}
        {resolved.data ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              Settings version ID:{' '}
              {resolved.data.config_version_id ? (
                <>
                  <code>{resolved.data.config_version_id}</code>
                  <CopyButton value={resolved.data.config_version_id} title="Copy the settings version ID" />
                </>
              ) : (
                '—'
              )}
            </p>
            <JsonView value={resolved.data.values} defaultExpandDepth={1} maxHeight={420} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const VALUE_WORDS: Record<string, string> = { native: 'Phone app', web: 'Web app' };

function OnOff({ value }: { value: unknown }) {
  if (value === true) return <Badge tone="success" className="px-2 text-sm">On</Badge>;
  if (value === false) return <Badge tone="danger" className="px-2 text-sm">Off</Badge>;
  if (value === undefined || value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge tone="neutral" className="px-2 text-sm">
      {VALUE_WORDS[String(value)] ?? String(value)}
    </Badge>
  );
}

/** Read-only summary of the kill switches, features and update gates in force for everyone (docs/13 §4, §6). */
export function KillSwitchesCard() {
  const advanced = useIsAdvanced();
  const q = useQuery({ queryKey: ['config', 'resolved', 'global'], queryFn: () => adminApi.config.resolved({}), refetchInterval: 120_000 });
  const values = q.data?.values;
  const features = values ? getPath(values, 'features') : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Power className="size-5" /> What’s switched on for everyone right now
        </CardTitle>
        <CardDescription className="text-sm">
          The default settings plus the settings for everyone{q.dataUpdatedAt ? `, checked ${formatDateTime(q.dataUpdatedAt)}` : ''}. A bank, an agent or a phone
          can have a setting of its own. None of these ever stops finished work from uploading.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.error ? <ApiErrorAlert error={q.error} onRetry={() => void q.refetch()} /> : null}
        {q.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : values ? (
          <div className="space-y-5 text-sm">
            <ul className="space-y-3">
              {KILL_SWITCH_KEYS.map((k) => (
                <li key={k.path} className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-medium">{k.label}</div>
                    <div className="text-sm text-muted-foreground">
                      {k.help}
                      {advanced ? <code className="ml-1 text-xs">({k.path})</code> : null}
                    </div>
                  </div>
                  <OnOff value={getPath(values, k.path)} />
                </li>
              ))}
            </ul>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-muted-foreground">Optional features</p>
              {isPlainObject(features) && Object.keys(features).length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {Object.entries(features).map(([k, v]) => (
                    <li key={k} className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                      {humanLabel(k)}
                      {advanced ? <code className="text-xs text-muted-foreground">features.{k}</code> : null} <OnOff value={v} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No optional features set.</p>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-muted-foreground">App version rules</p>
              <ul className="space-y-1.5">
                {MIN_VERSION_KEYS.map((k) => {
                  const v = getPath(values, k.path);
                  return (
                    <li key={k.path} className="flex justify-between gap-3 text-sm">
                      <span>
                        {k.label}
                        {advanced ? <code className="ml-1 text-xs text-muted-foreground">({k.path})</code> : null}
                      </span>
                      <span className="font-mono">{v === '0.0.0' ? 'Off' : String(v ?? '—')}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
