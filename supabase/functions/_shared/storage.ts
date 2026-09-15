// Storage through the service client, used only inside the API and workers (docs/03 §4, docs/05 §9).
// Buckets are private with no client policies: devices upload through server-issued signed upload URLs for the
// exact server-derived path (never overwritten); admins read through signed URLs valid ≤ 15 min.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.ts';
import { PosError } from './errors.ts';

let client: SupabaseClient | null = null;
export function service(): SupabaseClient {
  if (!client) {
    if (!env.serviceKey) throw new PosError('UNAVAILABLE', 'service key not configured');
    client = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

function publicUrl(url: string): string {
  if (env.publicSupabaseUrl === env.supabaseUrl) return url;
  return url.replace(env.supabaseUrl, env.publicSupabaseUrl);
}

export type UploadGrant = { exists: true } | { exists: false; signedUrl: string; token: string; path: string };

export async function createUploadGrant(bucket: string, path: string): Promise<UploadGrant> {
  const { data, error } = await service().storage.from(bucket).createSignedUploadUrl(path);
  if (error) {
    if (/exist/i.test(error.message)) return { exists: true };
    throw new PosError('UNAVAILABLE', 'storage unavailable');
  }
  return { exists: false, signedUrl: publicUrl(data.signedUrl), token: data.token, path: data.path };
}

export async function download(bucket: string, path: string): Promise<Uint8Array | null> {
  const { data, error } = await service().storage.from(bucket).download(path);
  if (error || !data) {
    const status = (error as { statusCode?: string; status?: number } | null)?.status;
    if (status === 400 || status === 404 || /not.?found|does not exist/i.test(error?.message ?? '')) return null;
    throw new PosError('UNAVAILABLE', `storage download failed: ${error?.message ?? 'unknown'}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

export async function uploadOnce(bucket: string, path: string, bytes: Uint8Array | Blob, contentType: string): Promise<'created' | 'exists'> {
  const { error } = await service().storage.from(bucket).upload(path, bytes, { upsert: false, contentType });
  if (!error) return 'created';
  if (/exist|duplicate/i.test(error.message)) return 'exists';
  throw new PosError('UNAVAILABLE', `storage upload failed: ${error.message}`);
}

export async function exists(bucket: string, path: string): Promise<boolean> {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash) : '';
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const { data, error } = await service().storage.from(bucket).list(dir, { search: name, limit: 5 });
  if (error) throw new PosError('UNAVAILABLE', `storage list failed: ${error.message}`);
  return (data ?? []).some((o) => o.name === name);
}

/** A read link valid ≤ 15 min. With `downloadAs`, the browser saves the file under that name (exports, T6-03). */
export async function signedReadUrl(bucket: string, path: string, expiresInSeconds = 900, downloadAs?: string): Promise<string> {
  const { data, error } = await service().storage.from(bucket)
    .createSignedUrl(path, Math.min(expiresInSeconds, 900), downloadAs ? { download: downloadAs } : undefined);
  if (error || !data) throw new PosError('NOT_FOUND', 'object not found');
  return publicUrl(data.signedUrl);
}
