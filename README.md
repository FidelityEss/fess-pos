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
| `supabase/seed/` | Reference data and default configuration, plus per-environment settings (`seed/env/qa.sql`, `seed/env/production.sql`) |
| `supabase/tests/` | pgTAP: grants/RLS allow + deny, integrity triggers, sessions, ingest pipeline |
| `tools/` | Codegen, engine vendoring, scenario seeder |

## Environments

There is no local database; the Docker stack was retired on 2026-09-12. Laptops run code only, pointed at one of two hosted Supabase projects:

| | QA | Production |
|---|---|---|
| Supabase project | fess-pos-qa `ysbgdxhdexpjvmlnjofc` | fess-pos `zqunqunjdjhyriqsvzfr` |
| Admin panel on Vercel | https://fess-pos-admin-qa.vercel.app, built from `master` | https://fess-pos-admin.vercel.app, built from `production` |
| Admin panel on a laptop | `pnpm --filter fess-pos-admin dev:qa` → http://localhost:3001 | `pnpm --filter fess-pos-admin dev:prod` → http://localhost:3002 |
| Data | dummy data from the scenario seeder | real data only; no seeders or tests |

Prerequisites: the Supabase CLI (logged in), Deno 2, Node 20+ and pnpm. The admin panel reads `apps/fess-pos-admin/.env.qa` / `.env.production` (gitignored; see `.env.example`).

```bash
pnpm install
supabase link --project-ref ysbgdxhdexpjvmlnjofc   # QA; confirm with: cat supabase/.temp/project-ref
supabase db push --linked                          # migrations (add --include-seed for reference data + settings)
pnpm db:test                                       # pgTAP suite; refuses to run unless the CLI is linked to QA
POS_PUBLISHABLE_KEY=<QA publishable key> pnpm smoke   # end-to-end API smoke test; QA only, needs one seeder run first
node tools/vendor-engine.mjs                       # copy the TS engine into supabase/functions/_shared/engine
supabase functions deploy api workers --project-ref ysbgdxhdexpjvmlnjofc --no-verify-jwt
curl https://ysbgdxhdexpjvmlnjofc.supabase.co/functions/v1/api/v1/health -H "apikey: <QA publishable key>"
```

Every change goes to QA first. Production gets the same migrations, functions and admin build later, on purpose and with approval. The release flow, the rebuild runbook and the Vercel setup are in the planning pack (`docs/15-environments.md`).

No secrets need provisioning. The access-token signing key, the stand-in identity-issuer key and the worker key are generated in each project's Vault by the migrations.

## Rules that shape the code

- **Clients never write tables.** Every write is one `pos_rpc` function in one transaction, called by the POS API as `service_role`. Agent reads run as `authenticated` with the verified POS claims, so RLS applies.
- **Land raw, then process.** Every envelope is stored before it is validated; nothing a device sends is refused for version, schema or business reasons.
- **Configuration, not code.** Forms, flows, views, content, reason codes, thresholds and issuers are data.
- **Only our two Supabase projects are ever targeted:** fess-pos (production) and fess-pos-qa (QA). The FESS app's projects are off-limits.
