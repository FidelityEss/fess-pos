'use client';

// Reads for the App settings screen: layer versions, the values a layer inherits (defaults ⊕ the layers above it, as
// pos_rpc.resolve_config merges them: per layer the newest version already in effect), four-eyes for the layer, and
// the phone's content strings for the preview.
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { currentAllActivation, fetchActivations, fetchVersion } from '@/components/definitions/definitions-data';
import { usePosUsers } from '@/components/ops/ops-shared';
import { REMOTE_CONFIG_DEFAULTS } from '@/lib/engine';
import { employeeName } from '@/lib/format';
import { useBanks } from '@/lib/hooks';
import { fetchRows, pos } from '@/lib/supabase';
import type { ConfigLayer, JsonObject, RemoteConfigVersion } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';
import { cloneJson, deepMerge, getPath, hasPath } from './config-doc';

export const configKeys = {
  versions: (layer: ConfigLayer, subjectId: string | null) => ['config', 'versions', layer, subjectId] as const,
  inherited: (layer: ConfigLayer, subjectId: string | null, bankId: string | null, userId: string | null) =>
    ['config', 'inherited', layer, subjectId, bankId, userId] as const,
  deviceOwner: (deviceId: string | null) => ['config', 'device_owner', deviceId] as const,
  strings: ['config', 'content_strings'] as const,
};

export function fetchLayerVersions(layer: ConfigLayer, subjectId: string | null) {
  const q = pos().from('remote_config_versions').select('*').eq('layer', layer);
  return fetchRows<RemoteConfigVersion>((subjectId ? q.eq('subject_id', subjectId) : q.is('subject_id', null)).order('version', { ascending: false }));
}

/** The newest version of a layer that is already in effect (what devices receive now). */
async function latestInEffect(layer: ConfigLayer, subjectId: string | null): Promise<RemoteConfigVersion | null> {
  const q = pos().from('remote_config_versions').select('*').eq('layer', layer).lte('effective_from', new Date().toISOString());
  const rows = await fetchRows<RemoteConfigVersion>((subjectId ? q.eq('subject_id', subjectId) : q.is('subject_id', null)).order('version', { ascending: false }).limit(1));
  return rows[0] ?? null;
}

export interface InheritedLayer {
  layer: ConfigLayer;
  label: string;
  version: number;
  values: JsonObject;
}

export interface LayerInheritance {
  /** Layers above the edited one, most general first. */
  above: InheritedLayer[];
  /** Defaults ⊕ the layers above: what this layer inherits. */
  inherited: JsonObject;
  /** Who the inherited value at a path is set for: "Default", "everyone", the bank's name, the agent's name, or "Not set". */
  sourceOf: (path: string) => string;
  /** Whether integrity-relevant changes on this layer need a second admin (null while unknown). */
  fourEyes: boolean | null;
  /** Agents in several banks: which bank's layer is shown as inherited. */
  bankChoice: { options: { id: string; label: string }[]; value: string | null; onChange: (id: string) => void } | null;
  /** Name of the bank this layer's agents work for (bank layer, or the agent's bank), for the preview. */
  bankName: string | null;
  isPending: boolean;
  error: unknown;
  refetch: () => void;
}

export function useLayerInheritance(layer: ConfigLayer, subjectId: string | null): LayerInheritance {
  const users = usePosUsers();
  const banks = useBanks({ includeInactive: true });
  const deviceOwner = useQuery({
    queryKey: configKeys.deviceOwner(subjectId),
    enabled: layer === 'device' && !!subjectId,
    queryFn: async () =>
      (await fetchRows<{ user_id: string }>(pos().from('devices').select('user_id').eq('device_id', subjectId ?? '').order('last_seen_at', { ascending: false }).limit(1)))[0] ??
      null,
  });
  const userId = layer === 'agent' ? subjectId : layer === 'device' ? (deviceOwner.data?.user_id ?? null) : null;
  const user = userId ? users.data?.find((u) => u.id === userId) : undefined;
  const userBanks = useMemo(() => user?.bank_ids ?? [], [user]);
  const [pickedBank, setPickedBank] = useState<string | null>(null);
  const bankId = layer === 'bank' ? subjectId : pickedBank && userBanks.includes(pickedBank) ? pickedBank : (userBanks[0] ?? null);
  const bankById = (id: string | null) => (id ? banks.data?.find((b) => b.id === id) : undefined);

  const ready = layer === 'global' || layer === 'bank' || (users.isSuccess && (layer === 'agent' || deviceOwner.isSuccess));
  const q = useQuery({
    queryKey: configKeys.inherited(layer, subjectId, bankId, userId),
    enabled: ready,
    queryFn: async () => {
      const [global, bank, agent] = await Promise.all([
        latestInEffect('global', null),
        layer !== 'global' && layer !== 'bank' && bankId ? latestInEffect('bank', bankId) : Promise.resolve(null),
        layer === 'device' && userId ? latestInEffect('agent', userId) : Promise.resolve(null),
      ]);
      return { global, bank, agent };
    },
  });

  const bank = bankById(bankId);
  // Who each layer applies to, read as "Settings for …" / "Same as for …".
  const bankLabel = bank ? bank.name : 'the bank';
  const agentLabel = user ? employeeName(user) : 'the agent';

  const above = useMemo<InheritedLayer[]>(() => {
    if (!q.data) return [];
    const out: InheritedLayer[] = [];
    if (layer !== 'global' && q.data.global) out.push({ layer: 'global', label: 'everyone', version: q.data.global.version, values: q.data.global.values });
    if (q.data.bank) out.push({ layer: 'bank', label: bankLabel, version: q.data.bank.version, values: q.data.bank.values });
    if (q.data.agent) out.push({ layer: 'agent', label: agentLabel, version: q.data.agent.version, values: q.data.agent.values });
    return out;
  }, [q.data, layer, bankLabel, agentLabel]);

  const inherited = useMemo(() => above.reduce((acc, l) => deepMerge(acc, l.values), cloneJson(REMOTE_CONFIG_DEFAULTS) as JsonObject), [above]);

  const sourceOf = useMemo(
    () => (path: string) => {
      for (let i = above.length - 1; i >= 0; i -= 1) {
        const l = above[i];
        if (l && hasPath(l.values, path)) return l.label;
      }
      return hasPath(REMOTE_CONFIG_DEFAULTS, path) ? 'Default' : 'Not set';
    },
    [above],
  );

  const globalFourEyes = getPath(q.data?.global?.values, 'governance.four_eyes_global') === true;
  let fourEyes: boolean | null = null;
  if (q.data && banks.data) {
    if (layer === 'global') fourEyes = globalFourEyes;
    else if (layer === 'bank') fourEyes = globalFourEyes || bankById(subjectId)?.four_eyes_enabled === true;
    else fourEyes = globalFourEyes || userBanks.some((id) => bankById(id)?.four_eyes_enabled === true);
  }

  const bankChoice =
    (layer === 'agent' || layer === 'device') && userBanks.length > 1
      ? { options: userBanks.map((id) => ({ id, label: bankById(id)?.name ?? id })), value: bankId, onChange: setPickedBank }
      : null;

  const error = users.error ?? deviceOwner.error ?? q.error ?? null;
  return {
    above,
    inherited,
    sourceOf,
    fourEyes,
    bankChoice,
    bankName: bank?.name ?? null,
    isPending: !error && (!ready || q.isPending),
    error,
    refetch: () => void q.refetch(),
  };
}

// ── Content strings for the phone preview ───────────────────────────────────────────────────────
/** Used when the content definition is unavailable (same wording as the seeded core copy). */
export const FALLBACK_STRINGS: Record<string, string> = {
  'jobs.empty_active': 'No active leads. New assignments appear here.',
  'sync.synced': 'Synced',
  'sync.pending': '{{count}} items waiting to upload',
  'sync.needs_attention': 'Needs attention',
  'location.outside_fence': "You're outside the expected location for this merchant.",
  'location.sampling': 'Getting an accurate location… accuracy {{accuracy}} m',
  'location.checkin_prompt': 'Record your location outside the premises before you go in.',
  'update.required': 'Update FESS to start this inspection. Anything already captured will still upload.',
};

/** The active global content definition (kind content, key core) — the phone's real wording — over the fallbacks. */
export function useContentStrings(): Record<string, string> {
  const q = useQuery({
    queryKey: configKeys.strings,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const fam = (await fetchRows<{ id: string }>(pos().from('definition_families').select('id').eq('kind', 'content').eq('key', 'core').is('bank_id', null).limit(1)))[0];
      if (!fam) return {};
      const active = currentAllActivation(await fetchActivations(fam.id), Date.now());
      const versionId =
        active?.version_id ??
        (await fetchRows<{ id: string }>(pos().from('definition_versions').select('id').eq('family_id', fam.id).order('version', { ascending: false }).limit(1)))[0]?.id;
      const version = versionId ? await fetchVersion(versionId) : null;
      const strings = version?.definition?.strings;
      if (!isPlainObject(strings)) return {};
      return Object.fromEntries(Object.entries(strings).filter((e): e is [string, string] => typeof e[1] === 'string'));
    },
  });
  return useMemo(() => ({ ...FALLBACK_STRINGS, ...(q.data ?? {}) }), [q.data]);
}

/** "{{count}} items" + { count: 3 } → "3 items". */
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => (vars[name] !== undefined ? String(vars[name]) : ''));
}
