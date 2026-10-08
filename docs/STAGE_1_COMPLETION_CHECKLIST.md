# Stage 1: verified facts, duplicate review and scoped access

Started 7 October 2026 from local commit `65d678e`. This completes **milestone 1 of the five continuation stages** in the [implementation audit](FIVE_PHASE_IMPLEMENTATION_AUDIT_2026_10_07.md#next-build-order): safe factual writes and permissions. It does not mark the entire original DOCX, the original broad five-stage roadmap, or hosted acceptance complete. No new service, secret, function or provider is introduced. Changes are local only.

## Implementation and acceptance matrix

| Workstream | Delivered behavior | Local evidence |
| --- | --- | --- |
| Employment | Sourced roles, optional start/end dates, chronology checks, explicit confirmation, server recording/verification actor and time, immutable corrections, current-profile application and stale-version checks | `migration-stage1-facts`, `migration-stage1-boundary-cases`, `ui-stage1` |
| Compensation | Admin-only amounts and history, explicit currency and annual/monthly/daily/hourly basis, fixed/variable/bonus/equity components, unknown versus zero, immutable corrections | Financial boundary, facts and boundary-case tests |
| Availability | Explicit confirmation, sources/dates, correction history, zero notice versus unknown, current-state conflict and chronology guards | Facts, boundary-case and existing availability tests |
| Duplicate review | Explainable suggestions, manual Anthro-ID pair selection, distinct/defer/merge decisions, paged history, reviewed field choices, transactional merge, durable exact-request retries | Duplicate tests, existing contacts/scorecards/readiness/index/hold regressions, UI tests |
| Data quality | Employment/availability queues reflect latest applicable confirmation, current-value mismatches and 120-day freshness; contact/fact navigation and duplicate/import/taxonomy handoffs | Boundary-case and quality database/UI tests |
| Financial isolation | Raw candidate salary/history snapshot/offer terms/import payload columns denied; guarded APIs redact typed financial keys for staff; partial writes preserve omitted pay; queued financial imports recheck approving admin | Financial boundary and boundary-case tests; legacy UI regressions |
| Assessor | Active, expiring candidate evaluation assignment; minimal candidate projection, own evaluation history, immutable assessment submission | Assignment database/UI tests |
| Sales/Account | Assigned client/demand progress only, aggregate stage counts, no candidate contacts/pay/private evaluations | Assignment database tests |
| Administration | Five roles, assignment grant/revoke UI, duplicate active-grant refusal, role-change revocation, last-admin serialization, scoped workspace switching | Assignments, members and workspace UI tests |
| Access evidence | Guarded repository/profile/fact/duplicate/assigned reads record server actor/time; existing export/download issuance controls retained; stale browser contexts cleared | Financial audit and workspace/assigned UI tests; surface inventory below |
| Privacy | Fact metadata projected into reviewed access packages; duplicate decisions, assignments and durable receipts added to the 41-category erasure inventory | Stage 1 privacy and existing subject-access/erasure tests |
| Release checks | Full regression, OCR, lint, format and offline Netlify packaging | Final verification recorded below |

## Permission matrix

| Role | Candidate scope | Financial/commercial scope | Writes |
| --- | --- | --- | --- |
| Admin | Existing full workspace | Typed compensation, offer pay and internal commercials | Facts, duplicate review, roles and assignments |
| Recruiter | Existing full nonfinancial workspace | No typed candidate/offer compensation or internal commercials | Nonfinancial facts, contacts, recruiting and reviewed merges |
| Viewer | Existing nonfinancial workspace read | None | None |
| Assessor | Explicit active evaluation assignments | None | Append evaluations for assigned, unheld candidates |
| Sales/Account | Explicit active client/demand progress assignments | None | None |
| External client | Existing separate submission-sharing portal | Existing narrow client projection | Existing scoped client feedback |

Limited roles receive `NULL` from the legacy `current_workspace()` helper, so old RLS and APIs cannot accidentally grant a workspace-wide seat. Their dedicated APIs resolve actual membership and lock/check assignment state. Role changes revoke old assignments; returning to the role does not resurrect access. Assignments must expire within 366 days and may be revoked immediately. Browser checks run on focus and at 60-second intervals; assigned work additionally rechecks every 45 seconds. Server checks apply to each request without waiting for polling. Already downloaded material cannot be recalled.

## Fact and merge semantics

An observation and a human confirmation are separate states. Confirmation and applying a fact to the profile both require explicit choices. Confirmation concerns the stated source/observation, not independent certification of identity. Ordinary edits never change candidate-wide `verified` or invent fact confirmation. A correction supersedes its parent without rewriting it; an unconfirmed correction invalidates the parent's confirmation. Employment applicability checks its role dates. Compensation tracks current and expected confirmation separately. Labels disclose stale confirmation or disagreement with the current profile.

New compensation facts use currency units. Existing profile `current`/`expected` amounts retain INR lakh/year compatibility. Only confirmed or unconfirmed facts deliberately applied as annual/monthly INR can update those legacy fields; monthly units multiply by 12 before conversion to lakh/year. Other currencies/bases remain historical facts with an explicit label, without invented exchange rates. Legacy records remain observed, with unknown recording/verification provenance where it was unavailable.

Duplicate merges require an explicit review and every permitted field choice. Versions cover both profiles, retained identity families, factual/contact/linked history and previous review decisions. Both identities lock in deterministic order; active recruiting holds prevent merging. The retired UUID and Anthro-ID remain, resolve to the survivor and retain original evidence/link references. Original contacts become unconfirmed alternate evidence; consent, confirmation and validated skills are never invented. Existing identity-family readers and normalization resolve preserved linked records. Evaluator access to the retired identity is revoked.

Suggestions compare a bounded first 1,000 active identities for exact LinkedIn or name plus employer/location evidence. The UI discloses this limit; manual pair review supports records outside that suggestion window. This is not exhaustive fuzzy deduplication. Each linked-history category and contact/history fingerprint is bounded; exceptionally large families require manual review rather than silent truncation or an unsafe merge. Review history and other new lists return at most 25 rows per page.

## Read/export/download surface inventory

| Surface | Authoritative boundary and evidence | Limit |
| --- | --- | --- |
| Candidate pages, profile sections, legacy snapshots and change feeds | Current membership, typed financial projection, opaque keyed conflict token; server candidate-read events | Raw nonfinancial PostgREST SELECTs are scoped by RLS but not individually read-audited |
| Sourced facts, duplicates, assigned evaluations/progress | Guarded private APIs and public invoker wrappers; server reads/decisions | Detailed histories are bounded and paged |
| Candidate CSV in repository/settings | Existing `api_prepare_candidate_export`, role projection, hold/MFA gates, quotas and private receipt when audited exports are enabled | Existing opt-in flag retained; legacy flag-off CSV is browser generated and has no issuance receipt |
| Report, analytics, submission, offer and training downloads | Existing role/approval/hold policies; source candidate data now projected before browser use; existing aggregate export receipts where supplied | Some browser-generated artifacts retain client audit only; universal durable export jobs belong to continuation milestone 5 |
| Private originals/document links | Existing signed-access API, scanner/hold/role checks, opt-in server issuance receipts, configured Storage/R2 policy | Hosted storage/legacy signing acceptance still required; possession of an already issued URL lasts until its expiry |
| Subject access packages | Reviewed explicit projection, server stale-source fingerprints, existing package issuance/expiry controls | Private decision and access-management history excluded for separate administrator review |
| Commercials | Existing admin RLS/projections; Sales/Account has no commercial projection | Recruiting demand budgets retain their existing policy |
| Imports | Staged pay visible only through guarded admin page; raw payload denied; financial write trigger and worker approval recheck | Free-form CV/extracted text is not a content classifier |
| Semantic retrieval | Existing professional-text index; limited roles excluded through legacy workspace guard | No new raw CV, compensation or private assessment embedding |

Typed financial isolation does not classify arbitrary text, arbitrary custom-field names, notes or CV contents. Do not store restricted pay in shared text/custom fields and expect automated redaction. Existing portal/projection contracts remain separate. No compliance certification, exhaustive read audit, destructive erasure, external notification or provider activation is claimed.

## Activation and hosted acceptance

Apply **every migration in filename order through `20261007141611_stage1_fact_quality.sql` before using this frontend**. Six additive Stage 1 migrations provide the financial boundary, verified facts, scoped assignments, duplicate workflow, privacy/access evidence and factual quality queues. Back up first. New guarded APIs fail closed when missing; old direct candidate salary/history reads must migrate to the guarded adapters. No environment variables or new Netlify functions are added. Preserve existing scan/document/export/MFA feature flags and verify their activation contracts.

Before production use:

1. Apply the complete chain to an isolated staging copy, run hosted Supabase security/performance advisors, inspect Auth/PostgREST grants and schema cache, and exercise all five roles plus two workspaces through real HTTP requests.
2. Test simultaneous last-admin demotions, role revocation versus fact/export writes, duplicate reviews/merges, assignment grants/revocation, primary contacts and competing import workers using separate database sessions. Local PGlite tests exercise transactional outcomes but do not prove concurrent hosted-session behavior.
3. Reconfirm private storage denial, document signing, scan/hold gates, scheduled jobs and server-only key placement. Existing scanner/OCR acceptance remains separate; no new scanning service was installed.
4. Test 200 authorized real CVs plus a representative spreadsheet against adjudicated duplicate/error outcomes. Local synthetic fixtures are not a real-data pilot.
5. Measure a representative 10,000-profile staging dataset (initial list/filter p95 target two seconds), database query cost and bounded network responses. Suggestions remain explicitly limited; no production scale claim is made.
6. Restore the database and representative private originals in isolation with outbound jobs paused; verify identity aliases, histories, assignment revocation and receipts. Record backup age, restore time and rollback ownership. Prefer disabling access/new UI while repairing forward over dropping privacy/history tables.
7. Perform keyboard, focus, screen-reader and mobile review of the completed journeys. Automated DOM tests are not WCAG certification.

Broader paged matching/reports/bulk jobs/custom-field filters, full demand readiness, communication and governance remain in their documented continuation stages. Import/taxonomy handoffs do not claim a new unified alias/import disposition ledger.

## Final local verification

**827 Node regression tests passed in the full suite**, followed by four passing workspace UI tests covering the final session-response race guard (including one newly added regression). Four Python OCR tests, lint, changed-file Prettier checks, documentation links, offline Netlify packaging of all 17 existing functions and the final Vite bundle check passed. The final main entry is 67.6 KiB against a 100 KiB budget. The repository-wide formatting command still flags 83 pre-existing, unchanged files; this milestone does not reformat unrelated code.

Hosted advisors could not connect to `127.0.0.1:54322`; no hosted migration, deployment, push or restore was performed.
