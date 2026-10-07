# Five build phases using the existing stack

Started: 7 October 2026. Scope: features classified as buildable in the [Netlify feature split](NETLIFY_FEATURE_SPLIT_2026_10_07.md). Keep React/Vite, Netlify, Supabase/PostgreSQL and existing private storage. Add no external provider or worker service as part of these phases. Commit locally only.

These are implementation phases, not five releases already completed. Close each slice with meaningful permission/migration/UI checks and update its status. Hosted activation requires migrations and staging acceptance; local work does not imply deployment.

## Phase 1 — Bounded repository and everyday workflow

**Status: in progress; first slice implemented locally.**

Verification: 770 Node tests, four OCR tests, lint, changed-file formatting and Netlify packaging passed. No external service, deployment or GitHub push was performed. Hosted migration/advisor/permission acceptance remains pending.

- Implemented first slice: personal saved views, experience-range/tag filters, server-side name/recent-verification/experience/notice sorts, and conflict-aware owner/next-action quick editing in paged Candidate 360. See [slice contract](PHASE_N1_REPOSITORY_VIEWS_AND_QUICK_EDIT.md).
- Next slices: richer paged saved filters; broader candidate editing with transactional history; bounded matching, reports, bulk previews/exports and cross-entity search; custom-field filtering/report metadata; accurate action-board totals; Anthro-ID capacity monitoring.
- Experience: keep the common browse → filter → open → next-action workflow in paged mode, explain errors and preserve failed edit drafts.
- Exit: these workflows operate without loading full candidate/document/history tables, preserve identity/history and obey permission projections. Large work is resumable and bounded.

## Phase 2 — Verified candidate facts, data quality and access

**Status: in progress; first contact slice implemented locally. Depends on Phase 1 read/write infrastructure.**

- Implemented first slice: sourced alternate email/phone records, explicit recruiter confirmation, preferred confirmed contacts, retirement, primary/alternate duplicate guards, merge-preserved evidence and bounded reads in both profile layouts. See [slice contract](PHASE_N2_CANDIDATE_CONTACTS.md). All 775 Node tests, four OCR tests, lint, changed-file formatting and offline Netlify packaging passed. No new service, deployment or push; hosted acceptance remains pending.
- Privacy integration: D7 inventories include contact records/events/receipts; recapture older checklists. D6 explicitly excludes these records from its 18-category package and needs separately approved review; regenerate previously prepared packages after the scope-notice change.
- Next slices: broader verified facts, data-quality queues and narrower role/field scopes below. Preferred contacts currently preserve primary profile/portal identity and recruiting consent.

- Multiple normalized contacts/preferred contact; date-rich employment; compensation currency/basis/components; availability/source/verification; latest applicable verified values and preserved superseded claims.
- Duplicate suggestions and review queues, incomplete/stale fact findings, taxonomy correction and import error resolution.
- Assessor and Sales/Account scopes, compensation/commercial permissions, client/assignment boundaries, sensitive-read/export audit coverage and session/cache access-removal behavior.
- Experience: show what is known, self-declared, verified and stale; let recruiters correct facts without asserting verification accidentally.
- Exit: concurrent updates cannot silently overwrite verified facts; prohibited fields never arrive in unauthorized browser/API/report responses; review decisions and history are traceable.

## Phase 3 — Complete ECOD evaluation and readiness

**Status: in progress; first general readiness review slice implemented locally. Depends on verified facts and role boundaries.**

- Implemented first slice: administrator readiness decisions separate from profile status, passing general assessment/enrichment checks, evidence expiry, source/head conflict checks, actor-bound acknowledgement retries and merge-preserved history in both profile layouts. See [slice contract](PHASE_N3_READINESS_JOURNAL.md). Existing roles apply; narrower Phase 2 assessor scopes remain pending.
- Privacy integration: D7 includes the readiness journal as its 31st category; recapture older checklists. D6 explicitly excludes decision history and requires separate approved review; regenerate prepared packages after the scope-notice change.
- Verification: all 779 Node tests, final expanded migration/UI checks, four OCR tests, lint, changed-file formatting and offline Netlify packaging passed. No new service, deployment or push; hosted permission/advisor/concurrency acceptance remains pending.
- Next slices: typed demand constraints, independent scorecards/debrief, assessor assignments, demand-specific validation and validated readiness consumers/analytics below. This panel does not yet change matching, submissions or existing analytics.

- Typed demand requirements and hard-constraint/unknown states; manual/deterministic CV entity grouping and JD review forms; permission-aware deterministic/full-text/existing private-vector retrieval.
- Versioned interview kits, independent scorecards, assessor assignments, evidence/debrief; gap plans, enrichment, reassessment, validator decisions and an append-only readiness journal with expiry.
- Candidate comparison; verified-ready cohorts, rediscovery, source/outcome timing, skill-gap heatmaps and historical/custom-field reports.
- Experience: explain fit and evidence, show what closes each gap, and distinguish observed profile status from validated readiness.
- Exit: complete demand → assess → gap → enrich → reassess → validate scenario with immutable prior evidence and accurate denominators. No model provider required.

## Phase 4 — Client collaboration and integration foundations

**Status: planned. Depends on field projections and evaluated submissions.**

- Client-scoped portal memberships, approved immutable submission versions, structured comments/ratings/decisions, interview requests and feedback aging.
- Account demand/placement progress with commercial segregation; submission/offer approval-change invalidation.
- Approved public job feed and source attribution; scoped/revocable machine credentials, required API writes, mappings, incremental feeds and webhook reconciliation.
- Experience: clients review a narrow approved shortlist and recruiters see the resulting next action. Start with manual provisioning/link sharing through existing auth rather than requiring a new email service.
- Exit: two-client/cross-workspace negative tests, share revocation, stale approval invalidation and replay-safe decisions/API writes. No partner posting or e-sign provider is activated.

## Phase 5 — Internal automation and governance operations

**Status: planned. Depends on prior workflow events and access controls.**

- Consolidated recruiter worklist, SLA/deadline/internal reminders, notification preferences, candidate self-update/review, redeployment prompts and portal feedback surveys.
- Message templates/previews, durable communication intents, segmentation and suppression logic using a test transport only. External sends remain disabled.
- Health/queue dashboards, retry/recovery controls, bounded load checks and redacted operational evidence.
- Retention-policy UI, subject-request coverage review, erasure dry-run/batch framework and explicit fulfillment evidence. Keep destructive execution disabled until approved policy/authorization exists; recovery and external-copy assurance remain activation dependencies.
- Experience: show due work, failures and recovery actions clearly; give candidates simple update/preferences forms and administrators honest completion/exclusion states.
- Exit: task replay/cancellation, restriction/suppression, failure recovery, privacy and representative volume checks pass. Do not describe dry runs as actual erasure or an email outbox as delivered communication.

## Dependencies that remain outside this build scope

Live email/mailbox/calendar, external model inference, partner boards/LinkedIn, SMS/WhatsApp, e-signing, organizational SSO, new private scan/OCR hosting and off-site backup infrastructure are deferred to separately configured integrations. Existing processing flags and production safeguards remain in place. No phase authorizes bypassing quarantine or using real candidate data without hosted safety/recovery acceptance.
