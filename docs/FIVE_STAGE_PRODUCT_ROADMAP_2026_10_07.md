# Anthroprime: five-stage product roadmap

Research date: **7 October 2026**. Implementation baseline: local commit **54a145d**, branch `codex/technical-improvements`. This document plans future work; it does not activate integrations or certify production readiness.

## Recommendation

Complete the repository and access foundations, add reliable communication, deepen the ECOD assessment-to-readiness workflow, enable client collaboration, then automate governance and prove scale. Preserve the existing React/Vite, Netlify, Supabase/PostgreSQL and private object-storage architecture. Build on the working imports, scanning, jobs, analytics and intelligence adapters.

The product's distinctive value is a durable person record that connects recruiting, assessment, enrichment and deployment through Anthro-ID. Email and scheduling make that asset usable daily; verified readiness and rediscovery make it more valuable than a conventional applicant pipeline.

## Evidence and limits

I compared the original `ECOD_Talent_Intelligence_Repository_Product_Blueprint.docx` (version 1.0, 18 September 2026), current source/migrations, and the implementation contracts linked in the [gap matrix](BLUEPRINT_GAP_MATRIX_2026_10_07.md). I researched seven established products through their official product/help documentation: Greenhouse, Lever, Ashby, Workable, Teamtailor, Zoho Recruit and Bullhorn.

“Common must-have” here means a recurring, useful workflow across these products and this project's operating model. It is a product-priority inference, not a market-share ranking or proof that every vendor includes a capability in its cheapest plan. Competitor features are advertised/documented capabilities; I did not test their accounts. Hosted credentials, deployment, live-provider results, independent accessibility assessment and a representative recruiting pilot were unavailable for this audit.

The 3 October audit and older equivalence/backlog documents contain historical gaps that subsequent work has closed. Their old coverage percentages should not be reused. In particular, hosted vectors, optional AI drafts, signed webhook delivery, durable imports, private scanning, reviewed access packages and internal reminders now exist locally. Local tests establish specific implementation behavior; they do not establish hosted acceptance or complete legal compliance.

## What is already built

| Foundation                         | Current implementation                                                                                                                                            | Remaining boundary                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Durable identity and recruiting    | Compact Anthro-ID, retired-ID resolution, Candidate 360, demands, explainable matching, pipelines, interviews, offers, placements and separate commercial records | Richer verified facts, field permissions, full ECOD readiness and production acceptance                                                  |
| Repository and ingestion           | Saved spreadsheet/CV reviews, background commits, private originals, opt-in paged browsing/Candidate 360, taxonomy and skill evidence                             | Several workflows still expand the full workspace; CV excerpts are not normalized employment/education/project entities                  |
| Document protection                | Private ClamAV quarantine, optional OCR, attachment gates, legacy R2 review; VirusTotal hash reputation                                                           | Hosted workers/signature updates, historical text gating, physical cleanup and retention enforcement                                     |
| Jobs and integration               | Server workflow jobs, candidate write API/mappings, signed webhook outbox with retries and health controls                                                        | Email transport, OAuth email/calendar, broader write APIs and dedicated machine identities                                               |
| Intelligence and measurement       | Tenant-scoped hosted vectors, optional reviewed AI drafts, lifecycle/source/outcome analytics, existing report builder                                            | Richer permission-aware evidence indexing, representative relevance evaluation, verified-readiness and historical/custom-field reporting |
| Governance                         | Optional privileged MFA, audited document/CSV issuance, subject-request cases, outbound holds, reviewed access packages and erasure inventory                     | Comprehensive read/export audit, full request fulfillment, actual erasure, retention, SSO and proven recovery                            |
| Automation and external experience | Candidate portal, careers/applications, manual-slot self-booking, referrals, internal interview/freshness tasks                                                   | Actual notifications, live calendar availability, replies, nurture and client login/review                                               |

The latest recorded verification is 766 Node tests, four OCR tests, lint/format checks and a Netlify build. That evidence belongs to the baseline implementation; this research task did not rerun the application suite.

## What competitors suggest prioritizing

| Pattern and official evidence                                                                                                                                                                                                                                                                                               | Implication for Anthroprime                                                                                                   | Priority and stage                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Greenhouse assigns interview scorecards against predetermined job criteria and supports controlled feedback visibility. [Scorecard documentation](https://support.greenhouse.io/hc/en-us/articles/4414777492891-Scorecard-overview)                                                                                         | Extend existing assessments/interviews with interview kits, individual feedback, debrief and readiness evidence.              | Must-have, 3                                      |
| Workable combines email/calendar integrations with self-scheduling against connected calendars. [Self-scheduling](https://help.workable.com/hc/en-us/articles/360007483594-Self-scheduled-events), [feature inventory](https://www.workable.com/features/)                                                                  | Complete communication and free/busy scheduling around the existing portal and slot system.                                   | Must-have, 2                                      |
| Lever surfaces declined/unanswered interview invitations on candidate profiles and synchronizes RSVP information from supported calendars. [Interview RSVP documentation](https://help.lever.co/s/article/Viewing-responses-to-scheduled-interview-invitations)                                                             | Show event acceptance, conflicts and recovery actions inside the interview workflow.                                          | Must-have, 2                                      |
| Ashby integrates talent pools, sourcing projects, search of past candidates and outreach sequences. [Sourcing and CRM](https://www.ashbyhq.com/platform/recruiting/sourcing-crm)                                                                                                                                            | Reuse pools and identity history; connect rediscovery to approved outreach and response suppression.                          | Must-have foundation, 2–3; nurture depth, 5       |
| Teamtailor Connect supports candidate interests, future-job subscriptions and candidate updates. [Connect overview](https://support.teamtailor.com/en/articles/1228328-this-is-connect)                                                                                                                                     | Add explicit communication preferences, self-update requests and talent-community subscriptions to the existing portal.       | Must-have preferences, 2; community, 5            |
| Zoho Recruit's client portal shares candidates and collects structured decisions within controlled client access. Availability is limited to specified plans and the Staffing Agency edition. [Client portal](https://help.zoho.com/portal/en/kb/recruit/self-service-portal/client-portal/articles/client-portal-overview) | Build a narrow, submission-specific client review portal before a general vendor portal.                                      | Must-have for staffing, 4                         |
| Bullhorn Automation engagements collect candidate/client information through surveys linked to recruitment workflows. [Engagements](https://kb.bullhorn.com/automation/Content/Automation/LP/Engagements.htm)                                                                                                               | Use reviewed self-update and post-placement feedback to keep the repository useful; avoid importing every automation feature. | Valuable, 2 and 5                                 |
| Workable and Teamtailor document job distribution alongside hiring workflows. [Workable features](https://www.workable.com/features/), [Teamtailor features](https://www.teamtailor.com/en/all-features/)                                                                                                                   | Improve incoming applications through an approved public feed and one actually supported board connector.                     | Must-have feed, 4; partner connectors conditional |

This comparison favors completed workflows over a larger menu: a recruiter should be able to discover a candidate, understand their evidence, contact them, arrange an assessment, close a gap and share an approved submission without losing context.

## Delivery structure

Exactly five stages follow. Security, permission tests and operational checks run in every stage. Stage 5 deepens and automates governance; basic access, backup and policy safeguards are required before the Stage 1 pilot.

| Stage                                               | Outcome                                                                 | Dependency                                                                 | Indicative engineering effort |
| --------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------- |
| 1. Trustworthy repository and usable foundation     | Fast, accurate, permission-safe daily work                              | Existing local baseline; staging environment and approved operating policy | 4–6 developer-weeks           |
| 2. Communication and scheduling                     | Reliable candidate engagement and connected calendars                   | Stage 1 access rules; approved sender and first calendar provider          | 4–6 developer-weeks           |
| 3. Verified ECOD intelligence                       | Evidence-backed assess → enrich → validate → ready                      | Stage 1 verified facts; Stage 2 invitations where used                     | 5–8 developer-weeks           |
| 4. Client collaboration and controlled integrations | Secure submissions, client decisions and candidate inflow               | Stages 1–3; client pilot and provider permissions                          | 4–6 developer-weeks           |
| 5. Governed growth and production assurance         | Retention fulfillment, recovery, sustainable nurture and measured scale | Prior stages and approved retention/processor policies                     | 4–7 developer-weeks           |

These are preliminary estimates for one experienced engineer, with product review and part-time QA/operations support. They total 21–33 developer-weeks before contingency; allow roughly 26–41 weeks with 25% contingency. They are not calendar commitments. Scope, existing hosted configuration, provider approvals and pilot findings can change them. An optional connector or identity-provider rollout needs its own estimate. Release useful slices within each stage rather than waiting for all five stages.

## Stage 1 — Trustworthy repository and usable foundation

### What to build

- **S1.1 Complete bounded reads and writes:** migrate rich saved filters/sorts, editing, matching, reports, exports, bulk actions and global search away from full-workspace expansion. Include versioned custom-field definitions in appropriate filters/reports rather than adding a layout builder immediately.
- **S1.2 Verified candidate facts:** multiple contacts with a preferred contact; employment dates and sources; compensation currency, basis and fixed/variable components; availability provenance and field-specific verification. Preserve old facts. An ordinary edit must not automatically imply independent verification.
- **S1.3 Actionable data quality:** one queue for duplicate suggestions, incomplete contacts, missing dates, stale facts, invalid taxonomy aliases and unresolved import errors. Explain each finding and record the human resolution.
- **S1.4 Access and audit foundation:** add Assessor and Sales/Account scopes alongside existing Admin/Recruiter/Viewer; define separate compensation/commercial permissions and assignment/client boundaries. Cover profile access and each existing export/download surface with a server-side permission inventory and audit design.
- **S1.5 Staging and recovery baseline:** verify migrations, RLS/Auth, private document workers, Netlify schedules, keys and feature flags in a hosted staging workspace. Establish a backup/restore baseline before a live candidate pilot.

### How to build

Use cursor-paged PostgreSQL queries with validated filter schemas, stable tie-breakers and bounded detail fetches. Convert shared UI operations incrementally, starting with saved views and candidate editing. Export large results through a durable job and a permission-projected snapshot; the browser should never reconstruct an unrestricted export from partial cache data. Keep approved imports and review operations transactional and version checked.

Add contact/fact structures referencing the existing candidate UUID. Store capture source/time, verification actor/time, effective dates and supersession links. Derive the current value from the latest applicable verified fact; show unverified claims separately. Backfill legacy values with an explicit legacy/unknown provenance rather than inventing verification. Use a money representation with declared units and currency; current `money()` presentation and profile-history capture assume INR/LPA and need an explicit compatibility migration.

Enforce sensitive projections in database/API reads, exports, documents and semantic retrieval. Hiding a field in React is insufficient. Extend roles through additive migrations and negative authorization tests. Require current membership on privileged operations and invalidate stale sessions/caches after access removal.

Keep Anthro-ID exactly `ANTHRO-12345` for current use. Add allocation monitoring and an exhaustion runbook: the global sequence has only 99,999 lifetime allocations, including retired records and consumed gaps. Use a configurable warning threshold and plan an explicitly approved future namespace before exhaustion; preserve all existing IDs and aliases. Anthro-ID remains a display identifier, not authentication or proof of a real-world identity.

### Experience improvements

Make “My work” the default recruiter entry: overdue feedback, interviews, candidate follow-ups and freshness reviews with one useful next action. Keep security/integration administration in Settings. Add saved, shareable filter definitions, clear loading/error states, safe bulk previews and conflict recovery without discarded edits. Candidate 360 should surface preferred contact, verification age, current stage and next action, with detailed history available on demand.

Apply keyboard navigation, visible focus, labelled fields, accessible modal focus and usable mobile layouts across these workflows. Target WCAG 2.2 AA with automated and manual checks; do not claim certification from a scan alone. [W3C guidance](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)

### Exit gate

Run the blueprint's 200-real-CV plus spreadsheet exercise using appropriately authorized data. Review duplicate/error outcomes against an adjudicated sample. Demonstrate the combined experience/location/notice/engagement/budget query, reload-safe corrections and historical preservation. On a proposed 10,000-profile staging dataset, measure list/filter p95 against an initial two-second target and confirm bounded network responses; adapt targets to the real operating volume. Verify forbidden fields are absent from responses for each role and cross-workspace/client access fails. Restore database plus representative originals into an isolated environment, with outbound jobs paused. Record the evidence and rollback plan before the pilot.

## Stage 2 — Communication and scheduling

### What to build

- **S2.1 Transactional email:** application acknowledgements, invitation/booking confirmations, interview reminders, status updates and approved freshness/self-update requests; previewable templates and sender configuration.
- **S2.2 Unified communication history:** link sent messages, delivery/bounce outcomes and candidate replies to Anthro-ID and the relevant demand/application. Preserve source-provider identifiers and allow recruiter takeover.
- **S2.3 One calendar connector:** choose Google Workspace or Microsoft 365 according to the actual team's account usage. Add free/busy checks, invitations, RSVPs, rescheduling/cancellation, time zones and buffers. Add the second provider after the first is proven.
- **S2.4 Preferences and suppression:** purpose-specific preferences, unsubscribe where applicable, recruiting holds, revocation, response-based suppression and safe frequency caps. Transactional and recruiting communications need distinct policy decisions.
- **S2.5 Candidate self-update:** request contact/notice/availability updates through a scoped expiring link. Save candidate claims as reviewable changes and retain their source.

### How to build

Add a communication outbox to the existing durable-job pattern, committed alongside the business event. Store message/template versions, actor, destination reference, intent, provider ID and delivery state; protect bodies and contacts with appropriate access/retention. Reserve bounded attempts and leases. Recheck current permissions, consent/purpose eligibility and holds immediately before sending; cancel obsolete invites after source changes.

Start with one provider adapter and a development sink. Domain authentication, sender ownership, bounce handling, signed provider callbacks and rate limits are activation gates. Keep provider-accepted, delivered, bounced and unknown states distinct. A timeout after provider acceptance is ambiguous: reconcile by provider ID/idempotency support, or require reviewed recovery instead of blindly sending again. Do not promise exactly-once delivery from the database outbox alone.

Store OAuth credentials encrypted on the server, using minimal scopes and explicit disconnect/revocation. Deduplicate mailbox threads by provider message IDs; process attachments through existing private quarantine. Implement calendar sync cursors, expiring subscription renewal and a bounded reconciliation poll. Google documents that notification channels need replacement on expiration and notifications require a subsequent fetch of changed resources. [Google Calendar push documentation](https://developers.google.com/workspace/calendar/api/guides/push)

Retain current manual slots and E1/E2 internal tasks as useful fallbacks. A calendar connection error should disable claims of live availability and provide an explicit manual route. Lock bookings transactionally and handle concurrent booking/rescheduling.

### Experience improvements

Offer “Preview and send” within candidate/pipeline context with purpose, recipient and next scheduled action visible. Show conversations and calendar outcomes in one timeline. Display times in both recruiter and candidate zones, with accessible reschedule/cancel controls. Give candidates a clear acknowledgement and a minimal next step; do not expose internal scorecards or commercial notes in status updates.

### Exit gate

In hosted staging, exercise acknowledgement, reply, bounce, revoked consent, hold-before-send, duplicate callback, lease recovery, expired OAuth, repeated webhook and provider timeout. Test daylight-saving changes and simultaneous bookings. Show that a held/revoked candidate receives no eligible recruiting send after the final gate, and that ambiguous delivery never triggers an unreviewed duplicate. Verify E1/E2 behavior continues when external transport is disabled. Pilot one sender/calendar with a small consenting cohort before general activation.

## Stage 3 — Verified ECOD intelligence

### What to build

- **S3.1 Rich requirements:** typed language/certification/eligibility requirements, skill recency and relevant years, currency-aware compensation constraints, explicit unknown/failed/satisfied states and a reviewed JD-to-demand draft.
- **S3.2 Rich CV entities:** reviewed employment/education/project/certification records linked to page/section evidence. Group existing excerpts into actual entities; never turn extraction confidence into verification automatically.
- **S3.3 Structured assessment:** versioned interview kits, assessor assignments, dimension-level scorecards, evidence references, independent feedback submission and a debrief decision. Keep prior assessments intact.
- **S3.4 Full gap-to-readiness loop:** gap plans, enrichment objectives and completion evidence, reassessment, validator decision, validity/expiry and estimated ready date. Add an append-only readiness journal distinct from profile status and assessment score.
- **S3.5 Hybrid retrieval and quality evaluation:** combine structured eligibility, full-text retrieval and existing hosted vectors; include approved project/CV/assessment evidence under an explicit permission and processing policy.
- **S3.6 ECOD analytics:** verified-ready cohorts, assessment → enrichment → reassessment outcomes, rediscovery rate, skill-gap heatmap, aging and historical/custom-field reports.

### How to build

Extend the existing demand, skills/evidence, assessment and enrichment models. Snapshot the requirements/rubric version on evaluation; reference those versions in matching and readiness decisions. Readiness records should include candidate, applicable demand/domain, validator, source assessment/evidence IDs, decision, validity and supersession. “Observed ready,” manually set profile status and “validated ready” must remain separate labels and metrics.

Use the existing provider/version/quota abstraction for schema-validated AI drafts. Include model/prompt/source versions, citations and explicit approval/rejection; handle unavailable providers with manual forms and deterministic parsing. Apply all hard constraints before displaying eligible shortlists; unknown eligibility requires review rather than an invented pass. A failure can still be shown as a near-match with its blocker clearly explained, without an automatic rejection.

The current hosted professional-text vectors omit raw CV/project/assessment text. Add approved evidence chunks with workspace, candidate, document/assessment version, permission classification, scan state and provenance. Rebuild or invalidate chunks on edits, merges, access restrictions and erasure. Establish an explicit policy for external embedding of evidence; private/deterministic retrieval remains available where external processing is inappropriate.

Build a labelled set of at least 50 representative demand queries and reviewed candidate judgments. Compare deterministic-only and hybrid retrieval using precision/recall at a defined shortlist size, blocker mistakes and stale evidence rates. Make production expansion contingent on improvement over the baseline and zero cross-tenant/forbidden-source disclosure in the security fixtures. Historic metrics need timestamped events and defined denominators; missing events should appear as missing data, not fabricated backfill.

### Experience improvements

Show a side-by-side candidate comparison with requirement results, dates, evidence and gaps. Link each explanation to an authorized source. Give assessors a small assigned-work screen, not access to the entire recruiter repository. Give recruiters a gap plan that says what to do, who owns it and when reassessment is due. Display “Ready for this demand until [date]” only after validation, and allow a reusable domain-readiness decision when appropriate.

### Exit gate

Demonstrate approved JD → demand → evidence-based shortlist → assessment → gap → enrichment → reassessment → validated ready. A new scorecard or profile edit must not rewrite an old assessment/decision. Expired readiness cannot silently qualify a candidate. A reviewer must be able to correct CV/AI output and trace every fact. Reports must reproduce readiness/rediscovery cohorts from events, respect field permissions and disclose incomplete historical coverage.

## Stage 4 — Client collaboration and controlled integrations

### What to build

- **S4.1 Client review portal:** invitation, client/demand-scoped shortlists, approved submission snapshots, comments/ratings, decisions and interview requests.
- **S4.2 Submission and offer workflow:** approved versions, consent/hold checks, feedback deadlines and change invalidation. Extend current offer approval/document generation with e-signing only where a real client requires it.
- **S4.3 Candidate inflow:** reliable source attribution and a public approved-job feed, followed by one permitted job-board or mailbox connector. Keep the existing careers/referrals flows.
- **S4.4 Integration-grade APIs:** dedicated scoped/revocable machine credentials, broader versioned writes where needed, incremental feeds, mappings and operational reconciliation. Extend existing webhook/API infrastructure.
- **S4.5 Account visibility:** approved demand/placement progress and role-permitted commercial views; retain a clear boundary between client-facing amounts and internal cost/margin.

### How to build

Create a separate portal-user membership model scoped to the client and explicitly shared submissions. Do not map clients to the existing workspace Viewer role. Server projections must omit contacts unless approved, compensation/private notes/assessments unless explicitly permitted, other clients and internal commercials. Share an immutable reviewed submission version, not a live unrestricted Candidate 360. Use expiring/revocable invitations and audited access; changes or holds invalidate future sharing as defined by policy.

Keep client feedback separate from internal assessment and preserve who submitted it. Model statuses and SLA timers from durable events. E-sign integrations need signed callback verification, document hashes, approval-version binding and reconciled outcomes; a generated PDF is not an executed contract.

Publish only approved, careers-visible demands to the job feed; unpublish closures/approval changes reliably. Partner posting APIs, LinkedIn messaging and job-board entitlements require provider approval and credentials. Existing People Data Labs LinkedIn lookup is a reviewed enrichment adapter, not official LinkedIn posting/messaging or permission to scrape. Prefer one connector selected by the pilot's actual acquisition channels.

For machine credentials, bind scopes/workspace/expiry, protect secrets, log use and support rotation. Use existing UUIDs plus Anthro-ID display labels, idempotency receipts and optimistic versions. Reconcile external changes rather than overwriting newer human-reviewed facts.

### Experience improvements

Give clients a short review list: fit summary, approved evidence, interview request and structured feedback. Let recruiters see “awaiting client decision” and aging directly on the submission. A changed/withdrawn submission should explain its status instead of leaving a stale download link. Group connector health and recovery actions in one administrator screen.

### Exit gate

Two-client tests must prove no crossover by IDs, search, exported packs, files or API endpoints. Repeated decisions and callbacks must not duplicate stages/offers. Removing a share/member must revoke subsequent access. Demonstrate approval change → job unpublish, external retry → single business update, and client feedback → recruiter next action. Activate an optional e-sign connector only after a provider sandbox proves document/version binding.

## Stage 5 — Governed growth and production assurance

### What to build

- **S5.1 Full subject-request fulfillment:** extend the reviewed package to authorized original files, relevant custom/history/provider data and tracked delivery. Keep exclusions explicit and reviewable.
- **S5.2 Retention and erasure execution:** approved retention categories, review dates, legal holds, dry-run impact, reviewed authorization, resumable deletion/anonymization and external-copy/back-up handling evidence.
- **S5.3 Stronger access operations:** optional organizational SSO, comprehensive privileged-session policy, broader sensitive-read/export auditing, bulk-export anomalies and format-appropriate watermarking/provenance.
- **S5.4 Recovery and scale:** encrypted off-site database/object backups, tested restores, redacted observability, worker failure alerts, load tests, query/index tuning and documented incident/rollback procedures.
- **S5.5 Sustainable talent CRM:** opt-in job-interest subscriptions, response-aware nurture sequences, redeployment prompts and reviewed post-placement candidate/client feedback. Measure whether reengagement improves validated readiness and deployment.

### How to build

Use D3/D6/D7 as the review and inventory foundation, not as proof that data was deleted. Introduce an approved category registry covering live and retired identities, original objects, extracted text, embeddings, imports, jobs, provider payloads and detached historical/custom references. Freeze/restrict relevant processing according to the approved case policy. Resolve source-version changes before executing irreversible steps.

Execute small idempotent batches with item receipts and retries. Record retained categories and the policy rationale. Prevent new indexing/messages for restricted subjects and prevent delayed jobs from recreating erased content. Minimize retained audit evidence without blindly destroying records that require retention. Reconcile storage/provider cleanup and document backup expiration/restoration suppression; do not claim immediate removal from immutable backups. Test restoration with a deletion/restriction ledger so recovered data is not unintentionally reactivated.

Back up the database and original objects separately. Supabase's database backups contain object metadata, not the Storage object bytes; its documentation recommends off-site CLI dumps for free-tier projects. Managed backups/PITR have plan dependencies. [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups)

Use encrypted backup tooling such as restic for operator-controlled off-site snapshots where the deployment supports it, with explicit database-dump/object manifests and isolated restore validation. This still needs storage, scheduling, key custody and an operator; free software does not mean zero operational cost. [restic documentation](https://restic.readthedocs.io/en/stable/010_introduction.html)

Set recovery objectives before the pilot; proposed starting targets are recovery point ≤24 hours and recovery time ≤4 hours, contingent on actual infrastructure and a successful drill. Tighten only when required and proven. Use permission-safe structured logs, correlation IDs and queue age/failure metrics; avoid CV/contact text in logs. Load-test imports, retrieval, exports, reminders and connectors together.

Nurture uses Stage 2's transport and suppression rules. Stop or pause sequences on replies, withdrawals, holds, loss of eligibility or preference changes. Do not use open tracking as the main success signal: prioritize replies, agreed assessments, verified updates, readiness and deployments. Build a vendor portal only after client collaboration demonstrates a specific unmet need.

### Experience improvements

Show a governance worklist with due dates, remaining categories and evidence needed. Explain “retained by policy” separately from “deleted.” Make connector/worker health understandable to the administrator: what failed, which workflow is affected and how to recover safely. Candidates should control subscriptions and see an honest update confirmation; recruiters should see which older talent was rediscovered and why contact is appropriate.

### Exit gate

Complete one reviewed access request and one authorized test erasure across all included database, object, vector and job categories. Prove holds and retries cannot resurrect data. Restore a separate environment with restricted/erased identities suppressed and outbound workers paused. Verify organizational identity/session removal where SSO is enabled. Run a representative pilot measuring bounded response times, queue age, failed workflows and rediscovery-to-ready/deployment outcomes. Leave optional nurture disabled until its preferences and suppression tests pass.

## Architecture and free/open-source choices

| Area           | Preferred approach                                                                                          | Cost/operating boundary                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Web/API        | Existing React/Vite and Netlify functions; staged flags and short bounded jobs                              | Validate actual plan quotas before activation; no Next.js rewrite required                                                 |
| Data/search    | Existing PostgreSQL full-text search, taxonomy and pgvector                                                 | Tune measured queries first; introduce a separate search cluster only for a demonstrated limit                             |
| Scanning/OCR   | Existing private ClamAV and Poppler/Tesseract workers                                                       | Requires privately hosted compute, engine/signature updates and capacity checks                                            |
| VirusTotal     | Preserve optional server-side hash reputation, without uploading CV bytes                                   | A key alone does not authorize commercial/business use; validate licensing                                                 |
| Email/calendar | One outbound transport and one OAuth calendar adapter first; test sink/manual fallback                      | Free quotas, domain setup, provider approval and mailbox permissions vary; choose after account/volume discovery           |
| Backups        | Database exports plus separate object backup; encrypted off-site snapshots/restore drills                   | Storage and operators still cost money; managed recovery features may require a paid plan                                  |
| AI             | Existing opt-in provider abstraction with schemas, review and quotas                                        | Make AI optional; do not assume free production inference or send sensitive evidence without an approved processing policy |
| QA             | Existing meaningful migration/UI/unit tests plus focused browser/accessibility/load tests for new workflows | Add tooling when it verifies a real risk; avoid a second overlapping test stack without need                               |

Netlify background functions have a documented 15-minute execution ceiling. Keep scanners/OCR and potentially large indexing jobs in the private worker architecture; use Netlify for bounded orchestration/API callbacks rather than relying on a single invocation to finish every large batch. [Netlify background functions](https://docs.netlify.com/build/functions/background-functions/)

VirusTotal's public API documentation prohibits commercial product/service use and business workflows that do not contribute new files. Preserve the current licensing gate and hash-only privacy design; use private ClamAV as the scanning foundation. Unknown hash reputation must remain unknown, not become a clean scan result. [VirusTotal API restrictions](https://docs.virustotal.com/reference/public-vs-premium-api)

## Metrics and rollout discipline

Measure baseline before setting improvement commitments. Product metrics: time to reviewed shortlist, time to validated ready, fraction of known candidates reused for a new demand, fresh verified profiles, assessment/enrichment conversion, source-to-ready/deployment conversion and client-feedback delay. Define rediscovery as an existing person reused in a later demand, preserving dates and prior application context; distinguish it from a newly imported duplicate.

Operational metrics: p95 read latency, response size, queue age, scan/signature age, failed/recovered jobs, ambiguous deliveries, bounced messages, denied access, original-object backup coverage and observed restore duration. Preserve denominators and distinguish “no data” from zero. Track interaction effort through observed recruiting tasks rather than guessing that extra dashboards improve usability.

Each stage: additive migration → local tests → hosted staging acceptance → limited pilot → controlled release. Use feature flags for optional connectors/AI/automation and documented drain/rollback procedures. Security and migration checks are release requirements, not work deferred to the final stage. No stage is complete merely because a local build passes.

## First implementation slice

Start **S1.1 with paged saved views and candidate editing**, closing the current full-workspace fallback for a common daily workflow. In parallel within the same engineering workstream, specify S1.2 verification semantics and S1.4's permission matrix before adding more sensitive fields. Complete hosted scanner/backup acceptance for the pilot. Then implement **S2.1 application acknowledgement email** as the first communication slice, using the durable outbox and final consent/hold checks.

Do not prioritize payroll/HRMS, an unrestricted custom-module builder, voice-AI screening, automatic AI rejection, dozens of connectors, a new vector database or a native mobile app. SMS/WhatsApp, reference-check adapters, e-signing and a vendor portal are conditional extensions after a real customer workflow establishes their value and operating requirements.

## Remaining decisions before activation

Identify actual sender domain/mail/calendar accounts; representative data volume; recruiting/assessor/sales/client access rules; jurisdictions and approved retention/processing policy; client pilot participants; infrastructure ownership and recovery objectives; licensed LinkedIn/job-board/VirusTotal entitlement where relevant. These decisions affect activation and estimates. Implementation can begin with provider-neutral schema/UI/test work while account choices are settled.

This roadmap and its matrix are planning artifacts only. Preserve the user's current instruction: **commit locally; do not push to GitHub**.
