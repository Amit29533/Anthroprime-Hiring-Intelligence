# Phase N3.2 — Sealed candidate rubric scorecards

This Phase 3 continuation adds bounded scorecard recording to both candidate profile layouts. Existing assessment templates become reusable frozen rubrics, submitted assessments carry server recording provenance, and readiness uses reliable chronology for new same-day assessments. It uses the existing Netlify/React/Supabase stack with no additional service, provider, function or credential. Phase 3 remains in progress.

## Experience and evidence

Open **Scorecards**, choose an active rubric, score every criterion and record the assessment date and 10–5,000 characters of observed evidence. The weighted preview helps review the draft; the database recomputes the final score and expiry. Templates are managed by administrators in the existing assessment-template library. Recording is available to existing administrators and recruiters; viewers can read submitted cards.

Each submitted card freezes the rubric's name, description, version, criteria, weights and validity. The server records the authenticated author, timestamp and sequence. There is no editable author field. Later template changes do not rewrite earlier evidence. A changed template version rejects a draft; refresh, explicitly reload the new rubric and score its criteria again. Failed acknowledgement retries retain the evidence/scores and reuse the operation ID. Successful submission clears the draft.

Scores, evidence and recording metadata on sealed cards cannot be overwritten. Record another assessment to correct or reassess. Existing assessment merge behavior can reassign `candidateId` within the workspace while preserving frozen content, original author/time/sequence and history. The generic UPSERT path preserves this evidence even when the template has subsequently changed. Direct SQL updates and UPSERTs cannot rewrite recording provenance. New standalone/legacy-form assessments also receive server provenance; their pre-existing editing rules remain otherwise applicable.

Pre-migration assessments keep null recording provenance; no actor, timestamp or sequence is invented. General readiness sorts by assessment date and then server sequence. A later recorded same-day assessment replaces an earlier one as current evidence, including a failed reassessment. Multiple legacy assessments on the latest date still block Ready if none has reliable recording chronology. New scorecards are general assessments; specialized skill/demand evaluations remain separate work.

Recording a card does not automatically validate readiness. Reopen or refresh **Readiness review** to review the new evidence and obtain a separate administrator decision. New assessments invalidate an existing readiness source fingerprint. Rubric edits alone preserve the validity of a decision based on its already frozen assessment. Profile labels, matching and downstream submission/analytics consumers retain their documented behavior.

## Contract and limits

| RPC                              | Parameters                                                                                           | Result                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `api_candidate_scorecards`       | `p_candidate`, `p_offset = 0`, `p_templates_offset = 0`                                              | Resolved candidate ID, up to 50 submitted cards, up to 50 active rubrics, separate `more` and `templatesMore` flags |
| `api_record_candidate_scorecard` | `p_candidate`, `p_operation`, `p_template`, `p_template_version`, `p_scores`, `p_date`, `p_evidence` | Assessment `id`, server-calculated `score`, `replayed`                                                              |

The operation UUID is the assessment ID and is bound to workspace, actor and a hash of the exact candidate/rubric-version/scores/date/trimmed evidence intent. Changed intent or another actor cannot reuse it. Unchanged receipt retries work after template edits or archival, but current workspace/candidate authorization is checked first. Retired candidate mutation IDs must be refreshed after a merge.

Dates must be no later than the database calendar date and no earlier than 730 days before it. A future date error identifies the latest accepted date; local and database date boundaries can differ. Evidence is bounded to 5,000 characters/20,000 bytes and score JSON to 8,000 bytes. Every criterion requires a numeric score in its allowed range; unknown/missing criteria fail. Rubrics are limited to 80,000 bytes on submission and pages to 512 KiB, without partial success on oversized pages. Reads use offsets 0–10,000. RPC recording stops at 200 assessments per candidate to stay within readiness review limits; this does not retroactively constrain existing legacy/import write paths.

Candidate and selected rubric locks serialize scorecard creation against identity and rubric changes. Public security-invoker wrappers call narrow private helpers with current membership and editor checks; anonymous execution is revoked. Existing assessment/template RLS still applies to direct browser access. Sealed scorecards remain internal workspace evidence. Independent actor authorship does not establish blind review, assessor assignment, reviewer independence or third-party confidentiality within the existing member roles.

## Privacy and rollout

Apply all migrations in filename order through `20261007092050_candidate_scorecards.sql` before deploying the frontend. No Netlify environment variable or function is added. Hosted migration, authority/concurrency/date-boundary acceptance and advisors remain pending; local Supabase advisors could not connect to `127.0.0.1:54322`.

Previously recorded readiness decisions will require a fresh review because the new assessment columns change their source fingerprints, even when legacy recording values remain null. Review current evidence and append a new decision rather than modifying the previous one.

The D7 inventory remains at 31 categories: scorecards use the existing assessments category, whose fingerprints include frozen evidence and recording fields. Recapture older checklists after migration and reconcile the evidence. No erasure is performed.

D6's 18-category packages can disclose their existing allowlisted assessment score/evidence fields after review, but do not include rubric snapshots or new recording provenance. The scope notice explicitly names that exclusion. Arrange separate approved disclosure review for those fields. Regenerate prepared packages and review snapshots after migration because scope-notice bytes and full source fingerprints change. Organizational backup/restore procedures must preserve original provenance through privileged, reviewed restoration; replaying old records as new browser inserts creates new recording provenance and does not recreate the original audit record.

## Verification and remaining work

All 783 Node regression tests passed, with final expanded migration checks after the UPSERT preservation fix. Focused migration/UI checks cover weighted computation, frozen versions, stale rubric errors, failed-draft recovery, actor-bound receipts, invalid/missing scores, provenance spoofing, sealed edits, UPSERT/merge preservation, legacy provenance, same-day readiness, viewers and other workspaces, bounded pages and existing privacy workflows. Four OCR tests, lint and offline Netlify packaging passed; the build packages 15 functions with a 65.2 KiB main entry. Changed-file formatting and documentation links passed.

Assessor assignments and narrower role scopes, independent blind submissions, criterion-specific evidence, interview kits/debrief, typed demand constraints, demand-specific validation and validated readiness reporting/consumer integration remain future slices. This continuation does not complete Phase 3 or the blueprint.
