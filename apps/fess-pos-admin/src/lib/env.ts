import { z } from 'zod';

/** Public (browser) environment, validated once. NEXT_PUBLIC_* vars must be referenced literally so Next inlines them. */
const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_POS_API_URL: z.string().url(),
  NEXT_PUBLIC_MAP_STYLE_URL: z.string().url(),
  NEXT_PUBLIC_ENV_NAME: z.enum(['local', 'qa', 'staging', 'production']),
});

export type EnvName = 'local' | 'qa' | 'staging' | 'production';

export interface AppEnv {
  supabaseUrl: string;
  publishableKey: string;
  /** Base of the POS API, e.g. http://127.0.0.1:54321/functions/v1/api (paths start with /v1/…). */
  posApiUrl: string;
  mapStyleUrl: string;
  envName: EnvName;
  isProduction: boolean;
}

function loadEnv(): AppEnv {
  const parsed = EnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_POS_API_URL: process.env.NEXT_PUBLIC_POS_API_URL,
    NEXT_PUBLIC_MAP_STYLE_URL: process.env.NEXT_PUBLIC_MAP_STYLE_URL,
    NEXT_PUBLIC_ENV_NAME: process.env.NEXT_PUBLIC_ENV_NAME,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(
      `fess-pos-admin: invalid or missing environment variables.\n${problems}\n` +
        'Copy apps/fess-pos-admin/.env.example to .env.local and fill in the values.',
    );
  }
  const e = parsed.data;
  return {
    supabaseUrl: e.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    posApiUrl: e.NEXT_PUBLIC_POS_API_URL.replace(/\/+$/, ''),
    mapStyleUrl: e.NEXT_PUBLIC_MAP_STYLE_URL,
    envName: e.NEXT_PUBLIC_ENV_NAME,
    isProduction: e.NEXT_PUBLIC_ENV_NAME === 'production',
  };
}

export const env: AppEnv = loadEnv();
