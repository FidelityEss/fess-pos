'use client';

// Shared TanStack Query hooks over PostgREST reads (schema `pos`, under RLS).
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { DbError, fetchRows, pos } from './supabase';
import type { Bank, DefinitionDraft, JsonObject, MccCode, PosUser, ReasonCategory, ReasonCode } from './types';

export { useMe, useStaff } from './staff';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID string (use before interpolating ids into PostgREST filters). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Query keys used by the shared hooks — invalidate by prefix, e.g. `{ queryKey: ['banks'] }`. */
export const queryKeys = {
  me: ['me'] as const,
  banks: (includeInactive = false) => ['banks', { includeInactive }] as const,
  reasonCodes: (category: ReasonCategory, bankId?: string | null) => ['reason_codes', category, bankId ?? null] as const,
  agents: (bankId?: string | null) => ['agents', bankId ?? null] as const,
  mccCodes: ['mcc_codes'] as const,
  dashboard: ['dashboard'] as const,
  queues: ['queues'] as const,
};

/** Banks visible to the user (RLS-scoped), sorted by name. Active only unless includeInactive. */
export function useBanks(options: { includeInactive?: boolean } = {}): UseQueryResult<Bank[], Error> {
  const includeInactive = options.includeInactive ?? false;
  return useQuery({
    queryKey: queryKeys.banks(includeInactive),
    queryFn: () => {
      const q = pos().from('banks').select('*');
      return fetchRows<Bank>((includeInactive ? q : q.eq('active', true)).order('name'));
    },
    staleTime: 5 * 60_000,
  });
}

/** Lookup function bank id → Bank (includes inactive banks). */
export function useBankLookup(): (bankId: string | null | undefined) => Bank | undefined {
  const { data } = useBanks({ includeInactive: true });
  const byId = useMemo(() => new Map((data ?? []).map((b) => [b.id, b])), [data]);
  return useCallback((bankId) => (bankId ? byId.get(bankId) : undefined), [byId]);
}

/**
 * Active reason codes for a category: global codes plus the bank's own (a bank code overrides a global code
 * with the same `code`), sorted by sort_order then label. Without bankId, global codes only.
 */
export function useReasonCodes(category: ReasonCategory, bankId?: string | null): UseQueryResult<ReasonCode[], Error> {
  const bank = isUuid(bankId) ? bankId : null;
  return useQuery({
    queryKey: queryKeys.reasonCodes(category, bank),
    queryFn: async () => {
      const base = pos().from('reason_codes').select('*').eq('category', category).eq('active', true);
      const rows = await fetchRows<ReasonCode>(bank ? base.or(`bank_id.is.null,bank_id.eq.${bank}`) : base.is('bank_id', null));
      const byCode = new Map<string, ReasonCode>();
      for (const r of rows) {
        const existing = byCode.get(r.code);
        if (!existing || (existing.bank_id === null && r.bank_id !== null)) byCode.set(r.code, r);
      }
      return [...byCode.values()].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
    },
    staleTime: 5 * 60_000,
  });
}

/** Active pos_agent users allowed to work for a bank (bank_ids null or containing it); all active agents without bankId. */
export function useAgents(bankId?: string | null): UseQueryResult<PosUser[], Error> {
  const bank = isUuid(bankId) ? bankId : null;
  return useQuery({
    queryKey: queryKeys.agents(bank),
    queryFn: () => {
      const base = pos().from('pos_users').select('*').eq('role', 'pos_agent').eq('active', true);
      const filtered = bank ? base.or(`bank_ids.is.null,bank_ids.cs.{${bank}}`) : base;
      return fetchRows<PosUser>(filtered.order('last_name').order('first_name'));
    },
    staleTime: 60_000,
  });
}

/** Active MCC codes sorted by code. */
export function useMccCodes(): UseQueryResult<MccCode[], Error> {
  return useQuery({
    queryKey: queryKeys.mccCodes,
    queryFn: () => fetchRows<MccCode>(pos().from('mcc_codes').select('*').eq('active', true).order('code')),
    staleTime: 10 * 60_000,
  });
}

/** Save the mutable working copy of a definition (the one direct table write the panel makes, docs/03 §5). */
export async function upsertDefinitionDraft(draft: {
  family_id: string;
  definition: JsonObject;
  base_version_id: string | null;
  updated_by: string;
}): Promise<DefinitionDraft> {
  const { data, error } = await pos()
    .from('definition_drafts')
    .upsert(draft, { onConflict: 'family_id' })
    .select('*')
    .single();
  if (error) throw new DbError(error);
  return data as DefinitionDraft;
}
