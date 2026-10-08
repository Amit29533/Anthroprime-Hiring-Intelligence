# Phase D3: data-subject request review cases

The later [D4 outbound hold slice](PHASE_D_OUTBOUND_HOLDS.md) adds an explicit recruiting hold action for verified restriction cases. Ordinary case closure still records a manual decision and does not erase data or release an active hold.

Implemented locally on 6 October 2026. Administrators can record internal cases for access, correction, restriction, erasure and retention review. The case workflow runs in PostgreSQL, with UI under **Candidate → Consent & privacy** and a workspace-wide queue under **Workspace settings → Data-subject request review**. No new paid provider, secret or Netlify function is required.

## Intake and review

Intake records a candidate, request type, summary and channel, plus an optional administrator owner and review date. Only an active, unmerged candidate in the current workspace can receive a new case. The case retains that candidate UUID and an Anthro-ID snapshot. A later candidate merge preserves the original link and is marked in the queue; cases are not silently transferred to another person.

Review states and actions are enforced on the server:

- `opened` → record identity verification → `verified` → start review → `in_review`.
- Review can wait for an action and resume. Only verified cases already under review or awaiting action can be closed.
- Active cases can be declined with a reference or decision. Closed/declined cases can reopen, returning to `opened` and requiring identity verification again.
- Active cases can change owner/review date through an explicit review-plan action. Only current workspace administrators can be assigned. An owner is for coordination; every workspace admin can review these cases.
- Every action requires a 10–2,000-character review reference or decision. Identity verification is an administrator's recorded assertion, not an automated check. Keep identity documents in approved private records; this UI does not collect or upload them.

Review dates are operator-entered scheduling dates, not computed statutory deadlines. Missing dates appear as unscheduled. The queue filters active/all/overdue and pages 50 cases, ordered by review date. Overdue means an active case with a review date before the database's current date. There is no automatic reminder or email delivery in this slice.

## Server-owned history

Cases and append-only API event history live in `ecod_private`, with RLS enabled and browser table access revoked. All four RPCs require current-workspace administrator membership. Recruiters, viewers, anonymous callers and administrators from another workspace cannot inspect or change cases. Case notes are not part of general candidate snapshots.

Updates lock the case and require its current version. Stale changes fail and require refresh. Operation UUIDs, actor binding and request fingerprints make unchanged acknowledgement retries idempotent; changing an already used operation or replaying it as another admin fails. Case updates and event receipts commit together. Events record actor, server time, action, state, version, reference, owner and review date. The detail panel pages 50 events newest first, exposing neither internal fingerprints nor operation receipts.

Intake uses a stable case UUID for retry. A retry of a previously committed intake returns its original receipt even if the case has since progressed; the UI reloads current details. Changed intake fields produce a new operation and may create another case, so retry unchanged inputs after a lost response. Successful intake resets its retry identifier.

## What closure means

Closure records an administrator's decision/reference. It does not certify that a data-subject request was fully fulfilled. The workflow does not change candidate data, freeze processing, revoke consent, export a complete dossier, delete objects, anonymize linked records or send a response. Use existing correction tools and approved manual processes; record the work/reference in the case. Do not treat a closed erasure/restriction case as an automatic technical control.

The consent panel now accurately describes the existing profile export as records available in that workspace view, rather than everything held about a person. The profile-anonymization confirmation now states that linked files/history remain and the action does not fulfill an erasure request. Those existing operations retain their behavior.

## Rollout and rollback

1. Back up and apply every migration in filename order through `20261006152558_data_subject_request_cases.sql`. The migration is repeatable and adds private case/event tables, indexes and permission-checked RPCs. There is no activation flag; the new admin panel becomes usable after migration/frontend deployment.
2. Deploy the frontend. Existing Netlify function packaging and credentials remain unchanged. Missing RPCs show an unavailable-state message and disable intake; no local fallback case is created.
3. Use staging to verify two workspaces, admin/recruiter/viewer boundaries, assignment to current admins, identity/review gates, decline/reopen, candidate merge behavior, version conflicts, simultaneous edits, lost acknowledgements, past/unscheduled review dates and case/history paging. Cases/decisions should be synthetic in staging.
4. Run hosted Supabase advisors and authenticated acceptance before production rollout. The browser workspace JSON backup does not include these private cases/events; database backup/restore must include `ecod_private`. Retain case history during rollback. The new foreign key prevents deleting a candidate while a case still references it.
5. To roll back the UI, deploy the preceding frontend and preserve compatible private tables/RPCs. No destructive down-migration or automatic case/event deletion is included.

Remaining Phase D work includes complete authorized fulfillment/export, original/history cleanup, processing restriction enforcement, notification intake/delivery, case retention policy, broader role projections, SSO/MFA and session controls. Request intake from candidate portals/mailboxes is still manual. No hosted migration or deployment was performed.

## Verification

All 724 Node tests passed. New migration/UI tests cover repeated migration, tenant/admin isolation, private table permissions, role-safe assignment, verification/closure gates, version conflicts, idempotent intake/actions, actor-bound retry, reopening, unchanged candidate data, history order, lost receipts, unavailable migrations and bounded paging. A focused rerun passed 23 request/workflow tests after the UI context/ownership updates.

ESLint, changed-file Prettier and tracked whitespace checks passed. Netlify CLI's updated offline production build packaged all 11 functions, and the frontend passed its entry bundle budget. Local security/performance advisors could not connect to `127.0.0.1:54322`; hosted advisors, simultaneous-edit checks and authenticated staging acceptance remain required. No hosted migration or deployment was performed.
