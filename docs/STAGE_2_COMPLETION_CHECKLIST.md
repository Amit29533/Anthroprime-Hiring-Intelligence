# Stage 2: demand-specific ECOD journey

Baseline: local `1269a6b`, 7 October 2026. This closes continuation milestone 2 from the [five-phase audit](FIVE_PHASE_IMPLEMENTATION_AUDIT_2026_10_07.md#next-build-order), corresponding to the demand journey in original Phase 3. It is separate from the original roadmap numbering. No added service, provider, deployment or GitHub push. Local commits only.

## Implemented contract

| Area | Completed behavior |
| --- | --- |
| Demand policy | Administrator-reviewed, append-only versions; up to 40 typed hard requirements, 1–20 weighted kit criteria, per-criterion passing floors, 1–5 independent assessors, threshold and validity. No automatic conversion of legacy briefs into confirmed policy. |
| Evidence checks | Explicit satisfied, failed and unknown. Skill experience/proficiency uses the latest dated validated evidence; experience, language, certification and eligibility use sourced, confirmed claims. Location/engagement/notice/mode use applicable Stage 1 confirmations. Pay requires an administrator, explicit currency units, matching currency and basis; no inferred conversion. Zero notice is known; null is unknown. |
| Source claims | Explicit confirmation defaults off, observation and expiry dates, typed values, append-only corrections, retained sources and recording actor. New unconfirmed evidence does not silently fall back to an older passing claim. |
| Assessment | Active candidate-scoped assessor grants, fixed configuration references, blind independent scorecards, evidence for every criterion, weighted score computed on the server, immutable seals and exact-operation retries. Other assessors' submissions/debriefs are withheld from the assigned surface. |
| Debrief | All required cards must be sealed before Pass/Gap/Not-ready. Pass requires each card's aggregate threshold, criterion floors and current validity. An obsolete or abandoned cycle can be cancelled to permit a fresh cycle. |
| Enrichment | Owned gap plans with required evidence, due and estimated-ready dates; sourced owner/admin completion; independent administrator validation; fresh reassessment after the last validation. Merged identities retain open obligations. No completion checkbox alone grants readiness. |
| Demand validation | Independent administrator journal: Ready, Near-ready, Not-ready, Revoked. Ready requires every hard requirement, all independent passing cards, a passing debrief and validated gaps. Expiry is capped by the earliest fact/assessment expiry. |
| Freshness | Source/configuration changes produce Needs review; date expiry produces Expired; revocation withdraws Ready. General candidate profile status, legacy fit and old decisions never certify current demand readiness. Identity merges invalidate source fingerprints and preserve historical evidence. |
| History/recovery | Bounded history of frozen kit versions, seals, debriefs, claims, gaps and validator decisions. Current grants are rechecked for assigned writes. Failed drafts survive explicit version refresh; failed acknowledgements reuse the exact operation. |
| Consumers | Server-filtered shortlist with current validated-ready/confirmed-eligible filters, 25-row pages; configured submission gate; readiness-aware client-pack source fingerprint and approval; expired/stale packs and feedback are withdrawn. |
| Reports | Current Ready/eligible counts over at most 1,000 active unheld identities, explicitly labelled coverage; 90-day recorded cycle/card/gap/reassessment/decision event cohorts. Reviewed aggregate exports have server audit, actor/time, snapshot checksum, durable retry receipt, stale-count rejection and six-new-exports/minute quota. |
| Privacy | D7 inventory expands from 41 to 48 categories, including claims, cycles, cards, debriefs, gaps, decisions and candidate-linked receipts. D6 explicitly excludes these private records for separate administrator-reviewed disclosure. No new automatic erasure/disclosure. |

## Access and data boundaries

Administrators configure policy and validate gaps/readiness; recruiters record nonfinancial evidence, coordinate cycles/debriefs and manage their plans; viewers only read the full-role projection. Assessor accounts use assigned work with only their own card and frozen kit. Sales/account and external client accounts cannot invoke full journey/report APIs. Client packs expose only sanitized current demand validation metadata, without internal sources, scorecards, validator reasons, identity-family inventories, financial criteria or decision IDs.

All eight new tables are in an unexposed private schema with RLS and no browser raw access. Public APIs are security invokers into explicitly guarded private routines. Membership/tenant/assignment checks, workspace/candidate locks, opaque source/version fingerprints, actor-bound operation receipts and server audit apply. Privileged configuration/validation/export honors existing opt-in MFA. Staff configurations hide compensation constraints; staff eligibility remains unknown for those private checks. Free-form evidence remains shared among authorized full-role staff: do not place restricted financial information in it.

The source inventory includes current candidate/demand, applicable family facts, skills and journey evidence, but not read audit or decisions themselves. It conservatively invalidates readiness after related candidate journey changes. Assignment revocation blocks future assigned reads/writes; it does not rewrite a historically sealed card. Use the explicit validation revocation when a recorded assessment is subsequently discredited.

## Limits and experience

History pages contain at most 25 records; evidence inventories fail closed above their explicit limits (100 identities, 2,000 records per fact history, 1,000 per journey/skill inventory, 2 MB source inventory). Shortlists filter in the database before paging. Report population counts and coverage are bounded; cohort counts describe recorded events, not a conversion funnel or proof of current readiness. The aggregate checksum covers the server JSONB snapshot, not the downloaded file bytes.

Full-role demand detail contains the new journey; assigned work contains blind cards; Reports contains aggregate readiness and audited export. Legacy matching stays labelled descriptive. General assessment/training workflows remain available. Existing general candidate status is not rewritten. No email, live calendar, external AI or additional scan service is needed.

Database computation can scan many rows and hash substantial evidence. Browser bounds do not establish constant query cost. The 1,000-profile report is not a production-scale benchmark; measure it and the ready-only shortlist before activation. Old observation expiry uses inclusive UTC dates. Historical cycles and decisions remain evidence rather than transferable readiness after a merge.

## Activation and hosted acceptance

Apply **every migration in filename order through `20261007165705_stage2_privacy_scope.sql` before serving this frontend**. Three additive Stage 2 migrations follow the complete Stage 1 chain. Back up first. New APIs fail closed when absent. No new Netlify function, environment variable, service or credential is introduced.

1. On an isolated staging copy, apply/reapply the chain, refresh PostgREST schema cache and inspect security/performance advisors and actual Auth/API grants. Test admin, recruiter, viewer, assessor, sales and external client across two workspaces.
2. Exercise separate hosted sessions for scorecard seal/retry, configuration versus seal, debrief versus seal, grant revocation, competing Ready decisions, merge versus gap completion, and submission/share preparation versus invalidation. PGlite tests do not prove hosted concurrency.
3. Verify a configured real demand from sourced facts through two blind assessors, debrief, gap completion, independent validation, reassessment, Ready, submission and client approval. Test evidence expiry, source edits, changed kit, revocation and obsolete-cycle cancellation. Unconfigured demands retain their legacy submission flow; only a reviewed configuration enables its gate.
4. Check representative workload latency/query cost for shortlist filtering and aggregate reports, including 10,000 profiles, merged evidence and large histories. Validate the 1,000-population coverage notice and inventory-limit error recovery.
5. Recapture existing D7 checklists after the 48-category change; regenerate D6 packages after the scope-notice change. Separately review any requested journey disclosure rather than treating the package as exhaustive. Test backup/restore with outbound jobs paused and retained histories/receipts/grants intact.
6. Complete keyboard, focus, screen-reader and mobile review. Validate existing document/scan/storage/export/MFA flags; no scanner credentials or services were changed.

Rollback should disable new UI/access or repair forward while preserving journals. Do not drop the history tables to recover a frontend issue. Local work does not activate policy on existing demands or deploy migrations.

## Verification

**841 Node tests passed in the final full suite**, including new demand-journey migration, boundary, merge/history, privacy/consumer and React interaction tests. Four Python OCR tests, lint, changed-file Prettier checks, documentation links and offline Netlify packaging of all 17 functions passed. The final main entry is 67.6 KiB against its 100 KiB budget. Migration reapplication, exact retries, changed-intent conflicts, independent actor enforcement, source/date/configuration invalidation, private financial projections and client withdrawal are exercised.

Local Supabase advisors could not connect to `127.0.0.1:54322`. Hosted migration, API/concurrency, workload, restore and accessibility acceptance remains pending. No push, deployment, hosted migration or provider activation occurred.
