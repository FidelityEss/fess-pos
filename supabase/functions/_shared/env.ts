// Environment for the POS API and workers. Supabase injects SUPABASE_* into every function.
// Secrets (signing keys, worker key) come from Vault via pos_rpc.secret_value() — see secrets.ts.

function first(...names: string[]): string | undefined {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v && v.length > 0) return v;
  }
  return undefined;
}

function keysFromJson(name: string): string[] {
  const raw = Deno.env.get(name);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return Object.values(parsed as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
  } catch {
    // not JSON: a single key
    return [raw];
  }
  return [];
}

export const env = {
  supabaseUrl: first('SUPABASE_URL') ?? 'http://127.0.0.1:54321',
  /** Origin devices use to reach Storage (signed upload URLs). Locally the functions see http://kong:8000. */
  publicSupabaseUrl: first('POS_PUBLIC_SUPABASE_URL', 'SUPABASE_URL') ?? 'http://127.0.0.1:54321',
  dbUrl: first('SUPABASE_DB_URL') ?? '',
  serviceKey: first('SUPABASE_SERVICE_ROLE_KEY') ?? keysFromJson('SUPABASE_SECRET_KEYS')[0] ?? '',
  /** Keys a client may present as `apikey`: legacy anon JWT and/or sb_publishable_… keys. */
  publishableKeys: [first('SUPABASE_ANON_KEY'), ...keysFromJson('SUPABASE_PUBLISHABLE_KEYS')].filter((k): k is string => !!k),
  posEnv: first('POS_ENV') ?? 'staging',
  adminOrigins: (first('POS_ADMIN_ORIGINS') ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
  apiVersion: '1',
  build: first('POS_BUILD') ?? 'dev',
};

export const TOKEN_ISSUER = 'fess-pos-api';
export const TOKEN_AUDIENCE = 'fess-pos';
