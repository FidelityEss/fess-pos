# Postman — POS API v1 for the module

A Postman collection for every endpoint the `fess_pos` module calls, with QA and production environments (T2-31, D-50).

| File | What |
|------|------|
| `fess-pos-module-api.postman_collection.json` | The collection. **Generated**: edit `build.mjs`, then run `node tools/postman/build.mjs` |
| `fess-pos-qa.postman_environment.json` | QA environment template: refs and URLs filled in, keys and test-user secrets blank |
| `fess-pos-production.postman_environment.json` | Production environment template: read-only use |
| `provision-qa.ts` | Creates the QA test users and writes a filled-in QA environment to `~/.fess-pos/postman/` |
| `build.mjs` | Generator for the three JSON files above |

## Environments

| | QA (`fess-pos-qa`) | Production (`fess-pos`) |
|---|---|---|
| What runs | Everything | `GET` requests only: health and card verification. The collection skips every other request (instructions §10–11: no test data on production) |
| Sign-in | Stand-in issuer `pos_dev`, through the QA test admin | The FESS issuers, once configured (D-05); nothing to sign in with yet |
| Test users | Test bank `APIT`, admin `API-ADM01` (scoped to `APIT`, `schedule_jobs`), agents `API-AG01` and `API-AG02` | None, ever |

## Set up QA (once)

1. Run the scenario seeder against QA once, if it hasn't been run since QA was last rebuilt. Its seed admin creates the test users.
2. Create the test users and your environment file:

   ```bash
   POS_PUBLISHABLE_KEY=<QA publishable key> deno run -A --node-modules-dir=none --config tools/scenarios/deno.json tools/postman/provision-qa.ts
   ```

   It writes `~/.fess-pos/postman/fess-pos-qa.local.postman_environment.json` (mode 600). The file holds the test admin's password (and a TOTP secret only if one was ever set up), so it stays outside the repo. The test admin joins by a registration link that the script completes itself (D-96).
3. In Postman, import the collection and that environment file, and select **FESS POS — QA (test users)**.

For production, import `fess-pos-production.postman_environment.json` and paste the production publishable key into `publishableKey`.

## Running it

Run the folders top to bottom, or run the whole collection. Each request stores what the next one needs in collection variables:

1. **QA setup** — test admin signs in with a password (the TOTP step is skipped unless the admin has one set up, D-96), creates a job for `API-AG01`, confirms the appointment, allocates it, and mints the host token FESS would hold.
2. **Auth and device** — exchange, refresh, and the device update (push token, versions).
3. **Sync** — the full pull, then an incremental one.
4. **Job events** — accept, an idempotent re-send (`duplicate`), and a same-id/different-payload `conflict`.
5. **A complete inspection** — `inspection_started` → traces → 5 × `evidence_meta` → upload grants and uploads → `evidence_uploaded` → snapshot → sealed `submission`, then a pull to watch the photos move to `verified`.
6. **Other envelope types** — `sync_report`, `custody_batch`, `client_error`, `form_submission`.
7. **Public card verification** — agent card and job card, JSON and web page. The web page comes back as plain text on `*.supabase.co` (known issue T2-32); the test checks the markup and warns.
8. **Other agent actions** — decline and unable-to-complete. They are recorded, not applied, on a job that is already accepted, so run QA setup and Pull again first if you want them applied.
9. **Error cases** — the error shape, with `retryable`.
10. **Sign out** — drops to `ingest_only`; uploads still land.

The scripts compute envelope ids (UUIDv7), payload hashes (RFC 8785 JCS + SHA-256), device sequence numbers and the submission hash exactly as the module does, and each receipt test checks that the server stored exactly the hash that was sent.

From the command line, with Postman's CLI runner:

```bash
npx newman run tools/postman/fess-pos-module-api.postman_collection.json -e ~/.fess-pos/postman/fess-pos-qa.local.postman_environment.json
```

## Notes

- Every run leaves dummy data on QA: one job, its inspection and five small evidence files. The "conflict" request raises an integrity alert on purpose.
- The inspection answers match the seeded global `site_inspection` v1 form: a standard-risk job at a standalone site, premises "complex". If that form changes, update `answersFor` in `build.mjs` (and `tools/scenarios/lib/inspection.ts`).
- The "photos" are small text files labelled `image/jpeg`: the server verifies the hash of the stored bytes, not the image format.
