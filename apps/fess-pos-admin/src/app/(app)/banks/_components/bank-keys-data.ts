// Bank API keys and the bank's recent calls (T6-06, D-100, B6.9). Keys are made, listed and switched off through the POS
// API (/v1/admin/banks/:id/api-keys, /v1/admin/api-keys/:id/revoke); the call record is read under RLS
// (pos.bank_api_calls: admins with the bank in scope).
import { api } from '@/lib/api';
import { env } from '@/lib/env';
import { fetchRows, pos } from '@/lib/supabase';

export type BankApiKeyStatus = 'active' | 'expired' | 'revoked';

/** A key as the admin API lists it: never the key itself or its fingerprint. */
export interface BankApiKey {
  id: string;
  bank_id: string;
  label: string;
  active: boolean;
  status: BankApiKeyStatus;
  last_four: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  rate_limit_per_minute: number | null;
  calls_last_24h: number;
}

/** The create response: the key row plus the key itself, shown once. */
export interface NewBankApiKey extends BankApiKey {
  key: string;
}

export interface BankApiCall {
  id: string;
  key_id: string;
  at: string;
  method: string;
  route: string;
  status: number;
  items: number | null;
}

export const bankKeyKeys = {
  list: (bankId: string) => ['bank-api-keys', bankId] as const,
  calls: (bankId: string) => ['bank-api-calls', bankId] as const,
};

const A = '/v1/admin';
const id = encodeURIComponent;

export const bankKeysApi = {
  list: (bankId: string) => api<BankApiKey[]>('GET', `${A}/banks/${id(bankId)}/api-keys`),
  create: (bankId: string, body: { name: string; expires_in_months: number }) =>
    api<NewBankApiKey>('POST', `${A}/banks/${id(bankId)}/api-keys`, body),
  revoke: (keyId: string, reason: string) => api<BankApiKey>('POST', `${A}/api-keys/${id(keyId)}/revoke`, { reason }),
};

export function fetchBankCalls(bankId: string, limit = 25): Promise<BankApiCall[]> {
  return fetchRows<BankApiCall>(
    pos().from('bank_api_calls').select('id,key_id,at,method,route,status,items').eq('bank_id', bankId).order('at', { ascending: false }).limit(limit),
  );
}

/** Where a bank's system sends its requests: the POS API's /v1/bank. */
export function bankApiBase(): string {
  return `${env.posApiUrl}/v1/bank`;
}

/** How long a new key can work for, in months. The server enforces the maximum (bank_api.key_max_months). */
export const KEY_MONTHS = [1, 3, 6, 12, 18, 24] as const;
export const DEFAULT_KEY_MONTHS = 12;

/** What a call did, in words, from its route. Unknown routes show as they are. */
export function callName(method: string, route: string): string {
  const r = route.replace(/^\/v1\/bank/, '');
  if (method === 'GET' && r === '/inspections') return 'Checked for new or changed visits';
  if (method === 'GET' && r === '/inspections/:id') return 'Read one visit';
  if (method === 'POST' && r === '/exports') return 'Asked for an export';
  if (method === 'GET' && r === '/exports') return 'Listed its exports';
  if (method === 'GET' && r === '/exports/:id') return 'Checked on an export';
  return `${method} ${route}`;
}

/** The result of a call, in words. */
export function callResult(status: number): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (status >= 200 && status < 300) return { label: 'Answered', tone: 'success' };
  if (status === 401) return { label: 'Refused: key not accepted', tone: 'danger' };
  if (status === 403) return { label: 'Refused: bank access is off', tone: 'danger' };
  if (status === 404) return { label: 'Not found', tone: 'neutral' };
  if (status === 429) return { label: 'Too many requests', tone: 'warning' };
  if (status >= 500) return { label: 'Failed on our side', tone: 'danger' };
  return { label: `Refused (${status})`, tone: 'warning' };
}
