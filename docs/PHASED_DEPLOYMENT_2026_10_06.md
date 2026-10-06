# ECOD gap closure and phased deployment

Phase E1 adds [internal interview preparation reminders](PHASE_E_INTERNAL_REMINDERS.md) locally using a minute-scheduled Netlify worker. Atomic shared tasks, private receipts, bounded retries, invalidation and admin controls work without a browser; external communication/delivery remains pending.

Phase D5 adds [optional administrator MFA](PHASE_D_PRIVILEGED_MFA.md) locally: Settings enrollment/step-up and trusted JWT assurance checks for cases/holds, audited candidate exports and document signing. Activation requires D1/D2 controls. General access governance and SSO remain pending.

Phase D4 adds [reviewed outbound recruiting holds](PHASE_D_OUTBOUND_HOLDS.md) locally. It governs pipeline writes and audited candidate CSVs while preserving corrections/cancellation; it is narrower than a complete processing restriction.

Phase D3 adds local [data-subject request review cases](PHASE_D_SUBJECT_REQUESTS.md). Case closure records manual administrative decisions; erasure/restriction execution and complete request fulfillment remain separate work.

Phase D2 adds [audited candidate CSV preparation](PHASE_D_CANDIDATE_EXPORTS.md) as a local opt-in slice. It covers repository/Settings candidate CSVs; other export formats and complete read governance remain future work.

Latest local progress: C4 structured CV evidence, C5 legacy R2 quarantine/retention review and [D1 audited document signing](PHASE_D_DOCUMENT_ACCESS.md) are implemented. D1 starts Phase D with optional download quotas, server-owned receipts, legacy Storage restrictions and an admin audit panel. Broader access/export governance remains pending; these slices have not been activated in production.

Scope: the remaining requirements in the September 2026 ECOD blueprint, building on migrations 001–039 and the compact Anthro-ID changes. This supplements the existing Remaining Features Roadmap; it does not restart completed work or claim production acceptance. Each phase is a separately deployable vertical slice; dates depend on staging results and provider setup.

## Phase A — Trustworthy historical analytics (first slice built locally)

- Database-owned append-only candidate status and consideration stage events, including actor, server timestamp and source at entry. Capture UI, portal, integration and direct authorized database writes through triggers.
- Mark existing records as baselines. Never invent historical stages from their current values or client-editable dates.
- Tenant-scoped 30/90/365-day cohorts, actual stages reached, observed stage progression, source-to-Ready counts and time to first Ready status.
- Show open journeys, missing history, skipped-stage limitations and merged/relinked exclusions. Ready is an observed recruiter status, not an assertion of validated assessment quality.
- Remaining Phase A slices: dedicated assessed/enrichment/validated-readiness and placement events, source-to-placement attribution, time-to-submit/first-shortlist, exports and historical report-builder fields.

Deployment: apply `20261006080639_lifecycle_analytics.sql` after existing core and Anthro-ID migrations, then deploy frontend. No external provider or new package required. Previous frontend remains compatible with the additive schema. Hide/revert the new panel if necessary; retain events rather than deleting evidence.

Exit tests: repeat migrations safely; capture transitions atomically with business writes; no event for unchanged states; rolled-back edits leave no event; tenant/viewer/anonymous boundaries hold; clients cannot forge/edit/delete events; no inferred skipped stages or migrated-history cohorts. Test two real workspaces in staging before production.

## Phase B — Durable imports and scalable repository browsing

**Local slices delivered:** [saved spreadsheet reviews and atomic background imports](PHASE_B_IMPORTS.md), an opt-in [durable CV staging/extraction preview](PHASE_B_CV_STAGING.md), and opt-in [paged startup/browsing/Candidate 360 reads](PHASE_B_PAGED_REPOSITORY.md). The [Phase C1 scan gate](PHASE_C_PRIVATE_SCANNING.md) is implemented locally; production activation requires a live scanner and hosted acceptance. Legacy workflows still load complete snapshots on demand, and representative hosted acceptance is pending; Phase B is not complete.

Verification for this slice: final full suite passed **677 tests**, plus lint/build/bundle checks. No hosted migration or deployment was performed.

1. Persist an import manifest, mapping and per-file state before processing; private object storage holds originals.
2. Reuse the existing PostgreSQL leases/retries pattern for extract/parse/review/commit jobs. Idempotency keys and hashes prevent replay duplicates.
3. Resume progress after tab closure; expose failed rows and retry; commit only recruiter-reviewed drafts. Connect extraction to Phase C's scan gate.
4. Replace full-table candidate/document loads with SQL filters, bounded pagination and on-demand Candidate 360 reads. Preserve matching explanations, saved views, Anthro-ID and permissions.

Tools: existing PostgreSQL/Supabase, Netlify workers, PDF.js, DOCX extraction and CSV/XLSX code. No paid parsing vendor required for text documents. Hosting quotas still apply.

Exit tests: 200 representative CVs plus spreadsheet metadata; close/reopen browser; crash/reclaim worker; replay batch without duplicates; inspect error report. Benchmark search on representative data and verify cross-workspace exclusion. Roll out behind workspace flags; retain current import/search as fallback until accepted.

## Phase C — Private document safety, OCR and parsing

**C5 local continuation:** [legacy R2 quarantine and retention review](PHASE_C_LEGACY_DOCUMENT_REVIEW.md) adds explicit adoption of eligible originals without moving bytes, an admin review inventory and server-enforced holds/reversible archive. Supabase/inline migration, historical text gating, deletion policy/cleanup and hosted acceptance remain pending.

**C4 local continuation:** [structured CV section evidence](PHASE_C_STRUCTURED_CV_EVIDENCE.md) adds bounded employment/education/certification/project excerpts, explicit recruiter confirmation, source-line checks for saved CVs and atomic persistence on candidates. It is a conservative first parsing slice; normalized entity grouping, legacy backfill/retention and hosted quality acceptance remain pending.

**Local slices delivered:** [C1 scan leases and extraction/approval/download gates for durable CV imports](PHASE_C_PRIVATE_SCANNING.md), followed by [C2 candidate/client attachment quarantine and C3 optional private OCR](PHASE_C_ATTACHMENTS_AND_OCR.md). New uploads use server-owned manifests, recoverable processing and scan-bound extraction/downloads when enabled. OCR uses a private Poppler/Tesseract sidecar with dedicated leases and text-bound provenance. Flags default off. Legacy backfill, richer structured drafts and live engine/hosted acceptance remain pending; this is not ecosystem-wide scan coverage.

1. Quarantine new object versions and deny download/preview/parse until a server-verified scan completes. Store verdict against the actual object hash/version, not a client-supplied claim. Legacy files remain explicitly unverified until backfilled.
2. Run ClamAV in an isolated worker with maintained definitions, bounded sizes/runtime and retry/health controls. Scan private bytes without publishing candidate files. Scanner outage keeps objects quarantined.
3. Add Tesseract/OCRmyPDF for scanned PDFs in the same isolated worker; use a sandbox with no unnecessary network access and CPU/memory limits.
4. Extract employment, education, certifications and projects into reviewable drafts; preserve originals and evidence provenance. Add optional provider parsing only with explicit workspace opt-in and quality checks.

Tools: [ClamAV](https://docs.clamav.net/), [Tesseract](https://github.com/tesseract-ocr/tesseract), [OCRmyPDF](https://ocrmypdf.readthedocs.io/en/latest/). These are open-source choices; hosting/storage and operational upkeep are not guaranteed free. Verify licenses and deployment versions at implementation. Long-running scan/OCR workers need a container/VM service; do not assume they fit short Netlify invocations.

VirusTotal integration, requested by Amit: an initial server-only hash reputation lookup is built locally. Only SHA-256 is sent, never CV bytes, filenames or storage links. Unknown/stale/incomplete reports are unverified. This does not scan new files, provide a clean verdict, or release quarantine. Standard upload scanning would disclose file contents to VirusTotal and requires a separate, explicit data-sharing decision and suitable commercial-use license. Private Scanning requires its own entitlement and supplies no antivirus-engine verdicts, so it is not an equivalent ClamAV replacement.

Exit tests: harmless test files and EICAR fixture in isolated staging; no malicious live samples required; pending/infected/error objects cannot download; verdict for an old version cannot release a replacement; stale definitions and worker outages fail closed; OCR preserves originals and does not auto-save extracted facts.

## Phase D — Access, audit and governance

- Add assessor and sales/account roles with an agreed matrix for candidate compensation, client commercials and assessment notes; enforce in DB/API, not only UI.
- MFA for privileged actions and SSO configuration as supported by the chosen authentication plan.
- Audited sensitive reads, signed downloads and export endpoints; server-side rate limits, row/field projections, provenance and unusual-volume alerts.
- Case-tracked data-subject requests, corrections, restriction and retention review tasks. Erasure/anonymisation must cover originals, notes, histories, mappings and linked records; retaining a profile with a blank name is insufficient.

Tools: existing auth/RLS, PostgreSQL, existing private storage; optional managed secret store. Provider SSO/MFA availability and cost must be verified. No automatic irreversible deletion until an approved retention policy and complete cascade behavior exist.

Exit tests: permission matrix allow/deny tests in two workspaces, sensitive read/export audit completeness, rate limits under concurrent use, revoked session behavior and full request fulfillment evidence. Deploy schema/backfill before turning on stricter app paths to avoid accidental lockouts.

## Phase E — Communication and nurture

- Provider-neutral delivery outbox with stable message IDs, consent/purpose checks, retries, suppression, delivery/bounce callbacks and visible failures.
- Application acknowledgements, interview invitations/reminders, freshness follow-ups and candidate re-engagement; then scheduled reports.
- Add internal scheduled tasks first so reminders work before an email account is configured.

Tools: existing job foundation and SMTP/API adapter. Use an existing approved SMTP service where possible, or a provider's current free tier after verifying business usage and limits. FOSS software does not provide free deliverability infrastructure. Avoid self-hosting a mail server as the initial rollout.

Dependencies: sending domain/DNS, credentials, reply handling, unsubscribe policy and test recipients. Exit tests: duplicate callbacks/retries do not duplicate sends; opt-outs and bounces suppress delivery; reminder cancellation after rescheduling; tasks run with browser closed. Start with internal/test recipients, then small enabled workspaces.

## Phase F — Mailbox, calendar and intelligence depth

- Google/Microsoft OAuth, encrypted server-side credentials, least-privilege scopes, renewal/revocation and connector health.
- Mailbox attachments enter the same quarantine/import pipeline; calendar changes reconcile bidirectionally without duplicate events.
- Add external ATS adapters on the existing mapping/version/idempotency APIs as needed.
- Extend retrieval to permission-safe CV/project/assessment text, combine AI retrieval with SQL filters, automate model-specific indexing and evaluate fixed relevance fixtures. Optional local embedding models can reduce provider spend but require hosted compute and model-license review.

Dependencies: provider applications, authorized test accounts, account quotas and business-approved data processing. Exit tests: expired/revoked tokens, conflicting edits, duplicate webhooks, tenant isolation and measured search relevance. Enable connectors individually.

## Phase G — Production operations and recovery

- Separate development/staging/production configuration, secrets and synthetic test data.
- Centralized redacted error/queue/integration monitoring and alerts; measure throughput and resource costs.
- Encrypted scheduled database/object backups, documented RPO/RTO and restore drills. Preserve candidate IDs and the Anthro-ID sequence in full database recovery.
- Run all blueprint acceptance journeys, security review and rollout checks; document operator ownership and rollback.

Tools: existing CI and health UI; FOSS monitoring/backup utilities where suitable. Verify actual managed backup/restore entitlements rather than assuming a free plan includes them. Restore into an isolated environment; never overwrite production during a drill.

## Common deployment gates

For every phase: additive migration and local tests → staging migration → server secrets/workers → frontend → authenticated acceptance → limited workspace activation → monitored production expansion. Use feature flags for new provider/processing paths. Take recovery snapshots before schema rollout. Pause workers/flags on failure, roll the frontend back, and retain compatible additive schema/evidence; destructive down-migrations are not the default rollback.

Current status: Phase A first slice, Phase B1 saved spreadsheet imports, Phase B2 opt-in durable CV staging preview, Phase B3 opt-in paged repository reads, Phase C1 private CV scanning, Phase C2 new candidate/client attachment quarantine and Phase C3 optional private OCR are implemented locally. VirusTotal remains optional hash reputation. The C2/C3 full regression passed all 702 Node tests and four Python tests, with lint and build checks passing. Remaining Phase C work includes legacy backfill/retention, richer structured extraction and hosted acceptance; later phases remain planned. No production migration, live key validation, CV transmission to VirusTotal or hosting deployment has been performed.

## VirusTotal activation

In Netlify server environment settings, enter `VIRUSTOTAL_API_KEY` and, after confirming your license permits this commercial workflow, `VIRUSTOTAL_USAGE_TIER=commercial`. Do not use a `VITE_` prefix, commit keys, paste them into chat or store them in browser settings. Redeploy functions. Workspace admins can then use **Workspace settings → VirusTotal document reputation**. The deployment setting is an operator declaration, not automatic verification of licensing. Provider quota errors are surfaced without keys or report contents in logs.

Official constraints: [Public vs Premium API](https://docs.virustotal.com/reference/public-vs-premium-api), [Private Scanning API](https://docs.virustotal.com/reference/private-files-api), [file report endpoint](https://docs.virustotal.com/reference/file-info). Public API commercial-use restrictions apply even to hash lookups; the integration therefore stays disabled without confirmed commercial configuration.

## Verification of the first local slices

- Full regression run: 670 tests, 669 passed and one new lifecycle test failed because its fixture reused a candidate/demand pair. All 662 pre-existing tests passed. The fixture was corrected to use a distinct candidate; the targeted suite then passed all eight new migration/UI/VirusTotal tests. This is aggregate verification, not a claim of a second full-suite run.
- ESLint passed. Production build and entry bundle budget passed (63.5 KiB / 100 KiB). Changed new JavaScript files pass Prettier and tracked diffs pass whitespace checks.
- Database tests run the real migration chain in PGlite/pgvector and check atomic rollback, immutable client permissions, tenant isolation, baseline handling, source snapshots, merge/relink exclusion and repeated stage visits.
- VirusTotal provider tests use mocks. No live key was tested, CV uploaded, migration applied to hosted Supabase, or production deployment performed. Hosted advisor checks, real account entitlement and authenticated staging acceptance remain deployment gates.
