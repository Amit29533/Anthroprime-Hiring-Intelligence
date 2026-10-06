# Phase D4: reviewed outbound recruiting holds

Implemented locally on 6 October 2026. An administrator can explicitly apply or release an outbound recruiting hold from a verified restriction request under review. This is a scoped recruiting control, not a complete processing restriction or erasure workflow.

## Apply and release

Open a restriction case in **Candidate → Consent & privacy** or **Workspace settings → Data-subject request review**. Record identity verification, start review, enter a decision/reference and choose **Apply outbound hold**. Audited candidate CSV exports must already be enabled and verified for that workspace. The operation locks the candidate and case, checks the case version, changes the server-owned candidate flag and appends a case event atomically.

Only current workspace administrators can manage holds. Another case cannot release the holding case's restriction. Applying an already active hold is rejected; unchanged retries use the same operation UUID and return the original receipt. The current case version is required for new actions. **Release outbound hold** requires an explicit review reference. Closure, decline, reopening and review dates do not automatically release it; a hold can be released from its owning case after closure. Use the All requests queue to find closed cases when necessary.

The public `candidates.processingRestricted` boolean indicates this outbound hold only. Its authoritative record is private and server-owned; browser roles cannot change the flag independently. Candidate saves omit it, preserving current server state even when a client has an older snapshot. The app reloads candidate data after a confirmed hold action. The full Candidate 360 shows a hold badge and disables shortlisting; the demand matching list excludes flagged profiles. Matching calculations also mark them ineligible without changing their underlying evidence scores.

## Server enforcement

Database triggers enforce the hold for UI, direct authorized writes and server RPCs, including portal booking through the interviews table:

| Surface | While the hold is active |
| --- | --- |
| Considerations | New rows and active-stage updates blocked; existing rows can be Rejected/Withdrawn under existing validation rules |
| Submissions | New rows and recipient/link changes blocked; existing notes-only updates remain available |
| Interviews | New rows and ongoing updates blocked; existing interviews can be Cancelled |
| Offers | New rows and ongoing updates blocked; existing offers can be Rejected/Withdrawn |
| Placements | New rows and ongoing updates blocked; existing placements can be Completed/Terminated/Cancelled |
| Candidate CSV preparation | Any selection containing a held candidate fails without returning partial rows |
| Candidate merge | Merging a held source or into a held target is blocked until release |

Candidate row locks serialize covered writes/CSV preparation against hold activation. If a covered transaction has already committed before the hold applies, it remains historical activity. Cancellation/withdrawal does not bypass existing validation or approval rules. Other profile corrections, notes and records remain usable.

Active holds pin `settings.custom.auditedCandidateExports=true`. Disabling/removing that setting fails until holds are released, preventing the application CSV buttons from falling back to their legacy browser path. The audited RPC itself checks holds regardless of that flag. Hold changes and their case history commit together; there is no standalone browser flag toggle.

## Scope limits

This hold does not revoke read access or already downloaded/loaded data. Reports, dossiers, presentation documents, profile JSON, backups, original downloads, external copies, candidate indexing/CV processing, tasks, assessments, enrichment and integration data access are not governed by it. It does not cancel existing activities automatically, send notices, erase records or enforce every purpose of processing. Duplicate profiles representing the same person need reconciliation; a hold attaches to the recorded candidate UUID and merge is blocked while active.

Older frontend builds can still serialize already loaded data locally. Reload open tabs after enabling audited exports and deploy the matching frontend before applying holds. A legacy export that began before activation cannot be recalled. The server guarantee covers the audited preparation RPC and guarded database writes, not arbitrary serialization of readable records.

Closing a case records a decision rather than certifying complete fulfillment. Use an approved review process for broader restriction/erasure work. Full permission/read/export coverage and original/history cleanup remain later Phase D work.

## Deployment and rollback

1. Back up and apply the complete migration chain through `20261006154142_candidate_outbound_holds.sql` in filename order. The migration is repeatable and adds the flag/private hold table, write/settings guards and an admin hold RPC. It wraps the D2 export and D3 detail implementations in private base functions. Browser execution of the private bases is revoked; only the permission-checked public wrappers remain exposed. Reapplying an older migration can replace a wrapper, so always apply the latest migration last.
2. Deploy frontend/Netlify functions together. No new secret, worker or Netlify function is needed. Deploy the migration before the frontend that understands its server-owned flag.
3. In staging, enable and verify audited candidate CSVs before applying a hold. Test two workspaces and admin/recruiter/viewer roles, unverified cases, stale versions, lost receipts, concurrent activation versus outbound writes/CSV preparation, merge boundaries, profile corrections, cancellation/withdrawal, closed-case release and settings downgrade refusal.
4. Run hosted database advisors and authenticated acceptance before production use. Include private holds/cases/events in database backups. Local compatible-database tests are not hosted concurrency or policy acceptance.
5. Roll back the frontend while preserving active holds, database guards and event history. Older clients may show stale actions, but covered writes remain blocked. Explicitly release holds after review before disabling audited CSVs; do not clear server flags or private records directly.

## Verification

All 727 Node tests passed. Tests cover repeated migration, verified case/version requirements, private/server-owned controls, export activation/downgrade gates, role/tenant denial, all five outbound table inserts, active-stage refusal, administrative cancellation/withdrawal, notes-only updates, correction, merge boundaries, closure persistence, release, idempotent UI retries and candidate refresh.

Final review found an insert-trigger edge case for corrections through UPSERT. The guard now restores the authoritative hold flag on the insert path before conflict handling, while rejecting forged holds. After this fix, five focused migration tests passed for held-profile upserts, compact identity upserts, durable CVs, saved imports and audited exports.

ESLint, changed-file Prettier and tracked whitespace checks passed. Netlify's offline production build packaged all 11 functions; the updated frontend passed its entry bundle budget. Local security/performance advisors could not connect to `127.0.0.1:54322`; hosted advisors, concurrent activation/write checks and authenticated staging acceptance remain required. No hosted migration or deployment was performed.
