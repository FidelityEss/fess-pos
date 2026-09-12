'use client';

// PostgREST reads shared by the administration screens (schema `pos`, under RLS).
import { useQuery } from '@tanstack/react-query';
import { isUuid } from '@/lib/hooks';
import { fetchRows, pos } from '@/lib/supabase';
import type { DeviceSyncStatus, PosUser, ReasonCode, TrustedIssuer } from '@/lib/types';

export type UserOption = Pick<PosUser, 'id' | 'employee_number' | 'first_name' | 'last_name' | 'email' | 'role' | 'active' | 'bank_ids'>;

export type SyncStatusRow = Pick<
  DeviceSyncStatus,
  'device_id' | 'pending_total' | 'oldest_pending_at' | 'received_at' | 'last_success_at' | 'module_version'
>;

/** Query keys; each starts with the table name so `invalidateQueries({ queryKey: ['<table>'] })` refreshes them. */
export const adminKeys = {
  reasonCodesAll: ['reason_codes', 'admin-all'] as const,
  userOptions: ['users', 'options'] as const,
  issuers: ['trusted_issuers'] as const,
  syncStatusForUser: (userId: string | null) => ['device_sync_status', 'user', userId] as const,
};

/** Every reason code (global and bank, active and inactive), by category then sort order. */
export function useAllReasonCodes() {
  return useQuery({
    queryKey: adminKeys.reasonCodesAll,
    queryFn: () => fetchRows<ReasonCode>(pos().from('reason_codes').select('*').order('category').order('sort_order').order('label')),
    staleTime: 60_000,
  });
}

/** Users for pickers (all roles, active and inactive; first 2000 by name). */
export function useUserOptions() {
  return useQuery({
    queryKey: adminKeys.userOptions,
    queryFn: () =>
      fetchRows<UserOption>(
        pos()
          .from('pos_users')
          .select('id,employee_number,first_name,last_name,email,role,active,bank_ids')
          .order('last_name')
          .order('first_name')
          .limit(2000),
      ),
    staleTime: 60_000,
  });
}

/** Trusted issuers by key. */
export function useTrustedIssuers() {
  return useQuery({
    queryKey: adminKeys.issuers,
    queryFn: () => fetchRows<TrustedIssuer>(pos().from('trusted_issuers').select('*').order('key')),
    staleTime: 60_000,
  });
}

/** Last sync report per device for a user (pending counts, docs/12). */
export function useSyncStatusForUser(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: adminKeys.syncStatusForUser(userId),
    queryFn: () =>
      fetchRows<SyncStatusRow>(
        pos()
          .from('device_sync_status')
          .select('device_id,pending_total,oldest_pending_at,received_at,last_success_at,module_version')
          .eq('user_id', userId ?? '')
          .order('received_at', { ascending: false }),
      ),
    enabled: enabled && isUuid(userId),
  });
}
