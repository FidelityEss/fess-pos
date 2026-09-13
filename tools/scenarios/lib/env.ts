// Where the scenario tools point (docs/15): POS_TARGET = qa (the default) | production. Targets are fixed to our two
// projects by ref, so a typo can never reach another project. The local Docker stack is retired (D-48). Keys come from
// the environment: POS_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY only where a tool needs it.

/** Our projects (instructions §10). Nothing else is ever targeted. */
export const PROJECT_REFS = {
  qa: 'ysbgdxhdexpjvmlnjofc', // fess-pos-qa — QA / testing (dummy data)
  production: 'zqunqunjdjhyriqsvzfr', // fess-pos — PRODUCTION (no test data, no seeders)
} as const;

export type Target = keyof typeof PROJECT_REFS;

const raw = (Deno.env.get('POS_TARGET') ?? 'qa').toLowerCase();
if (!Object.hasOwn(PROJECT_REFS, raw)) throw new Error(`POS_TARGET must be qa or production (got "${raw}")`);
export const target = raw as Target;

function required(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is required when POS_TARGET=${target}`);
  return v;
}

export const env = {
  ref: PROJECT_REFS[target],
  supabaseUrl: `https://${PROJECT_REFS[target]}.supabase.co`,
  publishableKey: required('POS_PUBLISHABLE_KEY'),
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
