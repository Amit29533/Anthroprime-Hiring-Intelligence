# Phase E2 — Internal freshness review tasks

This phase adds scheduled internal profile-review tasks. Workspace administrators explicitly enable the feature in Settings and choose 30–365 stale days (default 121). An hourly Netlify worker creates shared Notes & Tasks entries with the compact Anthro-ID. No email, SMS, provider request or candidate message is sent, and no profile facts are verified automatically.

## Eligibility and replay behavior

Candidate verification dates are interpreted against the server's UTC calendar date. A profile must be at least the configured number of days old, unmerged, available and free of a reviewed outbound hold. The latest recruiting-contact consent must be granted and not future-dated. Missing/revoked/expired consent suppresses issuance. For equal timestamps, revoked/expired records take precedence over granted records; UUID order breaks remaining ties. This uses the current consent-record model, not proof of candidate identity or external-message authorization.

Candidate locks serialize issuance with profile/hold changes and consent writes. A second eligibility check uses a fresh statement snapshot after locks are obtained. Active private receipts prevent duplicate tasks across repeated batches. Manually completing or deleting a task does not issue another while that receipt remains active. Verification changes, merge, unavailability, holds and loss of eligible consent cancel active receipts and close their tasks transactionally. Regranting consent or a later stale verification period can produce a replacement task. Completing a task does not update the candidate's verification date.

Pausing prevents new tasks and keeps existing ones. Invalidation remains active while paused. Threshold changes reconcile newly ineligible active receipts on the next worker batch; those tasks can be replaced if they later become eligible again. The worker processes at most 20 issuance candidates plus 20 cancellations per invocation (database maximum 50 each). Larger backlogs take successive hourly runs. Non-consenting older candidates are filtered before the batch limit, so they do not starve eligible profiles. Tasks are shared and initially unassigned.

## Failure handling and controls

Each task and its receipt commit together. Task failures roll back that candidate's effect, retain only a generic SQLSTATE, and allow other candidates/workspaces to progress. Retries use earliest-eligible delays of 1/2/4/8 minutes, sampled by the hourly worker. After five attempts an administrator can retry a failed receipt only while the policy is enabled and the candidate remains eligible. Paused/ineligible/cross-workspace retries fail. Repeating a retry after it is scheduled or completed returns success without duplicating work. Candidate updates or consent withdrawal can cancel failed/retrying receipts too.

Settings shows enable/pause, threshold changes, a successful global worker heartbeat, paged receipts and explicit failure retry. The heartbeat proves a successful database batch, not that every workspace's backlog is empty. Refresh the workspace to see newly created tasks. Missing migrations show an error and offer no local activation fallback.

Private policy/receipt/heartbeat tables use RLS with browser table access revoked. Administrator RPCs honor optional privileged MFA; recruiters/viewers/anonymous users cannot operate them. The scheduled worker RPC is service-role-only. Normal task visibility follows the existing workspace permissions.

## API and deployment

- `api_freshness_reviews(p_offset=0)` returns policy, global heartbeat, total and 50 receipt rows; offset 0–10,000.
- `api_set_freshness_reviews(p_enabled,p_stale_days=121)` sets the desired policy idempotently.
- `api_retry_freshness_review(p_id)` resets an eligible failed receipt for processing.
- Service-only `worker_run_freshness_reviews(p_limit=20)` returns created/retriedOrFailed/cancelled counts.

Apply all migrations in filename order through `20261007072845_internal_freshness_reviews.sql`, then deploy frontend/functions. Netlify `freshness-review-worker` runs at minute 15 each hour and uses existing `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` configuration. No new provider, secret or package is needed. The function count becomes 15. Keep the workspace policy disabled until authenticated staging acceptance, concurrent issuance/consent/hold tests, hosted advisors and scheduler verification pass. Pause to roll back issuance; retain receipts and invalidation logic.

This work is committed locally only at the user's request. No GitHub push, hosted migration, activation or deployment was performed. External communication/outbox/delivery, unsubscribe handling and real provider acceptance remain subsequent Phase E work.


## Verification

All 766 Node tests passed with zero failures, cancellations or skips (336.5 seconds), plus four Python OCR tests. The final expanded migration test separately passed retry acknowledgement replay, equal-time revocation, future-grant cancellation and bounded receipt paging. Full-chain/repeated migration checks cover disabled defaults, consent/hold gates, queue starvation prevention, tenant/role/MFA isolation, atomic task failures, five-attempt exhaustion, cross-workspace progress, verification/cancellation, threshold reconciliation and preservation of completed-task receipts. UI checks cover explicit enablement, threshold limits, bounded pages, failure retry, missing migrations and lost policy acknowledgements.

ESLint, changed-file Prettier and Git whitespace checks passed. Netlify offline build packaged all 15 functions and passed the 100 KiB entry budget at 65.0 KiB. Local security/performance advisors could not connect to port 54322. Hosted Auth/RLS/advisor, simultaneous worker/consent/hold and scheduler acceptance remain required. No hosted migration, activation, deployment or GitHub push was performed.
