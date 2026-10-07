# Candidate-scoped factual editing

Local continuation of Phases 1–2, 7 October 2026. Uses the existing React, Netlify and PostgreSQL stack. No new service, credential, table or privacy inventory category.

## Behavior

Paged Candidate 360 now offers **Edit profile facts** for administrators and recruiters. It edits name, title, company, location, summary, total experience, relevant experience and notice period. Opening or saving fetches only that candidate through RPC; it does not expand the full workspace. A successful save updates the displayed profile and repository context. Failed saves retain the draft; explicit reload fetches the latest facts and replaces the draft. Closing the profile discards the editor and ignores late responses.

Blank numeric fields mean unknown (`null`). Zero is a known value. Experience supports decimals from 0 through 100 years; notice supports whole days from 0 through 3650. Relevant experience cannot exceed a recorded total. Text is trimmed, the name is required, descriptive fields are limited to 300 characters and summary to 10,000 characters.

## Database contract

Apply migrations in order through `20261007124249_candidate_profile_edit.sql`.

- `api_candidate_profile_context(p_candidate uuid)` returns `{candidateId, token, fields}`. `fields` contains exactly the eight editable facts; the opaque token fingerprints the full candidate row.
- `api_candidate_profile_edit(p_candidate uuid, p_token text, p_fields jsonb)` requires all eight fields and rejects additional keys, wrong types and out-of-range values. The payload is capped at 30,000 bytes. It returns refreshed context.
- Both functions use security invoker, an empty search path, explicit current-workspace/editor checks and existing RLS. Anonymous execution is revoked. Viewers, other-workspace candidates, merged identities and external client-only accounts cannot use these editor RPCs.
- The save locks the current candidate row. If facts differ from the requested state, a stale token raises SQLSTATE `40001`. Concurrent unrelated edits also invalidate the token. If the current eight facts already equal the normalized request, it returns current context without an update. This permits acknowledgement retries while that desired state remains current; it is not a persistent operation receipt.
- The existing `record_change` trigger saves the prior candidate snapshot and actor transactionally. Existing freshness, client-source and machine-event triggers still run on actual updates. A no-op retry produces no extra history or invalidation.

Identity, primary/alternate contacts, consent, compensation, skills/evidence, verification dates, readiness, status, owner and next action are outside this RPC's allowlist. Owner/next action and contact/evaluation workflows retain their dedicated editors. This slice records factual corrections, not new verified employment claims; it does not manufacture employment dates or verification timestamps, or create employment/availability observations from a text edit.

## Permission boundary and remaining work

The editor follows the existing admin/recruiter/viewer roles. It does **not** complete the broader Assessor/Sales/Account permission matrix or remove sensitive columns from legacy table reads. Those changes still require a compatible database/API/report projection and assignment design. Generic profile history remains the existing record; richer sourced, dated, verified fact histories and correction dispositions remain Phase 2 work. The five phases remain unfinished as described in the [audit](FIVE_PHASE_IMPLEMENTATION_AUDIT_2026_10_07.md) and [build plan](CURRENT_STACK_BUILD_PHASES.md).

## Verification and activation

Focused embedded PostgreSQL tests exercise role/tenant denial, protected keys, validation, decimal/zero/unknown values, stale writes, desired-state retries, immutable identity/verification dates and history count. UI tests cover explicit conflict reload, preserved drafts, bounded RPC use, malformed/wrong-candidate responses and closing during save. Existing paged profile tests retain the quick-edit workflow.

Hosted Auth/PostgREST role checks, security/performance advisors and true concurrent-session acceptance remain pending. Local embedded tests do not establish deployment or hosted acceptance. Changes are committed locally only; there is no GitHub push or production migration.

Final local verification: **806 Node tests and four OCR tests passed**. Lint, changed-file formatting, documentation links and offline Netlify packaging of all 17 existing functions passed; the main entry remains 65.4 KiB against its 100 KiB budget. Expanded migration reapplication/history assertions also passed in a focused rerun. Local advisors could not connect to `127.0.0.1:54322`.
