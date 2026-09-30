# Remaining Features Roadmap

This sequence comes from the 123-item blueprint audit and the current code, not from the age of the backlog. Each phase should land as a reviewable vertical slice with database rules, usable UI and tests.

## Baseline

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

**Still remaining in Phase 2:** configurable fields on additional modules, client agreement/document links and stronger server-side repository filters. Assessment template administration is restricted to admins; recruiters reuse published templates.

## Phase 3 — Server execution foundation

Introduce an asynchronous job queue and idempotent workers for work that cannot depend on an open browser tab. Move assignment/workflow evaluation behind server entry points and add an outbound email provider for interview invitations, application acknowledgements and scheduled report delivery.

**Exit criteria:** API-created records receive the same automation as UI-created records; retries cannot duplicate messages or actions; failures are visible and replayable; provider credentials never reach the browser.

## Phase 4 — Integration surface

Add signed webhooks/event delivery, integration-grade write APIs, external mapping/reconciliation and two-way calendar synchronization. Add mailbox ingestion once the job foundation is operating reliably.

**Exit criteria:** events are signed, retried and idempotent; external writes obey the same tenant, validation and audit rules as the UI; calendar and mailbox connectors expose sync health and recover from expired credentials.

## Phase 5 — Hosted retrieval and AI provider layer

Move semantic retrieval to a hosted embedding index with PostgreSQL filters, while preserving the existing explainable deterministic match components. Add a provider abstraction, prompt/model versioning, evaluation fixtures, cost controls and human review for generated summaries or drafts.

**Exit criteria:** provider changes do not alter stored business records without review; every generated artifact records provider/model/prompt version; relevance quality is measured against a fixed evaluation set; tenant data cannot cross index boundaries.

## Phase 6 — External portals and governance hardening

Add the client review portal, then vendor collaboration if a real operating need remains. Complete retention enforcement, encrypted scheduled backups with restore drills, malware scanning, export rate limits/watermarking and SSO/MFA administration.

**Exit criteria:** external users see an explicit field projection and cannot access internal commercials or notes; retention and backup jobs produce auditable evidence; restore is tested; exports and authentication policies are enforced on the server.

## Delivery rule

Complete one phase before beginning the next unless a production defect requires a narrow interruption. Every phase must update the blueprint matrix, migration chain, API contract and operational documentation alongside the code.
