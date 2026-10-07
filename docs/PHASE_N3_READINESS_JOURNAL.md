# Phase N3.1 — Assessment-backed readiness review

The [N3.2 scorecard continuation](PHASE_N3_CANDIDATE_SCORECARDS.md) now records server authorship/time/sequence for new assessments and uses sequence to order same-day general evidence. The legacy same-day ambiguity below applies when the newest date has no reliable recording provenance. Reassessments can be recorded in the new Scorecards tab. Independent assessor assignment, blind debrief and demand validation remain pending.

The first Phase 3 slice adds a separate, evidence-backed general readiness review, administrator decisions, expiry, source-change detection and preserved decision history. It uses the existing Netlify/React/Supabase stack without a new service, function or credential. Phase 3 remains in progress; Phase 1 and Phase 2 also retain their documented unfinished slices.

## Candidate experience

Open **Readiness review** in either the full candidate profile or paged Candidate 360. The panel distinguishes validated review state from the editable profile status. Passing evidence checks does not automatically validate readiness; an administrator records Ready, Near-ready, Not-ready or Revoked with 10–2,000 characters of evidence and a requested validity of 1–180 days. Existing optional privileged MFA applies to decision writes. Recruiters and viewers can read the review but cannot validate it.

Ready requires all of these checks:

- The latest general assessment has no demand or skill scope, scores at least 80/100 and contains at least 10 characters of evidence. A newer failed assessment prevents fallback to an older passing assessment. Demand/skill assessments do not imply general readiness.
- Multiple general assessments on the latest date block Ready because legacy assessments have no reliable within-day chronology. Review/correct erroneous dates with evidence or record a genuinely later reassessment; do not alter genuine dates to bypass the check. Explicit assessment selection and server-recorded scorecard chronology remain future work.
- The assessment is not future-dated or expired. Its expiry is capped at 180 days from assessment, its explicit rubric expiry when present, and 120 days from the profile verification date.
- The profile verification date is neither future-dated nor older than 120 days. This is the existing profile date, not a newly implemented fact-by-fact verification system.
- All existing enrichment plans are Validated; Complete still requires validation. The candidate is available and has no outbound recruiting hold.

Ready expiry is the earliest of requested validity and the evidence expiry. Dates use the database calendar; the displayed expiry date is inclusive. The 80/100 and 120/180-day defaults are fixed in this slice, not workspace policy settings.

Decisions preserve server actor/time, assessment reference, previous decision reference and a source fingerprint. A source change produces **Needs review**, expired decisions show **Expired**, and explicit revocation shows **Revoked**. New decisions append to the journal; browser users cannot insert, overwrite or delete rows directly. A privileged database operator remains outside these browser restrictions.

Merges preserve earlier decisions under their original identity. Reads through retired Anthro-IDs resolve to the survivor and include the merged family's history. A retired identity's decision is never inherited as the survivor's current validation. Reassess and review the surviving profile explicitly.

## Contract and bounds

| RPC                              | Parameters                                                                                  | Result                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_candidate_readiness`        | `p_candidate`, `p_offset = 0`                                                               | Resolved candidate, profile status/date, assessment preview, blockers, eligibility, source fingerprint, current `headId`/state, at most 50 decisions and `more` |
| `api_decide_candidate_readiness` | `p_candidate`, `p_operation`, `p_head`, `p_fingerprint`, `p_decision`, `p_days`, `p_reason` | Decision `id` and `replayed`                                                                                                                                    |

Reads require current workspace membership; decisions require current-workspace administrator membership. Narrow private helpers implement authority checks behind public security-invoker wrappers with anonymous execution revoked. `readinessDecisions` has RLS and workspace-scoped select grants only. No structured salary/contact fields or complete profile snapshot is returned by the readiness RPC; the fingerprint detects changes without disclosing those values. Assessment evidence and decision reasons remain internal workspace information and need operator review for third-party content.

Decision writes lock the candidate and bounded existing assessment/enrichment rows, check both source fingerprint and latest decision ID, and append atomically. An operation UUID is bound to actor/workspace and a hash of the exact request. An unchanged acknowledgement retry returns the original decision even when newer evidence has arrived; it does not declare that earlier decision current. Reads recompute current state. Changed intent with the same operation fails. Stale source or journal head fails and retains the UI evidence draft for explicit refresh/review.

Source inventory is capped at 200 assessments and 200 enrichment records and 2 MiB of combined source JSON. Larger inventories fail with an approved manual-review message. Assessment evidence preview is capped at 5,000 characters, title at 300, decision history at 50 per page, offset at 10,000 and merged family at 100 identities. History and the current journal head use a server-generated sequence, so clock adjustments do not change decision order. Source changes include the whole candidate row and assessment/enrichment rows, so even a non-evaluation profile correction conservatively requires review. Alternate contacts, fine-grained skill verification and demand constraints are not included in this general review fingerprint.

This review does not change profile status, recruiting consent, outbound holds, matching rankings, submission eligibility, existing readiness analytics or client-visible packs. Those consumers still use their documented existing behavior. Demand fit, independent assessor scorecards, debrief and specialized role scopes remain future slices. Do not present this panel as complete validated demand readiness or the full ECOD cycle.

## Privacy and rollout

Apply all migrations in filename order through `20261007085457_candidate_readiness_journal.sql` before deploying the frontend. No additional configuration is required. Demo mode explains that validation requires a cloud workspace.

D7 erasure inventory now has 31 categories and includes the readiness journal, including retired merged identities. Counts/fingerprints do not disclose decision contents; existing inventory caps still apply. Recapture older checklists and reconcile evidence because the source fingerprint changes. This migration performs no erasure.

D6's 18-category reviewed access package explicitly excludes readiness decision history as well as the preceding contact exclusions. Arrange separate approved review of decisions and assessment evidence where required. Regenerate previously prepared packages because the scope notice changes their bytes/checksums. Private platform records, backups and downloaded copies retain their operational review requirements.

## Verification

Focused migration/UI checks passed, including source and journal conflicts, operation replay, viewer/recruiter/cross-workspace denials, browser journal immutability, low/future/stale evidence, enrichment validation, capped expiry, source limits, merged history and privacy inventory. Four OCR tests and lint passed. All 779 Node regression tests passed, followed by final expanded migration checks. Offline Netlify packaging passed with 15 functions and a 65.1 KiB main entry. Changed-file formatting and documentation links passed.

Local Supabase advisors could not connect to `127.0.0.1:54322`. Hosted migration/advisor and authenticated acceptance remain pending. In staging verify administrator/MFA enforcement, membership removal, two-workspace isolation, concurrent assessment/decision writes, expiry at the database date boundary, merged-history behavior and recaptured privacy artifacts. Local tests do not establish hosted deployment or concurrent production acceptance.
