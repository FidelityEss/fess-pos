# fess-pos

Code for the FESS POS merchant site-verification feature: the host-agnostic Flutter module, its standalone Supabase backend (the **POS API**), and the standalone admin panel. The design and plan live outside this repo, in the POS planning pack.

| Path | What |
|------|------|
| `schema/` | Language-agnostic contract: JSON Schemas for definitions, rules, API envelopes, remote config, plus shared fixtures |
| `packages/fess_pos_engine_ts/` | TypeScript engine `@fess-pos/engine`: JCS hashing, rules engine, resolver, validator, analyser, test cases. Used by the API and the admin panel |
| `packages/fess_pos/`, `packages/fess_pos_engine/` | Flutter module and pure-Dart engine (not started yet) |
| `apps/fess-pos-admin/` | Admin panel (Next.js) |
| `supabase/migrations/` | Postgres schema `pos` (tables, RLS, triggers) and `pos_rpc` (every write path), linear and expand-only |
| `supabase/functions/api/` | POS API v1: auth, sync, ingest, evidence, public verify, admin |
| `supabase/functions/workers/` | Queue workers (verify/replicate evidence, notify, reprocess, sweep), kicked by pg_cron |
| `supabase/seed/` | Local seed: reference data and default configuration |
| `supabase/tests/` | pgTAP: grants/RLS allow + deny, integrity triggers, sessions, ingest pipeline |
| `tools/` | Codegen, engine vendoring, scenario seeder |

## Run it locally

Prerequisites: Docker, the Supabase CLI, Deno 2, Node 20+ and pnpm.

```bash
pnpm install
supabase start                 # local stack; applies migrations and supabase/seed/*.sql
supabase test db               # pgTAP suite
node tools/vendor-engine.mjs   # copy the TS engine into supabase/functions/_shared/engine
supabase functions serve --env-file supabase/functions/.env.local
curl http://127.0.0.1:54321/functions/v1/api/v1/health
pnpm admin:dev                 # admin panel on http://localhost:3000
```

No secrets need provisioning. The access-token signing key, the stand-in identity-issuer key and the worker key are generated in each project's Vault by the migrations.

## Rules that shape the code

- **Clients never write tables.** Every write is one `pos_rpc` function in one transaction, called by the POS API as `service_role`. Agent reads run as `authenticated` with the verified POS claims, so RLS applies.
- **Land raw, then process.** Every envelope is stored before it is validated; nothing a device sends is refused for version, schema or business reasons.
- **Configuration, not code.** Forms, flows, views, content, reason codes, thresholds and issuers are data.
- **Only the fess-pos Supabase project is ever targeted.** The FESS app's project is off-limits.
