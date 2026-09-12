// Where the scenario tools point (docs/15): POS_TARGET = qa (default for remote work) | production | local (retired
// Docker stack; kept only for the historical smoke script). Remote targets are fixed to our two projects by ref, so a typo
// can never reach another project. Keys come from the environment (POS_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY).

// Public Supabase CLI demo keys — valid only against a local stack.
const LOCAL_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const LOCAL = {
  supabaseUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
  dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
};

/** Our projects (instructions §10). Nothing else is ever targeted. */
export const PROJECT_REFS = {
  qa: 'ysbgdxhdexpjvmlnjofc', // fess-pos-qa — QA / testing (dummy data)
  production: 'zqunqunjdjhyriqsvzfr', // fess-pos — PRODUCTION (no test data, no seeders)
} as const;

export type Target = 'local' | keyof typeof PROJECT_REFS;

const raw = (Deno.env.get('POS_TARGET') ?? 'qa').toLowerCase();
if (!['local', 'qa', 'production'].includes(raw)) throw new Error(`POS_TARGET must be qa, production or local (got "${raw}")`);
export const target = raw as Target;

function required(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is required when POS_TARGET=${target}`);
  return v;
}

export const env = target === 'local'
  ? { ...LOCAL, serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? LOCAL_SERVICE_KEY, ref: 'local' }
  : {
    ref: PROJECT_REFS[target],
    supabaseUrl: `https://${PROJECT_REFS[target]}.supabase.co`,
    publishableKey: required('POS_PUBLISHABLE_KEY'),
    dbUrl: '',
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  };

/** Tools that create or wipe test data call this first: production is never a test target. */
export function refuseProduction(tool: string): void {
  if (target === 'production') {
    throw new Error(`${tool} never runs against PRODUCTION (fess-pos ${PROJECT_REFS.production}). Use POS_TARGET=qa.`);
  }
}

export const apiUrl = `${env.supabaseUrl}/functions/v1/api`;
export const functionsUrl = `${env.supabaseUrl}/functions/v1`;
