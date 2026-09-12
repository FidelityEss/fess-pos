'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { AgentSelect } from '@/components/agent-select';
import { BankSelect } from '@/components/bank-select';
import { ApprovalsPanel } from '@/components/definitions/approvals-panel';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { SectionTitle, useUserLookup } from '@/components/ops/ops-shared';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { employeeName, shortId } from '@/lib/format';
import { isUuid, useBankLookup } from '@/lib/hooks';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { CONFIG_LAYERS, type ConfigLayer } from '@/lib/types';
import { DevicePicker, KillSwitchesCard, ResolvedConfigPanel } from './config-side-panels';
import { LayerPanel } from './layer-panel';

const LAYER_TAB: Record<ConfigLayer, string> = {
  global: 'Everyone (global)',
  bank: 'One bank',
  agent: 'One agent',
  device: 'One device',
};

const LAYER_HELP: Record<ConfigLayer, string> = {
  global: 'These settings apply to every agent, unless a bank, agent or device setting says otherwise.',
  bank: 'Settings here replace the global ones for agents working for this bank. Anything not set here is inherited.',
  agent: 'Settings here replace the bank and global ones for one agent. Anything not set here is inherited.',
  device: 'Settings here replace everything else for one phone. Anything not set here is inherited.',
};

/** /config — App settings: the layered remote config (docs/13 §5–6) with a typed editor and a live phone preview. */
export function ConfigView() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const bankLookup = useBankLookup();
  const userLookup = useUserLookup();
  const [chosenLayer, setLayer] = useState<ConfigLayer>('global');
  const [bankId, setBankId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');

  // Device settings are a technical tool: Advanced view only.
  const layer: ConfigLayer = chosenLayer === 'device' && !advanced ? 'global' : chosenLayer;
  const layers = CONFIG_LAYERS.filter((l) => advanced || l !== 'device');
  const subjectId = layer === 'global' ? null : layer === 'bank' ? bankId : layer === 'agent' ? agentId : isUuid(deviceId) ? deviceId : null;
  const canPublish = staff.isAdmin && (layer === 'global' ? staff.isGlobalAdmin : layer === 'bank' ? staff.canAccessBank(bankId) : true);
  const subjectLabel =
    layer === 'global'
      ? 'Settings for everyone'
      : layer === 'bank'
        ? `Bank: ${bankLookup(bankId)?.name ?? ''}`
        : layer === 'agent'
          ? `Agent: ${employeeName(userLookup(agentId))}`
          : `Device ${shortId(deviceId)}`;

  return (
    <>
      <PageHeader
        title="App settings"
        description="How the phone app behaves: kill switches, location checks, photo quality, sync and more. Set them for everyone, then adjust them for a bank or an agent. The most specific setting wins."
      />

      <Tabs value={layer} onValueChange={(v) => setLayer(v as ConfigLayer)}>
        <TabsList className="h-11">
          {layers.map((l) => (
            <TabsTrigger key={l} value={l} className="h-11 text-base">
              {LAYER_TAB[l]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <p className="mb-4 mt-2 text-sm text-muted-foreground">{LAYER_HELP[layer]}</p>

      {layer !== 'global' ? (
        <Card className="mb-5">
          <CardContent className="max-w-2xl pt-4">
            {layer === 'bank' ? (
              <FormField label="Bank" htmlFor="cfg-bank" required>
                <BankSelect id="cfg-bank" value={bankId} onChange={setBankId} includeInactive />
              </FormField>
            ) : layer === 'agent' ? (
              <FormField label="Agent" htmlFor="cfg-agent" required>
                <AgentSelect id="cfg-agent" value={agentId} onChange={(id) => setAgentId(id)} />
              </FormField>
            ) : (
              <FormField label="Device" htmlFor="cfg-device" required error={deviceId && !isUuid(deviceId) ? 'Must be a UUID (the module device id)' : null}>
                <DevicePicker id="cfg-device" value={deviceId} onChange={setDeviceId} userLabel={(uid) => employeeName(userLookup(uid))} />
              </FormField>
            )}
          </CardContent>
        </Card>
      ) : null}

      {layer === 'global' || subjectId ? (
        <LayerPanel key={`${layer}:${subjectId ?? ''}`} layer={layer} subjectId={subjectId} canPublish={canPublish} subjectLabel={subjectLabel} />
      ) : (
        <Card>
          <EmptyState icon={SlidersHorizontal} title={`Choose ${layer === 'agent' ? 'an agent' : `a ${layer}`}`} description={`Pick the ${layer} whose settings you want to see or change.`} />
        </Card>
      )}

      <section className="mt-10">
        <SectionTitle>Waiting for approval</SectionTitle>
        <ApprovalsPanel subjectTypes={['remote_config', 'block_in_progress']} emptyText="No settings changes are waiting for a second admin." />
      </section>

      <div className={advanced ? 'mt-8 grid gap-4 2xl:grid-cols-2' : 'mt-8 max-w-3xl'}>
        {advanced ? <ResolvedConfigPanel /> : null}
        <KillSwitchesCard />
      </div>
    </>
  );
}
