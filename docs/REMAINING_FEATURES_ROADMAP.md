# Remaining Features Roadmap

**7 October 2026 continuation:** [Phase A2 outcome analytics](PHASE_A_OUTCOME_ANALYTICS.md) adds server-recorded assessment, enrichment, demand and placement events; observed source-to-placement conversion; hiring/reassessment timing; and permission-checked, rate-limited aggregate exports with server receipts. Production acceptance, dedicated validated-readiness and historical custom report fields remain pending. Governance completion, provider delivery, connectors and recovery operations remain subsequent phases.

**LinkedIn import addition:** [candidate extraction by LinkedIn URL/handle/numeric ID](LINKEDIN_CANDIDATE_IMPORT.md) adds an optional server-side People Data Labs adapter, workspace opt-in, a shared daily attempt limit and a key-free pasted-text path. Drafts require review/contact details and use normal candidate persistence/Anthro-ID assignment. All 740 full-suite tests passed, plus seven focused checks for the final numeric-ID/parser/provider/endpoint/UI/database behavior. Lint, formatting, whitespace and the final Netlify build passed (13 functions; 64.8 KiB entry). Provider credentials, live provider coverage and hosted activation remain pending.

**Phase E1 local slice:** [internal interview reminders](PHASE_E_INTERNAL_REMINDERS.md) create shared preparation tasks from a scheduled Netlify worker, with replay prevention, five-attempt retries, private receipts, source-change cancellation and admin enable/pause/retry controls. The full run exercised 734 tests: 731 passed and three migration fixtures without `service_role` failed; a conditional grant fixed the issue and all three plus the reminder migration passed on rerun. Four reminder migration/worker/UI checks also passed, including cross-workspace failure isolation. Lint, formatting and Netlify build passed (12 functions). Hosted scheduler/concurrency/advisors acceptance and external delivery remain pending.

**Phase D5 local slice:** [optional administrator MFA](PHASE_D_PRIVILEGED_MFA.md) adds authenticator enrollment/verification in Settings and server assurance checks for request cases/holds, audited CSVs and document signing. Activation/downgrade requires AAL2; enabling pins the existing audited access controls. All 729 Node tests passed; final lock-order adjustments passed two focused migration tests and both MFA UI tests passed, including a later failed-challenge check. Lint, changed-file formatting and Netlify build passed. Hosted Auth/advisors acceptance, wider access governance and SSO remain pending.

**Phase D4 local slice:** [reviewed outbound recruiting holds](PHASE_D_OUTBOUND_HOLDS.md) links admin-reviewed restriction cases to server-owned candidate flags, guarded pipeline writes/CSV preparation, merge protection and explicit release. All 727 Node tests passed; a final UPSERT fix passed five focused migration tests. Lint and Netlify build checks passed. Wider read/export restrictions and complete restriction/erasure fulfillment remain pending.

**Phase D3 local slice:** [data-subject request review](PHASE_D_SUBJECT_REQUESTS.md) adds administrator case intake, identity/review states, assignment/review dates, version conflicts and actor-bound idempotent history. All 724 Node tests, lint and Netlify's offline build passed. Full request fulfillment, restriction enforcement, original/history cleanup and hosted acceptance remain pending.

**Phase D2 local slice:** [audited candidate CSV preparation](PHASE_D_CANDIDATE_EXPORTS.md) adds fresh server projections, administrator-only compensation in these CSVs, distributed export quotas, snapshot receipts and an administrator volume-review panel. All 720 Node tests, lint and Netlify's offline build passed. Reports/dossiers/backups, broad read restrictions and hosted activation remain pending.

**Phase D1 local slice:** [audited document signing](PHASE_D_DOCUMENT_ACCESS.md) adds opt-in distributed download quotas, service-only issuance receipts, direct Supabase Storage restrictions and an admin audit panel. All 716 Node tests, lint and Netlify's offline production build passed. Broader profile/export audit, role projections, session controls and data-subject workflows remain pending. Hosted activation is required.

**Phase C5 local slice:** [legacy R2 quarantine and retention review](PHASE_C_LEGACY_DOCUMENT_REVIEW.md) brings eligible originals into existing private processing and adds admin-only keep/hold/archive decisions with server-owned receipts. Automatic provider migration, historical text gating and original deletion remain pending.

**Phase C4 local slice:** [structured CV section evidence](PHASE_C_STRUCTURED_CV_EVIDENCE.md) adds cited employment, education, certification and project excerpts with explicit review and atomic candidate/original persistence. Netlify packaging and private worker images include the shared parser. Richer entity grouping, legacy backfill/retention and hosted acceptance remain pending.

**Phase C local slices (6 October 2026):** [C1 private scanning for saved CV imports](PHASE_C_PRIVATE_SCANNING.md) adds scan leases, a ClamAV worker and extraction/approval/download gates. [C2/C3](PHASE_C_ATTACHMENTS_AND_OCR.md) extend quarantine to new candidate/client attachments and add optional private Poppler/Tesseract OCR with reviewable text and bound provenance. VirusTotal remains hash reputation only. All 702 Node tests and four Python tests passed. Live engine/container acceptance, legacy backfill/retention and richer structured extraction remain pending. No production activation was performed.

**Current deployment sequence (6 October 2026):** [ECOD gap closure plan](PHASED_DEPLOYMENT_2026_10_06.md) supplements the phases below with staged rollout and acceptance gates. Historical lifecycle analytics and a server-only VirusTotal hash reputation lookup are the first local slices; neither is deployed. VirusTotal reputation is not CV malware scanning.

**Phase B1 local slice:** [resumable spreadsheet imports](PHASE_B_IMPORTS.md) adds saved reviews, explicit approval, atomic background commits, failed-row correction and bounded progress/error pages. CV staging/extraction and broad server-side browsing remain subsequent Phase B work.

This sequence comes from the 123-item blueprint audit and the current code, not from the age of the backlog. Each phase should land as a reviewable vertical slice with database rules, usable UI and tests.

## Baseline

**Latest audit:** [3 October 2026 product audit](PRODUCT_AUDIT_2026_10_03.md) supersedes historical percentage estimates for current planning. It checks the current repository and distinguishes code presence from authenticated production verification.

- Blueprint coverage after Phase 1: **83% weighted-equivalent** (83 equivalent, 36 partial, 1 different by design, 3 missing).
- The blueprint's R1/MVP checklist is complete.
- The remaining work is mainly production infrastructure, integration depth and external collaboration rather than the core candidate repository.

## Phase 1 — Placement and commercial outcomes (complete)

**Delivered:** first-class placement/deployment records; client and candidate visibility; planned/active/completed/terminated/cancelled lifecycle; links to candidate, demand, client, consideration and offer; start/end and delivery context; separate admin-only bill/cost/billed/collected record; derived margin; audit and incremental sync.

**Acceptance evidence:** migration 029 enforces tenant and client integrity, rejects invalid dates and duplicate live placements, and prevents recruiters from reading commercial outcomes. Unit, migration and UI workflow tests pass.

## Phase 2 — Repository depth and reusable operating structures

Build assessment templates, static talent pools, richer configurable fields beyond candidates/demands, agreement/document links on clients and stronger server-side repository filters. Add placement reporting to the report builder. This phase stays within the existing browser + PostgreSQL architecture.

**Exit criteria:** a recruiter can create and reuse an assessment template, curate a static pool without losing the current live-view pools, configure supported fields on the remaining core modules and report on placement status, margin and collections according to role permissions.

**Delivered first slice (30 September 2026):** admin-managed weighted assessment templates with versioned evidence and configurable expiry; recruiter-curated static pools with reversible membership and archiving; placement report fields with admin-only commercial measures and currency/billing-basis aggregation guards. Migration 032 enforces these structures and syncs them.

**Delivered second slice (1 October 2026):** client agreement/document uploads, private signed reads and reversible archiving, restricted to admins including historical snapshots; employer, engagement and admin-only compensation filters evaluated by PostgreSQL in cloud mode and stored in saved views. Migration 033 includes same-workspace document links, merge markers and permission-checked filter RPCs.

**Delivered third slice (3 October 2026, local implementation):** admin UI to configure fields on candidates, demands, clients and client contacts; typed client/contact values and read-only displays; reversible archiving; shared input controls that preserve empty numeric values and require explicit dropdown choices. Migration 034 checks definitions and values server-side and preserves record history/sync. Production migration/deployment is still required.

**Delivered fourth slice (3 October 2026, local implementation):** PDF.js extraction for compressed text PDFs; local worker, font assets and character maps; preserved line breaks and original bytes; editable candidate name/email/phone in CV import review with duplicate checks. Scanned, locked, malformed, timed-out and oversized PDFs receive manual-review messages. Originals remain attachable; no OCR or external parsing provider. This slice requires a frontend deployment only, with no additional database migration.

**Still remaining in Phase 2:** configurable fields on other needed modules, custom-field report/filter/column support, wider server-side filter/pagination adoption and scanned-PDF OCR. The new structured filters run on the server; the existing text, semantic, location, skill and queue filters still run in the browser. Assessment template administration is restricted to admins; recruiters reuse published templates.

## Phase 3 — Server execution foundation

Introduce an asynchronous job queue and idempotent workers for work that cannot depend on an open browser tab. Move assignment/workflow evaluation behind server entry points and add an outbound email provider for interview invitations, application acknowledgements and scheduled report delivery.

**Exit criteria:** API-created records receive the same automation as UI-created records; retries cannot duplicate messages or actions; failures are visible and replayable; provider credentials never reach the browser.

**Delivered first slice (3 October 2026, local implementation):** migration 035 adds opt-in server assignment for new candidates/demands and durable workflow jobs for existing event rules. The scheduled Netlify worker executes bounded, locked PostgreSQL batches; task/note/tag/next-action effects and job completion commit atomically, with exponential retries and terminal failure after five attempts. Admin settings show queue status and explicit retry using the repaired rule's current actions. Demo/legacy browser execution remains available; cloud saves query the authoritative mode and skip client execution when the server is enabled. See [deployment and operational details](PHASE3_SERVER_EXECUTION.md).

**Still remaining in Phase 3:** outbound email provider/delivery idempotency, invitation and acknowledgement send flows, scheduled report delivery, time-based rule conditions and hosted deployment/concurrency/throughput verification. Phase 3 is not complete; this implementation has not been pushed, activated or deployed.

## Phase 4 — Integration surface

Add signed webhooks/event delivery, integration-grade write APIs, external mapping/reconciliation and two-way calendar synchronization. Add mailbox ingestion once the job foundation is operating reliably.

**Exit criteria:** events are signed, retried and idempotent; external writes obey the same tenant, validation and audit rules as the UI; calendar and mailbox connectors expose sync health and recover from expired credentials.

**Delivered integration slice (3 October 2026, local):** migration 036 adds transactional idempotency receipts, source/external-ID mapping with optimistic versions (including UI edits), an authenticated candidate write endpoint, metadata-only event outbox, signed public-HTTPS delivery with DNS pinning, bounded leases/retries and admin subscription/status/retry controls. Configuration/delivery audit snapshots exclude secrets. Dedicated machine credentials, mapping pagination, connector OAuth/two-way calendar/mailbox ingestion, retention/secret rotation and authenticated hosted acceptance remain pending. Phase 4 is partial.

## Phase 5 — Hosted retrieval and AI provider layer

Move semantic retrieval to a hosted embedding index with PostgreSQL filters, while preserving the existing explainable deterministic match components. Add a provider abstraction, prompt/model versioning, evaluation fixtures, cost controls and human review for generated summaries or drafts.

**Exit criteria:** provider changes do not alter stored business records without review; every generated artifact records provider/model/prompt version; relevance quality is measured against a fixed evaluation set; tenant data cannot cross index boundaries.

**Delivered intelligence slice (3 October 2026, local):** migration 037 adds current-source, tenant-scoped hosted vectors and PostgreSQL filters, private deterministic indexing/search, separate optional OpenAI model namespaces, server-only credentials, atomic daily request reservations and provider/creator/reviewer/version metadata. AI is disabled by default; field-minimized summaries remain drafts until manually reviewed and approved/rejected. Optional 038 adds the pgvector index. Small retrieval fixtures and actual pgvector/permission/freshness tests pass; larger live-model relevance benchmarks, additional providers, automatic index maintenance and authenticated hosted acceptance remain pending. Phase 5 is partial. See [deployment and operational contract](PHASE4_5_INTEGRATIONS_INTELLIGENCE.md).

## Phase 6 — External portals and governance hardening

**Operations follow-up (3 October 2026, local):** migration 039 adds automatic private vector indexing/backfill, lease recovery, retry/health controls and stale pending-AI cleanup; external mapping pagination and explicit version-checked reconciliation; paused/drained webhook key rotation with metadata audit. Manual indexing remains a fallback. Automatic external-AI indexing, OAuth calendar/mailbox connectors, live relevance/throughput verification, delivery retention and secret encryption remain pending. See [operations deployment](OPERATIONS_MAINTENANCE.md).

Add the client review portal, then vendor collaboration if a real operating need remains. Complete retention enforcement, encrypted scheduled backups with restore drills, malware scanning, export rate limits/watermarking and SSO/MFA administration.

**Exit criteria:** external users see an explicit field projection and cannot access internal commercials or notes; retention and backup jobs produce auditable evidence; restore is tested; exports and authentication policies are enforced on the server.

## Delivery rule

**October 2026 Phase B continuation (local):** saved spreadsheet reviews and atomic background imports now have an opt-in [durable CV staging/extraction preview](PHASE_B_CV_STAGING.md) and opt-in [paged repository reads](PHASE_B_PAGED_REPOSITORY.md). Originals are private and immutable; leased parsing creates reviewable drafts and candidate/document commits are atomic. CV production activation requires the private scan gate. Startup, browsing and Candidate 360 reads are bounded in the new mode; legacy workflows still load full snapshots. Retention and hosted acceptance remain pending.

Complete one phase before beginning the next unless a production defect requires a narrow interruption. Every phase must update the blueprint matrix, migration chain, API contract and operational documentation alongside the code.
