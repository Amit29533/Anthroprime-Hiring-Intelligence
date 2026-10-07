# Phase A2 — ECOD outcomes and hiring velocity

This continuation adds server-observed assessment, enrichment, demand and placement events to the existing append-only lifecycle journal. It builds on the original historical status/pipeline analytics without replacing them or inventing old journeys from editable dates.

## Delivered

- Demand creation to first shortlist entry, where a shortlist entry means a candidate linked through a consideration.
- Consideration creation to the first observed Submitted state.
- Candidate entry to the first observed Active placement. Planned, Completed without an observed Active state, and a Deployed consideration alone do not establish placement activation.
- Completed enrichment to a subsequent recorded reassessment, matched to the plan's skill and demand scope. A general assessment is eligible for a demand-specific plan; another demand's assessment is not.
- Source-at-candidate-entry to assessment and active-placement counts, plus observed placement conversion. Later edits to a candidate's source do not change cohort attribution.
- Enrichment completion, subsequent reassessment, and a subsequent transition to Ready. These are observed sequences, not evidence that training caused improvement or that all skills passed validation. Multiple qualifying plans can share a reassessment; plan counts are not unique-person counts.
- Completed sample counts, unobserved counts, mean, median and 90th-percentile days. Missing milestones remain unobserved and do not become zero-duration samples. Rates include ongoing candidate journeys and can change over time.
- A historical CSV containing aggregate metrics and server-owned provenance. Editors can prepare exports; viewers can read the analytics but cannot prepare exports. Preparation stores the exact summary with a receipt, serializes per-user requests and allows five exports per minute. Source values are formula-escaped; candidate contacts, documents and commercials are absent.

## Evidence and limits

`ecodAnalyticsCoverage` records the start of outcome tracking for each workspace, including newly created workspaces. Existing records become baselines; migration reruns preserve the original coverage timestamp. Outcome candidate cohorts include only unmerged candidates first recorded after both coverage start and the selected 30/90/365-day cutoff. Baseline histories, relinked entity histories and future-dated events are excluded. Current business records must remain available for the corresponding cohorts; this is not an immutable warehouse after physical deletion.

Events commit with business changes. No-op status writes and unrelated notes/owner changes do not create artificial milestones. Cancelled, terminated or reopened records do not erase milestones already reached; these metrics describe historical progression, not present active-headcount.

Dedicated validated-readiness decisions, richer causal uplift measures and historical fields in the custom report builder remain subsequent work. This slice does not complete all blueprint analytics or the other five remaining feature groups.

## Deployment

1. Apply the complete migration chain through `20261007062351_ecod_outcome_analytics.sql` in staging before deploying the matching frontend.
2. Deploy the frontend. No new provider, secret, function or feature flag is required. An older database still shows the original lifecycle panel with a message explaining the missing outcome migration.
3. In two staging workspaces, verify real assessment/enrichment/placement changes, absence of cross-workspace counts, viewer export denial and the stored export receipt. Export preparation records issuance, not proof that a file was retained by the browser.
4. Keep the additive journal and receipts on frontend rollback. Normal workspace JSON backups do not include these server-owned tables; full database recovery must include them.

No hosted migration or production activation is performed by this development pass. Local tests use embedded PostgreSQL; hosted throughput and database advisors remain acceptance checks.

## Verification

Focused database, CSV and UI tests cover replay-safe migration, coverage for existing/new workspaces, source snapshots, time samples, wrong-skill exclusion, actual Active placement, incomplete journeys, append-only permissions, rollback, merge/relink exclusion, tenant boundaries, viewer denial, rate limiting, receipt snapshots, formula safety, missing receipt refusal and delayed workspace changes.

The final full run passed all 749 Node tests with zero failures or skips (361.6 seconds). ESLint, changed-file formatting and Git whitespace checks passed. Netlify's offline build bundled all 13 functions and passed the main-entry budget (65.0 KiB against 100 KiB). Supabase local advisors were attempted but could not connect to `127.0.0.1:54322`; no local Supabase service is running. Embedded PostgreSQL tests passed; hosted advisor and authenticated acceptance checks remain pending.
