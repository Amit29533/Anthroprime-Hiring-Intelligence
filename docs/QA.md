# Verification record

## 3 October 2026 — product audit and custom fields

Full suite: **587 passing, 0 failures**. ESLint and production build pass; the initial entry is 62.5 KiB within the 100 KiB budget. Changed JS/JSX files pass Prettier. The repository-wide format check still flags 103 unchanged files.

Migration 034 was applied locally with the full SQL chain and reapplied to verify idempotency. Tests cover role/tenant boundaries, field definition/value validation, preserving historical client/contact values, sync and reversible archiving. Real React journeys configure fields through Settings, create a client with decimal/select values, archive and restore its field, clear a contact number and display failed saves. The local settings panel was also reviewed in the browser.

Production sign-in page loads; the browser session has no app authentication. Migration 034 has not been run on production, and this local implementation has not been deployed. See [the audit](PRODUCT_AUDIT_2026_10_03.md) for the complete feature matrix, research sources and next phases.

27 September 2026 — ECOD first release.

## Automated checks

- Production build: Vite React bundle, local assets and Netlify configuration.
- Domain/import tests: skill aliases; scoring breakdown; hard failures despite high scores; unknown information; old/unrelated assessments; JD skill boundaries; duplicate detection; search syntax; numeric validation; malformed CSV; mixed valid/invalid/duplicate import; 200-row import; unavailable candidates and phone validation.
- Actual PostgreSQL migration executed in PGlite. Verified successful writes, historical snapshots, case-insensitive email uniqueness, candidate/demand uniqueness, cross-workspace row isolation, cross-workspace foreign-key rejection, denied anonymous access, denied viewer writes, denied membership changes and immutable audit records for authenticated application roles.

## Browser journeys

Verified through the running interface using fictional data:

1. Search `Databricks Azure` returned six initial matching profiles.
2. Created Maya Shah, then found the profile through repository search.
3. Created an Orion Labs data-engineering demand from a JD. Reviewed extracted skills and requirements, then generated ranked matches.
4. Expanded Maya's six-component match explanation: 80% with missing assessment evidence explicitly identified.
5. Shortlisted Maya into that demand; moved Identified → Contacted; reloaded and verified the saved stage.
6. Imported one valid CSV row, skipped a case-insensitive duplicate and rejected an invalid email. Reviewed the preview before import.
7. Edited the imported profile's expected CTC; verified the update and previous-profile history.
8. Recorded an assessment for Maya; match score changed from 80% to 98%, while profile readiness remained recruiter-controlled.
9. Corrected and rechecked target-date persistence after finding a date-input event issue.
10. Checked desktop (1440px) and mobile (390px) layouts. Main pages fit the viewport; repository tables and pipelines intentionally scroll within their own containers. Mobile navigation opens and closes correctly.

## Limits of verification

No Netlify account or Supabase project was connected or provisioned in this task. Hosted Auth/PostgREST, cloud end-to-end operation, team concurrency, production load, backup recovery and external integrations are therefore not verified. The cloud schema's authorization rules were tested locally with PostgreSQL roles. The Netlify artifact is a demo build until rebuilt with database configuration.

Sample records added during browser verification are fictional and exist only in the local preview's browser storage, not in the source seed data or deployable archive.

## Phase 2 PDF extraction slice — 3 October 2026

PDF.js replaces literal-string scraping. Tests exercise real Flate-compressed PDFs, misleading metadata, preserved original bytes, Unicode/line boundaries, empty/scanned pages, malformed and password-error paths, page/character limits, timeout destruction, editable drafts and duplicate blocking. Browser verification reads a compressed CV and manually completes a scanned draft without writing demo records. All parser/font/map assets are hosted locally. OCR, complex-column accuracy and hosted parsing remain outside this slice.

The full suite passed 593 tests before the final review UI refinements; all 28 targeted PDF/import/workflow tests passed afterward, including two new draft-review flows. Lint, changed-file formatting and the production build passed; the initial main entry remains 62.5 KiB against a 100 KiB budget. PDF.js is a larger lazy chunk loaded only for PDF extraction. Desktop and mobile review layouts were checked. This slice adds no migration; earlier custom-field migration 034 is still a separate deployment prerequisite.

## Phase 3 server execution — 3 October 2026

The full regression suite passed 602 tests before the last expanded migration assertions; the final migration test was rerun and passed with candidate/demand assignment, all five workflow modules, immutable normal-job snapshots, atomic rollback, exponential retries, completed-job replay rejection, repair/replay, pause/resume, audit payload exclusion and tenant/role checks. An additional cloud App save integration test passed, proving server mode skips browser side effects, legacy mode still executes rules, explicit owners are preserved and uncertain mode blocks saves. Admin queue filters/retry/error/demo flows and the scheduled worker entry point pass their dedicated tests. Lint and the production build pass; the main entry is 63.3 KiB against a 100 KiB budget.

Hosted migration 035, real Netlify scheduling, actual service credentials, concurrent hosted PostgreSQL behavior and throughput have not been verified. No email is sent. Deployment must follow docs/PHASE3_SERVER_EXECUTION.md before activating the workspace switch.

## Phase 4/5 local verification — 3 October 2026

The full suite passed **616 tests, 0 failures** with four concurrent test processes. After final webhook DNS handling, AI provenance/auditing and model/filter checks, **14 targeted tests passed** (migrations 035–037, actual optional pgvector index, integration/provider/security tests and React controls). ESLint and changed-file Prettier checks passed. The production build passed its **63.3 KiB / 100 KiB** entry budget; all three new Netlify entry points also bundled for Node 22. PDF.js still produces the known large lazy-chunk warning.

Coverage includes transactional import replay/conflicts, UI-origin mapping-version invalidation, editor/admin boundaries, source fingerprints, model namespaces, private field projections, disabled AI and request quotas, editable review with creator/reviewer metadata, metadata-only audit records, HMAC tamper/replay checks, public-network restrictions and pinned DNS callbacks. One application journey now waits for the actual lazy profile drawer rather than assuming it appeared within a fixed settle delay. SSR test servers disable background dependency scanning to avoid teardown races.

Provider responses and webhook receivers are mocked; no external candidate-data processing or hosted migrations/deployment occurred. Actual OAuth calendar/mailbox connectors, end-to-end Supabase/Netlify/R2 acceptance, hosted concurrency/recall and a broader relevance benchmark remain pending. See PHASE4_5_INTEGRATIONS_INTELLIGENCE.md for the rollout and limits.

## Operations maintenance verification — 3 October 2026

The full suite passes **623 tests, 0 failures**. Final changes also pass **21 targeted tests**, ESLint, changed-file Prettier, Node 22 index-worker bundling and the production build (**63.3 KiB / 100 KiB** entry budget). Migration 039 tests cover existing-profile backfill, current-source automatic queueing, contact-only no-op updates, stale lease rejection, expired-lease reclaim, retry exhaustion/admin replay, idempotent migration reruns, merged-vector removal, pending-AI cleanup, mapping version conflicts/reconciliation, private workspace boundaries and paused/drained signing-key rotation. The same test applies the actual optional pgvector extension/index and verifies worker writes remain compatible. React tests exercise paginated reconciliation, cleared rotation inputs and index health/retry controls.

These are local PostgreSQL and mocked-provider/UI checks. True multi-session lock races, production Netlify scheduling/throughput and authenticated hosted acceptance remain unverified. No deployment, push, external AI processing or candidate-data deletion occurred. Follow docs/OPERATIONS_MAINTENANCE.md for rollout.
