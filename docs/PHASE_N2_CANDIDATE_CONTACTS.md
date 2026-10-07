# Phase N2.1 — Candidate contacts and confirmation

The first Phase 2 slice adds sourced alternate email addresses and phone numbers, explicit recruiter confirmation, one preferred confirmed contact per kind, retirement and preserved evidence history. It uses the existing React, Netlify and Supabase stack without a new service, provider or credential. Phase 2 remains in progress.

## Recruiter experience

Open **Contacts** in the full candidate profile or paged Candidate 360. Record a contact with its source and optional label. New records start **Declared**. Enter 10–1,000 characters of evidence to confirm, prefer or retire a contact. Confirmation records the current actor and server time; it is a recruiter attestation, not proof obtained by sending an email, SMS or ownership challenge. Viewers can read contacts and history but cannot change them.

Only confirmed active contacts can be preferred. Replacing a preference preserves both records and writes a replacement event. Retirement retains the contact and its evidence. Merging candidates reparents contacts to the surviving identity, clears preferences for review and preserves original confirmation and event history. Reads through a retired Anthro-ID resolve to the survivor.

The primary profile email and phone remain visible. Preferred alternate contacts do not replace those fields, change candidate portal access, grant recruiting consent or mark the whole profile verified. Legacy primary contacts are not automatically copied or confirmed. Demo mode explains that this workflow requires a cloud workspace.

## Contract and safeguards

| RPC                            | Parameters                                                                      | Result                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `api_candidate_contacts`       | `p_candidate`, `p_offset = 0`, `p_events_offset = 0`                            | Resolved `candidateId`, primary contacts, at most 50 contact rows and 50 events, separate `more` and `eventsMore` flags |
| `api_change_candidate_contact` | `p_candidate`, `p_operation`, `p_action`, `p_contact`, `p_version`, `p_details` | `contactId`, new `version`, `replayed`                                                                                  |

Mutation actions are `add`, `verify`, `prefer` and `retire`. Add uses a new contact UUID, version zero, and string details `kind`, `value`, `label`, `source`. Other actions use the current contact version and a `reason`. Unknown detail keys, including forged confirmation actors/timestamps, are rejected. The operation UUID is bound to the current actor, workspace and exact request; retry an unchanged failed acknowledgement with the same UUID. Changed requests or stale versions fail explicitly.

Private tables have RLS enabled and no browser table grants. Public invoker wrappers call narrow private helpers that enforce current workspace membership and existing admin/recruiter write permissions. Anonymous and other-workspace requests are denied. Contact and event pages are independent; candidate-scoped mutations never fetch the full repository.

Email normalization trims and lowercases. Phone comparison strips formatting and leading zeroes under the existing identifier convention; it does not infer a country or claim E.164 equivalence. Active alternate identifiers are unique within a workspace. Shared identifier locks and a primary-field trigger protect existing UI, import and API primary-contact writes against another candidate's alternate identifier. Retired values can be reused, while their history remains. Each candidate can have 30 active contacts and 200 total records; reads are capped at offsets 10,000 for contacts and 100,000 for events.

## Privacy review

The D7 erasure inventory now covers 30 categories, adding contact records, immutable contact events and actor-bound operation receipts. Merged identity families are included. The existing caps of 100 identities, 2,000 records per category and 10,000 total still apply. Inventory responses expose counts and fingerprints, not raw contact contents. This is review support; no data is erased.

Existing erasure checklists must be recaptured after this migration because the inventory fingerprint now includes three additional categories. Reconcile evidence after capture before closure.

D6 reviewed access packages still cover 18 categories. Their scope notice now explicitly excludes alternate contacts and private contact verification/operation history; those require separate approved review, including third-party information and operational receipts. Regenerate previously prepared packages after migration because the updated scope notice changes package bytes/checksums. Do not deliver an old prepared copy as current or complete fulfillment. Backups and downloaded copies remain operational review responsibilities.

## Deployment and verification

Apply migrations in filename order through `20261007083715_candidate_contacts_verification.sql` before deploying the frontend. No Netlify function or environment variable is added. The existing paged-workspace flag still chooses paged routing; Contacts is available in both cloud profile layouts.

Local checks: all 775 Node tests and four OCR tests passed; final contact/erasure/access migration checks passed together after the privacy changes. Lint and changed-file formatting passed. Offline Netlify packaging passed with 15 functions and a 65.1 KiB main entry. Tests cover declared/confirmed states, evidence, acknowledgement retries, stale versions, primary/alternate duplicates, workspace and viewer restrictions, private-table denial, merge preservation, retirement, UI routing and privacy inventory changes.

Local Supabase advisors could not connect to `127.0.0.1:54322`. Hosted migration/advisor checks and authenticated acceptance remain pending. Verify two workspaces, viewer denial, duplicate import rejection, confirmation/preference replacement, merge history and refreshed privacy artifacts in staging before production activation. No deployment or GitHub push was performed.

## Remaining Phase 2 work

Date-rich employment, compensation currency/basis/components, broader fact provenance and latest applicable verified values, duplicate suggestions/review queues, taxonomy/import correction, stale/incomplete fact findings and Assessor/Sales field scopes remain separate slices. Primary-contact promotion and alternate-contact search/import/export integration also remain pending; this slice establishes their identity and evidence foundation.
