# schema/api — POS API v1

| File | Message |
|------|---------|
| `envelope.schema.json` | Every device write (docs/12 §4). The wrapper is checked at the door. Unknown `type`s and extra wrapper properties are accepted, so landing never refuses data from a newer module. Known types are listed in `x-known-types` |
| `payloads/<type>.v1.schema.json` | One per envelope type: `job_event`, `inspection_started`, `inspection_snapshot`, `evidence_meta`, `evidence_uploaded`, `traces_batch`, `submission`, `form_submission`, `custody_batch`, `sync_report`, `client_error`. Validated after landing; a failure produces a `rejected` receipt with the data kept |
| `receipt.schema.json` | One per envelope. `state: null` with `durable: false` means refused at the door: park the item and report it via `client_error` |
| `error.schema.json` | `{error:{code, message, retryable, details?}, request_id}` |
| `ingest-request` / `ingest-response` | `POST /v1/ingest`: 1–50 envelopes → receipts |
| `sync-pull-request` / `sync-pull-response` | `POST /v1/sync/pull` (docs/08 §2) |
| `auth-exchange-*`, `auth-refresh-*` | `POST /v1/auth/exchange`, `/v1/auth/refresh` |
| `upload-grant-*` | `POST /v1/evidence/upload-grant` |
| `answers-document.schema.json` | docs/04 §5 |
| `common.schema.json` | Shared types: ids, timestamps, hashes, geo fix, answers, context snapshot, integrity snapshot, diagnostics, geofence result, capability report |

**Conventions.**
- Ids are UUIDs; client ids are UUIDv7. The wrapper accepts any UUID and the server may flag non-v7 ids.
- Timestamps are ISO-8601 with an offset (`Z` or `±HH:MM`).
- Coordinates are decimal degrees; money is in integer minor units (the `currency` answer shape).
- Hashes are lower-case hex SHA-256 of the RFC 8785 JCS form.
- Device payloads and requests are strict: unknown properties are rejected, and a new field means a new `type_version`. Server responses allow unknown properties, which clients ignore.

**Aligned with the backend already in `supabase/` (2026-09-12).** Payload field names follow the ingest RPCs so the two agree:
- `submission` and `form_submission` carry the answers-document fields flat (`definition_refs`, `config_version_id`, `context_snapshot`, `answers`, `answers_hash`);
- the manifest lists `items`;
- `inspection_started` uses `geofence_result`, while `submission` uses `geofence`;
- `geofence.override` is a boolean, with details in `override_detail`;
- evidence location fields are flat;
- `client_error` carries `errors[]`;
- the sync pull response has streams of `{items, next_cursor, has_more}`, definitions / lookup lists / declarations as `{manifest, bodies}`, and config as `{default, by_bank}`, each entry `{config_version_id, values}`.

## Submission hash encoding (docs/07 §4 step 9)

```
preimage        = JCS([ "fess-pos/submission-hash/v1",
                        answers_hash,
                        [ evidence sha256 … sorted ascending ],
                        session_token_id,        // null when absent
                        started_at_device,
                        submitted_at_device,
                        device_id ])
submission_hash = hex(sha256(utf8(preimage)))
```

- The preimage is a JSON array serialised with RFC 8785. It is unambiguous for any string content (no delimiter collisions) and reuses the JCS code both engines already have.
- Evidence hashes are the manifest `items[].sha256`: lower-case hex, sorted by code unit, duplicates kept. Timestamps are used exactly as sent in the payload. `device_id` is the envelope's.
- The leading tag separates this hash from other uses and lets a future encoding move to `/v2`.
- Vectors: `fixtures/submission_hash/vectors.json`. The TS implementation is `submissionHash()` in `@fess-pos/engine`, and `submissionHashForPayload(payload, device_id)` for ingest.
