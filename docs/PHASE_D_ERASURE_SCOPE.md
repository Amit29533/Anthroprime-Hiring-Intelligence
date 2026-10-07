# Phase D7 — Erasure impact and fulfillment review

The [Phase N3.1 readiness slice](PHASE_N3_READINESS_JOURNAL.md) adds the readiness journal as category 31, including retired merged identities. Recapture prior checklists and reconcile evidence after migration because the source fingerprint changes. The existing scope limits and manual fulfillment boundaries remain applicable.

The [Phase N2.1 contact slice](PHASE_N2_CANDIDATE_CONTACTS.md) extends the inventory from 27 to 30 categories with contact records, verification events and actor-bound operation receipts, including merged identity families. Recapture existing checklists after its migration because the source fingerprint changes; reconcile the evidence before closure. This adds inventory coverage, not erasure execution.

This phase adds an administrator erasure-impact inventory and a seven-area evidence checklist. It prepares cases for reviewed manual fulfillment. It performs no erasure, anonymization, file deletion, provider request or message delivery. Approved retention policy and complete cascade execution remain separate work.

## Workflow

Verify identity and start an erasure case, then use **Capture current erasure scope**. The inventory counts the current candidate and descendant retired merged identities in the same workspace. It counts linked profiles, employment/compensation/availability, skills/evidence, assessments, enrichment, notes, consents, recruiting stages, placements/commercials, tasks, linked referrals, pool membership, document metadata, mappings, vectors, intelligence requests, workflow jobs, successful integration receipts, and linked history/audit rows. Internal hashes detect changes; the UI receives counts without raw contents, filenames, object locators or external IDs.

All seven areas start pending: profile/linked records; original files/extracted text; linked history/audit; mappings/vectors/jobs; private platform records; unlinked/external copies; backups. Record Completed, Retained or Not applicable explicitly with a 10–2,000-character evidence, retention-policy reference or rationale. Store references, not identity documents or sensitive record contents. Outcomes are operator attestations, not independently verified deletions. Retained outcomes allow reviewed retention decisions; they do not mean all data was erased.

Once a case has a checklist, a database trigger blocks closure until all seven areas are reviewed, identity verification matches and the identified database scope is unchanged. A reopened case requires a new capture. A new capture resets all decisions. After approved manual work changes database records, capture the final scope and reconcile evidence again before closing. Existing cases without a checklist retain their previous manual closure behavior; closure by itself never certifies erasure. Decline remains a separate decision.

## Scope and limits

- The bounded registry follows known database links. It does not infer identity from shared email addresses, names or unlinked applications/referrals. Private import/scan/governance/provider receipts, webhook payloads, old detached links, arbitrary references inside text/custom JSON, operator downloads, object existence and backup copies require manual inventory. The final three areas deliberately have no invented count.
- Counts and hashes are point-in-time observations. A removed file's metadata can remain after object cleanup; a zero count does not establish deletion outside the registry. No new processing restriction is introduced. New records after closure need separate review; use the existing reviewed outbound hold where applicable.
- At most 100 related identities, 2,000 records per registered category and 10,000 total records are inventoried. Exceeding these limits fails the capture atomically and directs the operator to an approved manual inventory. No partial snapshot is presented as complete.
- Private review tables use RLS and no browser table grants. RPCs require current-workspace administrator membership and existing optional privileged MFA. Mutations lock/version the case, bind operation UUIDs to actor and request, and write case evidence atomically. Another administrator cannot replay an operation. Unchanged acknowledgement retries return the original metadata receipt.
- Only count/hash snapshots and explicit decision references are retained. No source data is copied or deleted. Case/checklist retention and database backup policies still require operational approval.

## API and rollout

Apply all migrations in filename order through `20261007071142_reviewed_erasure_scope.sql`, then deploy the frontend. No new environment variables, packages, provider or scheduled function are required. The existing 14 Netlify functions remain compatible. Missing RPCs show an actionable migration error.

Admin/MFA APIs:

- `api_capture_erasure_scope(p_operation,p_id,p_version,p_note)` captures counts/hashes and initializes seven pending areas.
- `api_erasure_review(p_id)` returns the latest count summary and decision references, excluding internal hashes.
- `api_review_erasure_area(p_operation,p_id,p_version,p_review,p_area,p_decision,p_note)` records one reviewed outcome against the current scope/verification.

Existing `api_update_subject_request(...,p_action='close',...)` encounters the checklist guard after opt-in; its idempotent receipt behavior remains compatible. Production acceptance must exercise two workspaces, every role, AAL1/AAL2, lost receipts, simultaneous edits, retired identities, source changes, manual-work reconciliation, reopening, limits and policy references. Run hosted security/performance advisors. Preserve private review/case history during rollback; older frontends cannot bypass the server closure guard for opted-in cases.

No hosted migration, destructive action or deployment was performed.

## Verification

All 760 Node tests passed with zero failures, cancellations or skips (335.6 seconds), plus four Python OCR tests. The final expanded migration test passed the identity/record bounds and atomic rollback assertions. Database checks cover the full migration chain, migration replay, retired identities, linked history, content-free projections, private helper/table grants, administrator/tenant/MFA isolation, actor-bound retries, stale source/version checks, closure guards, reopened verification and preservation of original files/notes. UI checks cover evidence requirements, explicit outcomes, lost receipts, verification gates and unavailable migrations.

ESLint, changed-file Prettier and Git whitespace checks passed. Netlify offline production build packaged all 14 functions and passed the entry budget at 65.0 KiB against 100 KiB. Local security/performance advisors could not connect to port 54322; hosted advisors, simultaneous-edit checks and authenticated acceptance remain required.
