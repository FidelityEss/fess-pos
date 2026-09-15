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
  status?: number;
}

/** A 401 from PostgREST: the request went out without a valid user token (anonymous or expired JWT). */
function isUnauthorised(r: PostgrestLikeResult): boolean {
  return !!r.error && (r.status === 401 || r.error.code === 'PGRST301' || r.error.code === 'PGRST303');
}

/**
 * Run a PostgREST query; on a 401, make sure the session is restored (and refreshed) and run it once more (T2-30: the
 * first read right after a page load could go out before the stored session was restored, and fail with a 401).
 * PostgREST builders are lazy — awaiting one again re-sends the request. Anything else is returned as is.
 */
async function runWithSession(query: PromiseLike<PostgrestLikeResult>): Promise<PostgrestLikeResult> {
  const first = await query;
  if (!isUnauthorised(first)) return first;
  const auth = getSupabase().auth;
  const { data } = await auth.getSession();
  if (!data.session) return first;
  const second = await query;
  if (!isUnauthorised(second)) return second;
  const refreshed = await auth.refreshSession();
  return refreshed.error ? second : await query;
}

/** Await a PostgREST query and return its rows typed as T[] (throws DbError). */
export async function fetchRows<T>(query: PromiseLike<PostgrestLikeResult>): Promise<T[]> {
  const { data, error } = await runWithSession(query);
  if (error) throw new DbError(error);
  return (data ?? []) as T[];
}

/** Await a `.maybeSingle()` query and return the row or null (throws DbError). */
export async function fetchMaybeRow<T>(query: PromiseLike<PostgrestLikeResult>): Promise<T | null> {
  const { data, error } = await runWithSession(query);
  if (error) throw new DbError(error);
  return (data ?? null) as T | null;
}

/** Await a `select('…', { count: 'exact', head: true })` query and return the count (throws DbError). */
export async function fetchCount(query: PromiseLike<PostgrestLikeResult & { count?: number | null }>): Promise<number> {
  const result = (await runWithSession(query)) as PostgrestLikeResult & { count?: number | null };
  if (result.error) throw new DbError(result.error);
  return result.count ?? 0;
}

/** Call a read RPC in the `pos` schema and return its result typed as T (throws DbError). */
export async function callRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await runWithSession(pos().rpc(name, args ?? {}));
  if (error) throw new DbError(error);
  return data as T;
}
