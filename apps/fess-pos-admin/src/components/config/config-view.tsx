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

// Layers read as who a setting applies to (docs/17 §4.4): "For everyone", "For one bank", "For one agent", "For one phone".
const LAYER_TAB: Record<ConfigLayer, string> = {
  global: 'For everyone',
  bank: 'For one bank',
  agent: 'For one agent',
  device: 'For one phone',
};

const LAYER_HELP: Record<ConfigLayer, string> = {
  global: 'These settings apply to every agent, unless their bank, the agent or their phone has a setting of its own.',
  bank: 'A setting here replaces the one for everyone, for the agents who work for this bank. Anything you don’t set here stays as it is for everyone.',
  agent: 'A setting here replaces the bank’s setting and the one for everyone, for this agent only. Anything you don’t set here stays as it is for their bank.',
  device: 'A setting here replaces all the others, for one phone only. Anything you don’t set here stays as it is for the agent.',
};

const CHOOSE: Record<ConfigLayer, { title: string; description: string }> = {
  global: { title: 'Choose who these settings are for', description: '' },
  bank: { title: 'Choose a bank', description: 'Pick the bank whose settings you want to see or change.' },
  agent: { title: 'Choose an agent', description: 'Pick the agent whose settings you want to see or change.' },
  device: { title: 'Choose a phone', description: 'Pick the phone whose settings you want to see or change.' },
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
  const agent = userLookup(agentId);
  const subjectName =
    layer === 'global'
      ? 'everyone'
      : layer === 'bank'
        ? (bankLookup(bankId)?.name ?? 'this bank')
        : layer === 'agent'
          ? agent
            ? employeeName(agent)
            : 'this agent'
          : 'this phone';
  const subjectLabel = layer === 'device' ? `Settings for phone ${shortId(deviceId)}` : `Settings for ${subjectName}`;

  return (
    <>
      <PageHeader title="App settings" />

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
              <FormField
                label="Phone"
                htmlFor="cfg-device"
                required
                error={deviceId && !isUuid(deviceId) ? 'That isn’t a whole phone ID. Pick a phone from the list, or paste its full ID.' : null}
              >
                <DevicePicker id="cfg-device" value={deviceId} onChange={setDeviceId} userLabel={(uid) => employeeName(userLookup(uid))} />
              </FormField>
            )}
          </CardContent>
        </Card>
      ) : null}

      {layer === 'global' || subjectId ? (
        <LayerPanel
          key={`${layer}:${subjectId ?? ''}`}
          layer={layer}
          subjectId={subjectId}
          canPublish={canPublish}
          subjectLabel={subjectLabel}
          subjectName={subjectName}
        />
      ) : (
        <Card>
          <EmptyState icon={SlidersHorizontal} title={CHOOSE[layer].title} description={CHOOSE[layer].description} />
        </Card>
      )}

      <section className="mt-10">
        <SectionTitle>Waiting for approval</SectionTitle>
        <p className="-mt-1 mb-3 text-sm text-muted-foreground">Changes that affect security wait here until a second person approves them.</p>
        <ApprovalsPanel subjectTypes={['remote_config', 'block_in_progress']} emptyText="No settings changes are waiting for a second person to approve them." />
      </section>

      <div className={advanced ? 'mt-8 grid gap-4 2xl:grid-cols-2' : 'mt-8 max-w-3xl'}>
        {advanced ? <ResolvedConfigPanel /> : null}
        <KillSwitchesCard />
      </div>
    </>
  );
}
