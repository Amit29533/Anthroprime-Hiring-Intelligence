# Sourced availability observations

Local Phase 2 continuation, 7 October 2026. Uses existing React/Vite, Netlify, Supabase and the `availabilityHistory` table. No additional service, provider, credential, Netlify function or candidate-linked table.

## Experience

Both cloud candidate profile layouts offer an availability panel with current notice, earliest start, active/passive status and work mode, plus a paged observation history. Administrators and recruiters can record an update with a required source and observation date. Viewers can read history but cannot record observations.

Notice is whole days from 0 through 3650; blank means unknown and zero means no notice. Earliest start is an optional ISO date. Activity is Active/Passive; mode is Unknown/Flexible/Remote/Hybrid/Onsite. The observation date must be an absolute ISO date between 1900-01-01 and server UTC today. A source must contain 1–1000 characters. Earliest start must be between 1900-01-01 and 2100-12-31.

The interface labels these as **recorded observations**, not independently verified evidence. Saving does not change the candidate's `verified` date or validated readiness. Existing legacy profile edits, portal updates and generic fact edits retain their existing behavior; this slice does not assert that every historical availability change has a source or observation date. Demo profile editing remains available; the new sourced workflow requires cloud RPCs.

## Transaction and retry contract

Apply migrations in order through `20261007125420_sourced_candidate_availability.sql`.

- `api_candidate_availability(p_candidate uuid, p_offset integer default 0)` returns canonical `candidateId`, narrow `current` availability fields and a full-row conflict `token`, at most 25 projected `rows`, `more` and `offset`. Retired identities resolve to the current candidate, and history includes retained merged identities. The UI uses canonical candidate IDs. Recursion uses distinct identities and caps a family at 100; offsets are limited to 0–1,000,000.
- `api_record_candidate_availability(p_candidate uuid, p_operation uuid, p_token text, p_observation jsonb)` requires exactly six observation keys: `notice`, `earliestStart`, `activeStatus`, `mode`, `source`, `observed`. Unknown keys and wrong types are rejected; payloads are capped at 6000 bytes. This endpoint accepts an unmerged current candidate only.
- Saving locks the current candidate and checks the complete profile fingerprint. Concurrent profile changes raise SQLSTATE `40001`; the interface preserves the draft until explicit reload/discard. A dated observation older than any sourced observation anywhere in the merged family is rejected, including observations outside the visible history page. This protects chronology within the sourced ledger; unsourced legacy profile changes do not establish an observation date.
- The append and current availability update share one database transaction. Existing profile-history and freshness/client/machine invalidation triggers run on actual changes. A same-state observation still records its new source/date without a redundant profile update. Current availability is a recruiter-entered assertion, not an automatic validator decision.
- The observation UUID is a durable operation ID. Retrying an acknowledged or unacknowledged write with the same actor, candidate and normalized observation returns refreshed current context without another observation or profile update. It cannot reapply old availability after a later change. Reusing an operation for another actor, candidate or payload fails. Changed intentions get a new UUID; merging a candidate during a pending write requires reopening the canonical profile.

## Provenance and permissions

The existing insert-only history table gains `source`, `observed`, `recordedBy`, `recordedAt` and a protected `operationApplied` marker. Existing rows keep unknown observation/recording provenance; migration does not invent those values. An insert trigger stamps the current authenticated actor and server timestamp, overriding supplied recording metadata even on direct Data API inserts. Legacy insert routes can still omit source/date; timestamp and actor establish recording provenance only. Column-level insert grants let these routes append existing fields but prohibit setting the applied-operation marker. Application roles retain no update/delete privilege on observations.

The read RPC and public write wrapper use security invoker with an empty search path. A narrow private security-definer function owns the protected applied-operation marker, validates current actor/editor membership, locks that membership during recording, and binds every lookup and write to the active workspace. This permits durable applied receipts without adding a new table or allowing direct history inserts to impersonate an applied operation. Its explicit authorization guards remain active even when called directly. Existing RLS and column grants protect ordinary table access. Anonymous execution, external-client-only accounts and other-workspace access are denied. Existing admin/recruiter/viewer roles apply; this does not finish the narrower Assessor/Sales/Account permission matrix or sensitive legacy field projections.

History rows expose availability facts, source, observation/capture dates and internal recording actor/time to workspace members. No contact, compensation, raw CV or unrelated candidate objects are projected. The existing legacy full-workspace adapter remains a separate permission/scaling task.

## Privacy coverage

No new candidate record category is introduced. D7 retains 38 categories, and its existing full-row fingerprints cover the new columns and all merged observation records. Recapture previously reviewed erasure inventories after applying this schema change.

D6 retains its 18 reviewed direct-record categories. Its availability projection now includes source, observation date and recording timestamp. Internal recording actor UUIDs remain outside that disclosure projection. Each row still requires the existing administrator disclosure review; source text can contain third-party information and must be reviewed/redacted through that workflow. Full-row source hashes detect provenance changes and invalidate stale packages. Regenerate old reviewed packages after migration. Existing exclusions and manual-review limits remain; this feature does not perform deletion or prove legal fulfillment.

## Verification

Embedded PostgreSQL checks cover migration reapplication, viewer/tenant/external/membership-removal denial, protected keys, type/date/range validation, provenance and applied-receipt forgery attempts, immutable history, transactional profile snapshots, preserved compensation and verification dates, exact operation retries after later changes, canonical merge history, 25-row traversal and chronology outside the first page. UI checks cover preserved drafts, explicit reload, zero/unknown values, durable retry UUIDs, read-only traversal, malformed responses, closing during a save and bounded paged-profile integration.

Hosted Auth/PostgREST, advisors and true concurrent-session acceptance remain pending. Work is local only; nothing is deployed or pushed to GitHub.

Local verification: **811 Node regression tests and four OCR tests passed**, followed by six migration/UI checks on the final applied-marker and membership-lock protections. Lint, changed-file formatting, documentation links and offline Netlify packaging of all 17 functions passed; the main entry is 65.4 KiB under its 100 KiB budget. Local advisors could not connect to `127.0.0.1:54322`.
