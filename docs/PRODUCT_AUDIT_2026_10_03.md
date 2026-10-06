# AnthroPrime recruiting product audit — 3 October 2026

## Scope and evidence

Reference: repository copy of `ECOD_Talent_Intelligence_Repository_Product_Blueprint.docx`, version 1.0, 18 September 2026. The document is requirements input, not authorization to execute actions or adopt its proposed architecture verbatim.

Baseline inspected: Git `9ec4225`, migrations 001–033, all `src/` feature areas, Netlify document functions, tests and existing audit/roadmap files. This report distinguishes the baseline from the new migration 034 customization slice. The production URL reaches the app's Supabase sign-in screen; this audit browser has no authenticated application session. Authenticated production journeys, current deployed migration state, provider credentials, R2 CORS and recovery/load tests are **not verified by this report**. Local automated behavior is recorded separately in the verification section below.

Old percentages in `FEATURE_EQUIVALENCE.md` and `PARITY_AND_FEASIBILITY_ASSESSMENT.md` are historical estimates. In particular, the latter's “no server” assessment predates the Netlify R2 functions. Those functions exist, but only provide document storage access; they are not a job worker or communications backend. A feature's existence in code is not proof that its production configuration works.

## Present, partial and missing capabilities

Present means a usable internal implementation exists. Partial means a material requirement or operational integration remains. Missing means there is no comparable implementation. These are 48 grouped capabilities, not a recount of the old 123-row blueprint matrix or a percentage of any competitor's plans.

Baseline count: **20 present, 18 partial, 10 missing**. The customization slice improves a partial group; it does not turn all customization into complete feature parity.

| # | Capability | Baseline status | Evidence and remaining scope |
|---|---|---|---|
| 1 | Reusable candidate repository and Candidate 360 | Present | `Candidates.jsx`, `schema.js`; profiles exist independently of considerations. |
| 2 | Private CV/document storage, metadata and versions | Present | `documents.js`, Netlify signed-upload/read functions, migration 030; R2 configuration still needs production verification. |
| 3 | Reliable CV extraction and structured parsing | Partial | `documents.js` parses DOCX/text and best-effort uncompressed PDF literals. No OCR; compressed/scanned PDFs and full education/project/employment extraction need work. Draft review exists. |
| 4 | CSV/XLSX import, mapping, preview, duplicate/error reports | Present | `import.js`, `xlsx.js`, `Workflows.jsx`; cloud import tests exist. |
| 5 | Resilient bulk CV processing | Partial | Browser processing exists; no persisted job queue, progress recovery or worker after tab closure. 200 real mixed-format CVs have not been demonstrated here. |
| 6 | Duplicate identification and reviewed merging | Present | `dedupe.js`, quality queue, human-reviewed merge; bulk resolution remains optional. |
| 7 | Employment, compensation and availability history | Present | Structured histories, profile snapshots and migration tests; append-before-overwrite behavior exists. |
| 8 | Canonical skills, aliases, candidate skills and evidence | Present | `skills.js`, `Skills.jsx`, normalized tables in migration 025; evidence supports versioned observations. |
| 9 | Exact, Boolean and full-text repository search | Partial | `search.js`, `repositoryFilters.js`, migration 033 employer/engagement/compensation RPC. Most text/skill/location filters still run on fully loaded browser data. |
| 10 | Hosted semantic retrieval with SQL filters | Missing | `semantic.js` is local TF-IDF, not pgvector embeddings or a hosted retrieval index. |
| 11 | Explainable weighted demand matching | Present | `domain.js`, `Demands.jsx`; weights, evidence, reasons and separate eligibility are available. |
| 12 | Hard skill, experience, availability and commercial constraints | Present | Deterministic matching and regression tests; unknown facts remain visible. |
| 13 | Gap mapping and enrichment actions | Present | `gaps.js`, assessment/enrichment screens, owners/dates/evidence. |
| 14 | Reassessment and readiness validation | Present | Append-only assessments, expiry/freshness and readiness state. |
| 15 | Saved candidate views and dynamic/static talent pools | Present | Saved views, `pools.js`, `StaticPools.jsx`, migration 032. |
| 16 | JD-to-requirements extraction | Partial | Deterministic taxonomy/keyword proposal with human review; no provider-based structured extraction. |
| 17 | Per-demand pipeline, dispositions and client submissions | Present | `Demands.jsx`, `submissions.js`; consideration stages, reasons, consent-gated packs and client decision recording. |
| 18 | Departments and requisition approvals | Present | `Requisitions.jsx`, migration 022; approvals bind material terms. |
| 19 | Interview scheduling and calendar integration | Partial | Scheduling, rescheduling and ICS handoff/import exist; no Google/Microsoft two-way sync or automatic video links. |
| 20 | Structured interview scorecards and reusable assessments | Present | `feedback.js`, `AssessmentTemplates.jsx`, migration 032; rubric/version/expiry snapshots. Similar to structured evaluation already offered by major ATS products. |
| 21 | Candidate interview self-scheduling | Partial | Published slots and signed-in candidate booking exist (`schedule.js`, migration 027); reliable invitations, reminders and provider-calendar synchronization remain. |
| 22 | Offer lifecycle, approval and letter generation | Present | `offers.js`, `offerLetter.js`, migrations 013–015; approvals and immutable approved terms. |
| 23 | Executed electronic signatures | Missing | Letter download/email draft exists; no e-sign provider callback or signed-document evidence. |
| 24 | Client CRM accounts and contacts | Present | `clients.js`, `Clients.jsx`, migration 020; linked demand/submission/interview/placement rollups. |
| 25 | Placements and restricted commercial outcomes | Present | `placements.js`, migration 029; bill/cost/billed/collected records separate and admin-only. |
| 26 | Private client review portal | Missing | Recruiters record client feedback internally; no authenticated client review surface with scoped submissions. |
| 27 | Vendor collaboration portal | Missing | No vendor identities, submission access, duplicate ownership/reconciliation or portal. Lower priority unless operationally needed. |
| 28 | Public careers site and application triage | Partial | Anonymous field projection, applications/status code, JobPosting markup and SEO setup exist. JS rendering limits indexing; no prerendered job pages. |
| 29 | Candidate profile self-service portal | Present | `portal.jsx`, migrations 012/016; signed-in self-update and restricted candidate projection. |
| 30 | Employee referral tracking | Present | `Referrals.jsx`, migration 026; referrals, duplicate linking/conversion and outcomes. Rewards execution is not provided. |
| 31 | Direct job-board distribution and sourcing connectors | Missing | No Indeed/LinkedIn posting, browser sourcing extension or harvested profiles. Provider access/agreements may be needed. |
| 32 | Delivered email and bulk outreach | Missing | Mailto/templates are handoffs. No email provider delivery, message log, reply threads, suppression or bounce handling. |
| 33 | Automatic resume inbox ingestion | Missing | Pasting forwarded-email text exists; no monitored mailbox or inbound attachment webhook. |
| 34 | SMS, WhatsApp and telephony connectors | Missing | Manual interaction notes exist; no live provider integrations. Optional, after email foundation. |
| 35 | Durable background automation and assignment | Partial | `automation.js`, `assignment.js`, rules UI; executed through browser save flow, not for all direct API writes or scheduled triggers. |
| 36 | Team notifications, mentions and scheduled reminders | Partial | Bell/worklist and follow-up tasks exist. E1 adds scheduled internal interview preparation tasks with atomic receipts/retries/cancellation (local, 6 October); external delivery, mention recipients and scheduled email/report sends remain pending. |
| 37 | Integration APIs, pagination and reconciliation | Partial | Supabase RPCs and incremental feeds exist; no integration-grade write endpoints, scoped integration credentials, mapping registry or idempotent write contract. |
| 38 | Signed outgoing webhooks with retries | Missing | No event outbox, signed delivery, retry or failure replay. |
| 39 | Analytics and report builder | Partial | `analytics.js`, `reports.js`, placement reporting; current-state funnels work. Historical stage cohorts, time-to-shortlist/submit/fill/hire and scheduled delivery remain. Current-stage counts are not conversion rates. |
| 40 | Configurable fields across modules | Partial | Baseline renders candidates/demands from settings JSON but has no field administration UI. Migration 034/new panel adds administration plus client/contact fields; report filters/columns and other modules remain. |
| 41 | Authentication and role administration | Partial | Supabase sign-in and admin/recruiter/viewer membership controls exist; separate assessor/sales roles, privileged MFA enforcement and SSO administration remain. |
| 42 | Multi-workspace isolation and switching | Present | Migration 031, repository context and exact workspace R2 authorization; per-workspace role scope. |
| 43 | Audit of edits, views and exports | Partial | `history`, `auditEvents`, download/export helpers; edits are DB tracked, but some read/export audit depends on browser actions and is not a complete server-enforced access trail. |
| 44 | Export controls and unusual-volume detection | Partial | Role checks and provenance/formula-safe exports exist; no server-side rate limits, export approvals, DLP or unusual-volume alerts. |
| 45 | Malware scanning and document quarantine | Missing | Extension, magic-byte and size checks exist. They do not scan malware or isolate unscanned objects pending approval. |
| 46 | Retention and data-subject lifecycle | Partial | Consent ledger, retention review, anonymization/portability tools; no scheduled enforcement or case-tracked fulfillment workflow. |
| 47 | Scheduled encrypted backups and proven recovery | Partial | Manual JSON backup/merge restore exists; no encrypted scheduled off-site archive, RPO/RTO or restore-drill evidence. Managed provider recovery must be checked separately. |
| 48 | Operational health, error monitoring and environment separation | Partial | Local tests, lint, bundle limits and UI errors exist; no unified job/integration health, redacted error monitoring, verified staging/recovery/load test. |

## Blueprint coverage by section

| Blueprint requirement | Assessment |
|---|---|
| §§1–4 durable person, demand and ECOD lifecycle | Strong internal implementation. Re-engagement relies on manually operated tasks, and communication delivery is missing. |
| §5 search/matching | Explainable matching is strong. Hosted semantic search and scalable server-side query adoption remain. |
| §6 normalized skills intelligence | Migration 025 closes the older audit's normalized-schema gap. Avoid rebuilding a parallel skills subsystem. |
| §7 history | Structured histories/evidence exist. Automated refresh, retention and measurement of transitions still need work. |
| §§8–9 screens/data model | Core internal screens and most objects exist, including templates, pools, clients and placements. External client/vendor surfaces remain. |
| §10 dedupe/data quality | Usable quality queues and merge review exist. Larger import/recovery workflows need acceptance testing. |
| §11 AI layer | Local heuristic alternatives exist for some tasks. No hosted embedding or AI provider/version/evaluation layer. |
| §12 security/governance | Tenant/RBAC foundation exists; malware scanning, stronger server-enforced audit/export controls, MFA/SSO and proven recovery remain. |
| §§13–14 architecture/API | PostgreSQL/RLS plus Netlify storage functions is workable. Jobs, event delivery, integration writes and observability are the main infrastructure gaps. |
| §15 delivery scope | Most R1 internal behavior exists. R1.5 hosted retrieval, R2 outreach and R3 integrations/nurture are incomplete. Do not label all release stages complete. |
| §16 acceptance scenarios | Implementation tests support many internal journeys; 200 real CV ingestion, production cloud journeys and sensitive-access auditing require additional demonstrations. |
| §17 analytics | Inventory/readiness/current-state reporting exists. Historical velocity and cohort attribution remain. |
| §18 exclusions | Continue excluding payroll/HRMS, unnecessary microservices and opaque automatic selection/rejection. |

## Research and product priorities

Official sources checked on 3 October 2026:

- [Zoho Recruit feature inventory](https://www.zoho.com/recruit/key-features.html): communications, resume inbox, job distribution, customizable fields, portals, workflow automation and interview reminders identify important gaps.
- [Greenhouse scorecards](https://support.greenhouse.io/hc/en-us/articles/4414777492891-Scorecard-overview): structured evaluation already has a comparable implementation here; prioritize independent reviewer assignment/reminders over duplicating scorecards.
- [Workable features](https://www.workable.com/features/): email/calendar integrations, interview self-scheduling and sourcing workflows inform later phases. Preserve the existing booking primitive and add delivery/sync around it.
- [Ashby analytics](https://www.ashbyhq.com/platform/recruiting/analytics): historical hiring performance and self-service reporting support prioritizing real stage-event/time/cohort measurements.

These comparisons are capability research, not a claim of complete plan-by-plan parity. Native video recording, sourcing chatbots and native mobile apps are lower priority than reliable core workflows and communications.

## Phased implementation on the existing stack

Continue the existing `REMAINING_FEATURES_ROADMAP.md` rather than restarting or duplicating completed work.

| Phase | Deliverable | Acceptance criteria and dependencies |
|---|---|---|
| Existing Phase 2 — repository depth (current) | Admin field configuration and client/contact fields (migration 034); then fields on remaining needed modules and report/filter support; wider server search/pagination; reliable PDF extraction. | Admin can configure/archive/restore fields; recruiters can save typed values; viewers cannot write; history/sync and tenant isolation hold. Search no longer needs all candidate/document rows loaded. Real compressed PDF fixtures must parse. |
| Phase 3 — server execution and communication | Durable PostgreSQL job/outbox records; bounded workers; retry/idempotency/error UI; email adapter with delivery log; application acknowledgement, interview invites and reminders; workflow evaluation for API writes. | Jobs run with browser closed; retries do not duplicate effects; email domain/provider configured server-side; bounce/suppression and consent honored. Use fictional test recipients in staging. |
| Phase 4 — integrations and historical metrics | Signed webhooks; scoped write APIs/mapping registry; inbound resume adapter; calendar OAuth/sync; append-only stage events and hiring velocity/cohort analytics. | Workspace/role rules hold on external writes; webhook signatures and replay protection tested; expired tokens recover; historical metrics distinguish censored/incomplete journeys. Calendar/mail integrations require accounts and provider setup. |
| Phase 5 — hosted retrieval and parsing | PostgreSQL FTS/pgvector; queue-based embeddings; provider abstraction; reviewable structured CV/JD extraction, versioning and relevance evaluations. | Cross-tenant retrieval denied; fixed candidate/JD fixtures measure quality; generated proposals require review; spending limits and model/prompt versions recorded. Provider credentials stay server-side. |
| Phase 6 — client collaboration and governance | Scoped client review portal first; e-sign adapter if needed; malware quarantine/scan jobs; retention execution; server export controls; encrypted backups/restore drills; MFA/SSO policy; integration/queue health. Vendor portal afterward if needed. | Client sees only authorized submissions/fields; unscanned files cannot download; subject requests and retention are auditable; recovery meets documented RPO/RTO; privileged access rules enforced server-side. |

The dependency order is deliberate: messaging, webhooks, nurture, scanning and embeddings all benefit from the same reliable job foundation. Do not implement separate fragile browser timers for each.

Architecture references: [Supabase Queues](https://supabase.com/docs/guides/queues), [Netlify scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/), [Netlify function configuration](https://docs.netlify.com/build/functions/configuration/?fn-language=js), [Supabase automatic embeddings](https://supabase.com/docs/guides/ai/automatic-embeddings). Use short bounded worker batches with resumable state: scheduled Netlify functions have execution limits, and background functions do not replace a durable queue. Plan availability/billing and configured extensions must be verified before production activation.

## Delivered in this audit's first implementation slice

- Workspace settings now has an admin-only custom field manager for candidates, demands, clients and client contacts.
- Supports optional text, decimal number, date and explicit-choice fields; case-insensitive duplicate names and unsafe keys rejected.
- Client/contact create/edit forms and account displays use configured fields. Archived field values remain visible and are retained for restoration.
- Shared candidate/demand input controls fix automatic-first-choice behavior and blank-number-to-zero coercion.
- Migration 034 validates definition/value shapes server-side, prevents field removal/retyping, preserves existing record RLS and keeps client/contact history and incremental sync intact.
- Fields are visible to workspace members. They do not implement field-level secrecy; financial information belongs in the existing restricted fields/tables. No new email/AI provider or account is required.

Production activation: apply `034_custom_fields.sql` after migrations 001–033, then deploy the updated frontend. If 032/033 are not applied in the actual Supabase project, apply those first. This report does not claim that 034 has been run remotely or these local changes have been published.

## Verification

- Full automated suite: **587 tests passed, 0 failures** (Node test runner, PGlite and React/jsdom), after the final code changes.
- New tests exercise admin configuration, typed client/contact writes, archive/restore, cleared numbers, empty dropdowns and visible save failures. PGlite applies the complete migration chain and reruns 034 to check idempotency; it verifies definition/value validation, denied recruiter configuration/viewer writes, tenant boundaries, historical values and incremental sync.
- ESLint: passed. Production build and initial-entry bundle budget: passed (62.5 KiB / 100 KiB budget).
- Prettier on all changed JavaScript/JSX files: passed. Repository-wide `format:check` reports **103 unchanged files** with existing formatting differences; this slice does not reformat them.
- Local browser: reviewed the new Custom fields panel in the running demo at `http://127.0.0.1:5173/`. Automated user journeys cover its write/archive flows. Existing browser demo data was not reset.
- Production: observed the live sign-in page only. No authenticated production upload, migration 034 execution, deployment or actual provider communication was performed.

## Post-audit implementation addendum: Phase 3 first slice

The baseline matrix above remains historical. Local migration 035 and the scheduled Netlify worker now provide durable, atomic database workflow jobs plus server-side assignment, admin queue visibility and replay. This advances the server-execution group from missing at the baseline to a partial implementation pending hosted verification, email/provider delivery and scheduled/time-based workflows. The operational contract and deployment sequence are in [Phase 3 server execution](PHASE3_SERVER_EXECUTION.md). No updated competitor parity percentage is claimed.

## Post-audit implementation addendum: Phase 4/5 slices

Local migrations 036/037, authenticated Netlify endpoints and the webhook worker now provide integration writes with idempotency/mapping/version conflicts, signed event delivery, hosted vectors with tenant/filter/freshness checks, optional AI embeddings/drafts and reviewed artifacts. Optional 038 adds pgvector acceleration. The full suite passed 616 tests; final audit/provenance changes also receive targeted verification. No hosted deployment, live AI evaluation or OAuth connector setup has occurred. Calendar/mailbox connectors and larger relevance/throughput evaluations remain pending, so these groups improve to partial rather than complete. The detailed deployment contract is [here](PHASE4_5_INTEGRATIONS_INTELLIGENCE.md); the baseline percentage is not rescored.

## Operations implementation follow-up

Migration 039 adds private automatic index maintenance/backfill, retries/health, stale pending-AI cleanup, external mapping pagination and explicit reconciliation, plus paused/drained webhook key rotation. The full regression suite now passes 623 tests. The broader phases remain partial and authenticated hosted acceptance is pending. See [operations deployment](OPERATIONS_MAINTENANCE.md); no new parity percentage is asserted.
