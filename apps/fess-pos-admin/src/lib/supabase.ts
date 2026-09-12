import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

// Browser Supabase client. Reads only (PostgREST under RLS) plus Auth; all writes go through the POS API,
// except definition_drafts (docs/03 §5). The browser session is the source of truth — no server-side auth.

let client: SupabaseClient | null = null;

/** The singleton Supabase client (lazily created so SSR prerendering never touches auth storage). */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'fess-pos-admin.auth',
      },
    });
  }
  return client;
}

/** PostgREST access to the `pos` schema: `pos().from('jobs')…`, `pos().rpc('admin_dashboard')`. */
export function pos() {
  return getSupabase().schema('pos');
}

/** Current Supabase access token, or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Shape of a PostgREST error (PostgrestError). */
export interface PostgrestErrorLike {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/** A PostgREST / RPC failure as a real Error (instanceof-checkable, with code/details/hint). */
export class DbError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(e: PostgrestErrorLike) {
    super(e.message || 'Database request failed');
    this.name = 'DbError';
    this.code = e.code ?? 'UNKNOWN';
    this.details = e.details ?? null;
    this.hint = e.hint ?? null;
  }

  /** True when PostgREST could not find the RPC function (e.g. a migration not yet applied). */
  get isMissingFunction(): boolean {
    return this.code === 'PGRST202' || this.code === '42883';
  }
}

interface PostgrestLikeResult {
  data: unknown;
  error: PostgrestErrorLike | null;
}

/** Await a PostgREST query and return its rows typed as T[] (throws DbError). */
export async function fetchRows<T>(query: PromiseLike<PostgrestLikeResult>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new DbError(error);
  return (data ?? []) as T[];
}

/** Await a `.maybeSingle()` query and return the row or null (throws DbError). */
export async function fetchMaybeRow<T>(query: PromiseLike<PostgrestLikeResult>): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw new DbError(error);
  return (data ?? null) as T | null;
}

/** Call a read RPC in the `pos` schema and return its result typed as T (throws DbError). */
export async function callRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await pos().rpc(name, args ?? {});
  if (error) throw new DbError(error);
  return data as T;
}
