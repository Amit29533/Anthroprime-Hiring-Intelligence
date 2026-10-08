# Milestone for Independent Featureset Completion

Date: 8 October 2026. Baseline: local Stage 5 commit `c6ae7c7`. Scope: the five **continuation stages** selected under “Next build order” in the [implementation audit](FIVE_PHASE_IMPLEMENTATION_AUDIT_2026_10_07.md#next-build-order). Independent means these workflows use the existing Netlify/Supabase application, authentication and database; they require no new delivery, calendar, AI or scanning service. It does not mean an offline production system or a replacement for the original broad product blueprint.

The five stages are locally implemented. This integration milestone closes the route and refresh gaps found in the audit. Hosted activation and acceptance remain separate. No GitHub push, hosted migration, deployment, external message or destructive action is performed by this milestone.

## Audit and corrections

| Finding | Completed correction | Evidence |
| --- | --- | --- |
| Full workflow overview lost the newer queues after leaving paged mode | Both overviews use `IndependentWorkHub`: communication tests, feedback, recruiter worklist, SLA review and repository quality. Full overview also receives client navigation. | Shared hub DOM tests and the cloud-startup route test |
| Full Candidate 360 omitted communication and feedback workflows | Added cloud Communication tests and Feedback & self-updates tabs, using the same protected APIs as paged Candidate 360. | Cloud-startup test opens both tabs after switching repository modes |
| Accepted self-update did not refresh the surrounding profile | Successful acceptance publishes a journal event; full profiles reload application data and paged profiles fetch their current projection and refresh the candidate list. A successful exact retry triggers the refresh once. Read-refresh failure preserves the accepted write and tells the user to reopen the profile. | Feedback DOM acceptance/retry/read-failure tests |
| Candidate changes could reuse component-local state | Candidate drawers are keyed by workspace, current role and candidate. Shared queue content remounts on workspace/role changes and suppresses late responses from the old scope. | Shared hub scope-change test; existing session/role suites |
| Invitation draft promised automatic email-based profile linking | Draft now describes explicit administrator-approved access and expiry, and describes availability changes as proposals. | Cloud route test checks the drafted link text; Stage 4 account-grant database tests |
| Completed operations jobs could be mistaken for successful exports | History explains that completion means processing ended; details show failed/stale counts and the recovery action. Exports retain the existing all-items-completed server guard. | Operations DOM failure warning and database failure-isolation/export tests |
| Unified queues needed actionable missing-migration errors | The repository RPC adapter now names the Stage 5 migration for SLA/operations and the worklist migration for recruiter queues. Missing APIs continue to fail visibly. | Cloud fixture deliberately returns missing APIs; existing missing-migration UI tests |
| Earlier status documents described the pre-continuation baseline | Added dated supersession pointers and this current acceptance matrix while retaining historical findings and the broader backlog. | Documentation link and scope review |

## Feature acceptance matrix

Each row maps the feature to its reachable surface and regression evidence. Related rows share suites; this is not a numerical feature-coverage score. The detailed bounds, permissions, recovery behavior and rollout contracts remain in the five stage checklists.

| Stage / feature | Reachable surface / consumer | Local verification |
| --- | --- | --- |
| 1: sourced employment, compensation and availability | Paged/full Candidate 360; administrator financial projection | Stage 1 facts, boundary and financial-boundary database tests; facts DOM tests |
| 1: explicit confirmation, corrections and current application | Candidate facts; Stage 2 constraint consumers | Fact provenance, stale-token and chronology scenarios |
| 1: verified contacts and primary-contact changes | Candidate Contacts; communication eligibility | Existing contact and verification migrations/UI tests |
| 1: duplicate suggestions, review dispositions and merges | Repository quality → duplicate review | Duplicate database tests; identity-family and merge tests |
| 1: five roles, scoped assignments and revocation | Members; assessor/sales Assigned Work | Assignment, privacy, raw financial boundary and viewer suites |
| 1: quality queues and compact ID capacity | Both cloud overviews | Quality/capacity database and DOM suites; Anthro-ID tests |
| 2: typed pass/fail/unknown demand constraints | Demand detail → demand journey | Journey and boundary database tests; Stage 2 DOM tests |
| 2: versioned kits and blind independent evaluation | Demand journey; assigned assessor work | Frozen configuration, evidence, seal/retry and assignment scenarios |
| 2: debrief, gap plans, independent validation and reassessment | Demand journey | Lifecycle and invalidation scenarios |
| 2: demand-scoped readiness, expiry and submission gate | Shortlists/submissions; sanitized client packs | Readiness/filter/submission/client-projection scenarios |
| 2: bounded readiness analytics and audited export | Reports | Population bounds, cohort scope, redaction, stale snapshots and quota tests |
| 3: versioned templates and eligible recipient segmentation | Both cloud overviews; both Candidate 360 variants | Communication database and DOM suites |
| 3: preview, explicit intents and frozen exact retries | Communication test workspace | Consent/contact/policy/source/hold and lost-acknowledgement scenarios |
| 3: deterministic scheduled test transport | Existing `test-communication-worker` Netlify function | Worker/database retry, quota, quiet-window, suppression and attempt-receipt tests |
| 3: cancellation, administrator recovery and outbox history | Communication test workspace | Cancellation, current-role/MFA and failure isolation tests |
| 4: explicit Auth account grants and account chooser | Candidate feedback review; authenticated candidate portal | Grant expiry/revocation/multi-account and portal UI/database tests |
| 4: reviewed profile and alternate-contact proposals | Candidate portal → staff feedback review | Proposal baseline, independent review, merge/hold/contact checks; profile refresh tests |
| 4: immediate communication preferences | Candidate portal; Stage 3 execution checks | Preference/consent distinction, held-profile and worker eligibility tests |
| 4: freshness and redeployment invitations | Candidate review; feedback work queue | Frozen question/scope/recipient, grant coverage and placement/demand tests |
| 4: candidate/client surveys and response review | Candidate/client portals; staff account/candidate feedback | Account isolation, exact request lookup, expiry, duplicate response and aggregate tests |
| 5: SLA policy, personal opt-in and UTC quiet hours | Settings; both cloud overviews | Policy/MFA, due-day/grace, wrapped quiet-window and DOM navigation tests |
| 5: explicit bounded profile report and bulk preview/application | Settings → Operations and governance | 250-identity workload, versioned preview/confirm, stale-source/hold, retry/cancel and export tests |
| 5: retention selection and subject-case coverage | Operations selector/jobs; linked subject-request case | Policy, future date, identity-family case/version and quota tests |
| 5: erasure inventory dry runs | Operations; formal subject-request checklist | Current 60-category D7 registry, frozen 57-category source review, bounded coverage and no-erasure tests |
| 5: redacted health, recovery and restore evidence | Operations; existing queue-specific retry panels | Health/export redaction, private-state snapshot restoration, receipt and forward-only ID tests |
| Existing ecosystem regression | Imports, CV/OCR, documents, VirusTotal/private scanning, search, careers, client sharing, machine APIs, workers and settings | Complete Node suite, Python OCR suite, production build and offline Netlify packaging |

## Scope and product limits

- Compact Anthro-IDs remain `ANTHRO-` plus five digits. Internal UUIDs remain authoritative; the finite 99,999-ID capacity is monitored and sequence values must not be recycled.
- Communication delivery in this independent slice is **test-only**. Manual portal links require existing authenticated accounts and explicit grants. Saving preferences never creates consent.
- Bulk changes cover owner and next action only. Reports describe explicitly selected identities; readiness reports disclose their bounded population. Neither is an unlimited repository analytics engine.
- Retention selects candidates for review. Erasure jobs are dry runs and formal checklists record reviewed evidence; there is no automatic destructive executor.
- Operations health covers its documented six queue families. Import, document/scan/OCR and webhook recovery continue in their existing specific controls; the aggregate does not claim to cover every queue or prove scheduler/provider delivery.
- Application JSON downloads remain partial portability artifacts. Private schemas, Auth, original object bytes and database configuration require complete database/object backups and independent recovery acceptance.
- Taxonomy/import disposition ledgers, richer paged/custom-field filters, cross-entity database search, broader demand-weighted analytics, automatic campaigns and external provider integrations remain in the [original broader roadmap](FIVE_STAGE_PRODUCT_ROADMAP_2026_10_07.md) and [blueprint gap matrix](BLUEPRINT_GAP_MATRIX_2026_10_07.md). Those are outside the five continuation-stage contract and are not silently marked complete.
- Existing optional VirusTotal/enrichment/storage integrations retain their configuration requirements. No new provider or secret is introduced or activated here.

## Validation record

**Status: locally complete.** The complete regression run passed **894 Node tests** with zero failures, cancellations or skips (498.7 seconds). Four Python OCR tests passed. Focused route/shared-queue/feedback/operations checks passed all 20 scenarios, and all three paged repository scenarios passed. After the final demo-only lazy-mount guard, a further 17 smoke, dashboard/worklist, viewer and cloud-navigation tests passed. The JSDOM runs emitted React asynchronous `act` guidance in some fixtures; these are not real-browser accessibility or console-clean acceptance.

Final ESLint completed without warnings. Changed-file Prettier, Git whitespace and 107 local documentation-link checks passed. The final Netlify offline production build completed in 22.5 seconds and packaged all **18 functions**, with a **68.2 KiB** main entry against its 100 KiB budget. The API audit and migration suites validate local wiring and contracts; they do not replace the hosted checks below.

The first focused route test used a button-role query for an existing clickable candidate name; correcting the fixture to click that name made the route test pass. An initial lint run found one obsolete import after queue consolidation; it was removed before the final lint. A formatting check found one route-test line requiring formatting; the final check passed.

A literal API wiring audit found 138 names referenced by the frontend/Netlify functions, all present among 149 migration API names. This is a name/declaration check, not proof that every dynamic path or hosted request succeeds.

Supabase local security/performance advisors were attempted and could not connect to `127.0.0.1:54322`; no local database server is running. This is an outstanding hosted acceptance check, not a passing advisor result.

## Activation handoff

1. Apply **every migration in sorted filename order through `20261007190524_stage5_operations_governance.sql`** to a backed-up staging database. This milestone adds no migration or service.
2. Deploy frontend and the existing 18 Netlify functions together. Confirm existing environment variables, private storage access and worker scheduling. Keep policies paused until their guarded acceptance checks pass.
3. Follow [Stage 1](STAGE_1_COMPLETION_CHECKLIST.md), [Stage 2](STAGE_2_COMPLETION_CHECKLIST.md), [Stage 3](STAGE_3_COMPLETION_CHECKLIST.md), [Stage 4](STAGE_4_COMPLETION_CHECKLIST.md) and [Stage 5](STAGE_5_COMPLETION_CHECKLIST.md) hosted checks: real Auth/PostgREST roles, AAL1/AAL2, tenants, revocation, independent sessions, realistic workload, object access and restore.
4. Run the opt-in [Stage 5 hosted acceptance harness](../scripts/stage5-hosted-acceptance.mjs) only in its disposable staging workspace. It is not part of automatic tests and has not been run against a hosted project.
5. Recapture affected D7 inventories and regenerate reviewed D6 disclosure packages. Verify live browser keyboard/mobile behavior and downloads. Obtain policy, recovery and provider decisions separately where required.

Completion means the defined local independent feature set and integration checks are complete. It is not certification that every DOCX requirement, every possible edge case, production capacity or hosted deployment has been accepted.
