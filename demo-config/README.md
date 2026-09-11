# Demo configuration — how the module is driven end to end

**This is a demo.** These files show the exact format of the definitions that make the module configurable (`docs/04`, `docs/11`, `docs/13`). The numbers and wording are placeholders; the geofence values are pending PM sign-off (D-09).

## Where configuration actually lives

There is no single config file in production:
- **Definitions** (forms, flows, views, pages, content, job fields) are rows in the POS database (`definition_versions`, `docs/05` §3). Each version is immutable once published.
- **Remote config** lives in `remote_config_versions`, in layers: global → bank → agent → device.
- **Editing:** admins edit all of it in the admin panel's definitions studio.
- **Import/export:** the studio can import and export any definition as JSON **in exactly the format of these files**.
- **In the code repo,** files like these live in two places:
  - `supabase/seed/` — the global defaults a fresh install starts with;
  - `schema/fixtures/` — the contract tests that both engines (Dart and TypeScript) must agree on.

## The files

| File | Kind | What it controls |
|------|------|------------------|
| `app.agent_app.v1.json` | `app` | Tabs, every page, what each page shows, which buttons appear when, where forms lead, outcome pages |
| `view.home.v1.json` | `view` | The home page: greeting, agent card, stat tiles, today's leads, create-lead button |
| `view.cards.v1.json` | `view` ×3 | Job card (list item), job detail, agent authorisation card |
| `flow.site_inspection_flow.v1.json` | `flow` | The inspection journey, including the branch when the business is closed |
| `form.site_inspection.v1.json` | `form` | The full inspection form, mirroring the paper form, with its rules |
| `form.reason-forms.v1.json` | `form`/`flow` ×4 | Unable to complete (+ its flow), decline job, and a zero-code follow-up form |
| `job_schema.example-bank.v1.json` | `job_schema` | One bank's extra job fields (branch code, risk tier) |
| `content.en-ZA.v1.json` | `content` | Every word the app shows (it says "leads") |
| `remote-config.global.json` | remote config | Geofence profiles, integrity rules, sync, storage, keys, feature flags, kill switches |
| `test-cases.site_inspection.json` | test cases | Scenarios re-run on every publish; a failure blocks it |
| `example-submission.envelope.json` | — | What the phone sends when an inspection is submitted |

## End to end

### 1. An admin makes a change
Example request: *"The bank wants the business's actual address, with a map pin, whenever it isn't at the address on the request."*

1. **Edit the draft.** In the studio, the admin opens the draft of `site_inspection` and adds:
   - a yes/no field `address_matches`;
   - an `address` field shown only when the answer is *no*, using the rule builder: *When "Is the business at this address?" is No → show*.

   In the form file, that's `actual_address` with `"visible": { "==": [ { "var": "answers.address_matches" }, false ] }`.
2. **Preview.** It renders in the browser, using the module's own renderer. The admin can also open it on a phone via the preview QR.
3. **Record a test case.** The admin clicks through *No* and saves it as a test case (the first case in `test-cases.site_inspection.json`).
4. **Publish.** This runs automatically:
   - **analysis:** no rule cycles, no missing fields, every page reachable;
   - **every test case** for the family;
   - a **diff** against v1.

   A second admin approves (four-eyes). Version 2 is created and can never be edited again.
5. **Activate.** Version 2 goes to 10% of agents first, then everyone. Rollback means re-activating v1: instant, no app release.

### 2. The phone picks it up
1. **Sync.** On its next sync (foreground, reconnect, push hint, or a background timer), the phone calls `sync/pull`. It receives v2, plus any changed content, config and jobs.
2. **Compile.** It stores them in its encrypted local database and compiles v2 into a *render plan* once, in the background: fields flattened, rules pre-compiled, dependency graph built.
3. **Check compatibility.** If v2 needed a component this app version doesn't have, the phone would keep using v1, or the field's `fallback` — here the address field falls back to a text box.

### 3. The agent uses the app
1. **Home.** The app opens on the `home` page from `app.agent_app.v1.json`. `view.home.v1.json` draws the greeting, the agent card, the tiles (counted from local jobs, so offline works) and today's leads. The words come from `content.en-ZA.v1.json`.
2. **Job detail.** Tapping a lead opens `job_detail`. Its buttons appear by rule: *Accept*/*Decline* only when `assigned`, *Begin inspection* only once accepted.
3. **Begin inspection** starts `site_inspection_flow`:
   - **`location_check`:** the job's `location_type` is `shopping_centre`, so the `shopping_centre` profile in remote config applies: 250 m and 75 m accuracy. The app prompts a check-in on arrival, and if there's no GPS lock inside, that fix taken immediately outside the premises is what proves location. Photos are required either way (PM decision, 2026-09-11).
   - **The inspection is pinned** to the form, flow and config versions in force, so later changes don't affect it.
   - **`arrival`:** "Is the business open?" *No* would branch straight to `unable_to_complete_flow`.
   - **Form sections:** as the agent answers, only the rules that depend on the changed answer re-run. The mall profile makes `shopfront_photo` appear. Choosing *Private home* raises the internal-photo minimum to 4. E-commerce and point-of-sale percentages over 100% show the configured error.
   - **Autosave:** every answer and photo is saved to the phone (encrypted) before it's shown as done.
4. **Submit.** Validation runs locally, then the declaration and a hash that seals the submission. The submission is written once to the outbox with a permanent id — see `example-submission.envelope.json`.
5. **Outcome page.** The `inspection` outcome set shows either:
   - **"Inspection received"** — online and the server confirmed it; or
   - **"Saved on this phone"** — offline. It's never "failed" just because there's no signal.

### 4. The server receives it
1. **Land raw.** The raw envelope is stored before anything else, so it can't be lost.
2. **Check** (`docs/12`):
   - it re-validates with **the same definitions the phone used** (via `definition_refs`) and the `context_snapshot`, so it reaches the same visibility and required-ness;
   - it verifies hashes and the session token;
   - it checks that hidden fields are absent.
3. **Commit.** The inspection is committed. Photos upload separately and are verified against the `manifest`, and the inspection moves to review once every photo is verified.
4. **Review.** The reviewer sees answers, photos, the location profile used, the check-in, breadcrumbs and the custody timeline.

## What is config and what is code

| Change requested | How it's delivered |
|------------------|--------------------|
| Add, remove, reword or reorder a field; new option; new rule; photo minimum per premises type | Edit the form → publish → activate |
| New page, new tab, new button, new form that just records data | Edit `app` + a form bound to `record.submit` |
| Change the home page, cards or job detail layout | Edit a `view` |
| Change the inspection steps or branching | Edit the `flow` (integrity steps can't be removed) |
| Change any wording (e.g. "leads") | Edit `content` |
| Geofence numbers, blocking rules, sync timing, keys, feature flags | Edit remote config (bounded, audited) |
| A new *kind* of field, page type or server action | Code — a module release. The component catalogue (`docs/11`) is built broad up front to make this rare |
